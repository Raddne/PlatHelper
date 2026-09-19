// Phase 6: the WTB "interesting item" catalog scan (docs/live-scraper/
// quantframe-reference.md §B.2's collect_interesting_items, Buy branch).
// Quantframe scans its own proprietary price-stat cache in effectively no
// time; WFHelper has no such cache, so this module builds one from WFM's own
// public per-item endpoints - a continuous, low-priority background sweep of
// the full tradable catalog, entirely separate from the 1s engine tick.
//
// Cost: two WFM calls per item (order book + statistics), a third only when
// the WTB tab's Trading Tax Cap is actually enabled (the default -1 leaves it
// off, so most setups pay two). At the catalog's real size this is a genuine
// hour-plus continuous sweep, run at "background" request priority so it
// always yields to whatever the user is actively waiting on. Progress and the
// snapshot cache persist to disk so a stop/restart resumes mid-list instead
// of re-scanning from zero.
//
// This is a from-scratch approximation, not a port: see config/shared/
// liveScraperInterestingItems.ts's header for why a faithful port of
// Quantframe's own filter inputs is impossible, and what WFHelper computes
// instead for each field.

import { withScope } from "./logger";
import { createJsonCache } from "./jsonCache";
import * as wfmCatalog from "./wfmCatalog";
import { fetchItemMarketInfo } from "./liveScraperOrderBook";
import { fetchItemStatsSnapshot } from "./liveScraperItemStats";
import { getWfmSchedulerHealth } from "./wfmScheduler";
import { getInGameName } from "./wfmSession";
import { getLiveScraperSettings } from "./liveScraperSettings";
import { isThresholdDisabled } from "../config/shared/liveScraperPricing";
import {
  passesWtbFilter,
  type ItemStatSnapshot,
} from "../config/shared/liveScraperInterestingItems";
import type { ItemWtbSettings } from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperCatalogScan");

const SCAN_FILE = "live-scraper-catalog-scan.json";
const SAVE_INTERVAL_MS = 30_000;
const STEP_DELAY_MS = 25;

interface ScanFile {
  version: 1;
  snapshots: Record<string, ItemStatSnapshot>;
  scanIndex: number;
  lastFullPassAt: number | null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSnapshot(raw: unknown): ItemStatSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.wfmUrl !== "string" || !e.wfmUrl) return null;
  if (typeof e.wfmId !== "string" || !e.wfmId) return null;
  return {
    wfmUrl: e.wfmUrl,
    wfmId: e.wfmId,
    itemName: typeof e.itemName === "string" ? e.itemName : e.wfmUrl,
    profit: numOrNull(e.profit),
    profitMargin: numOrNull(e.profitMargin),
    avgPrice: numOrNull(e.avgPrice),
    volume:
      typeof e.volume === "number" && Number.isFinite(e.volume)
        ? Math.max(0, Math.floor(e.volume))
        : 0,
    weekPriceShift: numOrNull(e.weekPriceShift),
    tradingTax: numOrNull(e.tradingTax),
    scannedAt: typeof e.scannedAt === "number" ? e.scannedAt : 0,
  };
}

function normalizeScanFile(raw: unknown): ScanFile | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (e.version !== 1) return null;
  const snapshots: Record<string, ItemStatSnapshot> = {};
  if (e.snapshots && typeof e.snapshots === "object") {
    for (const [slug, value] of Object.entries(e.snapshots as Record<string, unknown>)) {
      const snap = normalizeSnapshot(value);
      if (snap) snapshots[slug] = snap;
    }
  }
  return {
    version: 1,
    snapshots,
    scanIndex:
      typeof e.scanIndex === "number" && Number.isFinite(e.scanIndex)
        ? Math.max(0, Math.floor(e.scanIndex))
        : 0,
    lastFullPassAt: typeof e.lastFullPassAt === "number" ? e.lastFullPassAt : null,
  };
}

const cache = createJsonCache<ScanFile>(SCAN_FILE, normalizeScanFile);

let _state: ScanFile = cache.read() ?? {
  version: 1,
  snapshots: {},
  scanIndex: 0,
  lastFullPassAt: null,
};
let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _lastSaveAt = 0;
let _lastScannedItemName: string | null = null;
let _catalogSize = 0;

function persist(force = false): void {
  if (!force && Date.now() - _lastSaveAt < SAVE_INTERVAL_MS) return;
  _lastSaveAt = Date.now();
  cache.write(_state);
}

/** Rankable items are bought unranked: without a rank filter the spread would
 *  compare a rank-0 seller against a max-rank buyer, and WFM refuses to create
 *  an order for them without a rank at all. */
