// Phase 5: item WTS selling - the second Live Scraper sub-engine that
// touches a real WFM order (docs/live-scraper/quantframe-reference.md §B.4c
// progress_selling). Prices from the lowest competing sell listing, applies
// the per-item minimum, the max-price-drop damping guard, the SMA floor and
// the minimum-profit floor, then dispatches the sell order.
//
// Deliberate fix vs. Quantframe (user-confirmed decision, docs §A.3): the
// damping guard here reads `items.wts.maxPriceDrop`/`minListingsBelow` - the
// WTS-tab settings - not `items.wtb.*` like the shipped Quantframe code does.
//
// Scope note: Quantframe supports per-stock-item overrides for minProfit and
// minSma (via a generic properties bag), not just minPrice. WFHelper's
// StockItem schema (Phase 2) only has a minPrice override; minProfit/minSma
// overrides are deferred to a later polish pass. Global items.wts settings
// apply uniformly in the meantime - documented here so it isn't mistaken for
// an oversight.

import { withScope } from "./logger";
import * as wfmCatalog from "./wfmCatalog";
import { updateStockItem } from "./liveScraperStock";
import { dispatchOrder } from "./liveScraperOrderDispatch";
import { matchExistingOrder } from "./liveScraperOrderMatch";
import { isThresholdDisabled, shouldApplyMaxPriceDrop } from "../config/shared/liveScraperPricing";
import type { NormalisedOrder } from "./wfmOrders";
import type { ItemMarketInfo } from "./liveScraperOrderBook";
import type { StockItem, StockEntryStatus } from "../config/shared/liveScraperStock";
import type { ItemWtsSettings } from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperSell");

interface StockProgressResult {
  itemName: string;
  action: "created" | "updated" | "deleted" | "skipped";
  orderId: string | null;
  price: number | null;
  error?: string;
}

/** Prices and dispatches one stock item's sell order for this tick. Always
 *  persists the resulting status/listPrice back to the stock row, except
 *  when the item was skipped before a price was even computed. `hiddenOnWfm`
 *  creates a new order hidden on warframe.market. */
export async function progressStockItem(
  item: StockItem,
  marketInfo: ItemMarketInfo,
  closedAvg: number | null,
  mySellOrders: readonly NormalisedOrder[],
  wts: ItemWtsSettings,
  hiddenOnWfm = false,
): Promise<StockProgressResult> {
  const catalogItem = await wfmCatalog.lookupBySlug(item.wfmUrl);
  if (!catalogItem?.id) {
    log.warn(`[LiveScraperSell] "${item.itemName}" (${item.wfmUrl}) not found in WFM catalog`);
    return {
      itemName: item.itemName,
      action: "skipped",
      orderId: null,
      price: null,
      error: "not in catalog",
    };
  }

  const rank = typeof item.subType?.rank === "number" ? item.subType.rank : null;
  const subtype = typeof item.subType?.subtype === "string" ? item.subType.subtype : null;
  const existing = matchExistingOrder(mySellOrders, catalogItem.id, rank, subtype);

  // An adopted listing that is no longer on WFM was sold or removed by the
  // user - never re-list it (the next adoption sync drops the row).
  if (item.adopted && !existing) {
    return { itemName: item.itemName, action: "skipped", orderId: null, price: null };
  }

  const ops = new Set<string>();
  ops.add(existing ? "Update" : "Create");

  if (item.isHidden) {
    if (item.status === "inactive") {
      return {
        itemName: item.itemName,
        action: "skipped",
        orderId: existing?.id ?? null,
        price: item.listPrice,
      };
    }
    ops.add("Delete");
    const dispatch = await dispatchOrder({
      orderType: "sell",
      postPrice: 1,
      quantity: item.owned,
      modRank: rank,
      subtype,
      itemId: catalogItem.id,
      existingOrder: existing,
      ops,
    });
    updateStockItem(item.id, { status: "inactive", listPrice: null });
    return {
      itemName: item.itemName,
      action: dispatch.action,
      orderId: dispatch.orderId,
      price: null,
      error: dispatch.error,
    };
  }

  // Fewer than two active competing sellers: only worth pricing at all if a
  // per-item minPrice override exists to price from - otherwise abandon the
  // listing this cycle (docs §B.4c step 3).
  if (marketInfo.sellVolume < 2 && item.minPrice == null) {
    if (item.adopted) {
      // The user's own listing: nothing to price against, so leave it exactly
      // as it is rather than taking it down.
      updateStockItem(item.id, { status: "noSellers" });
      return {
        itemName: item.itemName,
        action: "skipped",
        orderId: existing?.id ?? null,
        price: item.listPrice,
      };
    }
    ops.add("NoSellers");
    ops.add("Delete");
    const dispatch = await dispatchOrder({
      orderType: "sell",
      postPrice: 1,
      quantity: item.owned,
      modRank: rank,
      subtype,
      itemId: catalogItem.id,
      existingOrder: existing,
      ops,
    });
    updateStockItem(item.id, { status: "noSellers", listPrice: null });
    return {
      itemName: item.itemName,
      action: dispatch.action,
      orderId: dispatch.orderId,
      price: null,
      error: dispatch.error,
    };
  }

  let status: StockEntryStatus = "live";
  // `aboveLowest` sits a fixed amount over the cheapest competitor instead of
  // matching it; the floors and limits below still apply on top.
  let postPrice =
    marketInfo.sellVolume >= 2 ? (marketInfo.lowestPrice ?? 0) + Math.max(0, wts.aboveLowest) : 0;

  if (item.minPrice != null && postPrice < item.minPrice) {
    postPrice = item.minPrice;
    ops.add("MinimumPrice");
  }

  const currentOrderPrice = existing?.platinum ?? 0;
  const dampingReason = shouldApplyMaxPriceDrop(
    wts.maxPriceDrop,
    wts.minListingsBelow,
    currentOrderPrice,
    postPrice,
    marketInfo.sellPrices,
    "sell",
  );
  if (dampingReason) {
    postPrice = currentOrderPrice;
    ops.add(dampingReason);
  }

  const closed = closedAvg ?? 0;
  if (
    !isThresholdDisabled(wts.minSma) &&
    postPrice < closed - wts.minSma &&
    (marketInfo.lowestPrice ?? 0) > item.bought
  ) {
    postPrice = closed;
    status = "smaLimit";
    ops.add("SMALimit");
  }

  const profit = postPrice - item.bought;
  if (!isThresholdDisabled(wts.minProfit) && profit < wts.minProfit) {
    postPrice += wts.minProfit - profit;
    status = "toLowProfit";
    ops.add("LowProfit");
  }

  postPrice = Math.max(postPrice, 1);

  const dispatch = await dispatchOrder({
    orderType: "sell",
    postPrice,
    quantity: item.owned,
    modRank: rank,
    subtype,
    itemId: catalogItem.id,
    existingOrder: existing,
    ops,
    hidden: hiddenOnWfm,
  });

  if (dispatch.action !== "skipped" || !dispatch.error) {
    updateStockItem(item.id, {
      status,
      listPrice: postPrice,
      ...(dispatch.action === "created" ? { wfmHidden: hiddenOnWfm } : {}),
    });
  }

  return {
    itemName: item.itemName,
    action: dispatch.action,
    orderId: dispatch.orderId,
    price: postPrice,
    error: dispatch.error,
  };
}
