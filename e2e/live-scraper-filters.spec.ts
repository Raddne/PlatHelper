import { test, expect, type Locator, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

const NOW = 1_700_000_000_000;

const stockRow = (id: string, itemName: string, extra: Record<string, unknown> = {}) => ({
  id,
  wfmId: itemName.toLowerCase().replace(/ /g, "_"),
  wfmUrl: itemName.toLowerCase().replace(/ /g, "_"),
  itemName,
  owned: 1,
  bought: 0,
  listPrice: null,
  minPrice: null,
  isHidden: false,
  status: "pending",
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

const STOCK_FILE = {
  version: 1,
  stock: [
    stockRow("s-serration", "Serration", { status: "live", listPrice: 20 }),
    stockRow("s-forma", "Forma"),
    stockRow("s-vitality", "Vitality", { status: "live", listPrice: 15, origin: "trade" }),
  ],
  wishlist: [
    {
      id: "w-hornet",
      wfmId: "hornet_strike",
      wfmUrl: "hornet_strike",
      itemName: "Hornet Strike",
      quantity: 1,
      listPrice: null,
      maxPrice: null,
      minPrice: null,
      isHidden: false,
      status: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
};

const stat = (tag: string, positive = true) => ({ tag, positive, multiplier: false, value: 1 });

const rivenRow = (id: string, weaponName: string, extra: Record<string, unknown>) => ({
  id,
  sourceItemId: `src-${id}`,
  weaponName,
  rivenName: `${weaponName} ${id}`,
  masteryReq: 10,
  rerolls: 0,
  polarity: "madurai",
  modRank: 8,
  bought: 0,
  minPrice: null,
  listPrice: null,
  auctionId: null,
  isHidden: false,
  status: "pending",
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

const RIVEN_FILE = {
  version: 1,
  stockRivens: [
    rivenRow("r-crit-ms", "Boar", {
      stats: [stat("WeaponCritChanceMod"), stat("WeaponFireIterationsMod")],
    }),
    rivenRow("r-crit-cd", "Rubico", {
      origin: "trade",
      stats: [
        stat("WeaponCritChanceMod"),
        stat("WeaponCritDamageMod"),
        stat("WeaponZoomFovMod", false),
      ],
    }),
    rivenRow("r-ms-dmg", "Boar", {
      stats: [
        stat("WeaponFireIterationsMod"),
        stat("WeaponDamageAmountMod"),
        stat("WeaponRecoilReductionMod", false),
      ],
    }),
  ],
};

// The main process's answer (slug -> type); the live one depends on the network.
const ITEM_FACTS = {
  serration: "mod",
  vitality: "mod",
  forma: "misc",
  hornet_strike: "mod",
};

test.describe("Live Scraper listings filters", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;
  let panel: Locator;

  const rows = (): Locator => panel.locator("tbody tr");
  const openTab = (tab: string): Promise<void> =>
    panel.locator(`[data-live-scraper-listings-tab="${tab}"]`).click();
  const filterIds = (): Promise<string[]> =>
    panel
      .locator("[data-ls-filter-row] [data-ls-filter]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ls-filter") ?? ""));

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-filters-e2e-", {
      userDataFiles: {
        "live-scraper-stock.json": STOCK_FILE,
        "live-scraper-riven-stock.json": RIVEN_FILE,
      },
    });
    page = harness.page;
    await evaluateInMain(
      harness.app,
      ({ ipcMain }, facts) => {
        ipcMain.removeHandler("live-scraper:item-facts");
        ipcMain.handle("live-scraper:item-facts", () => facts);
      },
      ITEM_FACTS,
    );
    await openView(page, "liveScraper");
    panel = page.locator("[data-live-scraper-listings]");
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("each tab's filter row shows that tab's controls", async () => {
    await openTab("wtb");
    await expect(panel.locator('[data-ls-filter-row="wtb"]')).toBeVisible();
    expect(await filterIds()).toEqual(["type", "source", "owned", "status"]);

    await openTab("wts");
    await expect(panel.locator('[data-ls-filter-row="wts"]')).toBeVisible();
    expect(await filterIds()).toEqual(["type", "origin", "status"]);

    await openTab("rivens");
    await expect(panel.locator('[data-ls-filter-row="rivens"]')).toBeVisible();
    expect(await filterIds()).toEqual([
      "weapon",
      "positives",
      "negative",
      "polarity",
      "rerolls",
      "mr",
      "status",
    ]);
    await expect(panel.locator("[data-ls-filter-count]")).toHaveCount(0);
    await expect(panel.locator("[data-ls-filter-reset]")).toHaveCount(0);
  });

  test("a type filter narrows the rows, with a count and a reset until reset", async () => {
    await openTab("wts");
    await expect(rows()).toHaveCount(3);

    await panel.locator('[data-ls-filter="type"]').selectOption("mod");
    await expect(rows()).toHaveCount(2);
    await expect(rows().filter({ hasText: "Forma" })).toHaveCount(0);
    await expect(panel.locator("[data-ls-filter-count]")).toHaveText("2 of 3 shown");
    // The tab counter keeps counting everything tracked.
    await expect(panel.locator('[data-live-scraper-listings-tab="wts"]')).toContainText("(3)");

    await panel.locator("[data-ls-filter-reset]").click();
    await expect(rows()).toHaveCount(3);
    await expect(panel.locator("[data-ls-filter-count]")).toHaveCount(0);
    await expect(panel.locator('[data-ls-filter="type"]')).toHaveValue("all");
  });

  test("the status filter lists the statuses that occur, with counts", async () => {
    await openTab("wts");
    const status = panel.locator('[data-ls-filter="status"]');
    await expect(status.locator("option")).toHaveText(["Any", "Live (2)", "Pending (1)"]);

    await status.selectOption("live");
    await expect(rows()).toHaveCount(2);
    await expect(rows().filter({ hasText: "Forma" })).toHaveCount(0);

    // Filters combine; with nothing left the message names the filters.
    await panel.locator('[data-ls-filter="type"]').selectOption("misc");
    await expect(panel.locator("[data-ls-no-matches]")).toHaveText(
      "No listing matches the filters.",
    );

    await panel.locator("[data-ls-filter-reset]").click();
    await expect(rows()).toHaveCount(3);
  });

  test("the positives checklist needs every ticked stat and stops at three", async () => {
    await openTab("rivens");
    await expect(rows()).toHaveCount(3);
    const toggle = panel.locator('[data-ls-filter="positives"]');
    // The label sits above the control, which shows only the picked stats.
    await expect(panel.locator("#ls-filter-positives-label")).toHaveText("Positives");
    await expect(toggle).toHaveText("Any");

    await toggle.click();
    const list = page.locator("[data-ls-positives]");
    await expect(list).toBeVisible();
    await list.locator('[data-ls-positive="WeaponCritChanceMod"]').check();
    await expect(rows()).toHaveCount(2);
    await list.locator('[data-ls-positive="WeaponFireIterationsMod"]').check();
    await expect(rows()).toHaveCount(1);
    await expect(rows().first()).toContainText("r-crit-ms");
    await expect(toggle).toHaveText("Critical Chance, Multishot");

    await list.locator('[data-ls-positive="WeaponDamageAmountMod"]').check();
    await expect(list.locator('[data-ls-positive="WeaponCritDamageMod"]')).toBeDisabled();
    await list.locator('[data-ls-positive="WeaponDamageAmountMod"]').uncheck();
    await expect(list.locator('[data-ls-positive="WeaponCritDamageMod"]')).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(panel.locator("[data-ls-filter-count]")).toHaveText("1 of 3 shown");

    await panel.locator("[data-ls-filter-reset]").click();
    await expect(rows()).toHaveCount(3);
    await expect(toggle).toHaveText("Any");
  });

  test("a row from a trade shows the Trade badge", async () => {
    await openTab("wts");
    const badge = rows().filter({ hasText: "Vitality" }).locator("[data-ls-origin-trade]");
    await expect(badge).toHaveText("Trade");
    await expect(badge).toHaveAttribute("title", "Added from a trade the game confirmed");
    await expect(
      rows().filter({ hasText: "Serration" }).locator("[data-ls-origin-trade]"),
    ).toHaveCount(0);

    await panel.locator('[data-ls-filter="origin"]').selectOption("trade");
    await expect(rows()).toHaveCount(1);
    await panel.locator("[data-ls-filter-reset]").click();

    await openTab("rivens");
    await expect(
      rows().filter({ hasText: "r-crit-cd" }).locator("[data-ls-origin-trade]"),
    ).toHaveCount(1);
    await expect(panel.locator("[data-ls-origin-trade]")).toHaveCount(1);
  });
});
