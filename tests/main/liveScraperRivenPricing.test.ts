import { describe, expect, it } from "vitest";

import {
  averageFilteredLowestPrices,
  comparableSearchTiers,
  MIN_COMPARABLE_LISTINGS,
} from "../../config/shared/liveScraperRivenPricing";

describe("averageFilteredLowestPrices", () => {
  const prices = [100, 110, 120, 900, 2000, 5000];

  it("averages the lowest sample, dropping what the raw threshold multiplier cuts", () => {
    // Quantframe's quirk kept on purpose: 15 means up to 16x the lowest price.
    expect(averageFilteredLowestPrices(prices, 5, 15)).toBe(307);
    expect(averageFilteredLowestPrices(prices, 5, 0.15)).toBe(105);
  });

  it("treats -1 as no sample limit and no threshold", () => {
    expect(averageFilteredLowestPrices(prices, -1, -1)).toBe(1371);
    expect(averageFilteredLowestPrices(prices, 2, -1)).toBe(105);
    expect(averageFilteredLowestPrices(prices, -1, 15)).toBe(307);
  });

  it("answers -1 when there is nothing to average", () => {
    expect(averageFilteredLowestPrices([], 5, 15)).toBe(-1);
    expect(averageFilteredLowestPrices(prices, 0, 15)).toBe(-1);
  });
});

describe("comparableSearchTiers", () => {
  const cc = "critical_chance";
  const cd = "critical_damage";
  const ms = "multishot";

  it("asks for the identical roll first, then the same positives with any negative", () => {
    expect(comparableSearchTiers([cc, cd], ["zoom"], [])).toEqual([
      { name: "exact", positive: [cc, cd], negative: ["zoom"] },
      { name: "positives", positive: [cc, cd], negative: [] },
    ]);
  });

  it("has one tier for a roll without a negative", () => {
    expect(comparableSearchTiers([cc, cd], [], [])).toEqual([
      { name: "exact", positive: [cc, cd], negative: [] },
    ]);
  });

  it("adds the weapon's key stats the riven has, largest group first", () => {
    const groups = [
      { mandatory: [cc], optional: [ms] },
      { mandatory: [ms, "status_chance"], optional: [] },
      { mandatory: [cc, cd], optional: [ms, "damage"] },
    ];
    expect(comparableSearchTiers([cc, cd, ms], ["zoom"], groups).map((t) => t.positive)).toEqual([
      [cc, cd, ms],
      [cc, cd, ms],
      [cc, ms],
    ]);
    // The third group covers the whole roll and repeats the positives tier.
    expect(comparableSearchTiers([cc, cd, ms], ["zoom"], groups)).toHaveLength(3);
  });

  it("skips a group whose mandatory stat the riven lacks", () => {
    const tiers = comparableSearchTiers([cc, "zoom"], [], [{ mandatory: [ms], optional: [cc] }]);
    expect(tiers.map((t) => t.name)).toEqual(["exact"]);
  });

  it("has no search for a roll without positive stats", () => {
    expect(comparableSearchTiers([], ["zoom"], [])).toEqual([]);
  });

  it("wants more than a lone listing before it calls something a price", () => {
    expect(MIN_COMPARABLE_LISTINGS).toBeGreaterThanOrEqual(2);
  });
});
