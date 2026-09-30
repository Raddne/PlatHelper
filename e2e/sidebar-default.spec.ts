import { test, expect, type Page } from "@playwright/test";

import { VIEW_NAMES } from "../src/types/views";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  restartElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

// These run on truly empty storage, not the harness's All-functions seed: the
// point is what a fresh profile, or one an older build left behind, gets.

const DEFAULT_ROWS = ["dashboard", "inventory", "liveScraper", "messages", "settings"];
const ALL_ROWS = VIEW_NAMES.filter((view) => view !== "setup");
const HIDEABLE = VIEW_NAMES.filter(
  (view) => view !== "setup" && view !== "inventory" && view !== "settings",
);

const USER_PRESET = {
  id: "user-1",
  name: "Trading",
  order: ["market", "analytics", "liveScraper"],
};

// What a 0.2.5 profile looks like after setup: every view shown, a user preset
// active, and a sidebar layout of its own that the migration must not touch.
const OLDER_PROFILE: Record<string, string> = {
  "setup-completed-v2": "1",
  "feature-tour-done": "1",
  "app-language": "en",
  ...Object.fromEntries(HIDEABLE.map((view) => [`wf_tab_visible_${view}`, "1"])),
  wf_sidebar_presets_v1: JSON.stringify({
    version: 1,
    presets: [USER_PRESET],
    activePresetId: USER_PRESET.id,
  }),
  wf_sidebar_order: JSON.stringify(["messages", "inventory", "dashboard", "market", "settings"]),
  wf_sidebar_width: "260",
  wf_sidebar_labels_v1: JSON.stringify({ dashboard: "Home" }),
};

const SIDEBAR_KEYS = [
  ...HIDEABLE.map((view) => `wf_tab_visible_${view}`),
  "wf_sidebar_presets_v1",
  "wf_sidebar_defaults_v2",
  "wf_sidebar_order",
  "wf_sidebar_width",
  "wf_sidebar_labels_v1",
];

const rows = (page: Page): Promise<string[]> =>
  page
    .locator("#sidebar [data-view]")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.view ?? ""));

