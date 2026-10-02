import fs from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  selectOptionValues,
  type ElectronTestHarness,
} from "./electronTestHarness";

// An unveiled riven is an Upgrades entry whose fingerprint carries a weapon
// compat plus buffs/curses; a veiled one carries a challenge instead.
const MAX_ROLL_INT = 0x3fffffff;
// The card carries the riven's inventory ItemId, so a locator built from these
// stays valid under translation and in both card sizes.
const RIFLE_RIVEN_ID = "aaaaaaaaaaaaaaaaaaaaaaa1";
const PISTOL_RIVEN_ID = "aaaaaaaaaaaaaaaaaaaaaaa2";

function riven(itemType: string, oid: string, compat: string, buff: number, curse: number) {
  return {
    ItemType: `/Lotus/Upgrades/Mods/Randomized/${itemType}`,
    ItemId: { $oid: oid },
    UpgradeFingerprint: JSON.stringify({
      compat,
      lim: 0,
      lvlReq: 9,
      lvl: 8,
      rerolls: 2,
      pol: "AP_ATTACK",
      buffs: [{ Tag: "WeaponFireDamageMod", Value: Math.round(MAX_ROLL_INT * buff) }],
      curses: [{ Tag: "WeaponFireRateMod", Value: Math.round(MAX_ROLL_INT * curse) }],
    }),
  };
}

// The overall grade is lerp(-10, 10, avg roll), curses counting inverted: the
// rifle rolls average 0.71 (A-) and the pistol 0.05 (C-), one card per letter.
function inventory() {
  return {
    Suits: [],
    Upgrades: [
      riven(
        "LotusRifleRandomModRare",
        RIFLE_RIVEN_ID,
        "/Lotus/Weapons/Tenno/Rifle/Rifle",
        0.72,
        0.3,
      ),
      riven(
        "LotusPistolRandomModRare",
        PISTOL_RIVEN_ID,
        "/Lotus/Weapons/Tenno/Pistol/HeavyPistol",
        0.05,
        0.95,
      ),
    ],
  };
}

test.describe("riven card size", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-riven-cards-", { inventory: inventory() });
    await openView(harness.page, "rivens");
    await expect(harness.page.locator("[data-riven-card]").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("starts on full cards and switches to compact", async () => {
    const page = harness!.page;

    const grid = page.locator("[data-riven-card-size]");
    await expect(grid).toHaveAttribute("data-riven-card-size", "full");
    const fullCards = await page.locator("[data-riven-card]").count();
    expect(fullCards).toBe(2);

    const rifleCard = page.locator(`[data-riven-card="${RIFLE_RIVEN_ID}"]`);
    await expect(rifleCard).toBeVisible();
    await expect(rifleCard.locator("[data-riven-grade]")).toHaveText(/^[SABCF][+-]?$/);

    // SegmentedControl renders the options in store order: full, compact.
    await openView(page, "settings");
    await page.locator('[data-tour-tab="appearance"]').click();
    await page.locator("[data-riven-card-size-control] button").nth(1).click();
    await openView(page, "rivens");

    await expect(grid).toHaveAttribute("data-riven-card-size", "compact");
    await expect(page.locator("[data-riven-card]")).toHaveCount(fullCards);

    await expect(rifleCard).toBeVisible();
    await expect(rifleCard.locator("[data-riven-grade]")).toHaveText(/^[SABCF][+-]?$/);
    await expect(rifleCard.locator("[data-riven-copy-tag]")).toBeVisible();
  });

  test("keeps the compact choice across a reload", async () => {
    const page = harness!.page;

    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    await openView(page, "rivens");

    await expect(page.locator("[data-riven-card-size]")).toHaveAttribute(
      "data-riven-card-size",
      "compact",
      { timeout: 30_000 },
    );
    await expect(page.locator("[data-riven-card]")).toHaveCount(2);
  });

  test("the grade dropdowns list every grade and narrow the cards", async () => {
    const page = harness!.page;

    const gradeSelect = page.locator("[data-riven-grade-filter] [data-riven-grade-select]");
    const ratingSelect = page.locator("[data-riven-sheet-rating-select]");
    await expect(gradeSelect).toBeVisible({ timeout: 30_000 });

    expect(await selectOptionValues(gradeSelect)).toEqual(["all", "S", "A", "B", "C", "F"]);
    expect(await selectOptionValues(ratingSelect)).toEqual([
      "all",
      "good",
      "one-positive-off",
      "unlisted-negative",
      "not-good",
    ]);

    // The filter matches the letter family, so "C" keeps C+, C and C-.
    await gradeSelect.selectOption("C");
    await expect(page.locator("[data-riven-card]")).toHaveCount(1);
    await expect(
      page.locator(`[data-riven-card="${PISTOL_RIVEN_ID}"] [data-riven-grade]`),
    ).toHaveText(/^C[+-]?$/);

    await gradeSelect.selectOption("A");
    await expect(page.locator("[data-riven-card]")).toHaveCount(1);
    await expect(
      page.locator(`[data-riven-card="${RIFLE_RIVEN_ID}"] [data-riven-grade]`),
    ).toHaveText(/^A[+-]?$/);

    await gradeSelect.selectOption("all");
    await expect(page.locator("[data-riven-card]")).toHaveCount(2);
  });
});

type Roll = [tag: string, roll: number];

function rolledRiven(oid: string, compat: string, buffs: Roll[], curses: Roll[]) {
  const values = (rolls: Roll[]) =>
    rolls.map(([tag, roll]) => ({ Tag: tag, Value: Math.round(MAX_ROLL_INT * roll) }));
  return {
    ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
    ItemId: { $oid: oid },
    UpgradeFingerprint: JSON.stringify({
      compat,
      lim: 0,
      lvlReq: 10,
      lvl: 8,
      rerolls: 7,
      pol: "AP_ATTACK",
      buffs: values(buffs),
      curses: values(curses),
    }),
  };
}

