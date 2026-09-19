// Phase 7: riven selling - progress_selling's riven analogue (docs/live-scraper/
// quantframe-reference.md §B.4f). Prices from the average of the lowest
// competing direct-sell auctions (config/shared/liveScraperRivenPricing.ts's
// average_filtered_lowest_prices port), falls back to bought+minProfit+1 when
// there are no competing auctions at all (kept LISTED at that price, not
// deleted - a real deviation from item WTS's "no sellers -> abandon" branch),
// applies the per-riven minimum-price override and the minimum-profit floor,
// then dispatches to the WFM Auction API.
//
// No should_apply_max_price_drop damping is applied here at all, matching the
// reference: riven prices always snap to the freshly recomputed average.
//
// Dispatch note: unlike items, there is no "list my auctions" endpoint in play
// (services/wfmRivenSearch.ts has create/update/close only) - WFHelper owns
// the create<->auctionId mapping itself via the StockRiven row's `auctionId`
// field. Any update/delete failure (e.g. the auction already sold or was
// removed on WFM's site) clears that field so the next tick just creates a
// fresh one instead of retrying a dead id forever.

import { withScope } from "./logger";
import * as rivenData from "./rivenData";
import {
  searchSimilarRivens,
  createRivenAuction,
  updateRivenAuction,
  deleteRivenAuction,
} from "./wfmRivenSearch";
import { updateStockRiven } from "./liveScraperRivenStock";
import { isActiveOrderStatus } from "../config/shared/wfmOrders";
import { averageFilteredLowestPrices } from "../config/shared/liveScraperRivenPricing";
import { isThresholdDisabled } from "../config/shared/liveScraperPricing";
import { tagToWfmUrlName, polarityToWfm } from "../config/shared/wfmRivenVocabulary";
import type { StockRiven, StockRivenStat } from "../config/shared/liveScraperRivenStock";
import type { StockEntryStatus } from "../config/shared/liveScraperStock";
import type { RivenWtsSettings } from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperRiven");

interface RivenProgressResult {
  itemName: string;
  action: "created" | "updated" | "deleted" | "skipped";
  auctionId: string | null;
  price: number | null;
  error?: string;
}

function statUrlNames(stats: readonly StockRivenStat[], positive: boolean): string[] {
  return stats
    .filter((s) => s.positive === positive)
    .map((s) => tagToWfmUrlName(s.tag))
    .filter((v): v is string => !!v);
}

// One search page holds at most this many auctions; fewer means the result is complete.
const SEARCH_PAGE_SIZE = 500;

interface CompetingAuctions {
  prices: number[];
  /** False only when a complete result no longer contains the riven's own auction. */
  ownAuctionListed: boolean;
}

async function fetchCompetingPrices(
  riven: Pick<StockRiven, "stats" | "auctionId">,
  weaponSlug: string,
  ownName: string | null,
  onlineOnly = false,
): Promise<CompetingAuctions> {
  const listings = await searchSimilarRivens(weaponSlug, {
    limit: 2000,
    positiveStats: statUrlNames(riven.stats, true),
    negativeStats: statUrlNames(riven.stats, false),
  });
  const prices = listings
    .filter((l) => l.isDirectSell && l.buyoutPrice != null && l.buyoutPrice > 0)
    // The engine deliberately does not filter by seller status: a riven is one of a
    // kind, so an offline seller's auction is as much the going price as an online
    // one's. Only the manual quick-list asks the user and may pass onlineOnly.
    .filter((l) => !onlineOnly || isActiveOrderStatus(l.sellerStatus))
    .filter((l) => !ownName || l.seller.toLowerCase() !== ownName.toLowerCase())
    .map((l) => l.buyoutPrice as number)
    .sort((a, b) => a - b);
  // The search matches the riven's own stats, so its auction has to be in a
  // complete result; if it is not, it was closed or sold outside the scraper.
  const complete = listings.length > 0 && listings.length < SEARCH_PAGE_SIZE;
  const ownAuctionListed =
    !riven.auctionId || !complete || listings.some((l) => l.id === riven.auctionId);
  return { prices, ownAuctionListed };
}

/** warframe.market's answer for an auction id it no longer knows. */
function isAuctionGoneError(error: string | undefined): boolean {
  return /not_exist|not_found/i.test(error ?? "");
}

