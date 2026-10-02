import { describe, expect, it } from "vitest";

import {
  evaluateSheetRoll,
  evaluateSheetRow,
  findSheetWeapon,
  rateRivenBySheet,
  rollCodeForTag,
  ROLL_STAT_CODES,
  ROLL_STAT_LABELS,
  sameSheetWeapon,
  type RivenRoll,
  type RollSheetRow,
  type RollSheetWeapon,
  type RollStatCode,
  type RollVerdictKind,
  type SheetRating,
} from "../../config/shared/rivenRollSheet";
import {
  RIVEN_NAME_PARTS,
  RIVEN_ROLL_SHEET_WEAPONS,
} from "../../config/shared/rivenRollSheetTable";
import { getAllRivenWeaponNames, statNameToTag } from "../../services/rivenData";

// Sheet weapons that no name in the app's weapon data reaches through findSheetWeapon;
// both are missing from warframe-public-export-plus 0.6.8 altogether. A change here
// means the sheet or the export moved; check the lookup still finds them.
const UNRESOLVED_SHEET_WEAPONS = ["Aksondol", "Nunchasa"];

function weapon(name: string): RollSheetWeapon {
  const entry = findSheetWeapon(name);
  if (!entry) throw new Error(`no sheet entry for ${name}`);
  return entry;
}

// Rows are picked by their raw positive cells, "B | C | D".
function sheetRow(name: string, positives: string): RollSheetRow {
  const row = weapon(name).rows.find(
    (candidate) => candidate.raw.positives.join(" | ") === positives,
  );
  if (!row) throw new Error(`no ${name} row ${positives}`);
  return row;
}

// "MS,CD,CC / IMP"; "none" for a roll without a negative.
function roll(spec: string): RivenRoll {
  const [positives, negative] = spec.split(" / ");
  return {
    positives: positives.split(",") as RollStatCode[],
    negative: negative === "none" ? null : (negative as RollStatCode),
  };
}

const sorted = (codes: readonly string[]): string[] => [...codes].sort();

describe("riven roll sheet table", () => {
  it("holds every weapon, roll row and name part of the sheet", () => {
    expect(RIVEN_ROLL_SHEET_WEAPONS).toHaveLength(418);
    expect(RIVEN_ROLL_SHEET_WEAPONS.reduce((sum, entry) => sum + entry.rows.length, 0)).toBe(695);
    expect(RIVEN_NAME_PARTS).toHaveLength(31);
  });

  it("uses only known stat codes, each with a label", () => {
    const known = new Set<string>(ROLL_STAT_CODES);
    const unknown: string[] = [];
    for (const entry of RIVEN_ROLL_SHEET_WEAPONS) {
      for (const row of entry.rows) {
        const { stats, anyExcept } = row.negatives;
        const codes = [...row.slots.flatMap((slot) => slot.stats), ...stats, ...anyExcept];
        unknown.push(
          ...codes.filter((code) => !known.has(code)).map((code) => `${row.sheetRow}:${code}`),
        );
      }
    }
    unknown.push(
      ...RIVEN_NAME_PARTS.filter((part) => !known.has(part.code)).map((part) => part.code),
    );
    expect(unknown).toEqual([]);
    expect(sorted(Object.keys(ROLL_STAT_LABELS))).toEqual(sorted(ROLL_STAT_CODES));
  });

  it("gives all three slots of Latron's merged B:D row the same set", () => {
    const row = weapon("Latron").rows.find(
      (candidate) => new Set(candidate.raw.positives).size === 1,
    );
    expect(row).toBeDefined();
    expect(sorted(row!.slots[0].stats)).toEqual(["CC", "CD", "DMG", "MS"]);
    expect(row!.slots[1]).toEqual(row!.slots[0]);
    expect(row!.slots[2]).toEqual(row!.slots[0]);
  });

  it("reads Sarpa's ANY (not AS/CCC) as any curse but FR and CCC", () => {
    const row = weapon("Sarpa").rows.find((candidate) => candidate.negatives.anyExcept.length > 0);
    expect(row?.negatives.any).toBe(true);
    expect(sorted(row!.negatives.anyExcept)).toEqual(["CCC", "FR"]);
  });

  it("merges the rifle and melee Vinquibus blocks into one entry", () => {
    const rows = weapon("Vinquibus").rows;
    expect(rows).toHaveLength(4);
    expect(rows.some((row) => row.slots[0].stats.includes("MS"))).toBe(true);
    expect(rows.some((row) => row.slots[1].stats.includes("RNG"))).toBe(true);
  });
});