const BRATON = "/Lotus/Weapons/Tenno/Rifle/Rifle";
const CC: Roll = ["WeaponCritChanceMod", 0.8];
const CD: Roll = ["WeaponCritDamageMod", 0.7];
const MS: Roll = ["WeaponFireIterationsMod", 0.6];
// Braton's sheet rows: MS | CD | CC > TOX > FR / DMG / SC and CC | CD | TOX / DMG / FR,
// negatives IMP / PUNC > Z > REC. Each riven below meets them a different way.
const RATED = {
  good: rolledRiven("bbbbbbbbbbbbbbbbbbbbbbb1", BRATON, [CC, CD, MS], [["WeaponZoomFovMod", 0.4]]),
  "one-positive-off": rolledRiven(
    "bbbbbbbbbbbbbbbbbbbbbbb2",
    BRATON,
    [CD, MS, ["WeaponFireDamageMod", 0.7]],
    [["WeaponZoomFovMod", 0.4]],
  ),
  "unlisted-negative": rolledRiven(
    "bbbbbbbbbbbbbbbbbbbbbbb3",
    BRATON,
    [CC, CD, MS],
    [["WeaponClipMaxMod", 0.4]],
  ),
  "not-good": rolledRiven(
    "bbbbbbbbbbbbbbbbbbbbbbb4",
    BRATON,
    [
      ["WeaponFireDamageMod", 0.7],
      ["WeaponReloadSpeedMod", 0.5],
    ],
    [["WeaponFireRateMod", 0.3]],
  ),
} as const;
// One positive is no riven the sheet can judge: no rating, no badge.
const UNRATED = rolledRiven("bbbbbbbbbbbbbbbbbbbbbbb5", BRATON, [CC], [["WeaponZoomFovMod", 0.4]]);
const RATED_IDS = Object.fromEntries(
  Object.entries(RATED).map(([rating, entry]) => [rating, entry.ItemId.$oid]),
) as Record<keyof typeof RATED, string>;

test.describe("riven roll rating", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;
  const shots = process.env.RIVEN_PANEL_SHOTS;
  const keepShot = (name: string): void => {
    if (shots) fs.copyFileSync(test.info().outputPath(name), path.join(shots, name));
  };

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-riven-rating-", {
      inventory: { Suits: [], Upgrades: [...Object.values(RATED), UNRATED] },
    });
    await openView(harness.page, "rivens");
    await expect(harness.page.locator("[data-riven-card]")).toHaveCount(5, { timeout: 30_000 });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("each card shows its roll sheet rating, the letter grade beside it", async () => {
    const page = harness!.page;
    const labels = {
      good: "Good Roll",
      "one-positive-off": "Almost: one positive off",
      "unlisted-negative": "Good positives, unlisted negative",
      "not-good": "Not a good roll",
    };
    for (const [rating, id] of Object.entries(RATED_IDS)) {
      const card = page.locator(`[data-riven-card="${id}"]`);
      await expect(card.locator("[data-riven-sheet-rating]")).toHaveAttribute(
        "data-riven-sheet-rating",
        rating,
      );
      await expect(card.locator("[data-riven-sheet-rating]")).toHaveText(
        labels[rating as keyof typeof labels],
        { ignoreCase: true },
      );
      await expect(card.locator("[data-riven-grade]")).toHaveText(/^[SABCF][+-]?$/);
    }
    const unrated = page.locator(`[data-riven-card="${UNRATED.ItemId.$oid}"]`);
    await expect(unrated.locator("[data-riven-sheet-rating]")).toHaveCount(0);
    await expect(unrated.locator("[data-riven-grade]")).toBeVisible();
    await expect(page.locator("[data-riven-attr-grade]")).toHaveCount(0);

    await page.locator("[data-riven-card-size]").screenshot({
      path: test.info().outputPath("v5-rivens-tab-rating.png"),
      animations: "disabled",
    });
    keepShot("v5-rivens-tab-rating.png");
  });

  test("the roll rating filter keeps one rating", async () => {
    const page = harness!.page;
    const select = page.locator("[data-riven-sheet-rating-select]");
    await select.selectOption("good");
    await expect(page.locator("[data-riven-card]")).toHaveCount(1);
    await expect(page.locator(`[data-riven-card="${RATED_IDS.good}"]`)).toBeVisible();
    await select.selectOption("not-good");
    await expect(page.locator("[data-riven-card]")).toHaveCount(1);
    await expect(page.locator(`[data-riven-card="${RATED_IDS["not-good"]}"]`)).toBeVisible();
    await select.selectOption("all");
    await expect(page.locator("[data-riven-card]")).toHaveCount(5);
  });

  test("the detail shows the rating and the sheet's good rolls, no refresh", async () => {
    const page = harness!.page;
    await page.locator(`[data-riven-card="${RATED_IDS.good}"] button`).first().click();
    const dialog = page
      .locator(".detail-panel")
      .filter({ has: page.locator("[data-riven-detail-rank]") });
    await expect(dialog.locator("[data-riven-sheet-rating]")).toHaveText("Good Roll");
    await expect(dialog).toContainText("Critical Chance");
    await expect(dialog).toContainText("Zoom");
    await expect(dialog.locator("[data-riven-dictionary-refresh]")).toHaveCount(0);
    await expect(dialog.locator("[data-riven-dictionary-age]")).toHaveCount(0);
    await dialog.screenshot({
      path: test.info().outputPath("v5-riven-detail.png"),
      animations: "disabled",
    });
    keepShot("v5-riven-detail.png");
  });
});
