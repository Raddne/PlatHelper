// Phase 6: item WTB buying - progress_buying (docs/live-scraper/quantframe-
// reference.md §B.4b), the pricing half only. Candidates come from the
// catalog scan's snapshot cache (services/liveScraperCatalogScan.ts, §B.2's
// Buy branch), but pricing itself always uses a fresh per-tick order book and
// closed average, exactly like wishlist/WTS - the scan snapshot only decides
// *which* items are worth looking at this tick, never the price itself.
//
// Split from dispatch (dispatchBuyingItem, and the knapsack pass in between)
// because Quantframe's per-item budget check (§B.8 point 1) needs to see every
// candidate's computed price/profit *before* any of them are sent to WFM -
// liveScraperEngine.ts prices every WTB candidate this tick, runs the knapsack
// solver once over the whole batch, then dispatches. See config/shared/
// liveScraperKnapsack.ts's header for the scope simplification vs. Quantframe's
// two-pass version.
//
// Scope simplification: WTB only ever buys the base listing of an item - for
// rankable items (mods/arcanes) that means rank 0, which WFM requires on the
// order anyway (wtbRankFor in liveScraperCatalogScan.ts). No automated buying
// of a specific higher mod rank or relic refinement.

import { withScope } from "./logger";
import * as wfmCatalog from "./wfmCatalog";
import { listStockItems } from "./liveScraperStock";
import { wtbRankFor } from "./liveScraperCatalogScan";
import { isBlacklisted } from "../config/shared/liveScraperStock";
import { matchExistingOrder } from "./liveScraperOrderMatch";
import { dispatchOrder, type DispatchOrderResult } from "./liveScraperOrderDispatch";
import { isOwnedOrder } from "./liveScraperOwnedOrders";
import { shouldApplyMaxPriceDrop, isThresholdDisabled } from "../config/shared/liveScraperPricing";
import type { NormalisedOrder } from "./wfmOrders";
import type { ItemMarketInfo } from "./liveScraperOrderBook";
import type { ItemStatSnapshot } from "../config/shared/liveScraperInterestingItems";
import type {
  BlacklistEntry,
  BuyListEntry,
  ItemWtbSettings,
} from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperBuy");

export interface BuyPricing {
  wfmUrl: string;
  itemName: string;
  catalogId: string;
  /** 0 for rankable items, null otherwise - see wtbRankFor. */
  rank: number | null;
  existingOrder: NormalisedOrder | null;
  ops: Set<string>;
  postPrice: number;
  /** closedAvg - postPrice - 1; the knapsack "value" (docs §B.4b step 4/§B.8). */
  potentialProfit: number;
  /** True once ops already contains "Delete" - the knapsack step is skipped
   *  for these (nothing to gain by keeping them alive for the budget check). */
  rejected: boolean;
}

/** Steps 1-6, 8, 9 of progress_buying - everything except the knapsack budget
 *  check (§B.8, applied by the caller across the whole tick's candidates) and
 *  the actual WFM dispatch (dispatchBuyingItem, below). Returns null when the
 *  item is blacklisted, not in the WFM catalog, or has no competing market on
 *  either side - these never become knapsack candidates at all. */
