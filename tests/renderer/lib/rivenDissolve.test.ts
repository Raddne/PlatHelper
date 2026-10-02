import { describe, expect, it } from "vitest";

import { rivenDissolveHint } from "../../../src/lib/rivens/dissolve.js";

function riven(overrides: Partial<Parameters<typeof rivenDissolveHint>[0]> = {}) {
  return {
    sheetRating: "not-good" as const,
    masteryReq: 12,
    currentRank: 0,
    rerolls: 0,
    ...overrides,
  };
}

describe("rivenDissolveHint", () => {
  it("stays quiet on a roll worth keeping", () => {
    expect(rivenDissolveHint(riven({ sheetRating: "good", rerolls: 40 }))).toBeNull();
    // A near miss is still worth trading, not dissolving.
    expect(rivenDissolveHint(riven({ sheetRating: "one-positive-off", rerolls: 40 }))).toBeNull();
    expect(rivenDissolveHint(riven({ sheetRating: "unlisted-negative", rerolls: 40 }))).toBeNull();
    // A weapon the roll sheet lacks has no rating, so it gets no dissolve advice either.
    expect(rivenDissolveHint(riven({ sheetRating: null, rerolls: 40 }))).toBeNull();
  });

  it("stays quiet on a weak but barely rolled low-rank card", () => {
    expect(rivenDissolveHint(riven({ rerolls: 4 }))).toBeNull();
  });

  it("reports the endo once a weak roll has been rerolled", () => {
    // 100*(12-8) + floor(22.5*2^0) + 200*5 - 7
    expect(rivenDissolveHint(riven({ rerolls: 5 }))).toBe(400 + 22 + 1000 - 7);
  });

  it("reports the endo on a maxed weak card even with no rerolls", () => {
    expect(rivenDissolveHint(riven({ currentRank: 8 }))).toBe(400 + 5760 - 7);
  });
});
