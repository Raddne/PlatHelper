import { describe, expect, it } from "vitest";

import {
  chipCode,
  chipName,
  chipStatsTitle,
  chipValue,
  orderedChipStats,
} from "../../../src/lib/liveScraper/rivenStatChips";
import { statusHintKey } from "../../../src/lib/liveScraper/statusHints";
import { en } from "../../../src/i18n/en";

const stat = (tag: string, value: number, positive = value >= 0, multiplier = false) => ({
  tag,
  positive,
  multiplier,
  value,
});

describe("riven stat chips", () => {
  it("puts positives first, each side kept in order", () => {
    const stats = [
      stat("WeaponZoomFovMod", -40.2),
      stat("WeaponCritDamageMod", 120.6),
      stat("WeaponFireIterationsMod", 84.3),
    ];
    expect(orderedChipStats(stats).map((s) => s.tag)).toEqual([
      "WeaponCritDamageMod",
      "WeaponFireIterationsMod",
      "WeaponZoomFovMod",
    ]);
  });

  it("signs percentages and writes multipliers as x", () => {
    expect(chipValue(stat("WeaponCritDamageMod", 120.6))).toBe("+120.6%");
    expect(chipValue(stat("WeaponZoomFovMod", -40.2))).toBe("-40.2%");
    expect(chipValue(stat("WeaponFactionDamageGrineer", 1.44, true, true))).toBe("x1.44");
  });

  it("shows the first trader code in upper case", () => {
    expect(chipCode(stat("WeaponCritDamageMod", 1))).toBe("CD");
    expect(chipCode(stat("WeaponFireRateMod", 1))).toBe("FR");
    expect(chipCode(stat("WeaponZoomFovMod", -1))).toBe("ZOOM");
    expect(chipCode(stat("ComboDurationMod", 1))).toBe("COMBO");
  });

  it("falls back to the stat's name for a tag without a code", () => {
    const channeling = { ...stat("WeaponChannelingDamageMod", 1), name: "Channeling Damage" };
    expect(chipCode(channeling)).toBe("Channeling Damage");
    expect(chipCode(stat("WeaponMeleeComboPointsOnHitMod", 1))).toBe("Chance to Gain Combo Count");
  });

  it("names a stat by its given name, else by its tag", () => {
    expect(chipName({ ...stat("WeaponFireRateMod", 1), name: "Attack Speed" })).toBe(
      "Attack Speed",
    );
    expect(chipName(stat("WeaponFireRateMod", 1))).toBe("Fire Rate");
  });

  it("writes a readable hint of value and full name per stat", () => {
    expect(
      chipStatsTitle([stat("WeaponZoomFovMod", -40.2), stat("WeaponCritChanceMod", 153.4)]),
    ).toBe("+153.4% Critical Chance, -40.2% Zoom");
  });
});

describe("statusHintKey", () => {
  it("has an English hint for every status, items and rivens", () => {
    const statuses = [
      "pending",
      "live",
      "toLowProfit",
      "noSellers",
      "noBuyers",
      "inactive",
      "smaLimit",
      "overpriced",
      "underpriced",
      "maxPriceDrop",
      "aboveAvgPrice",
      "stockLimit",
      "budget",
      "orderLimit",
      "error",
    ] as const;
    for (const status of statuses) {
      expect(en[statusHintKey(status)]).toBeTruthy();
      expect(en[statusHintKey(status, true)]).toBeTruthy();
    }
  });

  it("reads a riven's noSellers and inactive in its own terms", () => {
    expect(statusHintKey("noSellers", true)).toBe(
      "liveScraper.listings.statusHint.riven.noSellers",
    );
    expect(statusHintKey("inactive", true)).toBe("liveScraper.listings.statusHint.riven.inactive");
    expect(statusHintKey("noSellers")).toBe("liveScraper.listings.statusHint.noSellers");
    expect(statusHintKey("toLowProfit", true)).toBe("liveScraper.listings.statusHint.toLowProfit");
  });
});
