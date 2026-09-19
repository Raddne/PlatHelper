// Phase 4: wishlist buying - the first Live Scraper sub-engine that touches a
// real warframe.market order (docs/live-scraper/quantframe-reference.md
// §B.4d progress_wish_list). Computes the buy price from live market data,
// persists the result to the wishlist row, and dispatches the WFM order
// mutation via liveScraperOrderDispatch.
//
// Implementation notes vs. the reference:
// - Quantframe reads two distinct cached stats, `market.volume`/`price.avg_price`;
//   WFHelper only has the single 48h-weighted average from wfmStatsPrice.ts
//   (see docs §Part A of the Phase 3 note). That one number stands in for
//   `avg_price` here.
// - When there are no competing buyers AND no price-stat fallback (both null/0),
//   Quantframe would still floor to 1 platinum and post a near-worthless order.
//   This port skips the item instead (logged, no order touched) rather than
//   create a real order with no pricing basis - a deliberate safety addition,
//   not a parity requirement.
// - Quantframe unconditionally sets status back to "Live" after the NoBuyers
//   branch (per the literal extraction in docs §B.4d), which would discard the
//   NoBuyers status it had just set. This port keeps "noBuyers" as the
//   persisted status in that case since it is strictly more informative for
//   the user and does not change the price or the order dispatch decision.

import { withScope } from "./logger";
import * as wfmCatalog from "./wfmCatalog";
import { updateWishlistItem } from "./liveScraperStock";
import { dispatchOrder } from "./liveScraperOrderDispatch";
import { matchExistingOrder } from "./liveScraperOrderMatch";
import type { NormalisedOrder } from "./wfmOrders";
import type { ItemMarketInfo } from "./liveScraperOrderBook";
import type { WishlistItem, StockEntryStatus } from "../config/shared/liveScraperStock";

const log = withScope("liveScraperWishlist");

interface WishlistProgressResult {
  itemName: string;
  action: "created" | "updated" | "deleted" | "skipped";
  orderId: string | null;
  price: number | null;
  error?: string;
}

/** Prices and dispatches one wishlist item's buy order for this tick. Always
 *  persists the resulting status/listPrice back to the wishlist row, even
 *  when the order dispatch itself was skipped or failed. */
export async function progressWishlistItem(
  item: WishlistItem,
  marketInfo: ItemMarketInfo,
  closedAvg: number | null,
  myBuyOrders: readonly NormalisedOrder[],
): Promise<WishlistProgressResult> {
  const catalogItem = await wfmCatalog.lookupBySlug(item.wfmUrl);
  if (!catalogItem?.id) {
    log.warn(`[LiveScraperWishlist] "${item.itemName}" (${item.wfmUrl}) not found in WFM catalog`);
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
  const existing = matchExistingOrder(myBuyOrders, catalogItem.id, rank, subtype);

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
      orderType: "buy",
      postPrice: 1,
      quantity: item.quantity,
      modRank: rank,
      subtype,
      itemId: catalogItem.id,
      existingOrder: existing,
      ops,
    });
    updateWishlistItem(item.id, { status: "inactive", listPrice: null });
    return {
      itemName: item.itemName,
      action: dispatch.action,
      orderId: dispatch.orderId,
      price: null,
      error: dispatch.error,
    };
  }

  let status: StockEntryStatus = "live";
  let postPrice: number;
  if (marketInfo.buyVolume === 0) {
    ops.add("NoBuyers");
    status = "noBuyers";
    postPrice = closedAvg ?? 0;
  } else {
    postPrice = marketInfo.highestPrice ?? 0;
  }

  if (item.maxPrice != null && postPrice > item.maxPrice) {
    postPrice = item.maxPrice;
    ops.add("MaxPrice");
  }
  if (item.minPrice != null && postPrice < item.minPrice) {
    postPrice = item.minPrice;
    ops.add("MinPrice");
  }

  if (postPrice <= 0) {
    log.info(
      `[LiveScraperWishlist] "${item.itemName}": no competing buyers and no price-stat fallback - skipping this tick`,
    );
    return {
      itemName: item.itemName,
      action: "skipped",
      orderId: existing?.id ?? null,
      price: item.listPrice,
    };
  }
  postPrice = Math.max(postPrice, 1);

  const dispatch = await dispatchOrder({
    orderType: "buy",
    postPrice,
    quantity: item.quantity,
    modRank: rank,
    subtype,
    itemId: catalogItem.id,
    existingOrder: existing,
    ops,
  });

  if (dispatch.action !== "skipped" || !dispatch.error) {
    updateWishlistItem(item.id, { status, listPrice: postPrice });
  }

  return {
    itemName: item.itemName,
    action: dispatch.action,
    orderId: dispatch.orderId,
    price: postPrice,
    error: dispatch.error,
  };
}
