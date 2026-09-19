// WTB catalog scan support: one v1 statistics fetch per item yielding both the
// 48h closed average (same figure services/wfmStatsPrice.ts exposes for
// wishlist/WTS pricing) and the week-over-week price shift (config/shared/
// wfmWeeklyShift.ts). Kept as its own cache rather than sharing wfmStatsPrice's
// - that module only stores the derived number, not the raw payload the shift
// calculation also needs, and folding the two would mean either re-fetching or
// reshaping an already-shipped, well-tested cache. The duplication costs one
// extra WFM call only for items that are both scanned and separately priced by
// wishlist/WTS in the same session - acceptable, not worth the coupling.

import { withScope } from "./logger";
import * as wfmClient from "./wfmClient";
import { extractAverageFromStatsPayload } from "../config/shared/wfmStats";
import { extractWeekPriceShiftPercent } from "../config/shared/wfmWeeklyShift";
import { normalizeErrorMessage } from "../config/shared/errors";
import { normalizeWfmSlug } from "../config/shared/wfm";
import { WFM_STATS_CACHE_TTL_MS } from "../config/runtime/cacheConfig";

const log = withScope("liveScraperItemStats");

interface ItemStatsSnapshot {
  closedAvg: number | null;
  weekPriceShift: number | null;
  /** Summed traded quantity across the 48h window's sell-side rows (the same
   *  volume figure extractAverageFromStatsPayload already computes internally
   *  to weight its average) - stands in for Quantframe's item.volume in the
   *  WTB "interesting item" filter (config/shared/liveScraperInterestingItems.ts). */
  tradeVolume: number;
}

const EMPTY_SNAPSHOT: ItemStatsSnapshot = { closedAvg: null, weekPriceShift: null, tradeVolume: 0 };

interface CacheEntry {
  snapshot: ItemStatsSnapshot;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ItemStatsSnapshot>>();
const CACHE_MAX_ENTRIES = 20_000;

function getCached(slug: string): ItemStatsSnapshot | null {
  const hit = cache.get(slug);
  if (!hit) return null;
  if (Date.now() - hit.ts > WFM_STATS_CACHE_TTL_MS) {
    cache.delete(slug);
    return null;
  }
  return hit.snapshot;
}

function setCached(slug: string, snapshot: ItemStatsSnapshot): void {
  if (!cache.has(slug) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(slug, { snapshot, ts: Date.now() });
}

export async function fetchItemStatsSnapshot(slugInput: unknown): Promise<ItemStatsSnapshot> {
  const slug = normalizeWfmSlug(typeof slugInput === "string" ? slugInput : null);
  if (!slug) return EMPTY_SNAPSHOT;

  const cached = getCached(slug);
  if (cached != null) return cached;

  const pending = inFlight.get(slug);
  if (pending) return pending;

  const task = (async (): Promise<ItemStatsSnapshot> => {
    try {
      const payload = await wfmClient.request("GET", `/items/${slug}/statistics`, {
        priority: "background",
      });
      const closed = extractAverageFromStatsPayload(payload);
      const snapshot: ItemStatsSnapshot = {
        closedAvg: closed?.average ?? null,
        weekPriceShift: extractWeekPriceShiftPercent(payload),
        tradeVolume: closed?.volume ?? 0,
      };
      setCached(slug, snapshot);
      return snapshot;
    } catch (err) {
      log.warn(`[WFM] item stats fetch failed for ${slug}:`, normalizeErrorMessage(err));
      return EMPTY_SNAPSHOT;
    } finally {
      inFlight.delete(slug);
    }
  })();

  inFlight.set(slug, task);
  return task;
}
