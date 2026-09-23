import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

const NOW = 1_700_000_000_000;

const stockRow = (id: string, itemName: string, wfmHidden: boolean) => ({
  id,
  wfmId: itemName.toLowerCase(),
  wfmUrl: itemName.toLowerCase(),
  itemName,
  owned: 1,
  bought: 0,
  listPrice: 30,
  minPrice: null,
  isHidden: false,
  wfmHidden,
  status: "live",
  createdAt: NOW,
  updatedAt: NOW,
});

// The harness is signed out of warframe.market, so this covers the switch's
// state, the Status column and the refusal; the order and auction calls are
// unit-tested.
test.describe("Live Scraper listings hidden on warframe.market", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-visibility-e2e-", {
      userDataFiles: {
        "live-scraper-settings.json": { version: 1, hiddenOnWfm: { wts: true } },
        "live-scraper-stock.json": {
          version: 1,
          stock: [stockRow("s1", "Serration", true), stockRow("s2", "Vitality", false)],
          wishlist: [],
        },
      },
    });
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("each tab shows its own saved state", async () => {
    await openView(page, "liveScraper");
    const panel = page.locator("[data-live-scraper-listings]");
    const visible = panel.locator('[data-ls-wfm-visibility-option="visible"]');
    const hidden = panel.locator('[data-ls-wfm-visibility-option="hidden"]');

    await panel.locator('[data-live-scraper-listings-tab="wtb"]').click();
    await expect(visible).toHaveAttribute("aria-pressed", "true");
    await expect(hidden).toHaveAttribute("aria-pressed", "false");
    await expect(panel.locator("[data-ls-tab-hidden]")).toHaveCount(1);
    await expect(panel.locator('[data-ls-tab-hidden="wts"]')).toBeVisible();

    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    await expect(hidden).toHaveAttribute("aria-pressed", "true");
    await expect(visible).toHaveAttribute("aria-pressed", "false");
  });

  test("a hidden listing says so in the Status column", async () => {
    await openView(page, "liveScraper");
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    await expect(panel.locator('[data-ls-row="s1"] .ls-status')).toHaveText("Hidden on WFM");
    await expect(panel.locator('[data-ls-row="s2"] .ls-status')).toHaveText("Live");
  });

  test("marked rows set what the switch shows and acts on", async () => {
    await openView(page, "liveScraper");
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    const visible = panel.locator('[data-ls-wfm-visibility-option="visible"]');
    const hidden = panel.locator('[data-ls-wfm-visibility-option="hidden"]');

    await panel.locator('[data-ls-row="s2"] td.name').click();
    await expect(visible).toHaveAttribute("aria-pressed", "true");
    await expect(hidden).toHaveAttribute("title", /1 marked/);

    // Mixed rows: neither option is set.
    await panel.locator('[data-ls-row="s1"] td.name').click({ modifiers: ["Control"] });
    await expect(visible).toHaveAttribute("aria-pressed", "false");
    await expect(hidden).toHaveAttribute("aria-pressed", "false");

    await hidden.click();
    const notice = panel.locator("[data-ls-wfm-visibility-notice]");
    await expect(notice).toContainText("not signed in");
    await expect(panel.locator('[data-ls-row="s2"] .ls-status')).toHaveText("Live");

    await page.keyboard.press("Escape");
    await expect(hidden).toHaveAttribute("aria-pressed", "true");
  });

  test("signed out, a switch is refused and nothing changes", async () => {
    await openView(page, "liveScraper");
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="rivens"]').click();
    await panel.locator('[data-ls-wfm-visibility-option="hidden"]').click();

    const notice = panel.locator("[data-ls-wfm-visibility-notice]");
    await expect(notice).toHaveAttribute("role", "alert");
    await expect(notice).toContainText("not signed in");
    await expect(panel.locator('[data-ls-wfm-visibility-option="visible"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.locator('[data-ls-tab-hidden="rivens"]')).toHaveCount(0);

    // The notice belongs to the tab it was raised on.
    await panel.locator('[data-live-scraper-listings-tab="wtb"]').click();
    await expect(notice).toHaveCount(0);
  });
});
