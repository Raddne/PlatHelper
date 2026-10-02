// The roll sheet rating as the riven views show it: label, tone and sort rank.

import type { MessageKey } from "../i18n.js";
import type { SheetRating } from "../../../config/shared/rivenRollSheet.js";

/** Best first, the order the sort and the filter use. */
export const SHEET_RATINGS: readonly SheetRating[] = [
  "good",
  "one-positive-off",
  "unlisted-negative",
  "not-good",
];

export const SHEET_RATING_KEYS: Record<SheetRating, MessageKey> = {
  good: "rivens.sheetRating.good",
  "one-positive-off": "rivens.sheetRating.onePositiveOff",
  "unlisted-negative": "rivens.sheetRating.unlistedNegative",
  "not-good": "rivens.sheetRating.notGood",
};

/** Theme text colours: green, yellow for the near misses, muted for not good. */
export const SHEET_RATING_TONES: Record<SheetRating, string> = {
  good: "text-success",
  "one-positive-off": "text-warning",
  "unlisted-negative": "text-warning",
  "not-good": "text-text-muted",
};

/** Sort rank, best highest; an unrated riven has none and sorts last. */
export function sheetRatingRank(rating: SheetRating | null): number | null {
  return rating ? SHEET_RATINGS.length - SHEET_RATINGS.indexOf(rating) : null;
}
