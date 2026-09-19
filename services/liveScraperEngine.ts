// Live Scraper engine (Phase 8): order cleanup (docs/live-scraper/
// quantframe-reference.md §B.7) now runs at the very start of every
// item-engine tick, ahead of collectInterestingItems - a one-time full wipe
// of non-blacklisted orders on the first tick after Start when autoDelete is
// on, or a narrower ongoing mode-mismatch cleanup on every later tick while
// autoDelete or deleteConflictingOrders is on. Alongside that: riven selling
// (Phase 7) as a real sub-engine next to item WTB buying (Phase 6), wishlist
// buying (Phase 4) and item WTS selling (Phase 5) - every non-hidden stock
// riven gets priced from the average of the lowest competing direct-sell
// auctions (§B.4f) and its WFM auction created/updated/deleted for real via
// liveScraperRiven. Unlike the item passes, the riven pass runs on its own
// cooldown (rivens.general.updateInterval, default 120s), not every 1s tick -
// real riven auction searches are far heavier requests than an item
// order-book fetch.
//
// Loop/status shape mirrors services/marketAlerts.ts, the house pattern for an
// always-on WFM-polling engine (see docs/live-scraper/wfhelper-infra-map.md §6).

import { withScope } from "./logger";
import { getWfmSchedulerHealth } from "./wfmScheduler";
import { getLiveScraperSettings } from "./liveScraperSettings";
import { listStockItems, listWishlistItems } from "./liveScraperStock";
import { listStockRivens } from "./liveScraperRivenStock";
import { fetchItemMarketInfo } from "./liveScraperOrderBook";
import { fetchPriceBySlug } from "./wfmStatsPrice";
import { getMyOrders, type NormalisedOrder } from "./wfmOrders";
import { progressWishlistItem } from "./liveScraperWishlist";
import { progressStockItem } from "./liveScraperSell";
import { progressStockRiven } from "./liveScraperRiven";
import {
  priceBuyingItem,
  dispatchBuyingItem,
  type BuyPricing,
  type BuyProgressResult,
} from "./liveScraperBuy";
import { runOrderCleanup } from "./liveScraperOrderCleanup";
import { syncAdoptedSellOrders } from "./liveScraperAdopt";
import { lookupBySlug } from "./wfmCatalog";
import {
  wtbRankFor,
  startCatalogScan,
  stopCatalogScan,
  getInterestingBuyCandidates,
  getCatalogScanStatus,
} from "./liveScraperCatalogScan";
import { solveKnapsack, type KnapsackCandidate } from "../config/shared/liveScraperKnapsack";
import { isThresholdDisabled } from "../config/shared/liveScraperPricing";
import { isBlacklisted } from "../config/shared/liveScraperStock";
import { rotateBatch } from "../config/shared/rotateBatch";
import { syncAdoptedRivenAuctions } from "./liveScraperRivenAdopt";
import type { StockItem, WishlistItem } from "../config/shared/liveScraperStock";
import type {
  LiveScraperEngineStatus,
  LiveScraperWtbListing,
} from "../config/shared/liveScraperEngine";
import type { ItemWtbSettings } from "../config/shared/liveScraperSettings";
import type { ItemStatSnapshot } from "../config/shared/liveScraperInterestingItems";

const log = withScope("liveScraperEngine");

const TICK_MS = 1000;
const INITIAL_DELAY_MS = 2000;

interface EngineDeps {
  onChanged: () => void;
  /** Signed-in WFM name, for excluding the user's own listings from competing
   *  order books (mirrors services/marketAlerts.ts's getOwnName dependency). */
  getOwnName: () => string | null;
}

let _deps: EngineDeps | null = null;
let _running = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _startTimer: ReturnType<typeof setTimeout> | null = null;
let _ticking = false;
let _tickCount = 0;
let _lastTickAt: number | null = null;
let _lastMessage: string | null = null;
let _lastError: string | null = null;
let _lastRivenPassAt: number | null = null;
/** True only during the very first tick of a Start session (docs §B.1 step 4:
 *  cleared unconditionally after every tick completes, regardless of
 *  stockMode) - gates the one-time full-wipe branch in the order-cleanup
 *  pass (§B.7) versus the narrower ongoing mode-mismatch cleanup. */