const readKeys = (page: Page): Promise<Record<string, string | null>> =>
  page.evaluate(
    (keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    SIDEBAR_KEYS,
  );

/** The fresh-user path out of the wizard, the one that needs no inventory file. */
async function finishSetupWithoutInventory(page: Page): Promise<void> {
  await expect(page.locator("#content.setup-active")).toBeVisible({ timeout: 90_000 });
  await page.locator("[data-setup-without-inventory]").first().click();
  await expect(page.locator("#sidebar")).toBeVisible({ timeout: 30_000 });
}

async function openPresetManager(page: Page): Promise<void> {
  await page.locator("[data-customize-open]").click();
  await expect(page.locator("[data-preset-manager]")).toBeVisible();
}

test.describe("default sidebar", () => {
  test.setTimeout(240_000);

  let harness: ElectronTestHarness | undefined;

  test.afterEach(async () => {
    await closeElectronTestHarness(harness);
    harness = undefined;
  });

  test("a fresh profile shows the default rows, and both built-in presets switch them", async () => {
    harness = await launchElectronTestHarness("wfh-sidebar-default-fresh-", {
      emptyStorage: true,
    });
    const { page } = harness;
    await finishSetupWithoutInventory(page);
    // World is hidden by default, so the no-inventory path opens the Dashboard.
    await expect(page.locator("#content")).toHaveAttribute("data-view", "dashboard");
    expect(await rows(page)).toEqual(DEFAULT_ROWS);
    expect(await page.evaluate(() => localStorage.getItem("wf_sidebar_presets_v1"))).toBeNull();

    // A widget whose tab is hidden offers no link to it; one on Inventory still does.
    const hiddenHomeLink = page.locator('[data-widget-open="widget.cycles"]');
    await expect(page.locator('[data-widget="widget.cycles"]')).toBeVisible();
    await expect(hiddenHomeLink).toHaveCount(0);
    await expect(page.locator('[data-widget-open="widget.inventoryValue"]')).toBeVisible();

    await openPresetManager(page);
    const presetRows = page.locator("[data-preset-row]");
    await expect(presetRows).toHaveCount(2);
    expect(
      await presetRows.evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.presetRow ?? ""),
      ),
    ).toEqual(["default", "all"]);
    await expect(presetRows.nth(0)).toContainText("Default");
    await expect(presetRows.nth(1)).toContainText("All functions");
    await expect(page.locator('[data-preset-row="default"] [data-preset-active]')).toBeVisible();
    await expect(page.locator('[data-preset-row="all"] [data-preset-active]')).toHaveCount(0);

    await page.locator('[data-preset-apply="all"]').click();
    await expect(page.locator('[data-preset-row="all"] [data-preset-active]')).toBeVisible();
    await expect.poll(() => rows(page)).toEqual(ALL_ROWS);
    await expect(hiddenHomeLink).toHaveCount(1);

    await page.locator('[data-preset-apply="default"]').click();
    await expect(page.locator('[data-preset-row="default"] [data-preset-active]')).toBeVisible();
    await expect.poll(() => rows(page)).toEqual(DEFAULT_ROWS);
    await expect(hiddenHomeLink).toHaveCount(0);
  });

  test("an older profile moves to Default once and keeps its presets and layout", async () => {
    harness = await launchElectronTestHarness("wfh-sidebar-default-migrate-", {
      emptyStorage: true,
    });
    let { page } = harness;
    // Swap the fresh profile the first start just made for an older build's.
    await page.evaluate((seed) => {
      localStorage.clear();
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    }, OLDER_PROFILE);
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });

    expect([...(await rows(page))].sort()).toEqual([...DEFAULT_ROWS].sort());
    await expect(page.locator('#sidebar [data-view="dashboard"]')).toContainText("Home");
    const migrated = await readKeys(page);
    for (const view of HIDEABLE) {
      expect(migrated[`wf_tab_visible_${view}`]).toBe(DEFAULT_ROWS.includes(view) ? "1" : "0");
    }
    expect(JSON.parse(migrated.wf_sidebar_presets_v1 ?? "null")).toEqual({
      version: 1,
      presets: [USER_PRESET],
      activePresetId: "default",
    });
    expect(migrated.wf_sidebar_defaults_v2).toBe("1");
    expect(migrated.wf_sidebar_order).toBe(OLDER_PROFILE.wf_sidebar_order);
    expect(migrated.wf_sidebar_width).toBe(OLDER_PROFILE.wf_sidebar_width);
    expect(migrated.wf_sidebar_labels_v1).toBe(OLDER_PROFILE.wf_sidebar_labels_v1);

    await openPresetManager(page);
    await expect(page.locator('[data-preset-row="default"] [data-preset-active]')).toBeVisible();
    await expect(page.locator(`[data-preset-row="${USER_PRESET.id}"]`)).toContainText(
      USER_PRESET.name,
    );
    await page.locator(`[data-preset-apply="${USER_PRESET.id}"]`).click();
    await expect(
      page.locator(`[data-preset-row="${USER_PRESET.id}"] [data-preset-active]`),
    ).toBeVisible();
    await expect
      .poll(async () => [...(await rows(page))].sort())
      .toEqual(["analytics", "inventory", "liveScraper", "market", "settings"]);
    const picked = await readKeys(page);

    harness = await restartElectronTestHarness(harness);
    page = harness.page;
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    expect(await readKeys(page)).toEqual(picked);
    expect([...(await rows(page))].sort()).toEqual([
      "analytics",
      "inventory",
      "liveScraper",
      "market",
      "settings",
    ]);
  });

  test("Live Scraper and Messages carry the sign-in while signed out", async () => {
    harness = await launchElectronTestHarness("wfh-sidebar-default-signin-", {
      emptyStorage: true,
    });
    const { page, app } = harness;
    await finishSetupWithoutInventory(page);

    await openView(page, "messages");
    const messagesSignIn = page.locator("[data-messages-signed-out]");
    await expect(messagesSignIn).toContainText("Sign in to warframe.market to see your messages.");
    await expect(messagesSignIn.locator("[data-wfm-sign-in]")).toBeVisible();

    await openView(page, "liveScraper");
    const scraperSignIn = page.locator("[data-live-scraper-sign-in]");
    await expect(scraperSignIn).toContainText(
      "Sign in to warframe.market to let the Live Scraper place and update your listings.",
    );
    await expect(scraperSignIn.locator("[data-wfm-sign-in]")).toBeVisible();

    // Stubbed at the IPC boundary; the typed values below are placeholders.
    await evaluateInMain(app, ({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { signInCalls: number };
      state.signInCalls = 0;
      ipcMain.removeHandler("wfm:signin");
      ipcMain.handle("wfm:signin", () => {
        state.signInCalls += 1;
        return { loggedIn: true, userName: "E2E Tester", platform: "pc" };
      });
    });
    await scraperSignIn.locator("#market-email").fill("fixture@example.test");
    await scraperSignIn.locator("#market-password").fill("fixture-password");
    await scraperSignIn.locator('button[type="submit"]').click();

    await expect(page.locator("[data-live-scraper-sign-in]")).toHaveCount(0);
    await expect(page.locator("[data-live-scraper-status]")).toBeVisible();
    expect(
      await evaluateInMain(
        app,
        () => (globalThis as typeof globalThis & { signInCalls: number }).signInCalls,
      ),
    ).toBe(1);
  });
});
