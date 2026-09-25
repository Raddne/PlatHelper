// Picks up riven auctions the user already has on warframe.market, the same way
// config/shared/liveScraperAdopt.ts does for sell orders: every live auction
// becomes a row the riven pass re-prices, and a row whose auction is gone (sold
// or closed by the user) is dropped again. Pure, so the matching rules are
// testable without the stores.

import type { StockRiven, StockRivenStat } from "./liveScraperRivenStock";
import { TAG_TO_WFM_URL_NAME } from "./wfmRivenVocabulary";

/** The subset of WfmContract (config/shared/wfmContracts.ts) this needs. */
export interface AdoptableAuction {
  id: string;
  weaponUrlName: string | null;
  rivenSuffix: string | null;
  buyoutPlatinum: number | null;
  platinum: number;
  /** False for a real auction that takes bids. */
  isDirectSell: boolean;
  modRank: number | null;
  rerolls: number | null;
  masteryLevel: number | null;
  polarity: string | null;
  stats: readonly { urlName: string; value: number | string | null; positive: boolean | null }[];
}

interface RivenAdoptionCreate {
  auctionId: string;
  weaponSlug: string;
  rivenName: string;
  masteryReq: number;
  rerolls: number;
  polarity: string;
  modRank: number;
  stats: StockRivenStat[];
  listPrice: number;
}

interface RivenAdoptionPlan {
  create: RivenAdoptionCreate[];
  /** A row the user added by hand that has no auction yet, and the live
   *  auction that is evidently the same riven. */
  link: { id: string; auctionId: string; listPrice: number }[];
  /** Adopted rows with no live direct-sell auction left. */
  remove: string[];
}

const URL_NAME_TO_TAG = new Map<string, string>();
for (const [tag, urlName] of Object.entries(TAG_TO_WFM_URL_NAME)) {
  // Several game tags can share one WFM attribute; the first one listed wins.
  // Either finds the same auctions, which is all an adopted row needs it for.
  if (!URL_NAME_TO_TAG.has(urlName)) URL_NAME_TO_TAG.set(urlName, tag);
}

function adoptableStats(auction: AdoptableAuction): StockRivenStat[] {
  const stats: StockRivenStat[] = [];
  for (const attr of auction.stats) {
    const tag = URL_NAME_TO_TAG.get(attr.urlName);
    const value = typeof attr.value === "number" ? attr.value : Number(attr.value);
    if (!tag || !Number.isFinite(value)) continue;
    stats.push({
      tag,
      positive: attr.positive ?? value >= 0,
      multiplier: false,
      value: Math.abs(value),
    });
  }
  return stats;
}

function price(auction: AdoptableAuction): number {
  return auction.buyoutPlatinum ?? auction.platinum;
}

const nameKey = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

export function planRivenAdoption(
  stock: readonly StockRiven[],
  auctions: readonly AdoptableAuction[],
  weaponSlugOf: (weaponName: string) => string,
): RivenAdoptionPlan {
  const plan: RivenAdoptionPlan = { create: [], link: [], remove: [] };
  // Only direct sells with a price the scraper can manage. Re-pricing sends the
  // same starting and buyout price, which turns a bid auction into a direct
  // sell - warframe.market refuses that once bids exist, and without bids it
  // would silently change what the user listed.
  const usable = auctions.filter(
    (auction) =>
      auction.isDirectSell && auction.weaponUrlName && auction.rivenSuffix && price(auction) > 0,
  );
  const liveIds = new Set(usable.map((auction) => auction.id));
  const knownIds = new Set(stock.map((row) => row.auctionId).filter((id) => id != null));
  const linked = new Set<string>();

  for (const auction of usable) {
    if (knownIds.has(auction.id)) continue;
    const unlisted = stock.find(
      (row) =>
        row.auctionId == null &&
        !linked.has(row.id) &&
        weaponSlugOf(row.weaponName) === auction.weaponUrlName &&
        nameKey(row.rivenName) === nameKey(auction.rivenSuffix),
    );
    if (unlisted) {
      linked.add(unlisted.id);
      plan.link.push({ id: unlisted.id, auctionId: auction.id, listPrice: price(auction) });
      continue;
    }
    const stats = adoptableStats(auction);
    // Without a single recognisable stat there is nothing to price against.
    if (stats.length === 0) continue;
    plan.create.push({
      auctionId: auction.id,
      weaponSlug: auction.weaponUrlName as string,
      rivenName: auction.rivenSuffix as string,
      masteryReq: Math.max(0, auction.masteryLevel ?? 0),
      rerolls: Math.max(0, auction.rerolls ?? 0),
      polarity: auction.polarity ?? "madurai",
      modRank: Math.max(0, auction.modRank ?? 0),
      stats,
      listPrice: price(auction),
    });
  }

  for (const row of stock) {
    if (row.adopted && row.auctionId != null && !liveIds.has(row.auctionId)) {
      plan.remove.push(row.id);
    }
  }
  return plan;
}
