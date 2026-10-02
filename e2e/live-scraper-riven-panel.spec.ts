import fs from "node:fs";
import path from "node:path";

import { test, expect, type Locator, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  selectOptionValues,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const NOW = 1_700_000_000_000;
const MAX_ROLL_INT = 0x3fffffff;

type Roll = [tag: string, roll: number];

// An unveiled riven is an Upgrades entry whose fingerprint carries a weapon
// compat plus buffs/curses (see rivens-cards.spec.ts).
function ownedRiven(itemType: string, oid: string, compat: string, buffs: Roll[], curses: Roll[]) {
  const values = (rolls: Roll[]) =>
    rolls.map(([tag, roll]) => ({ Tag: tag, Value: Math.round(MAX_ROLL_INT * roll) }));
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
      buffs: values(buffs),
      curses: values(curses),
    }),
  };
}

const RIFLE = "LotusRifleRandomModRare";
const PISTOL = "LotusPistolRandomModRare";
const BRATON = "/Lotus/Weapons/Tenno/Rifle/Rifle";

// Owned rivens. LATO is tracked already, so it lists last and cannot be picked.
const BRATON_CRIT = "ccccccccccccccccccccccc1";
const BRATON_HEAT = "ccccccccccccccccccccccc2";
const LEX = "ccccccccccccccccccccccc3";
const STRUN = "ccccccccccccccccccccccc4";
const SKANA = "ccccccccccccccccccccccc5";
const LATO = "ccccccccccccccccccccccc6";
const BURSTON = "ccccccccccccccccccccccc7";

const INVENTORY = {
  Suits: [],
  Upgrades: [
    ownedRiven(
      RIFLE,
      BRATON_CRIT,
      BRATON,
      [
        ["WeaponCritChanceMod", 0.8],
        ["WeaponCritDamageMod", 0.7],
        ["WeaponFireIterationsMod", 0.6],
      ],
      [["WeaponZoomFovMod", 0.4]],
    ),
    ownedRiven(
      RIFLE,
      BRATON_HEAT,
      BRATON,
      [
        ["WeaponFireDamageMod", 0.7],
        ["WeaponZoomFovMod", 0.5],
      ],
      [["WeaponFireRateMod", 0.3]],
    ),
    ownedRiven(
      PISTOL,
      LEX,
      "/Lotus/Weapons/Tenno/Pistol/HeavyPistol",
      [
        ["WeaponFireIterationsMod", 0.9],
        ["WeaponStunChanceMod", 0.4],
      ],
      [["WeaponRecoilReductionMod", 0.6]],
    ),
    ownedRiven(
      "LotusShotgunRandomModRare",
      STRUN,
      "/Lotus/Weapons/Tenno/Shotgun/Shotgun",
      [
        ["WeaponCritDamageMod", 0.5],
        ["WeaponToxinDamageMod", 0.8],
      ],
      [["WeaponImpactDamageMod", 0.2]],
    ),
    ownedRiven(
      "PlayerMeleeWeaponRandomModRare",
      SKANA,
      "/Lotus/Weapons/Tenno/Melee/LongSword/LongSword",
      [
        ["WeaponMeleeRangeIncMod", 0.6],
        ["SlideAttackCritChanceMod", 0.7],
        ["WeaponMeleeDamageMod", 0.4],
      ],
      [["ComboDurationMod", 0.5]],
    ),
    ownedRiven(
      PISTOL,
      LATO,
      "/Lotus/Weapons/Tenno/Pistol/Pistol",
      [["WeaponFactionDamageGrineer", 0.6]],
      [["WeaponZoomFovMod", 0.3]],
    ),
    ownedRiven(
      RIFLE,
      BURSTON,
      "/Lotus/Weapons/Tenno/Rifle/BurstRifle",
      [
        ["WeaponCritDamageMod", 0.6],
        ["WeaponElectricityDamageMod", 0.5],
      ],
      [["WeaponAmmoMaxMod", 0.4]],
    ),
  ],
};
// Untracked by weapon name, then the tracked one.
const PICKER_ORDER_HEAD = [BURSTON, LEX, SKANA, STRUN];

// Six weapons and five names are coprime, so all 30 tracked pairs differ and
// "Rubico Crita-visican" names exactly one of them. None is an owned riven.
const WEAPONS = ["Rubico", "Boar", "Kuva Bramma", "Tigris", "Soma", "Lanka"];
const NAMES = ["Crita-visican", "Satiata", "Acri-toxitis", "Vexi-hexatis", "Pleci-argicron"];
const TRACKED = Array.from({ length: 30 }, (_, i) => ({
  id: `tracked-${i}`,
  sourceItemId: `src-tracked-${i}`,
  weaponName: WEAPONS[i % WEAPONS.length] as string,
  rivenName: NAMES[i % NAMES.length] as string,
}));