let _justStarted = false;
/** Round-robin cursor into the catalog scan's current "interesting" list -
 *  see MAX_WTB_CANDIDATES_PER_TICK below for why this exists. */
let _wtbRotationOffset = 0;

/** Quantframe's own WTB source is its backend's pre-filtered price-stat cache
 *  (docs §B.2), which is small by construction. WFHelper's catalog-scan
 *  approximation (Phase 6) has no such pre-filtering - under realistic
 *  thresholds it can match dozens to hundreds of the 3800+ tradable items.
 *  Pricing+dispatching every match in one tick, sequentially, at up to 3 real
 *  WFM requests each, can turn a single tick into a multi-minute stall with
 *  the UI stuck showing nothing but "Starting..." (the status only updates
 *  once the tick's whole try block finishes). Capping the batch and rotating
 *  through the full candidate list across ticks keeps every tick fast and
 *  makes progress visible, at the cost of a slower cycle time per item when
 *  there are more candidates than fit in one batch. */
const MAX_WTB_CANDIDATES_PER_TICK = 15;

/** Picks up to `batchSize` candidates starting at the rotation cursor,
 *  wrapping around, and advances the cursor by however many were selected -
 *  so every candidate gets a turn over successive ticks instead of the same
 *  prefix winning forever. */
function selectWtbBatch(candidates: readonly ItemStatSnapshot[]): ItemStatSnapshot[] {
  const batch = rotateBatch(candidates, _wtbRotationOffset, MAX_WTB_CANDIDATES_PER_TICK);
  _wtbRotationOffset = batch.nextOffset;
  return batch.items;
}

// Same idea for stock/wishlist entries. warframe.market allows roughly three
// requests a second per IP, so an account with hundreds of listings needs
// minutes for one full round whatever the code does. Working through them in
// rotating blocks keeps every tick short: Stop, settings changes, the WTB pass
// and the riven pass no longer wait for the whole round.
const MAX_ENTRIES_PER_TICK = 40;
let _entryRotationOffset = 0;

function selectEntryBatch(entries: readonly InterestingEntry[]): InterestingEntry[] {
  const batch = rotateBatch(entries, _entryRotationOffset, MAX_ENTRIES_PER_TICK);
  _entryRotationOffset = batch.nextOffset;
  return batch.items;
}

// The 48h closed average barely moves within an hour, and the shared stats
// cache (5 min) never hits when one round over a large stock takes longer than
// that. Remembering it here turns every round after the first into one request
// per listing instead of two.
const CLOSED_AVG_TTL_MS = 60 * 60 * 1000;
const _closedAvgMemo = new Map<string, { value: number | null; at: number }>();

async function closedAvgFor(wfmUrl: string): Promise<number | null> {
  const hit = _closedAvgMemo.get(wfmUrl);
  if (hit && Date.now() - hit.at < CLOSED_AVG_TTL_MS) return hit.value;
  const value = await fetchPriceBySlug(wfmUrl);
  // A failed fetch comes back as null too; do not pin that for an hour.
  if (value != null) _closedAvgMemo.set(wfmUrl, { value, at: Date.now() });
  return value;
}

const _wtbListings = new Map<string, LiveScraperWtbListing>();

function wtbListingStatus(
  pricing: BuyPricing,
  result: BuyProgressResult,
): LiveScraperWtbListing["status"] {
  if (result.orderLimitReached) return "orderLimit";
  if (result.error) return "error";
  const ops = pricing.ops;
  if (ops.has("Skip")) return "budget";
  if (ops.has("Overpriced")) return "overpriced";
  if (ops.has("Underpriced")) return "underpriced";
  if (ops.has("AboveAvgPrice")) return "aboveAvgPrice";
  if (ops.has("Delete")) return "stockLimit";
  return "live";
}