export async function priceBuyingItem(
  snapshot: ItemStatSnapshot,
  marketInfo: ItemMarketInfo,
  closedAvg: number | null,
  myBuyOrders: readonly NormalisedOrder[],
  wtb: ItemWtbSettings,
  blacklist: readonly BlacklistEntry[],
  buyList: readonly BuyListEntry[],
): Promise<BuyPricing | null> {
  const catalogItem = await wfmCatalog.lookupBySlug(snapshot.wfmUrl);
  if (!catalogItem?.id) {
    log.warn(
      `[LiveScraperBuy] "${snapshot.itemName}" (${snapshot.wfmUrl}) not found in WFM catalog`,
    );
    return null;
  }

  // 1. Blacklist gate - WTB candidates are always the base/no-variant listing.
  if (isBlacklisted(blacklist, catalogItem.id, undefined, "buy")) return null;

  // 2. No-volume gate
  if (marketInfo.buyVolume === 0 || marketInfo.sellVolume === 0) return null;

  const rank = wtbRankFor(catalogItem);
  const existing = matchExistingOrder(myBuyOrders, catalogItem.id, rank, null);
  // A buy order the user placed by hand: not ours to re-price or take down.
  if (existing && !isOwnedOrder(existing.id)) return null;
  const ops = new Set<string>();
  ops.add(existing ? "Update" : "Create");

  // 3. Max stock quantity gate
  if (!isThresholdDisabled(wtb.maxStockQuantity)) {
    const stockItem = listStockItems().find(
      (item) =>
        item.wfmId === catalogItem.id &&
        (item.subType?.rank ?? null) === rank &&
        !item.subType?.subtype,
    );
    if (stockItem && stockItem.owned >= wtb.maxStockQuantity) {
      ops.add("Delete");
      return {
        wfmUrl: snapshot.wfmUrl,
        itemName: snapshot.itemName,
        catalogId: catalogItem.id,
        rank,
        existingOrder: existing,
        ops,
        postPrice: 1,
        potentialProfit: -Infinity,
        rejected: true,
      };
    }
  }

  let postPrice = marketInfo.highestPrice ?? 0;

  // 4. Damping guard
  const currentOrderPrice = existing?.platinum ?? 0;
  const dampingReason = shouldApplyMaxPriceDrop(
    wtb.maxPriceDrop,
    wtb.minListingsBelow,
    currentOrderPrice,
    postPrice,
    marketInfo.buyPrices,
    "buy",
  );
  if (dampingReason) {
    postPrice = currentOrderPrice;
    ops.add(dampingReason);
  }

  const closedAvgMetric = (closedAvg ?? 0) - postPrice;
  const potentialProfit = closedAvgMetric - 1;

  // 5. Per-item max price override (buy list)
  const buyListEntry = buyList.find((entry) => entry.wfmId === catalogItem.id);
  if (buyListEntry && buyListEntry.maxPrice > 0 && postPrice > buyListEntry.maxPrice) {
    ops.add("AboveMaxBuyPrice");
    postPrice = buyListEntry.maxPrice;
  }

  // 6. Global average price cap
  if (!isThresholdDisabled(wtb.avgPriceCap) && postPrice > wtb.avgPriceCap) {
    ops.add("AboveAvgPrice");
    ops.add("Delete");
  }

  // 8. Overpriced check
  if (closedAvgMetric < 0) {
    ops.add("Delete");
    ops.add("Overpriced");
  }

  // 9. Underpriced / spread-too-thin check (market_info.price_range - see §B.3)
  const priceRange =
    marketInfo.lowestPrice != null && marketInfo.highestPrice != null
      ? marketInfo.lowestPrice - marketInfo.highestPrice
      : -Infinity;
  if (priceRange < wtb.profitThreshold) {
    ops.add("Delete");
    ops.add("Underpriced");
  }

  postPrice = Math.max(postPrice, 1);

  return {
    wfmUrl: snapshot.wfmUrl,
    itemName: snapshot.itemName,
    catalogId: catalogItem.id,
    rank,
    existingOrder: existing,
    ops,
    postPrice,
    potentialProfit,
    rejected: ops.has("Delete"),
  };
}

export interface BuyProgressResult {
  itemName: string;
  action: DispatchOrderResult["action"];
  orderId: string | null;
  price: number | null;
  error?: string;
  orderLimitReached?: boolean;
  /** Order visibility after the call; undefined when no order is left. */
  visible?: boolean;
}

/** Applies the caller's knapsack verdict (ops may already have "Skip"+"Delete"
 *  added for a rejected candidate - see liveScraperEngine.ts) and dispatches
 *  the WFM order mutation. `hiddenOnWfm` creates a new order hidden. */
export async function dispatchBuyingItem(
  pricing: BuyPricing,
  quantity: number,
  hiddenOnWfm = false,
): Promise<BuyProgressResult> {
  const dispatch = await dispatchOrder({
    orderType: "buy",
    postPrice: pricing.postPrice,
    quantity,
    modRank: pricing.rank,
    subtype: null,
    itemId: pricing.catalogId,
    existingOrder: pricing.existingOrder,
    ops: pricing.ops,
    hidden: hiddenOnWfm,
  });
  return {
    itemName: pricing.itemName,
    action: dispatch.action,
    orderId: dispatch.orderId,
    price: pricing.postPrice,
    error: dispatch.error,
    orderLimitReached: dispatch.orderLimitReached,
    ...(dispatch.visible !== undefined ? { visible: dispatch.visible } : {}),
  };
}