// [weapon, roll, expected, row ("B | C | D") when the case checks one row]
const MATCHER_CASES: Array<[string, string, RollVerdictKind, string?]> = [
  ["Acceltra", "MS,CD,CC / IMP", "good"],
  ["Acceltra", "MS,TOX,CD / Z", "good"],
  ["Acceltra", "MS,CD,TOX / REC", "good"],
  ["Acceltra", "MS,FR,DMG / IMP", "not-good"],
  ["Acceltra", "MS,CD / IMP", "not-good"],
  ["Acceltra", "MS,CD,CC / none", "positives-no-negative"],
  ["Acceltra", "MS,CD,CC / DMG", "positives-unlisted-negative"],
  ["Boar", "MS,FR / AMMO", "good"],
  ["Boar", "MS,FR,CD / RLS", "good"],
  ["Latron", "CC,DMG,CD / PUNC", "good"],
  ["Latron", "MS,CC / Z", "not-good"],
  ["Dual Ichor", "TOX,CC,HEAT / none", "good"],
  ["Dual Ichor", "TOX,CC,HEAT / IMP", "positives-unlisted-negative"],
  ["Dual Ichor", "TOX,HEAT / none", "not-good"],
  ["Penta", "DMG,MAG / CC", "good", "ANY | NONE | MAG"],
  ["Penta", "DMG,MAG / none", "positives-no-negative", "ANY | NONE | MAG"],
  ["Penta", "MS,DMG,MAG / CC", "not-good", "ANY | NONE | MAG"],
  ["Sarpa", "FR,CCC / DMG", "good", "AS / IC | CCC / IC | IC / NONE"],
  ["Sarpa", "IC,CCC / DMG", "good", "AS / IC | CCC / IC | IC / NONE"],
  ["Sarpa", "FR,CCC,IC / SLIDE", "good", "AS / IC | CCC / IC | IC / NONE"],
  ["Sarpa", "FR,IC / CCC", "positives-unlisted-negative", "AS / IC | CCC / IC | IC / NONE"],
  ["Verglas", "CC,MS / DTI", "good", "NONE | CC* | MS > ANY"],
  ["Verglas", "CC,DMG / MAG", "good", "NONE | CC* | MS > ANY"],
  ["Verglas", "CC,MS,DMG / DTI", "not-good", "NONE | CC* | MS > ANY"],
  ["Ignis", "TOX,COLD,SC / none", "good"],
  ["Epitaph", "TOX,COLD / DMG", "good"],
  ["Ack & Brunt", "FR,RNG,CD / SLIDE", "good"],
  ["Braton", "MS,CD,CC / IMP", "good"],
  // Rubico: MS | CD | CC > DMG / FR > TOX / SC, negatives Z / IMP > REC.
  ["Rubico", "CD,MS,CC / Z", "good"],
  ["Rubico", "CD,MS,CC / none", "positives-no-negative"],
  ["Rubico", "CD,MS,CC / MAG", "positives-unlisted-negative"],
  ["Rubico", "CC,DMG,MS / Z", "not-good"],
];

describe("sheet matcher", () => {
  it.each(MATCHER_CASES)("%s %s -> %s", (name, spec, expected, positives) => {
    if (positives) {
      expect(evaluateSheetRow(sheetRow(name, positives), roll(spec))).toBe(expected);
      return;
    }
    const verdict = evaluateSheetRoll(weapon(name), roll(spec));
    expect(verdict.kind).toBe(expected);
    expect(verdict.row === null).toBe(expected === "not-good");
  });

  it("prefers a good row over an earlier near miss", () => {
    // Braton's first row wants MS; its second takes CC | CD | TOX without it.
    const verdict = evaluateSheetRoll(weapon("Braton"), roll("CC,CD,TOX / Z"));
    expect(verdict.kind).toBe("good");
    expect(verdict.row?.raw.positives).toEqual(["CC", "CD", "TOX / DMG / FR"]);
  });
});

describe("findSheetWeapon", () => {
  it.each([
    ["Kuva Sobek", "Sobek"],
    ["Braton Prime", "Braton"],
    ["Tenet Exec", "Tenet Exec"],
    ["tenet cycron", "Cycron"],
    ["Not A Weapon", null],
  ])("%s -> %s", (name, expected) => {
    expect(findSheetWeapon(name)?.name ?? null).toBe(expected);
  });
});

describe("sameSheetWeapon", () => {
  it.each([
    ["Kuva Sobek", "sobek", true],
    ["Braton  Prime", "Braton", true],
    ["Sobek", "Boar", false],
    ["", "Sobek", false],
  ] as const)("%s / %s -> %s", (a, b, expected) => {
    expect(sameSheetWeapon(a, b)).toBe(expected);
  });
});