function recordWtbListing(pricing: BuyPricing, result: BuyProgressResult, quantity: number): void {
  const status = wtbListingStatus(pricing, result);
  // A failed mutation leaves whatever order existed before untouched.
  const orderUp =
    status === "live" ||
    ((status === "error" || status === "orderLimit") && pricing.existingOrder != null);
  _wtbListings.set(pricing.wfmUrl, {
    wfmUrl: pricing.wfmUrl,
    wfmId: pricing.catalogId,
    itemName: pricing.itemName,
    status,
    listPrice: !orderUp
      ? null
      : status === "live"
        ? pricing.postPrice
        : (pricing.existingOrder?.platinum ?? null),
    potentialProfit: Number.isFinite(pricing.potentialProfit) ? pricing.potentialProfit : null,
    quantity,
    updatedAt: Date.now(),
  });
}

export function initLiveScraperEngine(deps: EngineDeps): void {
  _deps = deps;
}

function emitChanged(): void {
  _deps?.onChanged();
}

let _lastProgressEmitAt = 0;
const PROGRESS_EMIT_MIN_INTERVAL_MS = 750;

/** Publishes an in-progress status line so a long WTB batch doesn't look
 *  frozen (the renderer's live-scraper:changed handler re-fetches several
 *  lists, including a riven re-decode - firing it once per candidate would
 *  add real CPU cost on top of the very requests this is meant to make
 *  visible, so this is time-throttled rather than called unconditionally). */
function emitProgress(message: string): void {
  _lastMessage = message;
  const now = Date.now();
  if (now - _lastProgressEmitAt < PROGRESS_EMIT_MIN_INTERVAL_MS) return;
  _lastProgressEmitAt = now;
  emitChanged();
}

interface InterestingEntry {
  kind: "sell" | "wishlist";
  item: StockItem | WishlistItem;
}

/** Mirrors Quantframe's collect_interesting_items for the two DB-backed modes
 *  (docs §B.2): Sell reads the stock table, Wishlist reads the wishlist table,
 *  both filtered by blacklist + active trade mode. Buy (WTB) is handled
 *  separately by processWtbCandidates below — its candidates come from the
 *  catalog scan's snapshot cache, not a persisted table, so it doesn't fit
 *  this StockItem/WishlistItem-shaped list. */
function collectInterestingItems(): InterestingEntry[] {
  const settings = getLiveScraperSettings();
  const modes = settings.general.tradeModes;
  const blacklist = settings.items.general.blacklist;
  const entries: InterestingEntry[] = [];

  if (modes.includes("sell")) {
    for (const item of listStockItems()) {
      if (item.isHidden) continue;
      if (isBlacklisted(blacklist, item.wfmId, item.subType, "sell")) continue;
      entries.push({ kind: "sell", item });
    }
  }

  if (modes.includes("wishlist")) {
    for (const item of listWishlistItems()) {
      if (item.isHidden) continue;
      if (isBlacklisted(blacklist, item.wfmId, item.subType, "wishlist")) continue;
      entries.push({ kind: "wishlist", item });
    }
  }

  return entries;
}

/** Prices every WTB candidate the catalog scan currently considers
 *  "interesting" (docs §B.2 Buy branch), runs a single knapsack pass against
 *  the WTB tab's total-budget cap (§B.8 — see config/shared/liveScraperKnapsack.ts
 *  for the scope simplification vs. Quantframe's two-pass version), then
 *  dispatches every candidate's create/update/delete. Candidates a knapsack
 *  loser would otherwise never touch WFM for get "Skip"+"Delete" added so an
 *  existing live order for them is torn down like any other rejected item. */
