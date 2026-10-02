import { describe, expect, it } from "vitest";

import { en } from "../../../src/i18n/en";
import {
  SHEET_RATING_KEYS,
  SHEET_RATING_TONES,
  SHEET_RATINGS,
  sheetRatingRank,
} from "../../../src/lib/rivens/sheetRating";

describe("riven sheet rating", () => {
  it("ranks good first and leaves an unrated riven without a rank", () => {
    const ranks = SHEET_RATINGS.map(sheetRatingRank);
    expect(ranks).toEqual([4, 3, 2, 1]);
    expect(sheetRatingRank(null)).toBeNull();
  });

  it("labels every rating and colours it by theme token", () => {
    expect(SHEET_RATINGS.map((rating) => en[SHEET_RATING_KEYS[rating]])).toEqual([
      "Good Roll",
      "Almost: one positive off",
      "Good positives, unlisted negative",
      "Not a good roll",
    ]);
    expect(SHEET_RATING_TONES).toEqual({
      good: "text-success",
      "one-positive-off": "text-warning",
      "unlisted-negative": "text-warning",
      "not-good": "text-text-muted",
    });
  });
});