const stat = (tag: string, value: number) => ({
  tag,
  positive: value >= 0,
  multiplier: false,
  value,
});
// The first three tracked rows differ in stat count and in what the status
// block shows: a list price, a status, the default status.
const TRACKED_LOOKS: Record<string, Record<string, unknown>> = {
  "tracked-0": {
    stats: [
      stat("WeaponCritChanceMod", 153.4),
      stat("WeaponCritDamageMod", 120.6),
      stat("WeaponFireIterationsMod", 84.3),
      stat("WeaponZoomFovMod", -40.2),
    ],
    listPrice: 640,
    status: "live",
  },
  "tracked-1": {
    stats: [stat("WeaponFireIterationsMod", 90.1), stat("WeaponDamageAmountMod", 110.5)],
    status: "noSellers",
  },
};
const SEEDED = 8;
// The tracked owned riven sits in the list too, so the totals are one higher.
const TOTAL = TRACKED.length + 1;

const stockRiven = (riven: {
  id: string;
  sourceItemId: string;
  weaponName: string;
  rivenName: string;
}) => ({
  masteryReq: 10,
  rerolls: 0,
  polarity: "madurai",
  modRank: 8,
  stats: [{ tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 1 }],
  bought: 0,
  minPrice: null,
  listPrice: null,
  auctionId: null,
  isHidden: false,
  status: "pending",
  createdAt: NOW,
  updatedAt: NOW,
  ...riven,
  ...TRACKED_LOOKS[riven.id],
});

const LATO_STOCK = stockRiven({
  id: "tracked-lato",
  sourceItemId: LATO,
  weaponName: "Lato",
  rivenName: "Lato riven",
});

// Measured at the default font size in round 1; the 15rem list holds 5.5 rows.
const ROW_HEIGHT = 37.75;
const SCRATCH = process.env.RIVEN_PANEL_SHOTS;

interface ListedRiven {
  sourceItemId: string;
  bought: number;
}