async function processWtbCandidates(
  candidates: readonly ItemStatSnapshot[],
  myBuyOrders: readonly NormalisedOrder[],
  ownName: string | null,
  wtb: ItemWtbSettings,
  onProgress?: (message: string) => void,
): Promise<{ processed: number; mutations: number; orderLimitReached: boolean }> {
  const settings = getLiveScraperSettings();
  const blacklist = settings.items.general.blacklist;
  const buyList = settings.items.general.buyList;

  const pricings: BuyPricing[] = [];
  let priced = 0;
  for (const candidate of candidates) {
    if (!_running) break;
    onProgress?.(
      `Pricing WTB candidate ${priced + 1}/${candidates.length} (${candidate.itemName})...`,
    );
    // Same rank the order itself is posted at (priceBuyingItem / wtbRankFor).
    const catalogItem = await lookupBySlug(candidate.wfmUrl);
    const wtbRank = catalogItem ? wtbRankFor(catalogItem) : (candidate.wtbRank ?? null);
    const [marketInfo, closedAvg] = await Promise.all([
      fetchItemMarketInfo(
        candidate.wfmUrl,
        wtbRank != null ? { rank: wtbRank } : undefined,
        ownName,
      ),
      fetchPriceBySlug(candidate.wfmUrl),
    ]);
    const pricing = await priceBuyingItem(
      candidate,
      marketInfo,
      closedAvg,
      myBuyOrders,
      wtb,
      blacklist,
      buyList,
    );
    if (pricing) pricings.push(pricing);
    priced += 1;
  }

  if (!isThresholdDisabled(wtb.maxTotalPriceCap)) {
    const knapsackInput: KnapsackCandidate[] = pricings
      .filter((p) => !p.rejected)
      .map((p) => ({ id: p.wfmUrl, weight: p.postPrice, value: p.potentialProfit }));
    const selected = solveKnapsack(knapsackInput, wtb.maxTotalPriceCap);
    for (const pricing of pricings) {
      if (!pricing.rejected && !selected.has(pricing.wfmUrl)) {
        pricing.ops.add("Skip");
        pricing.ops.add("Delete");
      }
    }
  }

  let mutations = 0;
  let dispatched = 0;
  let orderLimitReached = false;
  for (const pricing of pricings) {
    if (!_running) break;
    // Once WFM has rejected a create for hitting the account's total-order
    // cap, every further create this pass would fail identically - stop
    // spending requests on it. Updates/deletes for already-existing orders
    // are unaffected (the cap only gates new creates) and keep going.
    if (orderLimitReached && !pricing.existingOrder && !pricing.rejected) continue;

    onProgress?.(
      `Dispatching WTB order ${dispatched + 1}/${pricings.length} (${pricing.itemName})...`,
    );
    const result = await dispatchBuyingItem(pricing, wtb.buyQuantity);
    dispatched += 1;
    recordWtbListing(pricing, result, wtb.buyQuantity);
    if (result.orderLimitReached) orderLimitReached = true;
    if (result.action === "created" || result.action === "updated" || result.action === "deleted") {
      mutations += 1;
    }
    log.info(
      `[Tick ${_tickCount}] wtb ${result.itemName}: ${result.action} ` +
        `price=${result.price ?? "-"} order=${result.orderId ?? "-"}` +
        (result.error ? ` error=${result.error}` : ""),
    );
  }
  if (orderLimitReached) {
    log.warn(
      `[Tick ${_tickCount}] WTB: WFM order limit reached - stopped after ${dispatched}/${pricings.length} candidate(s) this tick.`,
    );
  }

  return { processed: pricings.length, mutations, orderLimitReached };
}

/** Riven selling runs on its own cooldown (rivens.general.updateInterval),
 *  independent of the item passes' 1s cadence - a real auction search per
 *  riven is a much heavier request than an item order-book fetch, and
 *  Quantframe gates it the same way (docs §B.1). Returns null when the
 *  cooldown hasn't elapsed yet or there's nothing to sell, so the caller can
 *  leave the tick's message untouched. */
/** Makes the next tick re-price the rivens instead of waiting out the cooldown;
 *  called when the user edits a riven row or the riven settings. */
export function requestRivenPass(): void {
  _lastRivenPassAt = null;
}