async function dispatchRivenAuction(
  riven: StockRiven,
  postPrice: number,
  shouldDelete: boolean,
): Promise<{
  action: "created" | "updated" | "deleted" | "skipped";
  auctionId: string | null;
  error?: string;
}> {
  if (shouldDelete) {
    if (!riven.auctionId) return { action: "skipped", auctionId: null };
    const result = await deleteRivenAuction(riven.auctionId);
    if (!result.ok) {
      log.warn(`[LiveScraperRiven] delete auction ${riven.auctionId} failed:`, result.error);
      return { action: "skipped", auctionId: riven.auctionId, error: result.error };
    }
    return { action: "deleted", auctionId: null };
  }

  if (riven.auctionId) {
    if (riven.listPrice === postPrice) {
      return { action: "skipped", auctionId: riven.auctionId };
    }
    const result = await updateRivenAuction({
      auctionId: riven.auctionId,
      buyoutPrice: postPrice,
      startingPrice: postPrice,
      minReputation: 0,
      description: "",
    });
    if (result.ok) return { action: "updated", auctionId: result.auctionId ?? riven.auctionId };
    if (!isAuctionGoneError(result.error)) {
      // Anything else (rate limit, network) may leave the auction alive, so a
      // new one could duplicate it: drop the id and let the next pass decide.
      log.warn(
        `[LiveScraperRiven] update auction ${riven.auctionId} failed, will recreate:`,
        result.error,
      );
      return { action: "skipped", auctionId: null, error: result.error };
    }
    // Closed or sold on warframe.market: list it again right away instead of
    // leaving the riven unlisted for a whole update interval.
    log.info(
      `[LiveScraperRiven] auction ${riven.auctionId} is gone on warframe.market, creating a new one`,
    );
  }

  const weaponSlug = rivenData.getRivenFamilySlug(riven.weaponName);
  const wfmPolarity = polarityToWfm(riven.polarity) ?? "madurai";
  const attributes = riven.stats.map((s) => ({
    url_name: tagToWfmUrlName(s.tag) || s.tag,
    value: s.value,
    positive: s.positive,
  }));
  const rivenSuffix = (() => {
    const prefix = `${riven.weaponName} `;
    const suffix = riven.rivenName.startsWith(prefix)
      ? riven.rivenName.slice(prefix.length)
      : riven.rivenName;
    return suffix.toLowerCase();
  })();

  const result = await createRivenAuction({
    weaponSlug,
    rivenName: rivenSuffix,
    attributes,
    rerolls: riven.rerolls,
    masteryLevel: riven.masteryReq,
    polarity: wfmPolarity,
    modRank: riven.modRank,
    buyoutPrice: postPrice,
    startingPrice: postPrice,
    minReputation: 0,
    isPrivate: false,
    description: "",
  });
  if (!result.ok) {
    log.warn(`[LiveScraperRiven] create auction for "${riven.rivenName}" failed:`, result.error);
    return { action: "skipped", auctionId: null, error: result.error };
  }
  return { action: "created", auctionId: result.auctionId ?? null };
}

/** Prices and dispatches one stock riven's auction for this tick. Always
 *  persists the resulting status/listPrice/auctionId back to the row. */
