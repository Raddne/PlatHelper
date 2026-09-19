import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test.describe("Zoom shortcuts", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-zoom-e2e-", {
      userDataFiles: { "overlay-settings.json": { uiScale: 1 } },
    });
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  function zoomFactor(): Promise<number> {
    // Overlay windows exist too; the main window is the one showing this page.
    return evaluateInMain(
      harness.app,
      ({ BrowserWindow }, url) => {
        const win = BrowserWindow.getAllWindows().find(
          (w) => !w.isDestroyed() && w.webContents.getURL() === url,
        );
        return win ? win.webContents.getZoomFactor() : 0;
      },
      page.url(),
    );
  }

  async function ctrlWheel(deltaY: number): Promise<void> {
    await page.evaluate((dy) => {
      window.dispatchEvent(
        new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, cancelable: true, bubbles: true }),
      );
    }, deltaY);
  }

  test("Ctrl+wheel zooms the window in steps and shows the percentage", async () => {
    const before = await zoomFactor();
    await ctrlWheel(-100);
    await expect(page.locator("[data-zoom-badge]")).toHaveText("105%");
    await expect.poll(zoomFactor).toBeGreaterThan(before);

    await ctrlWheel(100);
    await ctrlWheel(100);
    await expect(page.locator("[data-zoom-badge]")).toHaveText("95%");
    await expect.poll(zoomFactor).toBeLessThan(before);
  });

  test("a plain wheel does not zoom, and Ctrl+0 resets", async () => {
    const before = await zoomFactor();
    await page.evaluate(() => {
      window.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true }),
      );
    });
    await page.waitForTimeout(400);
    expect(await zoomFactor()).toBe(before);

    // Zoom out first so the reset has something to undo even in a fresh app (a
    // retried test starts one), and dispatch the key: a CI runner's hidden desktop
    // gives the window no real keyboard focus.
    await ctrlWheel(100);
    await expect.poll(zoomFactor).toBeLessThan(before);
    const zoomedOut = await zoomFactor();
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "0", ctrlKey: true, cancelable: true, bubbles: true }),
      );
    });
    await expect(page.locator("[data-zoom-badge]")).toHaveText("100%");
    await expect.poll(zoomFactor).toBeGreaterThan(zoomedOut);
  });

  test("the zoom stops at the upper bound", async () => {
    for (let i = 0; i < 14; i += 1) await ctrlWheel(-100);
    await expect(page.locator("[data-zoom-badge]")).toHaveText("150%");
  });
});
