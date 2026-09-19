// Pure pricing helpers shared by every Live Scraper sub-engine (item WTS
// now, WTB/riven later). Isomorphic and side-effect free by design so the
// formulas can be unit-tested without touching WFM.

import { DISABLED } from "./liveScraperSettings";

export function isThresholdDisabled(value: number): boolean {
  return value <= DISABLED;
}

type OrderSide = "buy" | "sell";

/** Port of Quantframe's should_apply_max_price_drop (docs/live-scraper/
 *  quantframe-reference.md §B.4a): guards against chasing the market too far
 *  in one tick. Returns the ops tag to add ("MaxPriceDrop") when the caller
 *  should clamp postPrice back to currentOrderPrice, or null when the move
 *  is safe to apply as computed. `prices` is the full competing price list
 *  for this side (not just the best price) - needed to count how many
 *  listings sit below/above the current order price. */
export function shouldApplyMaxPriceDrop(
  maxPriceDrop: number,
  minListingsBelow: number,
  currentOrderPrice: number,
  postPrice: number,
  prices: readonly number[],
  orderType: OrderSide,
): string | null {
  if (isThresholdDisabled(maxPriceDrop) && isThresholdDisabled(minListingsBelow)) return null;

  let isPriceInvalid: boolean;
  let priceChange: number;
  let listingCount: number;
  if (orderType === "buy") {
    isPriceInvalid = currentOrderPrice > postPrice;
    priceChange = postPrice - currentOrderPrice;
    listingCount = prices.filter((p) => p > currentOrderPrice).length;
  } else {
    isPriceInvalid = currentOrderPrice < postPrice;
    priceChange = currentOrderPrice - postPrice;
    listingCount = prices.filter((p) => p < currentOrderPrice).length;
  }

  // Price moved the "safe" direction for this side - no damping needed.
  if (isPriceInvalid) return null;

  const shouldSkip =
    !isThresholdDisabled(maxPriceDrop) &&
    priceChange > maxPriceDrop &&
    (isThresholdDisabled(minListingsBelow) || listingCount <= minListingsBelow);

  return shouldSkip ? "MaxPriceDrop" : null;
}
