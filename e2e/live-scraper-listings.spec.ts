import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

const NOW = 1_700_000_000_000;

const STOCK_FILE = {
  version: 1,
  stock: [
    {
      id: "stock-1",
      wfmId: "serration",
      wfmUrl: "serration",
      itemName: "Serration",
      subType: { rank: 0 },
      owned: 2,
      bought: 10,
      listPrice: null,
      minPrice: null,
      isHidden: false,
      status: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "stock-2",
      wfmId: "forma",
      wfmUrl: "forma",
      itemName: "Forma",
      owned: 1,
      bought: 0,
      listPrice: 12,
      minPrice: null,
      isHidden: false,
      adopted: true,
      status: "live",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  wishlist: [
    {
      id: "wish-1",
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

test.describe("Live Scraper listings", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-listings-e2e-", {
      userDataFiles: { "live-scraper-stock.json": STOCK_FILE },
    });
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("the fixed sidebar rows still navigate on a mouse click", async () => {
    await openView(page, "liveScraper");
    await expect(page.locator("[data-live-scraper-listings]")).toBeVisible();
    await openView(page, "inventory");
    await expect(page.locator('#sidebar [data-view="inventory"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await openView(page, "settings");
    await expect(page.locator('#sidebar [data-view="settings"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a stock item's minimum price is editable by step buttons and by typing", async () => {
    await openView(page, "liveScraper");
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    const row = panel.locator("tbody tr", { hasText: "Serration" });
    const value = row.locator(".ls-price-value");
    await expect(value).toHaveText("–");

    await row.locator(".ls-step", { hasText: "+5" }).click();
    await expect(value).toHaveText("5p");
    await row.locator(".ls-step", { hasText: "+10" }).click();
    await expect(value).toHaveText("15p");

    await value.click();
    const input = row.locator(".ls-price-input");
    await input.fill("42");
    await input.press("Enter");
    await expect(row.locator(".ls-price-value")).toHaveText("42p");

    await row.locator(".ls-price-value").click();
    await row.locator(".ls-price-input").fill("");
    await row.locator(".ls-price-input").press("Enter");
    await expect(row.locator(".ls-price-value")).toHaveText("–");
  });

  test("an adopted warframe.market listing is marked and editable", async () => {
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    const row = panel.locator("tbody tr", { hasText: "Forma" });
    await expect(row.locator(".ls-adopted")).toHaveText("WFM");
    await expect(
      panel.locator("tbody tr", { hasText: "Serration" }).locator(".ls-adopted"),
    ).toHaveCount(0);
    await row.locator(".ls-step", { hasText: "+10" }).click();
    await expect(row.locator(".ls-price-value")).toHaveText("10p");
  });

  test("a wishlist item's maximum price is editable", async () => {
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wtb"]').click();
    const row = panel.locator("tbody tr", { hasText: "Hornet Strike" });
    await row.locator(".ls-step", { hasText: "+10" }).click();
    await expect(row.locator(".ls-price-value")).toHaveText("10p");
  });

  test("right-clicking a listing opens a menu whose entries edit values through a popup", async () => {
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    const row = panel.locator("tbody tr", { hasText: "Serration" });
    const menu = page.locator("[data-ls-menu]");
    const editor = page.locator("[data-ls-editor]");

    await row.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-ls-menu-item]")).toHaveCount(8);

    await menu.locator('[data-ls-menu-item="edit-owned"]').click();
    await expect(menu).toHaveCount(0);
    await expect(editor).toBeVisible();
    await editor.locator("input").fill("7");
    await editor.locator("[data-ls-editor-ok]").click();
    await expect(editor).toHaveCount(0);
    await expect(row.locator("td").nth(5)).toHaveText("7");

    await row.click({ button: "right" });
    await menu.locator('[data-ls-menu-item="edit-min-price"]').click();
    await editor.locator("input").fill("33");
    await editor.locator("input").press("Enter");
    await expect(row.locator(".ls-price-value")).toHaveText("33p");

    await row.click({ button: "right" });
    await menu.locator('[data-ls-menu-item="edit-min-price"]').click();
    await editor.locator("[data-ls-editor-clear]").click();
    await expect(row.locator(".ls-price-value")).toHaveText("–");

    // An owned quantity can never be cleared or go below one.
    await row.click({ button: "right" });
    await menu.locator('[data-ls-menu-item="edit-owned"]').click();
    await expect(editor.locator("[data-ls-editor-clear]")).toHaveCount(0);
    await editor.locator("input").fill("0");
    await editor.locator("[data-ls-editor-ok]").click();
    await expect(row.locator("td").nth(5)).toHaveText("1");
  });

  test("the menu closes on Escape and on an outside click, and adopted rows cannot be paused", async () => {
    const panel = page.locator("[data-live-scraper-listings]");
    const menu = page.locator("[data-ls-menu]");
    await panel.locator("tbody tr", { hasText: "Forma" }).click({ button: "right" });
    await expect(menu.locator('[data-ls-menu-item="toggle-hidden"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await panel.locator("tbody tr", { hasText: "Serration" }).click({ button: "right" });
    await expect(menu.locator('[data-ls-menu-item="toggle-hidden"]')).toHaveCount(1);
    await page.locator("h2").first().click();
    await expect(menu).toHaveCount(0);
  });

  test("the statistics entry opens the market statistics modal", async () => {
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator("tbody tr", { hasText: "Serration" }).click({ button: "right" });
    await page.locator('[data-ls-menu-item="statistics"]').click();
    const modal = page.locator("[data-market-stats-modal]");
    await expect(modal).toBeVisible();
    await expect(modal.locator("h3")).toHaveText("Serration");
    await modal.locator("button", { hasText: "×" }).click();
    await expect(modal).toHaveCount(0);
  });

  // Signed out in the harness, so only the row half of a removal is exercised
  // here; the warframe.market half needs a real session.
  test("removing a listing asks first and only removes on confirm", async () => {
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    const row = panel.locator("tbody tr", { hasText: "Serration" });

    await evaluateInMain(harness.app, ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
    });
    await row.locator(".ls-remove").click();
    await page.waitForTimeout(500);
    await expect(row).toHaveCount(1);

    await evaluateInMain(harness.app, ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never;
    });
    await row.locator(".ls-remove").click();
    await expect(row).toHaveCount(0);
    await expect(page.locator("[data-live-scraper-remove-error]")).toHaveCount(0);
  });
});
