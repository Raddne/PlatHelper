// Phase 7: riven selling - progress_selling's riven analogue. Prices from the
// lowest comparable fixed-price listings, applies the per-riven minimum price
// and the minimum-profit floor, then dispatches to the WFM Auction API. Where
// PlatHelper deviates from Quantframe: docs/live-scraper/quantframe-reference.md B.4f.

// The engine owns the create<->auctionId mapping on the StockRiven row; the
// adoption sync's account-wide auction list says whether that auction is still
// alive. An update failure never drops the id: the auction is most likely still
// up, and a fresh create next to it is a duplicate of the same riven.

import { withScope } from "./logger";
import * as rivenData from "./rivenData";
import { getGoodRolls } from "./rivenBestAttributes";
import {
  searchSimilarRivensOrThrow,
  createRivenAuction,
  updateRivenAuction,
  deleteRivenAuction,
} from "./wfmRivenSearch";
import { updateStockRiven } from "./liveScraperRivenStock";
import { WfmApiError } from "./wfmTypes";
import { isActiveOrderStatus } from "../config/shared/wfmOrders";
import {
  averageFilteredLowestPrices,
  comparableSearchTiers,
  MIN_COMPARABLE_LISTINGS,
  type ComparableTierName,
  type KeyStatGroup,
} from "../config/shared/liveScraperRivenPricing";
import { isThresholdDisabled } from "../config/shared/liveScraperPricing";
import { tagToWfmUrlName, polarityToWfm } from "../config/shared/wfmRivenVocabulary";
import {
  rivenNameSuffix,
  type StockRiven,
  type StockRivenStat,
} from "../config/shared/liveScraperRivenStock";
import type { StockEntryStatus } from "../config/shared/liveScraperStock";
import type { RivenWtsSettings } from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperRiven");

interface RivenProgressResult {
  itemName: string;
  action: "created" | "updated" | "deleted" | "skipped";
  auctionId: string | null;
  price: number | null;
  error?: string;
  /** True when warframe.market refused for rate limiting; the pass stops there. */
  rateLimited?: boolean;
}

function statUrlNames(stats: readonly StockRivenStat[], positive: boolean): string[] {
  return stats
    .filter((s) => s.positive === positive)
    .map((s) => tagToWfmUrlName(s.tag))
    .filter((v): v is string => !!v);
}

// One search page holds at most this many auctions, and the cheapest page is all a price needs.
const SEARCH_PAGE_SIZE = 500;

function isRateLimitError(err: unknown): boolean {
  if (err instanceof WfmApiError && (err.code === "WFM_RATE_LIMITED" || err.status === 429)) {
    return true;
  }
  return /rate limit/i.test(err instanceof Error ? err.message : String(err ?? ""));
}

/** The weapon's good-roll groups as WFM url names. A group whose mandatory
 *  stat has no WFM attribute is dropped rather than loosened. */
function keyStatGroups(weaponName: string): KeyStatGroup[] {
  const data = getGoodRolls(weaponName);
  if (!data) return [];
  const urlNames = (tags: readonly string[]) =>
    tags.map(tagToWfmUrlName).filter((v): v is string => !!v);
  return data.goodAttrs
    .map((group) => ({ mandatory: urlNames(group.mandatory), optional: urlNames(group.optional) }))
    .filter((group, i) => group.mandatory.length === data.goodAttrs[i]!.mandatory.length);
}

interface ComparablePrices {
  /** Ascending buyout prices of other sellers' fixed-price listings. */
  prices: number[];
  tier: ComparableTierName | null;
}

/** The cheapest comparable fixed-price listings, from the tightest search
 *  that holds MIN_COMPARABLE_LISTINGS of them. Throws when a search fails,
 *  so an outage never reads as "nothing listed". */