test.describe("Live Scraper rivens panel", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;
  let section: Locator;
  let search: Locator;
  let input: Locator;
  let list: Locator;

  const rows = (): Locator => section.locator("[data-live-scraper-riven-row]");
  const count = (): Locator => section.locator("[data-live-scraper-riven-count]");
  const trackedList = (): Locator => section.locator("[data-live-scraper-riven-list]");
  const options = (): Locator => list.locator("[data-riven-picker-option]");
  const option = (itemId: string): Locator =>
    list.locator(`[data-riven-picker-option="${itemId}"]`);
  const selectedCard = (): Locator => section.locator("[data-riven-picker-selected]");
  const sectionHeight = (): Promise<number> =>
    section.evaluate((el) => el.getBoundingClientRect().height);
  const shownIds = (): Promise<string[]> =>
    options().evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-riven-picker-option") ?? ""),
    );
  const stockList = (): Promise<ListedRiven[]> =>
    page.evaluate(() =>
      (
        window as unknown as { api: { liveScraperRivenStockList: () => Promise<ListedRiven[]> } }
      ).api.liveScraperRivenStockList(),
    );

  /** The panel plus the open list that overlays the page below it. */
  async function shootPanelWithList(name: string): Promise<void> {
    await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
    const panel = (await section.boundingBox())!;
    const dropdown = (await list.boundingBox())!;
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const bottom = Math.min(
      viewport.height,
      Math.max(panel.y + panel.height, dropdown.y + dropdown.height) + 8,
    );
    await page.screenshot({
      path: test.info().outputPath(name),
      animations: "disabled",
      clip: { x: panel.x, y: panel.y, width: panel.width, height: bottom - panel.y },
    });
  }

  /** A copy for the user's review, when RIVEN_PANEL_SHOTS names a folder. */
  function keepShot(name: string): void {
    if (SCRATCH) fs.copyFileSync(test.info().outputPath(name), path.join(SCRATCH, name));
  }

  /** Left and right edges of each matching element, in page pixels. */
  function edges(locator: Locator): Promise<{ left: number; right: number; width: number }[]> {
    return locator.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      }),
    );
  }

  /** Opens the picker list from a clean input. */
  async function openPicker(): Promise<void> {
    if ((await selectedCard().count()) > 0) {
      await selectedCard().getByRole("button", { name: "Clear selected item" }).click();
    }
    await page.locator("h2").first().click();
    await expect(list).toHaveCount(0);
    await input.fill("");
    await input.focus();
    await expect(list).toBeVisible();
  }

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-riven-panel-e2e-", {
      inventory: INVENTORY,
      userDataFiles: {
        "live-scraper-riven-stock.json": {
          version: 1,
          stockRivens: [...TRACKED.slice(0, SEEDED).map(stockRiven), LATO_STOCK],
        },
      },
    });
    page = harness.page;
    await openView(page, "liveScraper");
    section = page.locator('label[for="riven-picker"]').locator("xpath=ancestor::section[1]");
    search = section.locator("[data-live-scraper-riven-search] input");
    input = section.locator("[data-riven-picker-input]");
    list = section.locator("[data-riven-picker-list]");
    await expect(input).toBeVisible({ timeout: 30_000 });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("the tracked list scrolls past five rows and the panel stops growing", async () => {
    await expect(rows()).toHaveCount(SEEDED + 1);
    await expect(count()).toHaveText(String(SEEDED + 1));
    const heightBefore = await sectionHeight();

    await page.evaluate(async (payloads) => {
      const api = (
        window as unknown as {
          api: { liveScraperRivenStockCreate: (payload: unknown) => Promise<unknown> };
        }
      ).api;
      for (const payload of payloads) await api.liveScraperRivenStockCreate(payload);
    }, TRACKED.slice(SEEDED).map(stockRiven));
    await expect(rows()).toHaveCount(TOTAL);
    await expect(count()).toHaveText(String(TOTAL));

    const heightAfter = await sectionHeight();
    expect(Math.abs(heightAfter - heightBefore)).toBeLessThanOrEqual(2);

    const geometry = await trackedList().evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      return {
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        rows: Array.from(el.querySelectorAll("li"), (li) => {
          const box = li.getBoundingClientRect();
          return { top: box.top - top, bottom: box.bottom - top };
        }).slice(0, 6),
      };
    });
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    // Five rows fully visible, and roughly half of the sixth peeks out.
    const [fifth, sixth] = [geometry.rows[4]!, geometry.rows[5]!];
    expect(fifth.bottom).toBeLessThanOrEqual(geometry.clientHeight + 0.5);
    const peek = (geometry.clientHeight - sixth.top) / (sixth.bottom - sixth.top);
    expect(peek).toBeGreaterThan(0.3);
    expect(peek).toBeLessThan(0.7);
    for (const row of geometry.rows.slice(0, 5)) {
      expect(Math.abs(row.bottom - row.top - ROW_HEIGHT)).toBeLessThanOrEqual(0.5);
    }

    // Each row reads weapon first, then the riven name.
    await expect(section.locator('[data-live-scraper-riven-row="tracked-0"]')).toContainText(
      "Rubico Crita-visican",
    );
    await section.screenshot({
      path: test.info().outputPath("riven-panel-30-tracked.png"),
      animations: "disabled",
    });
  });

  test("a weapon or riven name narrows the rows, with a shown-of-total count", async () => {
    await search.fill("rubico");
    await expect(rows()).toHaveCount(5);
    await expect(count()).toHaveText(`5 of ${TOTAL}`);

    await search.fill("SATIATA");
    await expect(rows()).toHaveCount(6);
    await expect(count()).toHaveText(`6 of ${TOTAL}`);
    for (const text of await rows().allTextContents()) expect(text).toContain("Satiata");

    await search.fill("rubico crita");
    await expect(rows()).toHaveCount(1);
    await expect(rows().first()).toHaveAttribute("data-live-scraper-riven-row", "tracked-0");
    await expect(count()).toHaveText(`1 of ${TOTAL}`);

    await search.fill("tigris");
    await expect(rows()).toHaveCount(5);
    await section.screenshot({
      path: test.info().outputPath("riven-panel-search.png"),
      animations: "disabled",
    });
  });

  test("a query matching no tracked riven says so", async () => {
    await search.fill("zzz-nothing");
    await expect(rows()).toHaveCount(0);
    await expect(trackedList()).toHaveCount(0);
    await expect(section.locator("[data-live-scraper-riven-no-matches]")).toHaveText(
      'No tracked riven matches "zzz-nothing".',
    );
    await expect(count()).toHaveText(`0 of ${TOTAL}`);
  });

  test("clearing the search restores every row", async () => {
    await section.locator(".search-box-clear").click();
    await expect(search).toHaveValue("");
    await expect(rows()).toHaveCount(TOTAL);
    await expect(count()).toHaveText(String(TOTAL));
  });

  test("tracked rows show compact stat chips, a readable status, and line up", async () => {
    const row = (id: string): Locator => section.locator(`[data-live-scraper-riven-row="${id}"]`);
    const ids = ["tracked-0", "tracked-1", "tracked-2"];

    const crit = row("tracked-0").locator("[data-live-scraper-riven-stats] [data-riven-stat]");
    await expect(crit).toHaveCount(4);
    expect(
      await crit.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-riven-stat"))),
    ).toEqual(["positive", "positive", "positive", "negative"]);
    await expect(crit.nth(0)).toHaveText(/^\s*\+153\.4%\s*CC\s*$/);
    await expect(crit.nth(3)).toHaveText(/^\s*-40\.2%\s*ZOOM\s*$/);
    await expect(crit.nth(0)).toHaveAttribute("title", "Critical Chance");
    await expect(crit.nth(3)).toHaveAttribute("title", "Zoom");
    await expect(
      row("tracked-1").locator("[data-live-scraper-riven-stats] [data-riven-stat]"),
    ).toHaveCount(2);
    await expect(
      row("tracked-2").locator("[data-live-scraper-riven-stats] [data-riven-stat]"),
    ).toHaveCount(1);

    // A price where the riven is listed, else the status the listings table shows.
    const status = (id: string): Locator => row(id).locator("[data-live-scraper-riven-status]");
    await expect(status("tracked-0")).toHaveText("640p");
    await expect(status("tracked-0")).toHaveAttribute(
      "title",
      "Listed on warframe.market at this price.",
    );
    await expect(status("tracked-1")).toHaveText("No sellers");
    await expect(status("tracked-1")).toHaveAttribute("title", /fewer than three comparable/);
    await expect(status("tracked-2")).toHaveText("Pending");
    await expect(status("tracked-2")).toHaveAttribute("title", /.+/);

    // Status blocks share one width and right edge, and every chip strip ends at
    // the same x, whatever the status text and the stat count.
    const blocks = await edges(section.locator("[data-live-scraper-riven-status]"));
    const strips = await edges(section.locator("[data-live-scraper-riven-stats]"));
    const lastChips = await Promise.all(
      ids.map(async (id) => (await edges(row(id).locator("[data-riven-stat]"))).at(-1)!),
    );
    for (const [index] of ids.entries()) {
      expect(Math.abs(blocks[index]!.right - blocks[0]!.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(blocks[index]!.width - blocks[0]!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(strips[index]!.right - strips[0]!.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(lastChips[index]!.right - strips[0]!.right)).toBeLessThanOrEqual(1);
    }

    // The block fits the longest status label a riven row can show.
    const fits = await status("tracked-1").evaluate((block) => {
      const labels = ["Too low profit", "Max price drop", "Underpriced", "Overpriced", "12345p"];
      const probe = block.cloneNode() as HTMLElement;
      probe.style.width = "auto";
      probe.style.position = "absolute";
      block.parentElement!.append(probe);
      const widest = Math.max(
        ...labels.map((label) => {
          probe.textContent = label;
          return probe.getBoundingClientRect().width;
        }),
      );
      probe.remove();
      return widest <= block.getBoundingClientRect().width;
    });
    expect(fits).toBe(true);

    await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await section.screenshot({
      path: test.info().outputPath("v4-tracked-chips.png"),
      animations: "disabled",
    });
    keepShot("v4-tracked-chips.png");
  });

  test("the listings table's Rivens tab shows the same chips and status hints", async () => {
    const listings = page.locator("[data-live-scraper-listings]");
    await listings.locator('[data-live-scraper-listings-tab="rivens"]').click();
    const tabRow = (id: string): Locator => listings.locator(`[data-ls-row="${id}"]`);
    // The chips sit under the name or in their own column, whichever the width shows.
    const cell = (id: string): Locator => tabRow(id).locator("[data-ls-riven-stats]:visible");
    await expect(cell("tracked-0").locator("[data-riven-stat]")).toHaveCount(4);
    await expect(cell("tracked-1").locator("[data-riven-stat]")).toHaveCount(2);
    expect(
      await cell("tracked-0")
        .locator("[data-riven-stat]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-riven-stat"))),
    ).toEqual(["positive", "positive", "positive", "negative"]);
    await expect(cell("tracked-0").locator("[data-riven-stat]").nth(1)).toHaveText(
      /^\s*\+120\.6%\s*CD\s*$/,
    );
    await expect(cell("tracked-0").locator("[data-riven-stat]").nth(1)).toHaveAttribute(
      "title",
      "Critical Damage",
    );
    await expect(cell("tracked-0")).toHaveAttribute(
      "title",
      "+153.4% Critical Chance, +120.6% Critical Damage, +84.3% Multishot, -40.2% Zoom",
    );
    // One line, chips packed from the left edge of the column.
    const strips = await Promise.all(
      ["tracked-0", "tracked-1"].map(
        async (id) => (await edges(cell(id).locator("[data-riven-stat]")))[0]!,
      ),
    );
    expect(Math.abs(strips[0]!.left - strips[1]!.left)).toBeLessThanOrEqual(1);
    const heights = await listings
      .locator("[data-ls-row]")
      .evaluateAll((nodes) => nodes.slice(0, 3).map((node) => node.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(0.5);
    // Four chips fit the column without clipping.
    const clipped = await cell("tracked-0").evaluate((td) => {
      const last = td.querySelectorAll("[data-riven-stat]");
      const chip = last[last.length - 1]!.getBoundingClientRect();
      return chip.right > td.getBoundingClientRect().right;
    });
    expect(clipped).toBe(false);

    const badge = tabRow("tracked-1").locator(".ls-status");
    await expect(badge).toHaveText("No sellers");
    await expect(badge).toHaveAttribute("title", /fewer than three comparable/);
    await expect(tabRow("tracked-0").locator(".ls-status")).toHaveAttribute("title", /.+/);
    // The weapon is named once, then the rest of the riven name.
    await expect(tabRow("tracked-0").locator("td.name")).toContainText("Rubico Crita-visican");

    await listings.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await listings.screenshot({
      path: test.info().outputPath("v4-listings-rivens.png"),
      animations: "disabled",
    });
    keepShot("v4-listings-rivens.png");
  });

  test("focusing the picker opens one entry per owned riven over the listings", async () => {
    const before = await sectionHeight();
    await openPicker();
    await expect(options()).toHaveCount(INVENTORY.Upgrades.length);
    await expect(list.locator("[data-riven-picker-count]")).toContainText(
      `${INVENTORY.Upgrades.length} of ${INVENTORY.Upgrades.length} rivens`,
    );
    await expect(list.locator("[data-riven-picker-count]")).toContainText(
      "Stats work too: cd, +ms, -zoom",
    );
    await expect(input).toHaveAttribute("aria-expanded", "true");
    // The list overlays the page below; the panel keeps its height.
    expect(Math.abs((await sectionHeight()) - before)).toBeLessThanOrEqual(1);

    // Nothing clips it: its bottom edge is on screen and on top.
    await list.evaluate((el) => el.scrollIntoView({ block: "end" }));
    const onTop = await list.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + 8, box.bottom - 4);
      return box.bottom <= window.innerHeight && hit !== null && el.contains(hit);
    });
    expect(onTop).toBe(true);
    // At the default 820px height the panel plus the open list is taller than the
    // scroll area, so the shot gets a taller window to show both whole.
    await setLayoutViewport(page, 1280, 900);
    await shootPanelWithList("v2-picker-open.png");
  });

  test("entries list untracked rivens by weapon, each with signed stat chips", async () => {
    const ids = await shownIds();
    expect(ids.slice(2, 6)).toEqual(PICKER_ORDER_HEAD);
    expect(ids.slice(0, 2).sort()).toEqual([BRATON_CRIT, BRATON_HEAT].sort());

    const crit = option(BRATON_CRIT);
    await expect(crit).toContainText("Braton");
    const chips = crit.locator("[data-riven-stat]");
    await expect(chips).toHaveCount(4);
    expect(
      await chips.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-riven-stat"))),
    ).toEqual(["positive", "positive", "positive", "negative"]);
    await expect(chips.nth(0)).toContainText("Critical Chance");
    await expect(chips.nth(0)).toHaveText(/^\s*\+[\d.]+%\s*Critical Chance\s*$/);
    await expect(chips.nth(3)).toContainText("Zoom");
    await expect(chips.nth(3)).toHaveText(/^\s*[+-][\d.]+%\s*Zoom\s*$/);
    await expect(chips.nth(3).locator(".text-danger")).toHaveCount(1);
    await expect(chips.nth(0).locator(".text-success")).toHaveCount(1);

    // Braton's sheet row MS | CD | CC with -Zoom: the one good roll owned.
    await expect(crit.locator("[data-riven-good-roll]")).toHaveText("Good Roll");
    const marked = await list
      .locator("[data-riven-picker-option]:has([data-riven-good-roll])")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-riven-picker-option")));
    expect(marked).toEqual([BRATON_CRIT]);
    await expect(list.locator("[data-riven-grade], [data-riven-attr-grade]")).toHaveCount(0);
    await expect(crit).not.toContainText("Braton Braton");
    await expect(option(BRATON_HEAT)).not.toContainText("Braton Braton");
    await shootPanelWithList("v3-picker-good-roll.png");
    keepShot("v3-picker-good-roll.png");
  });

  test("weapons, stat names, codes and signed stats narrow the entries", async () => {
    const expectShown = async (query: string, expected: string[]) => {
      await input.fill(query);
      await expect
        .poll(async () => (await shownIds()).sort(), { message: query })
        .toEqual([...expected].sort());
      await expect(list.locator("[data-riven-picker-count]")).toContainText(
        `${expected.length} of ${INVENTORY.Upgrades.length} rivens`,
      );
    };
    await expectShown("lex", [LEX]);
    await expectShown("multishot", [BRATON_CRIT, LEX]);
    await expectShown("cd", [BRATON_CRIT, STRUN, BURSTON]);
    await expectShown("braton cd", [BRATON_CRIT]);
    await expectShown("-zoom", [BRATON_CRIT, LATO]);
    await expectShown("+zoom", [BRATON_HEAT]);

    await input.fill("zzz");
    await expect(options()).toHaveCount(0);
    await expect(list.locator("[data-riven-picker-no-matches]")).toHaveText(
      'No riven in your inventory matches "zzz".',
    );
    await input.fill("+cd");
    await expect(options()).toHaveCount(3);
    await shootPanelWithList("v2-picker-search.png");
  });

  test("a tracked riven lists last, dimmed, and cannot be picked", async () => {
    await openPicker();
    const ids = await shownIds();
    expect(ids.at(-1)).toBe(LATO);
    const lato = option(LATO);
    await expect(lato).toHaveAttribute("aria-disabled", "true");
    await expect(lato).toHaveCSS("opacity", "0.5");
    await expect(lato.locator("[data-riven-picker-tracked-badge]")).toHaveText("Tracked");
    await expect(option(LEX).locator("[data-riven-picker-tracked-badge]")).toHaveCount(0);

    // Playwright waits for an aria-disabled element to enable, so the click is forced.
    await lato.click({ force: true });
    await expect(selectedCard()).toHaveCount(0);
    await expect(list).toBeVisible();
  });

  test("arrow keys skip tracked rivens, Enter picks, Escape closes", async () => {
    await openPicker();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-expanded", "false");

    await input.fill("-zoom");
    await expect(options()).toHaveCount(2);
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      `riven-picker-option-${BRATON_CRIT}`,
    );
    await page.keyboard.press("ArrowDown");
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      `riven-picker-option-${BRATON_CRIT}`,
    );
    await page.keyboard.press("Enter");
    await expect(selectedCard()).toHaveAttribute("data-riven-picker-selected", BRATON_CRIT);
    await expect(list).toHaveCount(0);
  });

  test("the selected card clears with x, and pick + Add files the riven", async () => {
    await expect(selectedCard()).toBeVisible();
    await expect(selectedCard().locator("[data-riven-good-roll]")).toHaveText("Good Roll");
    await expect(selectedCard()).not.toContainText("Braton Braton");
    await selectedCard().getByRole("button", { name: "Clear selected item" }).click();
    await expect(selectedCard()).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(list).toBeVisible();

    await input.fill("lex");
    await option(LEX).click();
    const card = selectedCard();
    await expect(card).toHaveAttribute("data-riven-picker-selected", LEX);
    await expect(card).toContainText("Lex");
    await expect(card.locator('[data-riven-stat="negative"]')).toHaveCount(1);
    await expect(card.locator("[data-riven-good-roll]")).toHaveCount(0);
    await expect(card).not.toContainText("Lex Lex");
    await section.locator("#riven-bought").fill("25");
    await section.screenshot({
      path: test.info().outputPath("v2-picker-selected.png"),
      animations: "disabled",
    });

    await section.getByRole("button", { name: "Add", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(input).toHaveValue("");
    await expect
      .poll(async () => (await stockList()).find((riven) => riven.sourceItemId === LEX)?.bought)
      .toBe(25);
    await expect(rows()).toHaveCount(TOTAL + 1);
    const lexRow = rows().filter({ hasText: "Lex" });
    await expect(lexRow).toHaveCount(1);
    await expect(lexRow).not.toContainText("Lex Lex");

    await input.focus();
    await expect(option(LEX)).toHaveAttribute("aria-disabled", "true");
    expect((await shownIds()).slice(-2).sort()).toEqual([LATO, LEX].sort());
  });
});

