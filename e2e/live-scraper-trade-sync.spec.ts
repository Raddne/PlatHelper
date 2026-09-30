import fs from "node:fs";
import path from "node:path";

import { test, expect, type ElectronApplication, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

const EE_LOG_START =
  "0.127 Sys [Diag]: Current time: Fri Sep 18 15:40:49 2026 [UTC: Fri Sep 18 21:40:49 2026]\r\n";

const NOTICE = {
  id: "lsn-fixture",
  createdAt: 1_700_000_000_000,
  platinum: 60,
  split: "market",
  rows: [
    { name: "Fixture Prime Barrel", quantity: 1, bought: 15 },
    { name: "Fixture Prime Stock", quantity: 2, bought: 22 },
  ],
};

/** Sends one push to the app's own window, never an overlay. */
async function pushToMainWindow(app: ElectronApplication, channel: string): Promise<void> {
  await evaluateInMain(
    app,
    ({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().includes("renderer/dist/index.html"))
        ?.webContents.send(name);
    },
    channel,
  );
}

const tradeSyncBox = (page: Page, kind: "items" | "rivens") =>
  page.locator(`[data-live-scraper-trade-sync="${kind}"] input[type="checkbox"]`);

test.describe("Live Scraper trade sync: settings and notice", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-trade-sync-e2e-");
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("both completed-trade switches start on and a change survives reopening", async () => {
    await openView(page, "liveScraper");
    await page.locator("[data-live-scraper-open-settings]").click();
    const modal = page.locator("[data-live-scraper-settings]");
    await expect(modal).toBeVisible();
    await expect(tradeSyncBox(page, "items")).toBeChecked();
    await expect(tradeSyncBox(page, "rivens")).toBeChecked();

    await tradeSyncBox(page, "items").uncheck();
    await expect
      .poll(() => page.evaluate(async () => (await window.api.liveScraperGetSettings()).general))
      .toMatchObject({ tradeSyncItems: false, tradeSyncRivens: true });
    await page.locator("[data-live-scraper-settings-close]").click();
    await expect(modal).toHaveCount(0);

    await page.locator("[data-live-scraper-open-settings]").click();
    await expect(modal).toBeVisible();
    await expect(tradeSyncBox(page, "items")).not.toBeChecked();
    await expect(tradeSyncBox(page, "rivens")).toBeChecked();
    await page.locator("[data-live-scraper-settings-close]").click();
    await expect(modal).toHaveCount(0);
  });

  test("a queued notice shows on any tab until Got it acknowledges it", async () => {
    await evaluateInMain(
      harness.app,
      ({ ipcMain }, notice) => {
        const state = globalThis as typeof globalThis & { noticeAcks: string[] };
        state.noticeAcks = [];
        ipcMain.removeHandler("live-scraper:trade-notices");
        ipcMain.handle("live-scraper:trade-notices", () =>
          state.noticeAcks.includes(notice.id) ? [] : [notice],
        );
        ipcMain.removeHandler("live-scraper:trade-notice-ack");
        ipcMain.handle("live-scraper:trade-notice-ack", (_event, id: unknown) => {
          state.noticeAcks.push(String(id));
          return true;
        });
      },
      NOTICE,
    );
    const notice = page.locator("[data-live-scraper-trade-notice]");

    await openView(page, "dashboard");
    await pushToMainWindow(harness.app, "live-scraper:trade-notice");
    await expect(notice).toBeVisible();
    await expect(page.locator("#content")).toHaveAttribute("data-view", "dashboard");
    await expect(notice.locator("tbody tr")).toHaveCount(2);
    await expect(notice.locator("tbody tr").nth(0)).toContainText("Fixture Prime Barrel");
    await expect(notice.locator("tbody tr").nth(0)).toContainText("15p");
    await expect(notice.locator("tbody tr").nth(1)).toContainText("Fixture Prime Stock");
    await expect(notice.locator("tbody tr").nth(1)).toContainText("22p");

    // Still unacknowledged, so a restarted renderer, which opens on Inventory, shows it again.
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    await expect(page.locator("#content")).toHaveAttribute("data-view", "inventory");
    await expect(notice).toBeVisible();

    await notice.locator("[data-live-scraper-trade-notice-ack]").click();
    await expect(notice).toHaveCount(0);
    expect(
      await evaluateInMain(
        harness.app,
        () => (globalThis as typeof globalThis & { noticeAcks: string[] }).noticeAcks,
      ),
    ).toEqual([NOTICE.id]);
  });
});

