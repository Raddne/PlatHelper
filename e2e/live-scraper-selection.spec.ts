import { test, expect, type Locator, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

const NOW = 1_700_000_000_000;
const NAMES = ["Serration", "Forma", "Hornet Strike", "Point Strike", "Split Chamber"];

const STOCK_FILE = {
  version: 1,
  stock: NAMES.map((itemName, index) => ({
    id: `stock-${index + 1}`,
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
  })),
  wishlist: [],
};

test.describe("Live Scraper listings selection", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;
  let panel: Locator;

  const row = (name: string): Locator => panel.locator("tbody tr", { hasText: name });
  const selected = (): Promise<string[]> =>
    panel.locator("tbody tr.selected td.name").allInnerTexts();

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-selection-e2e-", {
      userDataFiles: { "live-scraper-stock.json": STOCK_FILE },
    });
    page = harness.page;
    await openView(page, "liveScraper");
    panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    await expect(panel.locator("tbody tr")).toHaveCount(NAMES.length);
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("click, ctrl+click and shift+click select like a file manager", async () => {
    await row("Forma").locator("td.name").click();
    expect(await selected()).toEqual(["Forma"]);

    await row("Point Strike")
      .locator("td.name")
      .click({ modifiers: ["Control"] });
    expect(await selected()).toEqual(["Forma", "Point Strike"]);

    await row("Forma").locator("td.name").click();
    await row("Point Strike")
      .locator("td.name")
      .click({ modifiers: ["Shift"] });
    expect(await selected()).toEqual(["Forma", "Hornet Strike", "Point Strike"]);
    await expect(panel.locator("[data-ls-selected-count]")).toContainText("3");

    await page.keyboard.press("Escape");
    expect(await selected()).toEqual([]);
  });

  test("the price buttons in a row do not change the selection", async () => {
    await row("Serration").locator("td.name").click();
    await row("Forma").locator(".ls-price-value").click();
    await page.keyboard.press("Escape");
    expect(await selected()).toEqual(["Serration"]);
    await row("Serration").locator("td.name").click();
  });

  test("the search box narrows the list, and shift+click ranges over what is shown", async () => {
    const search = panel.locator("[data-ls-search]");
    await search.fill("strike");
    await expect(panel.locator("tbody tr")).toHaveCount(2);
    await expect(panel.locator('[data-live-scraper-listings-tab="wts"]')).toContainText("(5)");

    await row("Hornet Strike").locator("td.name").click();
    await row("Point Strike")
      .locator("td.name")
      .click({ modifiers: ["Shift"] });
    expect(await selected()).toEqual(["Hornet Strike", "Point Strike"]);

    await search.fill("no such item");
    await expect(panel.locator("[data-ls-no-matches]")).toBeVisible();

    await search.fill("");
    await expect(panel.locator("tbody tr")).toHaveCount(NAMES.length);
    // Rows hidden by the search dropped out of the selection.
    expect(await selected()).toEqual([]);
  });

  test("right-click on a multi-selection edits and removes all of it", async () => {
    await row("Serration").locator("td.name").click();
    await row("Hornet Strike")
      .locator("td.name")
      .click({ modifiers: ["Shift"] });
    await row("Forma").click({ button: "right" });

    const menu = page.locator("[data-ls-menu]");
    await expect(menu.locator('[data-ls-menu-item="bulk-remove"]')).toContainText("3");
    await menu.locator('[data-ls-menu-item="bulk-price"]').click();
    await page.locator("#ls-editor-input").fill("25");
    await page.locator("[data-ls-editor-ok]").click();
    for (const name of ["Serration", "Forma", "Hornet Strike"]) {
      await expect(row(name).locator(".ls-price-value")).toHaveText("25p");
    }
    await expect(row("Point Strike").locator(".ls-price-value")).toHaveText("–");

    await evaluateInMain(harness.app, ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never;
    });
    await row("Forma").click({ button: "right" });
    await menu.locator('[data-ls-menu-item="bulk-remove"]').click();
    await expect(panel.locator("tbody tr")).toHaveCount(2);
    expect(await selected()).toEqual([]);
  });

  test("right-click outside the selection falls back to that single row", async () => {
    await row("Point Strike").locator("td.name").click();
    await row("Split Chamber").click({ button: "right" });
    expect(await selected()).toEqual(["Split Chamber"]);
    await expect(page.locator('[data-ls-menu] [data-ls-menu-item="remove"]')).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