async function maybeProcessRivenPass(
  settings: ReturnType<typeof getLiveScraperSettings>,
): Promise<string | null> {
  const intervalMs = Math.max(1, settings.rivens.general.updateInterval) * 1000;
  if (_lastRivenPassAt != null && Date.now() - _lastRivenPassAt < intervalMs) return null;

  _lastRivenPassAt = Date.now();
  // Pick up auctions the user already has on warframe.market before pricing.
  try {
    emitProgress("Checking riven auctions...");
    await syncAdoptedRivenAuctions();
  } catch (err) {
    log.warn("[Tick] failed to fetch my riven auctions; adoption skipped this pass:", err);
  }
  const rivens = listStockRivens().filter((r) => !r.isHidden || r.status !== "inactive");
  if (rivens.length === 0) return null;

  const ownName = _deps?.getOwnName() ?? null;
  let mutations = 0;
  for (const riven of rivens) {
    if (!_running) break;
    const result = await progressStockRiven(riven, settings.rivens.wts, ownName);
    if (result.action === "created" || result.action === "updated" || result.action === "deleted") {
      mutations += 1;
    }
    log.info(
      `[Tick ${_tickCount}] riven ${result.itemName}: ${result.action} ` +
        `price=${result.price ?? "-"} auction=${result.auctionId ?? "-"}` +
        (result.error ? ` error=${result.error}` : ""),
    );
  }
  return `Rivens: processed ${rivens.length} - ${mutations} auction(s) created/updated/deleted.`;
}

