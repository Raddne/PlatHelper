import { describe, expect, it } from "vitest";

import {
  sheetBestAttributes,
  sheetGoodRollDetail,
  sheetKeyStatGroups,
} from "../../config/shared/rivenRollSheetGroups";

describe("sheetKeyStatGroups", () => {
  it("requires the single-stat slots of a row and offers the rest", () => {
    // Rubico: MS | CD | CC > DMG / FR > TOX / SC.
    expect(sheetKeyStatGroups("Rubico Prime")).toEqual([
      {
        mandatory: ["multishot", "critical_damage"],
        optional: [
          "critical_chance",
          "base_damage_/_melee_damage",
          "fire_rate_/_attack_speed",
          "toxin_damage",
          "status_chance",
        ],
      },
    ]);
  });

  it("gives every sheet row its own group", () => {
    // Galatine: AS | RNG | CD > ELEC, then CC | CD | DMG / AS.
    expect(sheetKeyStatGroups("Galatine")).toEqual([
      {
        mandatory: ["fire_rate_/_attack_speed", "range"],
        optional: ["critical_damage", "electric_damage"],
      },
      {
        mandatory: ["critical_chance", "critical_damage"],
        optional: ["base_damage_/_melee_damage", "fire_rate_/_attack_speed"],
      },
    ]);
  });

  it("requires nothing from a slot that may stay empty", () => {
    // Sarpa's third row, AS / IC | CCC / IC | IC / NONE: CCC is both combo count tags.
    expect(sheetKeyStatGroups("Sarpa")[2]).toEqual({
      mandatory: [],
      optional: [
        "fire_rate_/_attack_speed",
        "channeling_damage",
        "chance_to_gain_combo_count",
        "chance_to_gain_extra_combo_count",
      ],
    });
  });

  it("adds nothing for an ANY slot", () => {
    // Penta's third row ANY | NONE | MAG, Verglas's second NONE | CC* | MS > ANY.
    expect(sheetKeyStatGroups("Penta")[2]).toEqual({
      mandatory: ["magazine_capacity"],
      optional: [],
    });
    expect(sheetKeyStatGroups("Verglas")[1]).toEqual({
      mandatory: ["critical_chance"],
      optional: [],
    });
  });

  it("has no groups for a weapon the sheet does not list", () => {
    expect(sheetKeyStatGroups("Ceti Lacera")).toEqual([]);
    expect(sheetKeyStatGroups("Not A Weapon")).toEqual([]);
  });
});

describe("sheetGoodRollDetail", () => {
  it("resolves each row with its own accepted curses", () => {
    const detail = sheetGoodRollDetail("Lex");
    expect(detail?.groups).toHaveLength(1);
    const [group] = detail!.groups;
    expect(group!.mandatory.map((a) => a.wfmUrlName)).toEqual(["multishot", "critical_damage"]);
    expect(group!.optional.map((a) => a.displayName)).toEqual([
      "Critical Chance",
      "Fire Rate",
      "Toxin",
      "Damage",
      "Status Chance",
    ]);
    expect(group!.negatives.map((a) => a.wfmUrlName)).toEqual([
      "puncture_damage",
      "zoom",
      "projectile_speed",
      "recoil",
    ]);
    expect(detail!.acceptedNegatives).toEqual(group!.negatives);
  });

  it("names a melee weapon's stats in their melee form", () => {
    const detail = sheetGoodRollDetail("Galatine", true)!;
    expect(detail.groups.map((g) => g.mandatory.map((a) => a.displayName))).toEqual([
      ["Attack Speed", "Range"],
      ["Critical Chance", "Critical Damage"],
    ]);
    expect(detail.groups[1]!.optional[0]).toEqual({
      tag: "WeaponMeleeDamageMod",
      wfmUrlName: "base_damage_/_melee_damage",
      displayName: "Melee Damage",
    });
  });

  it("joins the rows' curses for a weapon-level list", () => {
    // Verglas: CC / DTI on the first row, DTI > DTC > MAG on the others.
    expect(sheetGoodRollDetail("Verglas")!.acceptedNegatives.map((a) => a.wfmUrlName)).toEqual([
      "critical_chance",
      "damage_vs_infested",
      "damage_vs_corpus",
      "magazine_capacity",
    ]);
  });

  it("labels the combo count code as the sheet does", () => {
    const optional = sheetGoodRollDetail("Sarpa", true)!.groups[2]!.optional;
    expect(optional.map((a) => a.displayName)).toEqual([
      "Attack Speed",
      "Initial Combo",
      "Additional Combo Count Chance",
    ]);
  });

  it("is null for a weapon the sheet does not list", () => {
    expect(sheetGoodRollDetail("Ceti Lacera")).toBeNull();
  });
});

describe("sheetBestAttributes", () => {
  it("lists the required stats first, then the rest, and every accepted curse", () => {
    expect(sheetBestAttributes("Angstrum")).toEqual({
      positives: [
        "Multishot",
        "Critical Damage",
        "Critical Chance",
        "Fire Rate",
        "Toxin",
        "Damage",
        "Status Chance",
      ],
      negatives: ["Zoom", "Weapon Recoil", "Ammo Maximum"],
    });
  });

  it("joins the rows of a weapon with several", () => {
    expect(sheetBestAttributes("Galatine", true)?.positives).toEqual([
      "Attack Speed",
      "Range",
      "Critical Chance",
      "Critical Damage",
      "Electricity",
      "Melee Damage",
    ]);
  });

  it("is null for a weapon the sheet does not list", () => {
    expect(sheetBestAttributes("Not A Weapon")).toBeNull();
  });
});
