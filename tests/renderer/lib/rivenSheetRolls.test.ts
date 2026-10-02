import { describe, expect, it } from "vitest";

import { sheetCellParts, sheetCellTokens } from "../../../renderer/riven-sheet-rolls.js";

describe("sheetCellParts", () => {
  it("splits on / and > and keeps the separators", () => {
    expect(sheetCellParts("CC > DMG / FR")).toEqual([
      { text: "CC", token: true },
      { text: " > ", token: false },
      { text: "DMG", token: true },
      { text: " / ", token: false },
      { text: "FR", token: true },
    ]);
  });

  it("reads >> as one separator and leaves parentheses whole", () => {
    expect(sheetCellParts("IMP(Vandal) / PUNC(Prime) >> Z")).toEqual([
      { text: "IMP(Vandal)", token: true },
      { text: " / ", token: false },
      { text: "PUNC(Prime)", token: true },
      { text: " >> ", token: false },
      { text: "Z", token: true },
    ]);
    expect(sheetCellParts("ANY (not AS/CCC)")).toEqual([{ text: "ANY (not AS/CCC)", token: true }]);
  });

  it("keeps a single-stat cell whole", () => {
    expect(sheetCellParts("MS*")).toEqual([{ text: "MS*", token: true }]);
    expect(sheetCellParts("")).toEqual([]);
  });
});

describe("sheetCellTokens", () => {
  it("pairs the tokens with the cell's codes in order", () => {
    expect(sheetCellTokens("CC > DMG / AS", ["CC", "DMG", "FR"])).toEqual([
      { text: "CC", code: "CC" },
      { text: " > ", code: null },
      { text: "DMG", code: "DMG" },
      { text: " / ", code: null },
      { text: "AS", code: "FR" },
    ]);
  });

  it("pairs nothing when the counts differ, as in ANY or NONE cells", () => {
    expect(sheetCellTokens("IC / NONE", ["IC"])).toEqual([
      { text: "IC", code: null },
      { text: " / ", code: null },
      { text: "NONE", code: null },
    ]);
    expect(sheetCellTokens("ANY", [])).toEqual([{ text: "ANY", code: null }]);
    expect(sheetCellTokens("MS", undefined)).toEqual([{ text: "MS", code: null }]);
  });
});