describe("rollCodeForTag", () => {
  it.each([
    ["Critical Chance", "CC"],
    ["Multishot", "MS"],
    ["Attack Speed", "FR"],
    ["Fire Rate", "FR"],
    ["Melee Damage", "DMG"],
    ["Damage", "DMG"],
    ["Recoil", "REC"],
    ["Zoom", "Z"],
    ["Critical Chance for Slide Attack", "SLIDE"],
    ["Chance to Gain Combo Count", "CCC"],
    ["Combo Duration", "COMBO"],
  ])("%s -> %s", (name, code) => {
    expect(rollCodeForTag(statNameToTag(name) ?? "")).toBe(code);
  });

  it.each(["", "WeaponChannelingDamageMod", "constructor", "toString"])(
    "has no code for %j",
    (tag) => {
      expect(rollCodeForTag(tag)).toBeNull();
    },
  );
});

describe("sheet weapon coverage", () => {
  it("reaches every sheet weapon from the app's weapon names, bar a known list", () => {
    const reached = new Set<string>();
    for (const name of getAllRivenWeaponNames()) {
      const entry = findSheetWeapon(name);
      if (entry) reached.add(entry.name);
    }
    const unresolved = RIVEN_ROLL_SHEET_WEAPONS.map((entry) => entry.name)
      .filter((name) => !reached.has(name))
      .sort();
    expect(unresolved).toEqual(UNRESOLVED_SHEET_WEAPONS);
  });
});

// Stats by upgrade tag, built from "+Name" / "-Name" display names.
function stats(...specs: string[]): { tag: string; positive: boolean }[] {
  return specs.map((spec) => ({
    tag: statNameToTag(spec.slice(1)) ?? spec.slice(1),
    positive: spec.startsWith("+"),
  }));
}

const CRIT = ["+Critical Damage", "+Multishot", "+Critical Chance"];

describe("rateRivenBySheet on stats it cannot judge", () => {
  it.each([
    ["a stat without a code", [...CRIT, "-Channeling Damage"]],
    ["one positive", ["+Multishot", "-Zoom"]],
    ["four positives", [...CRIT, "+Damage"]],
    ["a positive twice", ["+Multishot", "+Multishot", "-Zoom"]],
    ["two negatives", [...CRIT, "-Zoom", "-Impact"]],
  ])("has no rating for %s", (_label, specs) => {
    const rated = rateRivenBySheet("Rubico", stats(...specs));
    expect(rated.weapon?.name).toBe("Rubico");
    expect(rated.rating).toBeNull();
    expect(rated.row).toBeNull();
  });
});

describe("rateRivenBySheet", () => {
  // Rubico: MS | CD | CC > DMG / FR > TOX / SC, negatives Z / IMP > REC.
  it.each([
    [[...CRIT, "-Zoom"], "good"],
    [CRIT, "not-good"],
    [[...CRIT, "-Magazine Capacity"], "unlisted-negative"],
    [["+Critical Damage", "+Multishot", "+Heat", "-Zoom"], "one-positive-off"],
    [["+Critical Damage", "+Multishot", "+Heat"], "not-good"],
    [["+Critical Damage", "+Multishot", "+Heat", "-Magazine Capacity"], "not-good"],
    [["+Critical Chance", "+Damage", "+Multishot", "-Zoom"], "one-positive-off"],
    [["+Critical Chance", "+Heat", "+Cold", "-Zoom"], "not-good"],
  ] as const)("Rubico %j -> %s", (specs, expected: SheetRating) => {
    const rated = rateRivenBySheet("Rubico", stats(...specs));
    expect(rated.weapon?.name).toBe("Rubico");
    expect(rated.rating).toBe(expected);
    expect(rated.row === null).toBe(expected === "not-good");
  });

  it("names the row a good roll came from", () => {
    const rated = rateRivenBySheet("Rubico", stats(...CRIT, "-Zoom"));
    expect(rated.row?.raw).toEqual({
      positives: ["MS", "CD", "CC > DMG / FR > TOX / SC"],
      negatives: "Z / IMP > REC",
      note: null,
    });
  });

  it("does not call two positives with one off a near miss", () => {
    expect(rateRivenBySheet("Rubico", stats("+Multishot", "+Heat", "-Zoom")).rating).toBe(
      "not-good",
    );
  });

  it("takes the best rating over the rows", () => {
    // Braton's first row is one positive off (no MS); the second takes the roll.
    expect(
      rateRivenBySheet("Braton", stats("+Critical Chance", "+Critical Damage", "+Toxin", "-Zoom"))
        .rating,
    ).toBe("good");
  });

  it("has no weapon or rating for one the sheet does not list", () => {
    expect(rateRivenBySheet("Not A Weapon", stats(...CRIT, "-Zoom"))).toEqual({
      weapon: null,
      rating: null,
      row: null,
    });
  });

  it("has no rating for stats it cannot judge", () => {
    const rated = rateRivenBySheet("Rubico", stats(...CRIT, "-Zoom", "-Impact"));
    expect(rated.weapon?.name).toBe("Rubico");
    expect(rated.rating).toBeNull();
    expect(rated.row).toBeNull();
  });
});