async function tick(): Promise<void> {
  if (!_running || _ticking) return;
  _ticking = true;
  try {
    const health = getWfmSchedulerHealth();
    if (health.state !== "ok") {
      _lastMessage = `Waiting for warframe.market request budget to recover (${health.state}).`;
      emitChanged();
      return;
    }

    const settings = getLiveScraperSettings();
    let cleanupSummary: string | null = null;
    let cleanupOrdersSnapshot: { buy: NormalisedOrder[]; sell: NormalisedOrder[] } | null = null;
    if (settings.general.stockMode === "riven") {
      _lastMessage = "Engine mode is Rivens-only; item processing skipped this tick.";
    } else {
      // Order cleanup (§B.7) runs before anything else in the item engine's
      // tick, on the same live order snapshot the buy/sell dispatch below
      // reuses (fetched once, not once per phase).
      if (settings.general.autoDelete || settings.general.deleteConflictingOrders) {
        try {
          // Emitted immediately (not just at tick's end) so the UI shows real
          // progress instead of a frozen "Starting..." while this - and the
          // WTB pricing/dispatch below - can each take a real, visible amount
          // of time.
          emitProgress("Cleaning up orders...");
          const mine = await getMyOrders();
          const result = await runOrderCleanup(settings, mine, _justStarted, () => _running);
          const deletedIds = new Set(result.deletedIds);
          cleanupOrdersSnapshot = {
            buy: mine.buy.filter((o) => !deletedIds.has(o.id)),
            sell: mine.sell.filter((o) => !deletedIds.has(o.id)),
          };
          if (result.attempted > 0) {
            cleanupSummary =
              `Cleanup: deleted ${result.deleted}/${result.attempted} order(s)` +
              (_justStarted ? " (full wipe on start)" : " (mode mismatch)") +
              (result.failed > 0 ? ` - ${result.failed} failed` : "");
          }
        } catch (err) {
          log.warn("[Tick] order cleanup skipped; failed to fetch my orders:", err);
        }
      }

      // Pick up sell orders the user already has on WFM so the WTS pass below
      // re-prices them too. Reuses the cleanup's snapshot when there is one,
      // and only ever runs on a fetch that succeeded.
      if (settings.general.tradeModes.includes("sell")) {
        if (!cleanupOrdersSnapshot) {
          try {
            const mine = await getMyOrders();
            cleanupOrdersSnapshot = { buy: mine.buy, sell: mine.sell };
          } catch (err) {
            log.warn(
              "[Tick] failed to fetch my orders; sell-order adoption skipped this tick:",
              err,
            );
          }
        }
        if (cleanupOrdersSnapshot) syncAdoptedSellOrders(cleanupOrdersSnapshot.sell);
      }

      const entries = collectInterestingItems();
      const wtbActive = settings.general.tradeModes.includes("buy");
      const wtbCandidates = wtbActive ? getInterestingBuyCandidates(settings.items.wtb) : [];

      if (entries.length === 0 && wtbCandidates.length === 0) {
        if (wtbActive) {
          const scanStatus = getCatalogScanStatus();
          _lastMessage =
            "No eligible stock/wishlist items and no WTB candidates yet " +
            `[scan ${scanStatus.scannedCount}/${scanStatus.catalogSize || "?"}].`;
        } else {
          _lastMessage = "No eligible stock or wishlist items this tick.";
        }
      } else {
        const ownName = _deps?.getOwnName() ?? null;
        // Fetch the live order snapshot once per tick, not once per item -
        // only needed at all when some entry this tick might actually mutate
        // an order (see docs/live-scraper/wfhelper-infra-map.md §1: WFHelper
        // has no standing order cache, so this is always a fresh call).
        const hasWishlistEntry = entries.some((e) => e.kind === "wishlist");
        const hasSellEntry = entries.some((e) => e.kind === "sell");
        let myBuyOrders: NormalisedOrder[] = [];
        let mySellOrders: NormalisedOrder[] = [];
        if (hasWishlistEntry || hasSellEntry || wtbCandidates.length > 0) {
          if (cleanupOrdersSnapshot) {
            myBuyOrders = cleanupOrdersSnapshot.buy;
            mySellOrders = cleanupOrdersSnapshot.sell;
          } else {
            try {
              const mine = await getMyOrders();
              myBuyOrders = mine.buy;
              mySellOrders = mine.sell;
            } catch (err) {
              log.warn("[Tick] failed to fetch my orders; buying/selling skipped this tick:", err);
            }
          }
        }

        let processed = 0;
        let mutations = 0;
        const entryBatch = selectEntryBatch(entries);
        // The moving-average floor is the only consumer of the closed average
        // on the sell side; with it switched off the request is pure waste.
        const sellNeedsClosedAvg = !isThresholdDisabled(settings.items.wts.minSma);
        for (const entry of entryBatch) {
          // A stop requested mid-cycle must not keep firing WFM requests.
          if (!_running) break;
          const item = entry.item;
          emitProgress(
            `${entry.kind === "sell" ? "Selling" : "Wishlist"} ${processed + 1}/${entryBatch.length}: ${item.itemName}` +
              (entries.length > entryBatch.length ? ` (${entries.length} tracked, rotating)` : ""),
          );
          const [marketInfo, closedAvg] = await Promise.all([
            fetchItemMarketInfo(item.wfmUrl, item.subType, ownName),
            entry.kind === "sell" && !sellNeedsClosedAvg
              ? Promise.resolve(null)
              : closedAvgFor(item.wfmUrl),
          ]);
          processed += 1;

          if (entry.kind === "wishlist") {
            const result = await progressWishlistItem(
              item as WishlistItem,
              marketInfo,
              closedAvg,
              myBuyOrders,
            );
            if (
              result.action === "created" ||
              result.action === "updated" ||
              result.action === "deleted"
            ) {
              mutations += 1;
            }
            log.info(
              `[Tick ${_tickCount}] wishlist ${result.itemName}: ${result.action} ` +
                `price=${result.price ?? "-"} order=${result.orderId ?? "-"}` +
                (result.error ? ` error=${result.error}` : ""),
            );
          } else {
            const result = await progressStockItem(
              item as StockItem,
              marketInfo,
              closedAvg,
              mySellOrders,
              settings.items.wts,
            );
            if (
              result.action === "created" ||
              result.action === "updated" ||
              result.action === "deleted"
            ) {
              mutations += 1;
            }
            log.info(
              `[Tick ${_tickCount}] sell ${result.itemName}: ${result.action} ` +
                `price=${result.price ?? "-"} order=${result.orderId ?? "-"}` +
                (result.error ? ` error=${result.error}` : ""),
            );
          }
        }

        let wtbProcessed = 0;
        let wtbBatchSize = 0;
        let wtbOrderLimitReached = false;
        if (_running && wtbCandidates.length > 0) {
          const batch = selectWtbBatch(wtbCandidates);
          wtbBatchSize = batch.length;
          const wtbResult = await processWtbCandidates(
            batch,
            myBuyOrders,
            ownName,
            settings.items.wtb,
            emitProgress,
          );
          wtbProcessed = wtbResult.processed;
          mutations += wtbResult.mutations;
          wtbOrderLimitReached = wtbResult.orderLimitReached;
        }

        const sellCount = entries.filter((e) => e.kind === "sell").length;
        const wishlistCount = entries.filter((e) => e.kind === "wishlist").length;
        const scanStatus = wtbActive ? getCatalogScanStatus() : null;
        _lastMessage =
          `Processed ${processed}/${entryBatch.length} item(s)` +
          (entries.length > entryBatch.length ? ` of ${entries.length} (rotating)` : "") +
          ` (${sellCount} sell, ${wishlistCount} wishlist)` +
          (wtbActive
            ? `, ${wtbProcessed}/${wtbBatchSize} WTB candidate(s) this tick` +
              (wtbCandidates.length > wtbBatchSize
                ? ` (of ${wtbCandidates.length} interesting, rotating)`
                : "") +
              (scanStatus
                ? ` [scan ${scanStatus.scannedCount}/${scanStatus.catalogSize || "?"}]`
                : "")
            : "") +
          ` - ${mutations} order(s) created/updated/deleted.` +
          (wtbOrderLimitReached
            ? " WFM order limit reached - some WTB buys skipped this tick."
            : "");
      }
    }

    if (cleanupSummary) _lastMessage = `${_lastMessage} | ${cleanupSummary}`;

    if (_running && settings.general.stockMode !== "item") {
      const rivenMessage = await maybeProcessRivenPass(settings);
      if (rivenMessage) _lastMessage = `${_lastMessage} | ${rivenMessage}`;
    }

    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    log.error("Tick failed:", _lastError);
  } finally {
    _tickCount += 1;
    _lastTickAt = Date.now();
    _ticking = false;
    // Consumed once by the cleanup pass above - only tick #1 of a session
    // ever sees justStarted=true (docs §B.1 step 4: cleared after every full
    // iteration, regardless of which sub-systems ran that tick).
    _justStarted = false;
    emitChanged();
  }
}

