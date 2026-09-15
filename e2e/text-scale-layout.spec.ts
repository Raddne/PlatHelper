import { expect, test, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

// A Playwright viewport does not resize an Electron window, so the reporter's
// 1920x1200 has to be set on the BrowserWindow itself.
async function setWindowSize(
  harness: ElectronTestHarness,
  width: number,
  height: number,
): Promise<void> {
  await evaluateInMain(
    harness.app,
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes("renderer/dist/index.html"),
      );
      win?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await harness.page.waitForTimeout(400);
}

async function setFontScale(page: Page, scale: number): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem(
      "wf_theme_settings",
      JSON.stringify({ version: 1, fontSizes: { globalScale: value } }),
    );
  }, scale);
  await page.reload();
  await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
}

function measureRelicRow(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector<HTMLElement>("[data-relic-filter-row]");
    const tabs = document.querySelector<HTMLElement>("[data-relic-tier-tabs]");
    const search = document.querySelector<HTMLElement>("[data-relic-filter-controls] .search-box");
    if (!row || !tabs || !search) throw new Error("relic filter row is missing");
    const tabsRect = tabs.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    return {
      overlaps:
        Math.min(tabsRect.right, searchRect.right) - Math.max(tabsRect.left, searchRect.left) >
          0.5 &&
        Math.min(tabsRect.bottom, searchRect.bottom) - Math.max(tabsRect.top, searchRect.top) > 0.5,
      searchEscapesRow: searchRect.left < row.getBoundingClientRect().left - 0.5,
      rowFits: row.scrollWidth <= row.clientWidth,
    };
  });
}

function measureNavIcons(page: Page) {
  return page.evaluate(() => {
    const icons = Array.from(document.querySelectorAll<HTMLElement>("#sidebar [data-view] img"));
    const buttons = Array.from(document.querySelectorAll<HTMLElement>("#sidebar [data-view]"));
    return {
      sizes: icons.map((icon) => {
        const rect = icon.getBoundingClientRect();
        return `${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`;
      }),
      pitch:
        buttons.length > 1
          ? +(
              buttons[1]!.getBoundingClientRect().top - buttons[0]!.getBoundingClientRect().top
            ).toFixed(1)
          : 0,
    };
  });
}

function measureAppearanceCards(page: Page) {
  return page.evaluate(() => {
    const sections = ["[data-app-scale]", "[data-font-sizes]"];
    return sections.map((selector) => {
      const section = document.querySelector<HTMLElement>(selector);
      if (!section) throw new Error(`${selector} is missing`);
      const cards = Array.from(section.querySelectorAll<HTMLElement>("label"));
      if (cards.length === 0) throw new Error(`${selector} has no card`);
      return {
        selector,
        sectionOverflow: section.scrollWidth - section.clientWidth,
        cardOverflow: Math.max(...cards.map((card) => card.scrollWidth - card.clientWidth)),
        // A control that dropped below its label; at the default scale every
        // card still has both on one line, which is what pins today's look.
        stacked: cards.filter((card) => {
          const label = card.firstElementChild!.getBoundingClientRect();
          const control = card.lastElementChild!.getBoundingClientRect();
          return control.top >= label.bottom - 1;
        }).length,
      };
    });
  });
}

async function openAppearance(page: Page): Promise<void> {
  await openView(page, "settings");
  await page.locator('[data-tour-tab="appearance"]').click();
  await expect(page.locator("[data-app-scale]")).toBeVisible();
}