async function finishSetupWithoutInventory(page: Page): Promise<void> {
  await expect(page.locator("#content.setup-active")).toBeVisible({ timeout: 90_000 });
  await page.locator("[data-setup-without-inventory]").first().click();
  await expect(page.locator("#sidebar")).toBeVisible({ timeout: 30_000 });
}

// Stored data that repeats a key a list is keyed on. Every case crashed the view
// with each_key_duplicate in v0.4.4; every row must still show.
const DUP_TAGS = [
  "WeaponCritChanceMod",
  "WeaponCritDamageMod",
  "WeaponFireIterationsMod",
  "WeaponDamageAmountMod",
  "WeaponMeleeDamageMod",
  "WeaponZoomFovMod",
  "WeaponStunChanceMod",
  "WeaponFactionDamageGrineer",
];
const DUP_WEAPONS = ["Rubico", "rubico", "RUBICO", "Rubico Prime", "Kuva Bramma", "Lanka"];
const DUP_POLARITIES = ["madurai", "", "AP_ATTACK", "Madurai", "naramon"];

/** Distinct rows in the shapes the app writes: adopted, from the inventory,
 *  the same source riven twice, and the oldest shape the normaliser takes. */
function manyStockRivens(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const tags = [0, 3, 5].map((offset) => DUP_TAGS[(i + offset) % DUP_TAGS.length]!);
    const stats = tags.map((tag, n) => stat(tag, n === 2 ? -20 : 50 + i));
    const weaponName = DUP_WEAPONS[i % DUP_WEAPONS.length]!;
    const base = { id: `many-${i}`, sourceItemId: `src-many-${i}`, weaponName, rivenName: "x" };
    if (i % 4 === 0) {
      return {
        ...stockRiven({ ...base, sourceItemId: "" }),
        adopted: true,
        auctionId: `auction-${i}`,
        listPrice: 100 + i,
        status: "live",
        stats,
      };
    }
    if (i % 4 === 1) return { id: base.id, weaponName, stats: [{ tag: tags[0] }] };
    return {
      ...stockRiven(base),
      ...(i % 4 === 2 ? { sourceItemId: `src-many-${i - 1}` } : {}),
      polarity: DUP_POLARITIES[i % DUP_POLARITIES.length],
      stats,
    };
  });
}