async function findComparablePrices(
  weaponName: string,
  weaponSlug: string,
  stats: readonly StockRivenStat[],
  ownName: string | null,
  onlineOnly = false,
): Promise<ComparablePrices> {
  const tiers = comparableSearchTiers(
    statUrlNames(stats, true),
    statUrlNames(stats, false),
    keyStatGroups(weaponName),
  );
  for (const tier of tiers) {
    const listings = await searchSimilarRivensOrThrow(weaponSlug, {
      limit: SEARCH_PAGE_SIZE,
      positiveStats: tier.positive,
      negativeStats: tier.negative,
      directOnly: true,
      ascOnly: true,
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
    if (prices.length >= MIN_COMPARABLE_LISTINGS) return { prices, tier: tier.name };
  }
  return { prices: [], tier: null };
}

/** warframe.market's answer for an auction id it no longer knows. */
function isAuctionGoneError(error: string | undefined): boolean {
  return /not_exist|not_found/i.test(error ?? "");
}

async function dispatchRivenAuction(
  riven: StockRiven,
  postPrice: number,
  shouldDelete: boolean,
  hidden = false,
): Promise<{
  action: "created" | "updated" | "deleted" | "skipped";
  auctionId: string | null;
  error?: string;
  /** Auction visibility after the call; undefined when unknown or gone. */
  visible?: boolean;
}> {
  if (shouldDelete) {
    if (!riven.auctionId) return { action: "skipped", auctionId: null };
    const result = await deleteRivenAuction(riven.auctionId);
    if (!result.ok && !isAuctionGoneError(result.error)) {
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
      // The PUT replaces the whole entry, visibility included.
      visible: !hidden,
    });
    if (result.ok) {
      return {
        action: "updated",
        auctionId: result.auctionId ?? riven.auctionId,
        visible: !hidden,
      };
    }
    if (riven.adopted || !isAuctionGoneError(result.error)) {
      // A rate limit or network error leaves the auction up, and an adopted
      // auction is never replaced; either way the id stays and the next pass
      // retries. Dropping it here is what listed one riven twice.
      log.warn(
        `[LiveScraperRiven] update auction ${riven.auctionId} failed, kept for retry:`,
        result.error,
      );
      return { action: "skipped", auctionId: riven.auctionId, error: result.error };
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

  const result = await createRivenAuction({
    weaponSlug,
    rivenName: rivenNameSuffix(riven.weaponName, riven.rivenName),
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
  const auctionId = result.auctionId ?? null;
  // The create call has no visibility field, so a hidden riven's new auction is
  // hidden right after. Should that fail, the next price update retries it.
  let visible = true;
  if (hidden && auctionId) {
    const hide = await updateRivenAuction({
      auctionId,
      buyoutPrice: postPrice,
      startingPrice: postPrice,
      minReputation: 0,
      description: "",
      visible: false,
    });
    if (hide.ok) visible = false;
    else log.warn(`[LiveScraperRiven] could not hide new auction ${auctionId}:`, hide.error);
  }
  return { action: "created", auctionId, visible };
}

const NO_COMPARABLE = "no comparable fixed-price listing";

/** Takes a riven off warframe.market for want of a comparable price. The row
 *  stays as "No sellers" and is listed again once a price can be found. */
async function unlistWithoutPrice(riven: StockRiven): Promise<RivenProgressResult> {
  const base = { itemName: riven.rivenName, error: NO_COMPARABLE };
  if (riven.adopted) {
    // The user listed this auction at their own price; the engine only ever
    // re-prices it and never takes it down.
    if (riven.status !== "noSellers") updateStockRiven(riven.id, { status: "noSellers" });
    return { ...base, action: "skipped", auctionId: riven.auctionId, price: riven.listPrice };
  }
  if (!riven.auctionId) {
    if (riven.status !== "noSellers" || riven.listPrice != null) {
      updateStockRiven(riven.id, { status: "noSellers", listPrice: null });
    }
    return { ...base, action: "skipped", auctionId: null, price: null };
  }
  const dispatch = await dispatchRivenAuction(riven, 1, true);
  if (dispatch.action !== "deleted") {
    // Still up; the next pass tries again.
    return {
      ...base,
      action: "skipped",
      auctionId: riven.auctionId,
      price: riven.listPrice,
      error: dispatch.error ?? NO_COMPARABLE,
      rateLimited: isRateLimitError(dispatch.error),
    };
  }
  log.info(`[LiveScraperRiven] "${riven.rivenName}" unlisted: ${NO_COMPARABLE}`);
  updateStockRiven(riven.id, { status: "noSellers", listPrice: null, auctionId: null });
  return { ...base, action: "deleted", auctionId: null, price: null };
}

/** Prices and dispatches one stock riven's auction for this tick. Always
 *  persists the resulting status/listPrice/auctionId back to the row.
 *  `isHidden` is read right before each auction call: every update resends
 *  the visibility, so a stale value would undo a switch from the panel.
 *  `liveAuctionIds` is the account's auction list from the adoption sync;
 *  a row whose auction is missing from it gets a new one. */
export async function progressStockRiven(
  riven: StockRiven,
  wts: RivenWtsSettings,
  ownName: string | null,
  isHidden: () => boolean = () => false,
  liveAuctionIds: ReadonlySet<string> | null = null,
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

  if (riven.auctionId && liveAuctionIds && !liveAuctionIds.has(riven.auctionId)) {
    if (riven.adopted) {
      // The adoption sync drops such rows itself; never list one on our own.
      return {
        itemName: riven.rivenName,
        action: "skipped",
        auctionId: riven.auctionId,
        price: riven.listPrice,
        error: "adopted auction is gone",
      };
    }
    log.info(
      `[LiveScraperRiven] auction ${riven.auctionId} is no longer on the account, creating a new one`,
    );
    updateStockRiven(riven.id, { auctionId: null, listPrice: null });
    riven = { ...riven, auctionId: null, listPrice: null };
  }

  let comparable: ComparablePrices;
  try {
    comparable = await findComparablePrices(riven.weaponName, weaponSlug, riven.stats, ownName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`[LiveScraperRiven] search for "${riven.rivenName}" failed, left as is:`, message);
    return {
      itemName: riven.rivenName,
      action: "skipped",
      auctionId: riven.auctionId,
      price: riven.listPrice,
      error: `search failed: ${message}`,
      rateLimited: isRateLimitError(err),
    };
  }

  let postPrice = averageFilteredLowestPrices(
    comparable.prices,
    wts.maxResults,
    wts.thresholdPercentage,
  );
  if (postPrice < 0) return unlistWithoutPrice(riven);

  let status: StockEntryStatus = "live";
  if (riven.minPrice != null && postPrice < riven.minPrice) {
    postPrice = riven.minPrice;
  }

  const profit = postPrice - riven.bought;
  if (!isThresholdDisabled(wts.minProfit) && profit < wts.minProfit) {
    postPrice += wts.minProfit - profit;
    status = "toLowProfit";
  }

  postPrice = Math.max(postPrice, 1);

  const dispatch = await dispatchRivenAuction(riven, postPrice, false, isHidden());
  // Price/status only update on an actual success, so a failed attempt doesn't
  // claim "live" at a price nothing was ever posted at.
  if (dispatch.action !== "skipped" || !dispatch.error) {
    updateStockRiven(riven.id, {
      status,
      listPrice: postPrice,
      auctionId: dispatch.auctionId,
      ...(dispatch.visible !== undefined ? { wfmHidden: !dispatch.visible } : {}),
    });
  }
  if (dispatch.action !== "skipped") {
    log.info(
      `[LiveScraperRiven] "${riven.rivenName}" ${dispatch.action} at ${postPrice}p ` +
        `(${comparable.tier} tier, ${comparable.prices.length} listings)`,
    );
  }

  return {
    itemName: riven.rivenName,
    action: dispatch.action,
    auctionId: dispatch.auctionId,
    price: postPrice,
    error: dispatch.error,
    rateLimited: dispatch.error ? isRateLimitError(dispatch.error) : undefined,
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

/** Cheapest comparable fixed-price listing, for the Rivens tab's "list at the
 *  lowest price". Null price = nothing comparable is listed. Throws when the
 *  search fails. */
export async function quoteLowestRivenPrice(
  weaponName: string,
  stats: readonly StockRivenStat[],
  ownName: string | null,
  onlineOnly: boolean,
): Promise<{ ok: true; price: number | null; listings: number } | { ok: false; error: string }> {
  const weaponSlug = rivenData.getRivenFamilySlug(weaponName);
  if (!weaponSlug) return { ok: false, error: "unknown weapon" };
  const { prices } = await findComparablePrices(weaponName, weaponSlug, stats, ownName, onlineOnly);
  return { ok: true, price: prices[0] ?? null, listings: prices.length };
}

/** Posts the auction for a freshly created stock row at a fixed price and records
 *  it on the row, so the engine's next riven pass takes the listing over. */
export async function listStockRivenAt(
  riven: StockRiven,
  price: number,
  hiddenOnWfm = false,
): Promise<{ ok: true; auctionId: string | null } | { ok: false; error: string }> {
  const dispatch = await dispatchRivenAuction(
    { ...riven, auctionId: null },
    price,
    false,
    hiddenOnWfm,
  );
  if (dispatch.action !== "created") {
    return { ok: false, error: dispatch.error ?? "auction was not created" };
  }
  updateStockRiven(riven.id, {
    status: "live",
    listPrice: price,
    auctionId: dispatch.auctionId,
    ...(dispatch.visible !== undefined ? { wfmHidden: !dispatch.visible } : {}),
  });
  return { ok: true, auctionId: dispatch.auctionId };
}