export function wtbRankFor(item: { maxRank?: number | null }): number | null {
  return typeof item.maxRank === "number" && item.maxRank > 0 ? 0 : null;
}

async function scanOne(item: wfmCatalog.CatalogItem, wtb: ItemWtbSettings): Promise<void> {
  if (!item.url_name || !item.id) return;

  const wtbRank = wtbRankFor(item);
  const [marketInfo, stats] = await Promise.all([
    fetchItemMarketInfo(
      item.url_name,
      wtbRank != null ? { rank: wtbRank } : undefined,
      getInGameName(),
    ),
    fetchItemStatsSnapshot(item.url_name),
  ]);

  let tradingTax: number | null = null;
  if (!isThresholdDisabled(wtb.tradingTaxCap)) {
    try {
      const details = await wfmCatalog.lookupItemDetails(item.url_name);
      tradingTax = details?.tradingTax ?? null;
    } catch {
      // leave null - the tax-cap filter treats a missing value as "fails" below.
    }
  }

  const profit =
    marketInfo.lowestPrice != null && marketInfo.highestPrice != null
      ? marketInfo.lowestPrice - marketInfo.highestPrice
      : null;
  const profitMargin =
    profit != null && marketInfo.highestPrice != null && marketInfo.highestPrice > 0
      ? profit / marketInfo.highestPrice
      : null;

  _state.snapshots[item.url_name] = {
    wfmUrl: item.url_name,
    wfmId: item.id,
    itemName: item.item_name,
    wtbRank,
    profit,
    profitMargin,
    avgPrice: stats.closedAvg,
    volume: stats.tradeVolume,
    weekPriceShift: stats.weekPriceShift,
    tradingTax,
    scannedAt: Date.now(),
  };
  _lastScannedItemName = item.item_name;
}

async function scanLoop(): Promise<void> {
  _timer = null;
  if (!_running) return;

  const health = getWfmSchedulerHealth();
  if (health.state !== "ok") {
    _timer = setTimeout(() => void scanLoop(), 2000);
    return;
  }

  try {
    const items = await wfmCatalog.listAllItems();
    _catalogSize = items.length;
    if (items.length === 0) {
      _timer = setTimeout(() => void scanLoop(), 5000);
      return;
    }

    if (_state.scanIndex >= items.length) {
      _state.scanIndex = 0;
      _state.lastFullPassAt = Date.now();
      persist(true);
      log.info(`[CatalogScan] Full pass complete (${items.length} items).`);
    }

    // Settings can change mid-pass (e.g. the user toggles the tax cap); read fresh each item.
    const wtb = getLiveScraperSettings().items.wtb;

    await scanOne(items[_state.scanIndex], wtb);
    _state.scanIndex += 1;
    persist();
  } catch (err) {
    log.warn("[CatalogScan] step failed, continuing:", err);
  } finally {
    if (_running) _timer = setTimeout(() => void scanLoop(), STEP_DELAY_MS);
  }
}

export function startCatalogScan(): void {
  if (_running) return;
  _running = true;
  log.info("[CatalogScan] starting");
  _timer = setTimeout(() => void scanLoop(), STEP_DELAY_MS);
}

export function stopCatalogScan(): void {
  if (!_running) return;
  _running = false;
  if (_timer) clearTimeout(_timer);
  _timer = null;
  persist(true);
  log.info("[CatalogScan] stopped");
}

interface CatalogScanStatus {
  running: boolean;
  scannedCount: number;
  catalogSize: number;
  lastFullPassAt: number | null;
  lastScannedItemName: string | null;
}

export function getCatalogScanStatus(): CatalogScanStatus {
  return {
    running: _running,
    scannedCount: _state.scanIndex,
    catalogSize: _catalogSize,
    lastFullPassAt: _state.lastFullPassAt,
    lastScannedItemName: _lastScannedItemName,
  };
}

/** WTB candidates currently in the snapshot cache that pass the live WTB
 *  thresholds - the scan's equivalent of Quantframe's get_interesting_items.
 *  Snapshots accumulate as the scan progresses, so early in a fresh pass this
 *  can be a small or empty list; it grows toward full catalog coverage over
 *  the pass's runtime. */
export function getInterestingBuyCandidates(wtb: ItemWtbSettings): ItemStatSnapshot[] {
  const out: ItemStatSnapshot[] = [];
  for (const snapshot of Object.values(_state.snapshots)) {
    if (passesWtbFilter(snapshot, wtb)) out.push(snapshot);
  }
  return out;
}