const MANY = 250;
const REPEATED_STOCK_RIVENS = [
  ...manyStockRivens(MANY),
  stockRiven({ id: "rep-tag", sourceItemId: "s1", weaponName: "Braton", rivenName: "Crita" }),
  stockRiven({ id: "pos-neg", sourceItemId: "s2", weaponName: "Lex", rivenName: "Herazeti" }),
  stockRiven({ id: "dup-id", sourceItemId: "s3", weaponName: "Tigris", rivenName: "Sati" }),
  stockRiven({ id: "dup-id", sourceItemId: "s4", weaponName: "Soma", rivenName: "Visi" }),
  stockRiven({ id: "odd", sourceItemId: "s5", weaponName: "all", rivenName: "all" }),
].map((row) => {
  if (row.id === "rep-tag") {
    return {
      ...row,
      stats: [
        stat("WeaponCritChanceMod", 150),
        stat("WeaponCritChanceMod", 120),
        stat("WeaponCritDamageMod", 90),
      ],
    };
  }
  if (row.id === "pos-neg") {
    return { ...row, stats: [stat("WeaponZoomFovMod", 50), stat("WeaponZoomFovMod", -30)] };
  }
  if (row.id === "odd") {
    return { ...row, polarity: "all", stats: [stat("WeaponCritChanceMod", 10), stat("none", -5)] };
  }
  return row;
});

