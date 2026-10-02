import fs from "node:fs";
import path from "node:path";

import { test, expect, type Locator, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

// The listings panel at the window sizes users report: worst-case rows (long
// names, ranks, badges, long statuses, five-digit prices, four-digit reroll
// counts, long stat codes) must fit the panel without a sideways scroll.
const NOW = 1_700_000_000_000;

const slug = (name: string): string => name.toLowerCase().replace(/ /g, "_");

const stockItem = (id: string, itemName: string, extra: Record<string, unknown>) => ({
  id,
  wfmId: slug(itemName),
  wfmUrl: slug(itemName),
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

const wishItem = (id: string, itemName: string, extra: Record<string, unknown>) => ({
  id,
  wfmId: slug(itemName),
  wfmUrl: slug(itemName),
  itemName,
  quantity: 1,
  listPrice: null,
  maxPrice: null,
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
    stockItem("s-equinox", "Equinox Prime Neuroptics Blueprint", {
      owned: 12,
      bought: 12000,
      minPrice: 15000,
      listPrice: 18500,
      adopted: true,
      origin: "trade",
      status: "toLowProfit",
    }),
    stockItem("s-ammo", "Primed Shotgun Ammo Mutation", {
      subType: { rank: 10 },
      owned: 3,
      bought: 10500,
      minPrice: 12000,
      listPrice: 13999,
      wfmHidden: true,
      status: "live",
    }),
    stockItem("s-charger", "Arcane Primary Charger", {
      subType: { rank: 5 },
      owned: 21,
      bought: 15000,
      minPrice: 19999,
      listPrice: 21000,
      wfmHidden: true,
      status: "maxPriceDrop",
    }),
  ],
  wishlist: [
    wishItem("w-equinox", "Equinox Prime Neuroptics Blueprint", {
      quantity: 12,
      maxPrice: 12500,
      listPrice: 11999,
      wfmHidden: true,
      status: "underpriced",
    }),
    wishItem("w-ammo", "Primed Shotgun Ammo Mutation", {
      subType: { rank: 10 },
      maxPrice: 99999,
      listPrice: 10500,
      status: "toLowProfit",
    }),
  ],
};

// Catalog-scan candidates live in the engine's status, not in a file.
const SCAN_ROWS = [
  {
    wfmUrl: "wisp_prime_neuroptics_blueprint",
    wfmId: "wisp_prime_neuroptics_blueprint",
    itemName: "Wisp Prime Neuroptics Blueprint",
    status: "aboveAvgPrice",
    listPrice: 10500,
    potentialProfit: -12345,
    quantity: 99,
    hidden: true,
    updatedAt: NOW,
  },
  {
    wfmUrl: "kompressa_prime_receiver",
    wfmId: "kompressa_prime_receiver",
    itemName: "Kompressa Prime Receiver",
    status: "stockLimit",
    listPrice: 15500,
    potentialProfit: 12345,
    quantity: 10,
    updatedAt: NOW,
  },
];

const stat = (tag: string, value: number, multiplier = false) => ({
  tag,
  positive: value >= 0,
  multiplier,
  value,
});

const rivenRow = (
  id: string,
  weaponName: string,
  suffix: string,
  extra: Record<string, unknown>,
) => ({
  id,
  sourceItemId: `src-${id}`,
  weaponName,
  rivenName: `${weaponName} ${suffix}`,
  masteryReq: 16,
  rerolls: 1234,
  polarity: "madurai",
  modRank: 8,
  bought: 12000,
  minPrice: 15000,
  listPrice: 18500,
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
    rivenRow("r-cleavers", "Prisma Dual Cleavers", "Croni-critacan", {
      origin: "trade",
      status: "toLowProfit",
      stats: [
        stat("SlideAttackCritChanceMod", 215.3),
        stat("ComboDurationMod", 9.8),
        stat("WeaponMeleeFactionDamageGrineer", 1.45, true),
        stat("WeaponMeleeComboEfficiencyMod", -38.4),
      ],
    }),
    rivenRow("r-plasmor", "Tenet Arca Plasmor", "Visi-critatis", {
      rerolls: 9876,
      bought: 9999,
      minPrice: 25000,
      listPrice: 24999,
      auctionId: "auction-plasmor",
      wfmHidden: true,
      status: "live",
      stats: [
        stat("WeaponCritChanceMod", 188.2),
        stat("WeaponCritDamageMod", 164.7),
        stat("WeaponFireIterationsMod", 121.9),
        stat("WeaponZoomFovMod", -55.3),
      ],
    }),
    rivenRow("r-akstiletto", "Akstiletto Prime", "Acri-toxitis", {
      adopted: true,
      auctionId: "auction-akstiletto",
      wfmHidden: true,
      status: "maxPriceDrop",
      stats: [
        stat("WeaponFactionDamageCorpus", 1.52, true),
        stat("WeaponToxinDamageMod", 130.4),
        stat("WeaponElectricityDamageMod", 128.8),
        stat("WeaponRecoilReductionMod", -66.1),
      ],
    }),
  ],
};

type Tab = "wtb" | "wts" | "rivens";
const TABS: readonly Tab[] = ["wtb", "wts", "rivens"];

// A row per tab whose price is stepped and typed, and its fixture value.
const PRICE_ROWS: Record<Tab, { id: string; value: number }> = {
  wtb: { id: "w:w-equinox", value: 12500 },
  wts: { id: "s-equinox", value: 15000 },
  rivens: { id: "r-plasmor", value: 25000 },
};

const SHOTS = process.env.LS_COMPACT_SHOTS;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

const centre = (box: Box): number => (box.top + box.bottom) / 2;

test.describe("Live Scraper listings at small window sizes", () => {
  test.setTimeout(240_000);

  let harness: ElectronTestHarness;
  let page: Page;
  let panel: Locator;

  const tabButton = (tab: Tab): Locator =>
    panel.locator(`[data-live-scraper-listings-tab="${tab}"]`);

  async function openTab(tab: Tab): Promise<void> {
    await tabButton(tab).click();
    await expect(panel.locator(`table.ls-${tab} tbody tr`).first()).toBeVisible();
  }

  async function useWindow(
    width: number,
    height: number,
    sidebar: "collapsed" | "expanded",
  ): Promise<void> {
    const wanted = sidebar === "collapsed" ? "60" : "300";
    const stored = await page.evaluate(() => localStorage.getItem("wf_sidebar_width"));
    if (stored !== wanted) {
      await page.evaluate((value) => localStorage.setItem("wf_sidebar_width", value), wanted);
      await page.reload();
      await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
      await openView(page, "liveScraper");
    }
    await setLayoutViewport(page, width, height);
    await expect(panel.locator("tbody tr").first()).toBeVisible();
  }

  /** The table's layout: "" (wide), "medium" or "compact". */
  function layoutOf(tab: Tab): Promise<string> {
    return panel
      .locator(`table.ls-${tab}`)
      .evaluate((table) => getComputedStyle(table).getPropertyValue("--ls-layout").trim());
  }

  /** The whole app window, the listings panel scrolled fully into view. */
  async function shoot(name: string): Promise<void> {
    await panel.evaluate((el) => el.scrollIntoView({ block: "end" }));
    await page.screenshot({ path: test.info().outputPath(name), animations: "disabled" });
    if (SHOTS) fs.copyFileSync(test.info().outputPath(name), path.join(SHOTS, name));
  }

  /** Sideways overflow of the page, the rows, the header row; edges of chips and buttons. */
  function geometry() {
    return panel.evaluate((el) => {
      const box = (node: Element) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
        };
      };
      const scroll = el.querySelector(".ls-scroll") as HTMLElement;
      const tabBar = el.querySelector(".ls-tab-bar") as HTMLElement;
      const content = document.querySelector("#content") as HTMLElement;
      const visible = (nodes: ArrayLike<Element>) =>
        Array.from(nodes).filter((node) => node.checkVisibility());
      return {
        panel: box(el),
        scroll: { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth },
        visibleRows: box(scroll),
        page: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          contentScroll: content.scrollWidth,
          contentClient: content.clientWidth,
        },
        tabBar: {
          scrollWidth: tabBar.scrollWidth,
          clientWidth: tabBar.clientWidth,
          children: Array.from(tabBar.children, (child) => box(child)),
          box: box(tabBar),
        },
        chips: visible(el.querySelectorAll(".ls-scroll [data-riven-stat]")).map(box),
        removes: visible(el.querySelectorAll(".ls-remove")).map(box),
        prices: visible(el.querySelectorAll(".ls-price")).map((price) => ({
          value: box(price.querySelector(".ls-price-value, .ls-price-input")!),
          steps: box(price.querySelector(".ls-steps")!),
        })),
      };
    });
  }

  type Geometry = Awaited<ReturnType<typeof geometry>>;

  function expectNoPageScroll(g: Geometry): void {
    expect(g.page.scrollWidth).toBeLessThanOrEqual(g.page.clientWidth);
    expect(g.page.contentScroll).toBeLessThanOrEqual(g.page.contentClient);
  }

  function expectHeaderFits(g: Geometry): void {
    expect(g.tabBar.scrollWidth).toBeLessThanOrEqual(g.tabBar.clientWidth);
    for (const child of g.tabBar.children) {
      expect(child.right).toBeLessThanOrEqual(g.tabBar.box.right + 0.5);
    }
  }

  function expectPricesOnOneLine(g: Geometry): void {
    expect(g.prices.length).toBeGreaterThan(0);
    for (const price of g.prices) {
      expect(Math.abs(centre(price.value) - centre(price.steps))).toBeLessThanOrEqual(2);
      expect(price.steps.left).toBeGreaterThanOrEqual(price.value.right);
    }
  }

  /** No sideways scroll; every chip and remove button inside the visible rows. */
  function expectFits(g: Geometry): void {
    expectNoPageScroll(g);
    expectHeaderFits(g);
    expectPricesOnOneLine(g);
    expect(g.scroll.scrollWidth).toBeLessThanOrEqual(g.scroll.clientWidth);
    for (const edge of [...g.chips, ...g.removes]) {
      expect(edge.right).toBeLessThanOrEqual(g.visibleRows.right + 0.5);
      expect(edge.right).toBeLessThanOrEqual(g.panel.right);
    }
  }

  /** Each filter control's box, in grid order, plus the grid's content edges. */
  function filterGrid() {
    return panel.evaluate((el) => {
      const grid = el.querySelector("[data-ls-filter-row] > div") as HTMLElement;
      const rect = grid.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        controls: Array.from(grid.querySelectorAll("[data-ls-filter]"), (node) => {
          const box = node.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, width: box.width };
        }),
      };
    });
  }

  /** Steps the tab's price row up and types the fixture value back. */
  async function editAndStep(tab: Tab): Promise<void> {
    const { id, value } = PRICE_ROWS[tab];
    const row = panel.locator(`[data-ls-row="${id}"]`);
    const shown = row.locator(".ls-price-value");
    await expect(shown).toHaveText(`${value}p`);
    await row.locator(".ls-step", { hasText: "+5" }).click();
    await expect(shown).toHaveText(`${value + 5}p`);
    await shown.click();
    const input = row.locator(".ls-price-input");
    await input.fill(String(value));
    await input.press("Enter");
    await expect(row.locator(".ls-price-value")).toHaveText(`${value}p`);
  }

  /** Name, meta unit, chips and cell of each riven row, as shown. */
  function rivenCells() {
    return panel.locator("table.ls-rivens tbody tr").evaluateAll((rows) =>
      rows.map((row) => {
        const box = (node: Element | null) => {
          const rect = node!.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
          };
        };
        const meta = row.querySelector("[data-ls-riven-meta]") as HTMLElement;
        const cell = row.querySelector("td.name") as HTMLElement;
        const style = getComputedStyle(cell);
        const chipNodes = Array.from(row.querySelectorAll("[data-riven-stat]")).filter((node) =>
          node.checkVisibility(),
        );
        return {
          id: row.getAttribute("data-ls-row") ?? "",
          name: box(row.querySelector("[data-ls-name]")),
          title: box(row.querySelector(".ls-riven-title")),
          meta: box(meta),
          metaShown: meta.checkVisibility(),
          metaText: meta.textContent?.replace(/\s+/g, " ").trim() ?? "",
          metaClipped: meta.scrollWidth > meta.clientWidth + 0.5,
          cell: box(cell),
          cellContentLeft: cell.getBoundingClientRect().left + parseFloat(style.paddingLeft),
          cellContentRight: cell.getBoundingClientRect().right - parseFloat(style.paddingRight),
          chips: chipNodes.map((node) => box(node)),
          chipsInWideColumn: chipNodes.some((node) => node.closest("td.attrs") !== null),
          height: row.getBoundingClientRect().height,
        };
      }),
    );
  }

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-compact-e2e-", {
      storage: { wf_sidebar_width: "60" },
      userDataFiles: {
        "live-scraper-stock.json": STOCK_FILE,
        "live-scraper-riven-stock.json": RIVEN_FILE,
      },
    });
    page = harness.page;
    await evaluateInMain(
      harness.app,
      ({ ipcMain }, rows) => {
        ipcMain.removeHandler("live-scraper:status");
        ipcMain.handle("live-scraper:status", () => ({
          running: false,
          lastTickAt: null,
          tickCount: 0,
          lastMessage: null,
          lastError: null,
          scheduler: { state: "ok", recentFailures: 0 },
          wtbListings: rows,
        }));
      },
      SCAN_ROWS,
    );
    await openView(page, "liveScraper");
    panel = page.locator("[data-live-scraper-listings]");
    await expect(panel).toBeVisible({ timeout: 30_000 });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("963 x 809 with the sidebar collapsed: every tab fits without a sideways scroll", async () => {
    await useWindow(963, 809, "collapsed");
    for (const tab of TABS) {
      await openTab(tab);
      expect(await layoutOf(tab)).toBe("compact");
      expectFits(await geometry());
      await editAndStep(tab);
      expectFits(await geometry());
      await page.locator("h2").first().click();
      await shoot(`c1-${tab}-963.png`);
    }
  });

  test("WTB and WTS rows carry the moved columns on a muted second line", async () => {
    await useWindow(963, 809, "collapsed");
    await openTab("wtb");
    const wtb = panel.locator("table.ls-wtb");
    for (const name of ["Source", "Updated"]) {
      await expect(wtb.locator("thead th", { hasText: name })).toBeHidden();
    }
    // The long profit header would force width; the short one stands in.
    await expect(wtb.locator("thead").getByText("Potential profit")).toBeHidden();
    await expect(wtb.locator("thead").getByText("Profit", { exact: true })).toBeVisible();
    const wish = panel.locator('[data-ls-row="w:w-ammo"]');
    await expect(wish.locator(".ls-line2")).toBeVisible();
    await expect(wish.locator(".ls-line2")).toContainText("Wishlist");
    await expect(wish.locator("[data-ls-name]")).toHaveText("Primed Shotgun Ammo Mutation R10");
    await expect(wish.locator("[data-ls-name]")).toHaveAttribute(
      "title",
      "Primed Shotgun Ammo Mutation R10",
    );
    await expect(
      panel.locator('[data-ls-row="s:kompressa_prime_receiver"] .ls-line2'),
    ).toContainText("Market scan");

    await openTab("wts");
    const wts = panel.locator("table.ls-wts");
    for (const name of ["Owned", "Updated"]) {
      await expect(wts.locator("thead th", { hasText: name })).toBeHidden();
    }
    const equinox = panel.locator('[data-ls-row="s-equinox"]');
    await expect(equinox.locator(".ls-line2")).toContainText("Owned 12");
    await expect(equinox.locator(".ls-adopted")).toBeVisible();
    await expect(equinox.locator("[data-ls-origin-trade]")).toBeVisible();
  });

  test("the riven cell: name and meta on one line, four chips on the next", async () => {
    await useWindow(963, 809, "collapsed");
    await openTab("rivens");
    const table = panel.locator("table.ls-rivens");
    for (const name of ["Attributes", "MR", "Rerolls"]) {
      await expect(table.locator("thead th", { hasText: name })).toBeHidden();
    }
    const cells = await rivenCells();
    expect(cells.map((cell) => cell.id)).toEqual(["r-cleavers", "r-plasmor", "r-akstiletto"]);
    expect(cells.find((cell) => cell.id === "r-plasmor")?.metaText).toBe("MR 16 · ⟳ 9876");
    for (const cell of cells) {
      expect(cell.metaShown).toBe(true);
      expect(cell.metaClipped).toBe(false);
      expect(cell.metaText).toMatch(/^MR 16 · ⟳ \d{4}$/);
      // Right-aligned on the name's line.
      expect(Math.abs(centre(cell.meta) - centre(cell.name))).toBeLessThanOrEqual(3);
      expect(Math.abs(cell.meta.right - cell.cellContentRight)).toBeLessThanOrEqual(1);
      expect(cell.meta.left).toBeGreaterThanOrEqual(cell.title.right);
      // Four chips on one line under the name, inside the cell.
      expect(cell.chips).toHaveLength(4);
      expect(cell.chipsInWideColumn).toBe(false);
      const tops = cell.chips.map((chip) => chip.top);
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
      expect(Math.min(...tops)).toBeGreaterThanOrEqual(cell.name.bottom - 1);
      for (const chip of cell.chips)
        expect(chip.right).toBeLessThanOrEqual(cell.cellContentRight + 0.5);
    }
    await expect(
      panel.locator('[data-ls-row="r-plasmor"] [data-ls-riven-stats]:visible'),
    ).toHaveAttribute(
      "title",
      "+188.2% Critical Chance, +164.7% Critical Damage, +121.9% Multishot, -55.3% Zoom",
    );
  });

  test("the filter grid: seven equal columns edge to edge, the same width on every tab", async () => {
    await useWindow(963, 809, "collapsed");
    await openTab("rivens");
    const rivens = await filterGrid();
    expect(rivens.controls).toHaveLength(7);
    const width = rivens.controls[0]!.width;
    for (const control of rivens.controls) {
      expect(Math.abs(control.width - width)).toBeLessThanOrEqual(1);
      expect(Math.abs(control.top - rivens.controls[0]!.top)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(rivens.controls[0]!.left - rivens.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(rivens.controls[6]!.right - rivens.right)).toBeLessThanOrEqual(1);
    // The Positives control shows only its value; its label sits above it.
    await expect(panel.locator('[data-ls-filter="positives"]')).toHaveText("Any");

    for (const tab of ["wts", "wtb"] as const) {
      await openTab(tab);
      const grid = await filterGrid();
      for (const control of grid.controls) {
        expect(Math.abs(control.width - width)).toBeLessThanOrEqual(1);
        expect(Math.abs(control.top - grid.controls[0]!.top)).toBeLessThanOrEqual(1);
      }
    }

    // A filter puts the count and the reset on their own line under the grid.
    await openTab("wts");
    await panel.locator('[data-ls-filter="type"]').selectOption("mod");
    const tools = panel.locator("[data-ls-filter-reset]");
    await expect(tools).toBeVisible();
    const toolsBox = (await tools.boundingBox())!;
    const lastControl = (await filterGrid()).controls.at(-1)!;
    expect(toolsBox.y).toBeGreaterThan(lastControl.top + 10);
    await tools.click();
  });

  test("the default window with the sidebar collapsed keeps rivens on one line", async () => {
    await useWindow(1280, 820, "collapsed");
    await openTab("rivens");
    expect(await layoutOf("rivens")).toBe("medium");
    const table = panel.locator("table.ls-rivens");
    await expect(table.locator("thead th", { hasText: "Attributes" })).toBeVisible();
    for (const name of ["MR", "Rerolls"]) {
      await expect(table.locator("thead th", { hasText: name })).toBeHidden();
    }
    const g = await geometry();
    expectFits(g);
    for (const cell of await rivenCells()) {
      expect(cell.metaShown).toBe(true);
      expect(cell.metaClipped).toBe(false);
      expect(Math.abs(centre(cell.meta) - centre(cell.name))).toBeLessThanOrEqual(3);
      expect(Math.abs(cell.meta.right - cell.cellContentRight)).toBeLessThanOrEqual(1);
      // The chips sit in their own column, on the name's line.
      expect(cell.chipsInWideColumn).toBe(true);
      expect(cell.chips).toHaveLength(4);
      for (const chip of cell.chips) {
        expect(chip.left).toBeGreaterThanOrEqual(cell.cell.right - 0.5);
        expect(Math.abs(centre(chip) - centre(cell.name))).toBeLessThanOrEqual(3);
      }
    }
    // The Attributes column hugs its chips, right before Bought.
    const hug = await table.locator("tbody tr").evaluateAll((rows) =>
      rows.map((row) => {
        const td = row.querySelector("td.attrs") as HTMLElement;
        const strip = td.querySelector("div") as HTMLElement;
        return td.getBoundingClientRect().width - strip.scrollWidth;
      }),
    );
    for (const slack of hug) expect(slack).toBeLessThanOrEqual(16);
    await shoot("c1-rivens-1280.png");
  });

  test("the widest panel shows the full single-line tables", async () => {
    await useWindow(1500, 900, "collapsed");
    for (const tab of TABS) {
      await openTab(tab);
      expect(await layoutOf(tab)).toBe("");
      expectFits(await geometry());
    }
    const table = panel.locator("table.ls-rivens");
    for (const name of ["Attributes", "MR", "Rerolls"]) {
      await expect(table.locator("thead th", { hasText: name })).toBeVisible();
    }
    await expect(panel.locator("[data-ls-riven-meta]:visible")).toHaveCount(0);
    await shoot("c1-rivens-wide.png");
  });

  test("900 x 600 with the sidebar expanded: nothing clips or overlaps", async () => {
    await useWindow(900, 600, "expanded");
    for (const tab of TABS) {
      await openTab(tab);
      expect(await layoutOf(tab)).toBe("compact");
      const g = await geometry();
      expectNoPageScroll(g);
      expectHeaderFits(g);
      expectPricesOnOneLine(g);
      // Narrower than the rows' minimum, the rows scroll sideways inside the
      // panel instead of clipping; the page itself never does.
      const table = await panel
        .locator(`table.ls-${tab}`)
        .evaluate((el) => el.getBoundingClientRect().right);
      for (const edge of [...g.chips, ...g.removes]) expect(edge.right).toBeLessThanOrEqual(table);
      // Four columns: 4 + 3, never one filter alone.
      const grid = await filterGrid();
      const rows = new Map<number, number>();
      for (const control of grid.controls) {
        const top = Math.round(control.top);
        rows.set(top, (rows.get(top) ?? 0) + 1);
      }
      expect([...rows.values()]).toEqual(tab === "rivens" ? [4, 3] : [grid.controls.length]);
    }

    for (const cell of await rivenCells()) {
      expect(cell.metaShown).toBe(true);
      expect(cell.metaClipped).toBe(false);
      // The meta unit is a left-aligned subtitle under the name, never a lone
      // right-aligned text, and overlaps neither the name nor the chips.
      expect(Math.abs(cell.meta.left - cell.cellContentLeft)).toBeLessThanOrEqual(1);
      expect(cell.meta.top).toBeGreaterThanOrEqual(cell.name.bottom - 1);
      // Two chips per line: two distinct left edges, never a chip alone.
      const lefts = new Set(cell.chips.map((chip) => Math.round(chip.left)));
      expect(lefts.size).toBe(2);
      const lines = new Map<number, number>();
      for (const chip of cell.chips) {
        expect(chip.top).toBeGreaterThanOrEqual(cell.meta.bottom - 1);
        expect(chip.right).toBeLessThanOrEqual(cell.cellContentRight + 0.5);
        const top = Math.round(chip.top);
        lines.set(top, (lines.get(top) ?? 0) + 1);
      }
      expect([...lines.values()]).toEqual([2, 2]);
    }
    await page.locator("h2").first().click();
    await panel.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: test.info().outputPath("c1-rivens-900-expanded.png"),
      animations: "disabled",
    });
    if (SHOTS) {
      fs.copyFileSync(
        test.info().outputPath("c1-rivens-900-expanded.png"),
        path.join(SHOTS, "c1-rivens-900-expanded.png"),
      );
    }
  });

  test("the add forms stack and the tracked rivens stay inside their list", async () => {
    for (const [width, sidebar] of [
      [963, "expanded"],
      [900, "expanded"],
      [963, "collapsed"],
      [900, "collapsed"],
    ] as const) {
      await useWindow(width, 809, sidebar);
      const view = await page.evaluate(() => {
        const content = document.querySelector("#content") as HTMLElement;
        const pickers = Array.from(
          document.querySelectorAll<HTMLElement>("section input[placeholder='Search items...']"),
          (input) => input.getBoundingClientRect().width,
        );
        const list = document.querySelector("[data-live-scraper-riven-list]") as HTMLElement;
        const listRight = list.getBoundingClientRect().right;
        return {
          contentScroll: content.scrollWidth,
          contentClient: content.clientWidth,
          pickers,
          listScroll: list.scrollWidth,
          listClient: list.clientWidth,
          rowRights: Array.from(list.querySelectorAll("li button"), (button) =>
            Math.round(button.getBoundingClientRect().right - listRight),
          ),
        };
      });
      expect(view.contentScroll).toBeLessThanOrEqual(view.contentClient);
      // An item search keeps room to type (10rem).
      for (const picker of view.pickers) expect(picker).toBeGreaterThanOrEqual(149);
      expect(view.listScroll).toBeLessThanOrEqual(view.listClient);
      for (const right of view.rowRights) expect(right).toBeLessThanOrEqual(0);
    }
  });
});
