import fs from "node:fs";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

// The Riven checkbox replaced both the Syndicate checkbox and the old
// engine-mode dropdown; the file keeps a matching stockMode for older builds.
test.describe("Live Scraper trade modes", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  const savedGeneral = () =>
    JSON.parse(
      fs.readFileSync(
        path.join(harness.sandboxDir, "user-data", "live-scraper-settings.json"),
        "utf8",
      ),
    ).general as { tradeModes: string[]; stockMode: string };

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-ls-trade-modes-e2e-", {
      userDataFiles: {
        // Saved by an older build with "Rivens only" picked in the dropdown.
        "live-scraper-settings.json": {
          version: 1,
          general: { stockMode: "riven", tradeModes: ["buy", "sell", "wishlist"] },
        },
      },
    });
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("only Riven can be ticked, and it is saved", async () => {
    await openView(page, "liveScraper");
    await page.locator("[data-live-scraper-open-settings]").click();
    const modes = page.locator("[data-live-scraper-trade-modes] label");
    await expect(modes).toHaveText(["Buy", "Sell", "Wishlist", "Riven"]);
    await expect(page.locator("[data-live-scraper-settings] select")).toHaveCount(0);

    const box = (name: string) => modes.filter({ hasText: name }).locator("input");
    // The old "Rivens only" reads as Riven alone.
    await expect(box("Riven")).toBeChecked();
    for (const name of ["Buy", "Sell", "Wishlist"]) await expect(box(name)).not.toBeChecked();

    await box("Sell").check();
    await expect
      .poll(() => savedGeneral())
      .toEqual(expect.objectContaining({ tradeModes: ["sell", "riven"], stockMode: "all" }));

    await box("Sell").uncheck();
    await expect
      .poll(() => savedGeneral())
      .toEqual(expect.objectContaining({ tradeModes: ["riven"], stockMode: "riven" }));

    await box("Riven").uncheck();
    await expect
      .poll(() => savedGeneral())
      .toEqual(expect.objectContaining({ tradeModes: [], stockMode: "item" }));
  });
});
