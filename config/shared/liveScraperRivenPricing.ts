// Riven selling's average_filtered_lowest_prices (docs/live-scraper/
// quantframe-reference.md B.4f) plus the comparable-listing rules PlatHelper
// adds on top: which searches a riven is priced from, tightest first, and how
// many fixed-price listings make a price. The doc's B.4f note has the why.

import { isThresholdDisabled } from "./liveScraperPricing";

/** `prices` must already be ascending; -1 (Quantframe's sentinel) when there is
 *  nothing to average. Literal port including the kept quirk: the threshold is
 *  a raw multiplier, no /100 (the default 15 keeps up to 16x the lowest, docs
 *  A.5). -1 disables either limit, as the settings form promises. */
export function averageFilteredLowestPrices(
  pricesAscending: readonly number[],
  limitTo: number,
  thresholdPercentage: number,
): number {
  if (pricesAscending.length === 0) return -1;
  const top = isThresholdDisabled(limitTo)
    ? [...pricesAscending]
    : pricesAscending.slice(0, Math.max(0, Math.floor(limitTo)));
  if (top.length === 0) return -1;
  const minPrice = top[0]!;
  const filtered = isThresholdDisabled(thresholdPercentage)
    ? top
    : top.filter((p) => p <= minPrice * (1 + thresholdPercentage));
  if (filtered.length === 0) return -1;
  const sum = filtered.reduce((a, b) => a + b, 0);
  return Math.floor(sum / filtered.length);
}

/** Fewer fixed-price listings than this are not a market: one or two identical
 *  rolls at 9500p are as likely "not really for sale" prices as real ones, and
 *  following them is how a Boar riven ended up listed at 9500p. */
export const MIN_COMPARABLE_LISTINGS = 3;

export type ComparableTierName = "exact" | "positives" | "keyStats";

/** One warframe.market search the riven is priced from: every listed riven
 *  has at least these stats (WFM ANDs a comma list, see wfmRivenSearch.ts). */
interface ComparableSearchTier {
  name: ComparableTierName;
  positive: string[];
  negative: string[];
}

/** One good-roll group of the weapon, as WFM url names: the stats a good roll
 *  must have and the ones that may complete it. */
export interface KeyStatGroup {
  mandatory: readonly string[];
  optional: readonly string[];
}

function tierKey(positive: readonly string[], negative: readonly string[]): string {
  return `${[...positive].sort().join(",")}|${[...negative].sort().join(",")}`;
}

/** The searches a riven is priced from, tightest first: the identical roll,
 *  the same positive stats with any negative, then the stats that matter for
 *  the weapon per its good-roll groups. A whole-weapon search is deliberately
 *  not a tier: a random roll of the same weapon is not a comparable price. */
export function comparableSearchTiers(
  positive: readonly string[],
  negative: readonly string[],
  keyStatGroups: readonly KeyStatGroup[],
): ComparableSearchTier[] {
  if (positive.length === 0) return [];
  const tiers: ComparableSearchTier[] = [];
  const seen = new Set<string>();
  const add = (name: ComparableTierName, pos: readonly string[], neg: readonly string[]) => {
    const key = tierKey(pos, neg);
    if (seen.has(key)) return;
    seen.add(key);
    tiers.push({ name, positive: [...pos], negative: [...neg] });
  };

  add("exact", positive, negative);
  add("positives", positive, []);

  const keyTiers = keyStatGroups
    .filter((group) => group.mandatory.length > 0)
    .filter((group) => group.mandatory.every((stat) => positive.includes(stat)))
    .map((group) =>
      positive.filter((stat) => group.mandatory.includes(stat) || group.optional.includes(stat)),
    )
    .sort((a, b) => b.length - a.length);
  for (const stats of keyTiers) add("keyStats", stats, []);
  return tiers;
}