export async function progressStockRiven(
  riven: StockRiven,
  wts: RivenWtsSettings,
  ownName: string | null,
): Promise<RivenProgressResult> {
  const weaponSlug = rivenData.getRivenFamilySlug(riven.weaponName);
  if (!weaponSlug) {
    log.warn(`[LiveScraperRiven] "${riven.weaponName}" has no known WFM family slug`);
    return {
      itemName: riven.rivenName,
      action: "skipped",
      auctionId: riven.auctionId,
      price: null,
      error: "unknown weapon",
    };
  }

  if (riven.isHidden) {
    if (riven.status === "inactive") {
      return {
        itemName: riven.rivenName,
        action: "skipped",
        auctionId: riven.auctionId,
        price: riven.listPrice,
      };
    }
    const dispatch = await dispatchRivenAuction(riven, 1, true);
    updateStockRiven(riven.id, {
      status: "inactive",
      listPrice: null,
      auctionId: dispatch.auctionId,
    });
    return {
      itemName: riven.rivenName,
      action: dispatch.action,
      auctionId: dispatch.auctionId,
      price: null,
      error: dispatch.error,
    };
  }

  const { prices, ownAuctionListed } = await fetchCompetingPrices(riven, weaponSlug, ownName);
  if (!ownAuctionListed) {
    log.info(
      `[LiveScraperRiven] auction ${riven.auctionId} is no longer listed, creating a new one`,
    );
    riven = { ...riven, auctionId: null, listPrice: null };
  }

  let status: StockEntryStatus = "live";
  let postPrice: number;
  if (prices.length === 0) {
    status = "noSellers";
    postPrice = riven.bought + wts.minProfit + 1;
  } else {
    postPrice = averageFilteredLowestPrices(prices, wts.maxResults, wts.thresholdPercentage);
    if (postPrice < 0) {
      status = "noSellers";
      postPrice = riven.bought + wts.minProfit + 1;
    }
  }

  if (riven.minPrice != null && postPrice < riven.minPrice) {
    postPrice = riven.minPrice;
  }

  const profit = postPrice - riven.bought;
  if (!isThresholdDisabled(wts.minProfit) && profit < wts.minProfit) {
    postPrice += wts.minProfit - profit;
    status = "toLowProfit";
  }

  postPrice = Math.max(postPrice, 1);

  const dispatch = await dispatchRivenAuction(riven, postPrice, false);
  // The auctionId always gets persisted, even on failure - a cleared id from
  // dispatchRivenAuction's self-heal must stick so the next tick creates a
  // fresh auction instead of retrying a dead one forever. Price/status only
  // update on an actual success, so a failed attempt doesn't claim "live" at
  // a price nothing was ever posted at.
  if (dispatch.action !== "skipped" || !dispatch.error) {
    updateStockRiven(riven.id, { status, listPrice: postPrice, auctionId: dispatch.auctionId });
  } else if (dispatch.auctionId !== riven.auctionId) {
    updateStockRiven(riven.id, { auctionId: dispatch.auctionId });
  }

  return {
    itemName: riven.rivenName,
    action: dispatch.action,
    auctionId: dispatch.auctionId,
    price: postPrice,
    error: dispatch.error,
  };
}

/** The WFM family slug plus the stat url names a search for this riven uses. */
export function rivenSearchTerms(
  weaponName: string,
  stats: readonly StockRivenStat[],
): { weaponSlug: string; positive: string[]; negative: string[] } | null {
  const weaponSlug = rivenData.getRivenFamilySlug(weaponName);
  if (!weaponSlug) return null;
  return {
    weaponSlug,
    positive: statUrlNames(stats, true),
    negative: statUrlNames(stats, false),
  };
}

/** Cheapest direct-sell auction with the same stats, for the Rivens tab's
 *  "list at the lowest price". Null price = nothing comparable is listed. */
export async function quoteLowestRivenPrice(
  weaponName: string,
  stats: readonly StockRivenStat[],
  ownName: string | null,
  onlineOnly: boolean,
): Promise<{ ok: true; price: number | null; listings: number } | { ok: false; error: string }> {
  const weaponSlug = rivenData.getRivenFamilySlug(weaponName);
  if (!weaponSlug) return { ok: false, error: "unknown weapon" };
  const { prices } = await fetchCompetingPrices(
    { stats: [...stats], auctionId: null },
    weaponSlug,
    ownName,
    onlineOnly,
  );
  return { ok: true, price: prices[0] ?? null, listings: prices.length };
}

/** Posts the auction for a freshly created stock row at a fixed price and records
 *  it on the row, so the engine's next riven pass takes the listing over. */
export async function listStockRivenAt(
  riven: StockRiven,
  price: number,
): Promise<{ ok: true; auctionId: string | null } | { ok: false; error: string }> {
  const dispatch = await dispatchRivenAuction({ ...riven, auctionId: null }, price, false);
  if (dispatch.action !== "created") {
    return { ok: false, error: dispatch.error ?? "auction was not created" };
  }
  updateStockRiven(riven.id, { status: "live", listPrice: price, auctionId: dispatch.auctionId });
  return { ok: true, auctionId: dispatch.auctionId };
}
