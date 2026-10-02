import { describe, expect, it } from "vitest";

import {
  rivenMatchesPickerQuery,
  rivenMatchesQuery,
} from "../../../src/lib/liveScraper/rivenSearch.js";
import { RIVEN_STAT_CODES } from "../../../src/lib/liveScraper/rivenStatCodes.js";
import { TAG_TO_WFM_URL_NAME } from "../../../config/shared/wfmRivenVocabulary.js";

const RUBICO = { weaponName: "Rubico", rivenName: "Crita-visican" };

describe("rivenMatchesQuery", () => {
  it("matches every riven on an empty or blank query", () => {
    expect(rivenMatchesQuery(RUBICO, "")).toBe(true);
    expect(rivenMatchesQuery(RUBICO, "   ")).toBe(true);
  });

  it("matches the weapon name or the riven name, ignoring case and outer spaces", () => {
    expect(rivenMatchesQuery(RUBICO, "rubi")).toBe(true);
    expect(rivenMatchesQuery(RUBICO, "  VISICAN ")).toBe(true);
  });

  it("matches weapon and riven name typed together", () => {
    expect(rivenMatchesQuery(RUBICO, "rubico crita")).toBe(true);
    expect(rivenMatchesQuery(RUBICO, "crita rubico")).toBe(false);
  });

  it("rejects a query found in neither name", () => {
    expect(rivenMatchesQuery(RUBICO, "boar")).toBe(false);
  });
});

const stat = (tag: string, name: string, positive = true) => ({ tag, name, positive });

// +critical chance, +critical damage, +multishot, -zoom.
const RUBICO_ROLL = {
  ...RUBICO,
  stats: [
    stat("WeaponCritChanceMod", "Critical Chance"),
    stat("WeaponCritDamageMod", "Critical Damage"),
    stat("WeaponFireIterationsMod", "Multishot"),
    stat("WeaponZoomFovMod", "Zoom", false),
  ],
};

describe("rivenMatchesPickerQuery", () => {
  const matches = (query: string, riven = RUBICO_ROLL) => rivenMatchesPickerQuery(riven, query);

  it("matches every riven on an empty or blank query", () => {
    expect(matches("")).toBe(true);
    expect(matches("  ")).toBe(true);
  });

  it("matches a substring of the weapon, the riven name or a stat name", () => {
    expect(matches("RUBI")).toBe(true);
    expect(matches("visi")).toBe(true);
    expect(matches("multi")).toBe(true);
    expect(matches("heat")).toBe(false);
  });

  it("needs every word to match", () => {
    expect(matches("rubico multishot")).toBe(true);
    expect(matches("rubico  cd   ms")).toBe(true);
    expect(matches("rubico heat")).toBe(false);
  });

  it("matches a shorthand code only when typed whole", () => {
    expect(matches("cd")).toBe(true);
    expect(matches("CC")).toBe(true);
    // Names without the letter isolate the code rule.
    const boar = { weaponName: "Boar", rivenName: "Satiata" };
    const unnamed = { ...boar, stats: [stat("WeaponCritChanceMod", "暴击几率")] };
    expect(matches("cc", unnamed)).toBe(true);
    expect(matches("c", unnamed)).toBe(false);
    const grineer = { ...boar, stats: [stat("WeaponFactionDamageGrineer", "Damage to Grineer")] };
    expect(matches("dtg", grineer)).toBe(true);
    expect(matches("dt", grineer)).toBe(false);
  });

  it("limits a signed word to stats of that sign", () => {
    expect(matches("+cd")).toBe(true);
    expect(matches("+critical")).toBe(true);
    expect(matches("-zoom")).toBe(true);
    expect(matches("\u2212zoom")).toBe(true);
    expect(matches("-z")).toBe(true);
    expect(matches("+zoom")).toBe(false);
    expect(matches("-cd")).toBe(false);
    // A sign never reaches the weapon or riven name.
    expect(matches("+rubico")).toBe(false);
  });

  it("lets a bare sign match everything", () => {
    expect(matches("+")).toBe(true);
    expect(matches("-")).toBe(true);
    expect(matches("rubico -")).toBe(true);
  });

  it("resolves every code in the map to its stat", () => {
    for (const [tag, codes] of Object.entries(RIVEN_STAT_CODES)) {
      expect(TAG_TO_WFM_URL_NAME, tag).toHaveProperty(tag);
      for (const code of codes) {
        const roll = { weaponName: "W", rivenName: "N", stats: [stat(tag, "")] };
        expect(rivenMatchesPickerQuery(roll, code), `${tag} ${code}`).toBe(true);
        expect(rivenMatchesPickerQuery(roll, `+${code}`), `${tag} +${code}`).toBe(true);
        expect(rivenMatchesPickerQuery(roll, `-${code}`), `${tag} -${code}`).toBe(false);
      }
    }
  });
});