const listItem = (id: string, extra: Record<string, unknown>) => ({
  id,
  wfmId: "serration",
  wfmUrl: "serration",
  itemName: "Serration",
  listPrice: null,
  minPrice: null,
  isHidden: false,
  status: "pending",
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

const REPEATED_INVENTORY = {
  Suits: [],
  Upgrades: [
    ownedRiven(
      RIFLE,
      "ddddddddddddddddddddddd1",
      BRATON,
      [
        ["WeaponCritChanceMod", 0.5],
        ["WeaponCritChanceMod", 0.6],
      ],
      [],
    ),
    // An entry without an ItemId decodes with an empty one.
    { ...ownedRiven(RIFLE, "", BRATON, [["WeaponCritDamageMod", 0.5]], []), ItemId: undefined },
    { ...ownedRiven(RIFLE, "", BRATON, [["WeaponFireIterationsMod", 0.5]], []), ItemId: undefined },
  ],
};

test.describe("Live Scraper view with repeated keys in stored data", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  const crashed = (): Locator => page.getByRole("heading", { name: "Renderer crashed" });
  const listings = (): Locator => page.locator("[data-live-scraper-listings]");
  const tab = (name: string): Locator =>
    listings().locator(`[data-live-scraper-listings-tab="${name}"]`);

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-repeated-keys-e2e-", {
      inventory: REPEATED_INVENTORY,
      userDataFiles: {
        "live-scraper-riven-stock.json": { version: 1, stockRivens: REPEATED_STOCK_RIVENS },
        "live-scraper-stock.json": {
          version: 1,
          stock: [
            listItem("s-dup", { owned: 1, bought: 0 }),
            listItem("s-dup", { owned: 2, bought: 5 }),
          ],
          wishlist: [listItem("w-dup", { quantity: 1 }), listItem("w-dup", { quantity: 2 })],
        },
      },
      storage: { wf_live_scraper_listings_tab: "rivens" },
    });
    page = harness.page;
    await openView(page, "liveScraper");
    await expect(page.locator("[data-live-scraper-riven-row]").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("the tracked list shows every row and every chip of a repeated stat", async () => {
    await expect(crashed()).toHaveCount(0);
    await expect(page.locator("[data-live-scraper-riven-row]")).toHaveCount(MANY + 5);
    await expect(page.locator('[data-live-scraper-riven-row="dup-id"]')).toHaveCount(2);
    const chips = (id: string): Locator =>
      page.locator(`[data-live-scraper-riven-row="${id}"] [data-riven-stat]`);
    await expect(chips("rep-tag")).toHaveCount(3);
    expect(
      await chips("pos-neg").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-riven-stat")),
      ),
    ).toEqual(["positive", "negative"]);
  });

  test("the Rivens tab, its filters and the positives list render", async () => {
    await expect(tab("rivens")).toHaveClass(/active/);
    const row = (id: string): Locator => listings().locator(`[data-ls-row="${id}"]`);
    await expect(row("dup-id")).toHaveCount(2);
    await expect(
      row("rep-tag").locator("[data-ls-riven-stats]:visible [data-riven-stat]"),
    ).toHaveCount(3);
    for (const id of ["weapon", "negative", "polarity"]) {
      const values = await selectOptionValues(listings().locator(`[data-ls-filter="${id}"]`));
      expect(new Set(values).size, id).toBe(values.length);
    }
    await listings().locator('[data-ls-filter="positives"]').click();
    await expect(page.locator("[data-ls-positives]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(crashed()).toHaveCount(0);
  });

  test("the WTB and WTS tabs show both rows that share an id", async () => {
    await tab("wtb").click();
    await expect(listings().locator('[data-ls-row="w:w-dup"]')).toHaveCount(2);
    await tab("wts").click();
    await expect(listings().locator('[data-ls-row="s-dup"]')).toHaveCount(2);
    await expect(crashed()).toHaveCount(0);
  });

  test("the picker lists every owned riven, ids missing or not", async () => {
    const section = page.locator('label[for="riven-picker"]').locator("xpath=ancestor::section[1]");
    await section.locator("[data-riven-picker-input]").focus();
    const options = section.locator("[data-riven-picker-option]");
    await expect(options).toHaveCount(REPEATED_INVENTORY.Upgrades.length);
    await expect(
      section.locator('[data-riven-picker-option="ddddddddddddddddddddddd1"] [data-riven-stat]'),
    ).toHaveCount(2);
    await expect(crashed()).toHaveCount(0);
  });
});

// A fresh install: no saved sidebar, no unlock flags. The panel must be reachable the
// way a new user reaches it, with nothing seeded by the harness. Setup without
// inventory reads no game data, so the picker has no riven to list yet.
test.describe("Live Scraper rivens panel on a fresh profile", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;

  test.afterEach(async () => {
    if (harness) await closeElectronTestHarness(harness);
    harness = undefined;
  });

  test("the default sidebar leads to the panel and its riven picker", async () => {
    harness = await launchElectronTestHarness("wfh-ls-riven-panel-fresh-", {
      emptyStorage: true,
    });
    const { page } = harness;
    await finishSetupWithoutInventory(page);
    await openView(page, "liveScraper");
    const label = page.locator('label[for="riven-picker"]');
    await expect(label).toHaveText("Riven to auto-sell");
    const section = label.locator("xpath=ancestor::section[1]");
    await expect(section.locator("h3")).toHaveText("Rivens (selling)");
    await expect(section).toContainText("No unveiled rivens found in your inventory.");
    await expect(section.locator("#riven-bought")).toBeVisible();
  });
});
