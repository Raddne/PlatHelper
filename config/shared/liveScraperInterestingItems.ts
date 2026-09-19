// WTB candidate filter for the Live Scraper's catalog scan (Phase 6). Ports
// the *shape* of Quantframe's get_interesting_items formula (docs/live-scraper/
// quantframe-reference.md §B.2) exactly - same six thresholds, same combining
// logic, same -1-disables convention - but the inputs are WFHelper-custom:
// Quantframe's profit/profitMargin/avgPrice/volume/weekPriceShift/tradingTax
// come from its own proprietary backend cache (api.quantframe.app), which
// cannot be reproduced client-side (confirmed by reading the Quantframe Rust
// source, not assumed). This filter instead runs against a snapshot built
// from WFM's own public per-item order book + statistics endpoints - see
// services/liveScraperCatalogScan.ts for exactly how each field is computed.
// The user was told this plainly and chose to proceed with a from-scratch
// full-catalog scan anyway (2026-09-17).

import { isThresholdDisabled } from "./liveScraperPricing";
import type { ItemWtbSettings } from "./liveScraperSettings";

export interface ItemStatSnapshot {
  wfmUrl: string;
  wfmId: string;
  itemName: string;
  /** Rank WTB buys this item at: 0 for rankable items (mods/arcanes - WFM
   *  rejects an order without a rank for these), null otherwise. The order
   *  book behind `profit` is filtered to the same rank. Optional so scan
   *  files written before this field existed still load. */
  wtbRank?: number | null;
  /** lowestSellPrice - highestBuyPrice from the live order book; null if either side is empty. */
  profit: number | null;
  /** profit / max(highestBuyPrice, 1) - a WFHelper-custom ratio, not Quantframe's opaque figure. */
  profitMargin: number | null;
  /** 48h closed-volume-weighted average sell price (same figure WTS/wishlist pricing uses). */
  avgPrice: number | null;
  /** Summed traded quantity over the trailing 48h (services/liveScraperItemStats.ts's
   *  tradeVolume) - stands in for Quantframe's item.volume, which is itself an
   *  opaque figure from its own backend cache with no documented formula. */
  volume: number;
  /** Percent change in average sell price over the trailing ~7 days (config/shared/wfmWeeklyShift.ts). */
  weekPriceShift: number | null;
  tradingTax: number | null;
  scannedAt: number;
}

/** Direct port of get_interesting_items's combined filter (§B.2). All
 *  comparisons strict except avgPrice (`<=`) and tradingTax (`<`). */
export function passesWtbFilter(snapshot: ItemStatSnapshot, wtb: ItemWtbSettings): boolean {
  const profitMarginFilter =
    isThresholdDisabled(wtb.minWtbProfitMargin) ||
    (snapshot.profitMargin != null && snapshot.profitMargin >= wtb.minWtbProfitMargin);
  const volumeFilter =
    isThresholdDisabled(wtb.volumeThreshold) || snapshot.volume > wtb.volumeThreshold;
  const profitFilter =
    isThresholdDisabled(wtb.profitThreshold) ||
    (snapshot.profit != null && snapshot.profit > wtb.profitThreshold);
  const avgPriceFilter =
    isThresholdDisabled(wtb.avgPriceCap) ||
    (snapshot.avgPrice != null && snapshot.avgPrice <= wtb.avgPriceCap);
  const weekPriceShiftFilter =
    isThresholdDisabled(wtb.priceShiftThreshold) ||
    (snapshot.weekPriceShift != null && snapshot.weekPriceShift >= wtb.priceShiftThreshold);
  const tradingTaxCapFilter =
    isThresholdDisabled(wtb.tradingTaxCap) ||
    (snapshot.tradingTax != null && snapshot.tradingTax < wtb.tradingTaxCap);

  return (
    volumeFilter &&
    profitFilter &&
    avgPriceFilter &&
    weekPriceShiftFilter &&
    tradingTaxCapFilter &&
    profitMarginFilter
  );
}
