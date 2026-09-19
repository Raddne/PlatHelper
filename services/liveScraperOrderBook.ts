// Phase 3: per-item competing-order fetcher for the Live Scraper engine
// (docs/live-scraper/quantframe-reference.md §B.3). Fetches a fresh order
// book per item from WFM v2, filtered to the item's variant, with the
// caller's own orders excluded and only active (in-game/online) listings
// counted - mirroring the "lowest sell / highest buy" market-info shape
// Quantframe computes per item before pricing. Read-only: makes no order
// create/update/delete calls itself.

import { withScope } from "./logger";
import * as wfmClient from "./wfmClient";
import { normalizeErrorMessage } from "../config/shared/errors";
import {
  extractWfmOrderList,
  normalizeWfmOrderBookSide,
  isActiveOrderStatus,
} from "../config/shared/wfmOrders";
import type { SubTypeLike } from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperOrderBook");

export interface ItemMarketInfo {
  /** Lowest competing sell price (best price for a buyer); null if no active sellers. */
  lowestPrice: number | null;
  /** Highest competing buy price (best price for a seller); null if no active buyers. */
  highestPrice: number | null;
  sellVolume: number;
  buyVolume: number;
  /** Full competing price lists (sell ascending / buy descending), needed by
   *  should_apply_max_price_drop's "how many listings below/above me" check
   *  (docs §B.4a) - not just the best price. */
  sellPrices: number[];
  buyPrices: number[];
}

const EMPTY_MARKET_INFO: ItemMarketInfo = {
  lowestPrice: null,
  highestPrice: null,
  sellVolume: 0,
  buyVolume: 0,
  sellPrices: [],
  buyPrices: [],
};

function excludeOwn<T extends { userName: string }>(entries: T[], ownName: string | null): T[] {
  if (!ownName) return entries;
  const lower = ownName.toLowerCase();
  return entries.filter((entry) => entry.userName.toLowerCase() !== lower);
}

/** Fetches and filters the live order book for one item variant. A fresh REST
 *  call every time by design (matches Quantframe, which has no per-item order
 *  cache either - see docs §B.3); callers are responsible for pacing. */
export async function fetchItemMarketInfo(
  wfmUrl: string,
  subType: SubTypeLike | undefined,
  ownName: string | null,
): Promise<ItemMarketInfo> {
  try {
    const raw = await wfmClient.requestV2("GET", `/orders/item/${encodeURIComponent(wfmUrl)}`, {
      priority: "background",
    });
    const list = extractWfmOrderList(raw);
    if (!list) return EMPTY_MARKET_INFO;

    const rankFilter = typeof subType?.rank === "number" ? subType.rank : null;
    const subtypeFilter = typeof subType?.subtype === "string" ? subType.subtype : null;

    const sells = excludeOwn(
      normalizeWfmOrderBookSide(list, "sell", rankFilter, undefined, subtypeFilter),
      ownName,
    ).filter((entry) => isActiveOrderStatus(entry.status));
    const buys = excludeOwn(
      normalizeWfmOrderBookSide(list, "buy", rankFilter, undefined, subtypeFilter),
      ownName,
    ).filter((entry) => isActiveOrderStatus(entry.status));

    return {
      // normalizeWfmOrderBookSide already sorts sell ascending / buy descending.
      lowestPrice: sells.length > 0 ? sells[0].platinum : null,
      highestPrice: buys.length > 0 ? buys[0].platinum : null,
      sellVolume: sells.length,
      buyVolume: buys.length,
      sellPrices: sells.map((entry) => entry.platinum),
      buyPrices: buys.map((entry) => entry.platinum),
    };
  } catch (err) {
    log.warn(`[WFM] order book fetch failed for ${wfmUrl}:`, normalizeErrorMessage(err));
    return EMPTY_MARKET_INFO;
  }
}
