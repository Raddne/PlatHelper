// Isomorphic core of Quantframe's delete_unwanted_orders / orders_to_delete
// (docs/live-scraper/quantframe-reference.md §B.7): decides which live WFM
// order IDs the cleanup pass should nuke this tick. Pure and side-effect
// free - services/liveScraperOrderCleanup.ts does the actual deleting.

import { isBlacklisted } from "./liveScraperStock";
import type { LiveScraperSettings, SubTypeLike, TradeMode } from "./liveScraperSettings";

/** The subset of NormalisedOrder (services/wfmOrders.ts) this module needs -
 *  kept minimal/duck-typed so this file stays free of a main-process import. */
export interface CleanupOrderLike {
  id: string;
  orderType: string;
  itemId: string | null;
  modRank: number | null;
  subtype: string | null;
}

interface CleanupMyOrders {
  buy: readonly CleanupOrderLike[];
  sell: readonly CleanupOrderLike[];
}

function orderSubType(order: CleanupOrderLike): SubTypeLike | undefined {
  const out: SubTypeLike = {};
  if (typeof order.modRank === "number") out.rank = order.modRank;
  if (typeof order.subtype === "string") out.subtype = order.subtype;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Mirrors `orders_to_delete` (helpers.rs:439-473), with one deliberate,
 *  user-requested deviation: a SELL order is only ever deleted when
 *  `isManagedSell` says the scraper itself manages it (it matches a tracked
 *  stock item). Quantframe wipes every sell order, including ones the user
 *  listed by hand on warframe.market - here those are never touched. The
 *  default predicate manages nothing, so a caller that forgets it deletes no
 *  sell order at all rather than all of them.
 *  Second deviation, after a user lost some 500 hand-placed orders to the
 *  start-up wipe: NO order is deleted unless `isOwnOrder` says the scraper
 *  created it. Same fail-safe default - a caller that forgets the predicate
 *  deletes nothing.
 *  - `autoDelete && justStarted`: FULL WIPE of every non-blacklisted order
 *    (buy and sell) - the one-time destructive pass the UI's start-confirm
 *    modal warns about, only ever true on the very first tick of a session.
 *  - otherwise: a narrower, ongoing mode-mismatch cleanup that runs on every
 *    later tick as long as `autoDelete` OR `deleteConflictingOrders` is on -
 *    note `deleteConflictingOrders` only widens the outer gate, it is never
 *    itself consulted in the branching below (faithful to source).
 */
export function computeOrdersToDelete(
  settings: LiveScraperSettings,
  myOrders: CleanupMyOrders,
  justStarted: boolean,
  isManagedSell: (order: CleanupOrderLike) => boolean = () => false,
  isOwnOrder: (order: CleanupOrderLike) => boolean = () => false,
): string[] {
  return computeCandidates(
    settings,
    { buy: myOrders.buy.filter(isOwnOrder), sell: myOrders.sell.filter(isOwnOrder) },
    justStarted,
    isManagedSell,
  );
}

function computeCandidates(
  settings: LiveScraperSettings,
  myOrders: CleanupMyOrders,
  justStarted: boolean,
  isManagedSell: (order: CleanupOrderLike) => boolean,
): string[] {
  const general = settings.general;
  if (!general.autoDelete && !general.deleteConflictingOrders) return [];

  if (general.autoDelete && justStarted) {
    const blacklist = settings.items.general.blacklist;
    const all: CleanupOrderLike[] = [...myOrders.buy, ...myOrders.sell];
    return all
      .filter((order) => {
        if (order.orderType !== "buy" && !isManagedSell(order)) return false;
        if (!order.itemId) return true;
        const mode: TradeMode = order.orderType === "buy" ? "buy" : "sell";
        return !isBlacklisted(blacklist, order.itemId, orderSubType(order), mode);
      })
      .map((order) => order.id);
  }

  const modes = general.tradeModes;
  const hasBuy = modes.includes("buy");
  const hasSell = modes.includes("sell");
  const hasWishlist = modes.includes("wishlist");

  if (hasBuy && hasWishlist && !hasSell) {
    return myOrders.sell.filter(isManagedSell).map((order) => order.id);
  }
  if (hasSell && !hasBuy && !hasWishlist) {
    return myOrders.buy.map((order) => order.id);
  }
  return [];
}