test.describe("Layout holds at a raised text scale", () => {
  test.setTimeout(300_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-text-scale-layout-");
    page = harness.page;
    await setWindowSize(harness, 1920, 1200);
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("relic tier tabs never sit under the filter controls", async () => {
    for (const scale of [1.25, 1.5]) {
      await setFontScale(page, scale);
      for (const width of [1200, 1600, 1920, 2560]) {
        await setWindowSize(harness, width, 1000);
        await openView(page, "relics");
        const layout = await measureRelicRow(page);
        await page
          .locator("[data-relic-filter-row]")
          .screenshot({ path: test.info().outputPath(`relics-${width}-${scale}.png`) });

        expect(layout.overlaps, `search box covers the tier tabs at ${width}px, ${scale}x`).toBe(
          false,
        );
        expect(layout.searchEscapesRow, `search box left the row at ${width}px, ${scale}x`).toBe(
          false,
        );
        expect(layout.rowFits, `filter row scrolls sideways at ${width}px, ${scale}x`).toBe(true);
      }
    }
    await setWindowSize(harness, 1920, 1200);
  });

  test("collapsed nav icons keep the size they have expanded", async () => {
    for (const scale of [1.25, 1.5]) {
      await setFontScale(page, scale);
      await setWindowSize(harness, 1920, 1200);
      const expanded = await measureNavIcons(page);
      await page.locator("#sidebar").screenshot({
        path: test.info().outputPath(`sidebar-expanded-${scale}.png`),
      });

      await page.locator("#sidebar [data-sidebar-collapse]").click();
      await expect(page.locator("#sidebar")).toHaveClass(/sidebar-collapsed/);
      const collapsed = await measureNavIcons(page);
      await page.locator("#sidebar").screenshot({
        path: test.info().outputPath(`sidebar-collapsed-${scale}.png`),
      });
      await page.locator("#sidebar [data-sidebar-collapse]").click();

      expect(expanded.sizes.length, `no nav icons at ${scale}x`).toBeGreaterThan(3);
      expect(collapsed.sizes, `collapsed nav icons shrink at ${scale}x`).toEqual(expanded.sizes);
      expect(collapsed.pitch, `collapsed nav rows change rhythm at ${scale}x`).toBe(expanded.pitch);
    }
  });

  test("the app size and font size cards fit their column", async () => {
    for (const scale of [1.25, 1.5]) {
      await setFontScale(page, scale);
      await setWindowSize(harness, 1920, 1200);
      await openAppearance(page);
      await page
        .locator("[data-app-scale]")
        .screenshot({ path: test.info().outputPath(`app-size-card-${scale}.png`) });

      for (const section of await measureAppearanceCards(page)) {
        expect(section.sectionOverflow, `${section.selector} overflows at ${scale}x`).toBe(0);
        expect(section.cardOverflow, `${section.selector} card overflows at ${scale}x`).toBe(0);
      }
    }
  });

  // Both controls used to write the store on every keystroke and every pointer
  // move, which re-scaled the page the user was still typing or dragging in.
  test("the text size controls apply on release", async () => {
    await setFontScale(page, 1.25);
    await setWindowSize(harness, 1920, 1200);
    await openAppearance(page);
    const rootSize = (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    const percentBox = page.locator("[data-font-sizes] input[type='number']").first();
    const slider = page.locator("[data-font-sizes] input[type='range']").first();
    const scaled = await rootSize();

    await percentBox.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("12");
    expect(await rootSize(), "typing in the percent box re-scaled the page").toBe(scaled);
    await page.keyboard.press("Enter");
    expect(await rootSize(), "the percent box did not apply on Enter").not.toBe(scaled);
    await expect(percentBox, "the clamped value was not written back").toHaveValue("75");

    await setFontScale(page, 1.25);
    await openAppearance(page);
    await slider.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = "1.5";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(await rootSize(), "dragging the slider re-scaled the page").toBe(scaled);
    await expect(percentBox, "the slider did not update its live label").toHaveValue("150");
    await slider.evaluate((element) =>
      element.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(await rootSize(), "releasing the slider did not apply the scale").not.toBe(scaled);
  });

  // The wrap is a fallback, so at the default scale both halves of every card
  // must still share one line - that is what keeps the 100% render unchanged.
  test("the cards stay on one line at the default text scale", async () => {
    await setFontScale(page, 1);
    for (const width of [1400, 1920]) {
      await setWindowSize(harness, width, 1200);
      await openAppearance(page);
      for (const section of await measureAppearanceCards(page)) {
        expect(section.stacked, `${section.selector} wrapped at 1x, ${width}px`).toBe(0);
        expect(section.sectionOverflow, `${section.selector} overflows at 1x, ${width}px`).toBe(0);
      }
    }
    await setWindowSize(harness, 1920, 1200);
  });
});