export function startLiveScraperEngine(): LiveScraperEngineStatus {
  if (_running) return getLiveScraperEngineStatus();
  _running = true;
  _tickCount = 0;
  _justStarted = true;
  _lastMessage = "Starting...";
  _lastError = null;
  _wtbListings.clear();

  // The catalog scan is its own continuous background loop (services/
  // liveScraperCatalogScan.ts), independent of the 1s tick - only started
  // when Buy is an active trade mode, since it exists purely to feed WTB
  // candidates.
  if (getLiveScraperSettings().general.tradeModes.includes("buy")) {
    startCatalogScan();
  }

  if (_startTimer) clearTimeout(_startTimer);
  if (_timer) clearInterval(_timer);
  _startTimer = setTimeout(() => {
    _startTimer = null;
    void tick();
    _timer = setInterval(() => void tick(), TICK_MS);
  }, INITIAL_DELAY_MS);

  emitChanged();
  return getLiveScraperEngineStatus();
}

export function stopLiveScraperEngine(): LiveScraperEngineStatus {
  _running = false;
  if (_timer) clearInterval(_timer);
  if (_startTimer) clearTimeout(_startTimer);
  _timer = null;
  _startTimer = null;
  _lastMessage = "Stopped.";
  stopCatalogScan();
  emitChanged();
  return getLiveScraperEngineStatus();
}

export function getLiveScraperEngineStatus(): LiveScraperEngineStatus {
  return {
    running: _running,
    lastTickAt: _lastTickAt,
    tickCount: _tickCount,
    lastMessage: _lastMessage,
    lastError: _lastError,
    scheduler: getWfmSchedulerHealth(),
    wtbListings: [..._wtbListings.values()],
  };
}