// The EE.log trade goes through the real monitor, trade workflow and trade sync;
// only what would reach warframe.market (catalog, set lookup, order books) is
// answered in the main process.
const CATALOG = {
  "fixture prime barrel": {
    id: "fixture-barrel-id",
    url_name: "fixture_prime_barrel",
    item_name: "Fixture Prime Barrel",
    thumb: "",
    icon: "",
    maxRank: 0,
    gameRef: "",
  },
  "fixture prime stock": {
    id: "fixture-stock-id",
    url_name: "fixture_prime_stock",
    item_name: "Fixture Prime Stock",
    thumb: "",
    icon: "",
    maxRank: 0,
    gameRef: "",
  },
};

// Lowest in-game sell offers: the 60p purchase splits 15p / 45p by market value.
const OFFERS = { fixture_prime_barrel: 10, fixture_prime_stock: 30 };

const PURCHASE_LOG =
  [
    "1300.000 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade?",
    "You are offering:",
    "Platinum x 60",
    "and will receive from FixtureSeller the following:",
    "Fixture Prime Barrel",
    "Fixture Prime Stock, leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)",
    "1305.000 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, leftItem=/Menu/Confirm_Item_Ok)",
  ].join("\r\n") + "\r\n";

test.describe("Live Scraper trade sync: a confirmed purchase", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-trade-purchase-e2e-", {
      eeLog: EE_LOG_START,
    });
    page = harness.page;
    await evaluateInMain(
      harness.app,
      ({ app, ipcMain }, fixture) => {
        const load = process
          .getBuiltinModule("module")
          .createRequire(`${app.getAppPath()}/.electron-build/main.js`);
        const catalog = load("./services/wfmCatalog.js") as Record<string, unknown>;
        const orderBook = load("./services/liveScraperOrderBook.js") as Record<string, unknown>;
        catalog.ensureLoaded = async () => Object.keys(fixture.catalog).length;
        catalog.lookupByName = (name: string) =>
          fixture.catalog[String(name).toLowerCase() as keyof typeof fixture.catalog] ?? null;
        catalog.resolveSetMembership = async () => ({ kind: "not-set" });
        orderBook.fetchLowestInGameSellPrice = async (slug: string) =>
          fixture.offers[slug as keyof typeof fixture.offers] ?? null;
        ipcMain.removeHandler("live-scraper:item-facts");
        ipcMain.handle("live-scraper:item-facts", () => ({
          fixture_prime_barrel: "misc",
          fixture_prime_stock: "misc",
        }));
      },
      { catalog: CATALOG, offers: OFFERS },
    );
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("two listed items bought in one trade become two WTS rows and raise the notice", async () => {
    await openView(page, "liveScraper");
    const panel = page.locator("[data-live-scraper-listings]");
    await panel.locator('[data-live-scraper-listings-tab="wts"]').click();
    await expect(panel.locator("tbody tr")).toHaveCount(0);

    fs.appendFileSync(path.join(harness.sandboxDir, "local", "Warframe", "EE.log"), PURCHASE_LOG);

    const barrel = panel.locator("tbody tr").filter({ hasText: "Fixture Prime Barrel" });
    const stock = panel.locator("tbody tr").filter({ hasText: "Fixture Prime Stock" });
    await expect(barrel).toHaveCount(1, { timeout: 60_000 });
    await expect(stock).toHaveCount(1);
    await expect(panel.locator("tbody tr")).toHaveCount(2);
    await expect(barrel.locator("[data-ls-origin-trade]")).toHaveText("Trade");
    await expect(stock.locator("[data-ls-origin-trade]")).toHaveText("Trade");

    const notice = page.locator("[data-live-scraper-trade-notice]");
    await expect(notice).toBeVisible();
    await expect(notice.locator("tbody tr").nth(0)).toContainText("Fixture Prime Barrel");
    await expect(notice.locator("tbody tr").nth(0)).toContainText("15p");
    await expect(notice.locator("tbody tr").nth(1)).toContainText("Fixture Prime Stock");
    await expect(notice.locator("tbody tr").nth(1)).toContainText("45p");

    await notice.locator("[data-live-scraper-trade-notice-ack]").click();
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => window.api.liveScraperTradeNotices())).toEqual([]);
  });
});
