// Riven selling's average_filtered_lowest_prices (docs/live-scraper/
// quantframe-reference.md §B.4f). Literal port including the confirmed-kept
// quirk: thresholdPercentage is a raw multiplier with no /100 division (the
// shipped Quantframe default of 15 means "keep auctions up to 1600% of the
// lowest" - almost certainly not what the UI label implies, but the user
// explicitly chose to keep this as-shipped rather than "fix" it, see docs §A.5).

/** `prices` must already be ascending. Returns -1 (Quantframe's sentinel) when
 *  there is nothing to average, matching the source 1:1 so callers can reuse
 *  the same "no price" check. */
export function averageFilteredLowestPrices(
  pricesAscending: readonly number[],
  limitTo: number,
  thresholdPercentage: number,
): number {
  if (pricesAscending.length === 0) return -1;
  const top = pricesAscending.slice(0, Math.max(0, Math.floor(limitTo)));
  if (top.length === 0) return -1;
  const minPrice = top[0]!;
  const threshold = minPrice * (1 + thresholdPercentage);
  const filtered = top.filter((p) => p <= threshold);
  if (filtered.length === 0) return -1;
  const sum = filtered.reduce((a, b) => a + b, 0);
  return Math.floor(sum / filtered.length);
}
