// 0/1 knapsack budget solver for WTB buying (docs/live-scraper/quantframe-
// reference.md §B.8), maximizing total profit subject to a platinum budget
// cap. Standard bounded-weight DP, O(n * maxWeight) - fine for the caps this
// feature deals with (platinum budgets in the thousands-to-hundred-thousands
// range, not millions).
//
// Scope note vs. Quantframe: Quantframe runs two knapsack passes per cycle -
// one inline per item (checked against *all* currently cached buy orders,
// including ones from earlier cycles) and one global re-pass at the end of
// the cycle that can delete previously-created orders that no longer fit.
// This port runs a single pass, once per tick, over only the WTB candidates
// this tick wants to (re)price - it does not reconcile the cap against
// buy orders already open from the wishlist or earlier WTB cycles. A known
// simplification: revisit if live testing shows the total open-buy-order
// exposure exceeds maxTotalPriceCap in practice.

export interface KnapsackCandidate {
  id: string;
  weight: number;
  value: number;
}

/** Returns the subset of candidate ids that maximizes summed value subject to
 *  summed weight <= maxWeight. Non-positive weights/values and weights above
 *  maxWeight are dropped before solving (never selected). */
export function solveKnapsack(
  candidates: readonly KnapsackCandidate[],
  maxWeight: number,
): Set<string> {
  const cap = Math.max(0, Math.floor(maxWeight));
  const items = candidates.filter(
    (c) => Number.isFinite(c.weight) && c.weight > 0 && c.weight <= cap && Number.isFinite(c.value),
  );
  if (items.length === 0 || cap === 0) return new Set();

  const n = items.length;
  // dp[w] = best value achievable with total weight <= w, using items seen so far.
  const dp: number[] = new Array(cap + 1).fill(0);
  // choice[i][w] = true if item i was taken to reach dp[w] at that step.
  const choice: Uint8Array[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const { weight, value } = items[i];
    const row = new Uint8Array(cap + 1);
    for (let w = cap; w >= weight; w--) {
      const withItem = dp[w - weight] + value;
      if (withItem > dp[w]) {
        dp[w] = withItem;
        row[w] = 1;
      }
    }
    choice[i] = row;
  }

  const selected = new Set<string>();
  let w = cap;
  for (let i = n - 1; i >= 0; i--) {
    if (choice[i][w] === 1) {
      selected.add(items[i].id);
      w -= items[i].weight;
    }
  }
  return selected;
}
