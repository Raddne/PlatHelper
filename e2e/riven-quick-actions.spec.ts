import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

const MAX_ROLL_INT = 0x3fffffff;
const RIVEN_ID = "bbbbbbbbbbbbbbbbbbbbbbb1";

// One unveiled rifle riven: +heat damage, -fire rate (see rivens-cards.spec.ts).
const INVENTORY = {
  Suits: [],
  Upgrades: [
    {
      ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
      ItemId: { $oid: RIVEN_ID },
      UpgradeFingerprint: JSON.stringify({
        compat: "/Lotus/Weapons/Tenno/Rifle/Rifle",
        lim: 0,
        lvlReq: 9,
        lvl: 8,
        rerolls: 2,
        pol: "AP_ATTACK",
        buffs: [{ Tag: "WeaponFireDamageMod", Value: Math.round(MAX_ROLL_INT * 0.72) }],
        curses: [{ Tag: "WeaponFireRateMod", Value: Math.round(MAX_ROLL_INT * 0.3) }],
      }),
    },
  ],
};

test.describe("riven card quick actions", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-riven-quick-", { inventory: INVENTORY });
    page = harness.page;
    await openView(page, "rivens");
    await expect(page.locator("[data-riven-card]").first()).toBeVisible({ timeout: 30_000 });
    // Record instead of acting: no browser opens, and every dialog answers "second button".
    await evaluateInMain(harness.app, ({ shell, dialog }) => {
      const scope = globalThis as unknown as { quickTest: { urls: string[]; dialogs: string[] } };
      scope.quickTest = { urls: [], dialogs: [] };
      shell.openExternal = (async (url: string) => {
        scope.quickTest.urls.push(url);
      }) as never;
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = (args.length > 1 ? args[1] : args[0]) as { message?: string };
        scope.quickTest.dialogs.push(String(options?.message ?? ""));
        return { response: 1, checkboxChecked: false };
      }) as never;
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  const recorded = () =>
    evaluateInMain(
      harness.app,
      () =>
        (globalThis as unknown as { quickTest: { urls: string[]; dialogs: string[] } }).quickTest,
    );

  test("the menu links to the warframe.market search for exactly this roll", async () => {
    await page.locator("[data-riven-card]").first().click({ button: "right" });
    const menu = page.locator("[data-riven-card-menu]");
    await expect(menu.locator("[data-riven-menu-search]")).toBeVisible();
    await expect(menu.locator("[data-riven-menu-quick-list]")).toBeVisible();

    await menu.locator("[data-riven-menu-search]").click();
    await expect(menu).toHaveCount(0);
    await expect.poll(async () => (await recorded()).urls.length).toBe(1);
    const url = new URL((await recorded()).urls[0] as string);
    expect(url.origin + url.pathname).toBe("https://warframe.market/auctions/search");
    expect(url.searchParams.get("type")).toBe("riven");
    expect(url.searchParams.get("weapon_url_name")).toBe("braton");
    expect(url.searchParams.get("positive_stats")).toBe("heat_damage");
    expect(url.searchParams.get("negative_stats")).toBe("fire_rate_/_attack_speed");
    expect(url.searchParams.get("sort_by")).toBe("price_asc");
  });

  test("listing asks whose listings count first and posts nothing without a yes", async () => {
    await page.locator("[data-riven-card]").first().click({ button: "right" });
    await page.locator("[data-riven-menu-quick-list]").click();

    // First question is always the online-only one; the stub answers "No, all listings".
    await expect.poll(async () => (await recorded()).dialogs.length).toBeGreaterThan(0);
    expect((await recorded()).dialogs[0]).toContain("online");

    // What follows depends on the live market: a price to confirm (the stub
    // declines it) or a toast saying there is nothing to match / no connection.
    await expect
      .poll(
        async () =>
          (await recorded()).dialogs.length > 1 ||
          (await page.locator("article", { hasText: /riven|listing|warframe\.market/i }).count()) >
            0,
        { timeout: 60_000 },
      )
      .toBe(true);
    const dialogs = (await recorded()).dialogs;
    if (dialogs.length > 1) expect(dialogs[1]).toMatch(/for \d+p\?/);

    // Declined or impossible either way: no stock riven was filed.
    const stock = await page.evaluate(() =>
      (
        window as unknown as { api: { liveScraperRivenStockList: () => Promise<unknown[]> } }
      ).api.liveScraperRivenStockList(),
    );
    expect(stock).toEqual([]);
  });
});
