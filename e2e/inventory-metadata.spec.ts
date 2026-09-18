import { test, expect as baseExpect } from "@playwright/test";

import { DB_GET_ITEM_DATABASE, DB_GET_WFM_ITEMS } from "../config/shared/ipcChannels";
import type { WfmItemsLookup } from "../src/types/ipc";
import type { ItemDbEntry } from "../src/types/inventory";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  writeHarnessInventory,
  type ElectronTestHarness,
} from "./electronTestHarness";
import { createOfflineScenario } from "./offlineScenario";

const expect = baseExpect.configure({ timeout: 20_000 });
const ITEM_REF = "/Lotus/Upgrades/Mods/Pistol/Event/Nightwave/NightwaveLasGooPistolAugmentMod";
const CATALOG_ITEM = {
  gameRef: ITEM_REF,
  item_name: "Prototype Shock Coils",
  url_name: "prototype_shock_coils",
  maxRank: 5,
};
const CATALOG: WfmItemsLookup = {
  [ITEM_REF.toLowerCase()]: CATALOG_ITEM,
  "prototype shock coils": CATALOG_ITEM,
};

test("inventory resolves missing Nightwave metadata and keeps catalog entries unowned", async () => {
  test.setTimeout(180_000);
  const scenario = createOfflineScenario("world-darvo");
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-inventory-metadata-", {
      ...scenario,
      inventory: {
        Suits: [],
        Upgrades: [{ ItemType: ITEM_REF, ItemCount: 1, Rank: 0 }],
      },
    });
    const database: Record<string, ItemDbEntry> = {
      "/Lotus/Weapons/Test/UnownedSentinel": { name: "Unowned Fixture", category: "Weapon" },
    };
    await evaluateInMain(
      harness.app,
      ({ ipcMain }, payload) => {
        // Filesystem write-stability polling needs time to advance after offline startup.
        globalThis.Date = Date.prototype.constructor as DateConstructor;
        ipcMain.removeHandler(payload.itemDbChannel);
        ipcMain.handle(payload.itemDbChannel, () => payload.database);
        ipcMain.removeHandler(payload.catalogChannel);
        ipcMain.handle(payload.catalogChannel, () => payload.catalog);
      },
      {
        itemDbChannel: DB_GET_ITEM_DATABASE,
        catalogChannel: DB_GET_WFM_ITEMS,
        database,
        catalog: CATALOG,
      },
    );
    const { page } = harness;
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url !== "https://api.warframe.market/v2/orders/item/prototype_shock_coils") {
          return original(input, init);
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                type: "sell",
                platinum: 18,
                quantity: 1,
                rank: 0,
                visible: true,
                user: { ingameName: "FixtureSeller", status: "ingame" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };
    });
    await page.reload();
    await page.locator('#sidebar [data-view="inventory"]').click();
    await page.locator('[data-tour="inventory-tabs"] [data-tour-tab="mods"]').click();
    const cards = page.locator("[data-inventory-card]");
    await expect(cards).toHaveCount(1);
    await expect(cards.locator(".item-name")).toHaveText("Prototype Shock Coils");
    await expect(cards.locator(".item-rank-text")).toHaveText("0/5");
    await expect(cards).toContainText("x1");
    await expect(cards).toHaveAttribute("data-inventory-card", `${ITEM_REF}#r0m10`);
    expect(
      await page.evaluate(
        async (reference) => (await window.api.getItemDatabase())[reference],
        ITEM_REF,
      ),
    ).toBeUndefined();
    await cards.click();
    const panel = page.locator("[data-orderbook-panel]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Prototype Shock Coils");
    await expect(panel.locator('[data-orderbook-unit-plat="18"]')).toBeVisible();
    const ranks = panel.locator("select.inventory-orderbook-select").first();
    await expect(ranks.locator("option")).toHaveCount(6);
    expect(
      await ranks
        .locator("option")
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(["0", "1", "2", "3", "4", "5"]);
    await page.screenshot({ path: test.info().outputPath("prototype-shock-coils.png") });
    await page.locator("[data-orderbook-close]").click();

    writeHarnessInventory(harness, { Suits: [], Upgrades: [] });
    await expect(cards).toHaveCount(0);
    expect(
      await page.evaluate(
        async () => (await window.api.getWfmItems())["prototype shock coils"].maxRank,
      ),
    ).toBe(5);
    await page.screenshot({ path: test.info().outputPath("catalog-with-empty-inventory.png") });
  } finally {
    await closeElectronTestHarness(harness);
    scenario.dispose();
  }
});
