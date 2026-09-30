import { expect, test, type Locator, type Page } from "@playwright/test";

import type { PersonalProfile } from "../config/shared/personalProfile";
import { STAT_RESOURCES } from "../config/shared/statsTypes";
import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

// Stats turns the page scroll off, so each tab has to scroll inside its own
// boxes. A trade rail taller than the window must scroll too, not be clipped.
const TRADE_ROWS = 120;

function dayKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function history() {
  return {
    schemaVersion: 2,
    entries: Array.from({ length: 60 }, (_, index) => ({
      date: dayKey(60 - index),
      platDelta: (index % 7) - 3,
      creditsDelta: 0,
      endoDelta: 0,
      ducatsDelta: index % 5,
      ayaDelta: 0,
      vitusDelta: 0,
      relicsOpened: index % 4,
      daysPlayed: 1,
      dailyTrades: index % 3,
      absPlat: 1000 + index,
    })),
  };
}

function trades(): unknown[] {
  const now = Date.now();
  return Array.from({ length: TRADE_ROWS }, (_, index) => ({
    id: `scroll-${index}`,
    date: new Date(now - index * 3_600_000).toISOString(),
    type: "sale",
    platChange: 10 + index,
    partner: `Partner${index}`,
    items: [
      {
        internalName: "/Lotus/Fixture",
        displayName: `Fixture ${index}`,
        count: 1,
        direction: "given",
      },
    ],
  }));
}

const account = "c".repeat(24);
const profile: PersonalProfile = {
  displayName: "Scroll Fixture",
  masteryRank: 20,
  registeredAt: 1700000000000,
  career: { TimePlayedSec: 36000, Income: 1000, MissionsCompleted: 100, ReviveCount: 3 },
  equipment: Array.from({ length: 50 }, (_, index) => ({
    type: `/Fixture/Equipment/ScrollWeapon${String(index).padStart(2, "0")}`,
    equipTime: index * 3600,
    kills: index,
  })),
  enemies: [],
  abilities: null,
  missions: [],
  appearance: [],
};

/** Wheels over the visible middle of `over` until `scroller` stops moving;
 *  returns the distance it travelled. */
async function wheelUntilStill(page: Page, over: Locator, scroller: Locator): Promise<number> {
  const box = await over.boundingBox();
  const viewport = await page.evaluate(() => ({ height: window.innerHeight }));
  if (!box) throw new Error("wheel target has no box");
  const top = Math.max(0, box.y);
  const bottom = Math.min(viewport.height, box.y + box.height);
  if (bottom <= top) throw new Error("wheel target is outside the window");
  await page.mouse.move(box.x + box.width / 2, top + (bottom - top) / 2);
  const start = await scroller.evaluate((el) => el.scrollTop);
  let previous = -1;
  let current = start;
  for (let step = 0; step < 60 && current !== previous; step += 1) {
    previous = current;
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    current = await scroller.evaluate((el) => el.scrollTop);
  }
  return current - start;
}

/** The element sits fully inside its scroller and inside the window. */
async function fullyShown(scroller: Locator, target: Locator): Promise<boolean> {
  return scroller.evaluate(
    (box, el) => {
      const outer = box.getBoundingClientRect();
      const inner = (el as Element).getBoundingClientRect();
      return (
        inner.height > 0 &&
        inner.top >= outer.top - 1 &&
        inner.bottom <= outer.bottom + 1 &&
        inner.bottom <= window.innerHeight + 1
      );
    },
    await target.elementHandle(),
  );
}

test.describe("Stats scrolling", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-stats-scroll-", {
      userDataFiles: {
        "stats-history.json": history(),
        "trade-log.json": trades(),
        "codex-profile.json": { accountId: account },
        "personal-profile.json": { accountId: account, fetchedAt: Date.now(), profile },
      },
      storage: {
        wf_stats_chart_resources: JSON.stringify(STAT_RESOURCES.slice(0, 10).map((r) => r.id)),
      },
    });
    await setLayoutViewport(harness.page, 1024, 640);
    await openView(harness.page, "stats");
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("the Tracking charts and the trade rail scroll with the wheel", async () => {
    const page = harness!.page;
    await page.locator('[data-stats-header] [data-tour-tab="tracking"]').click();
    const charts = page.locator("[data-stats-tracking] > .\\@container");
    await expect(page.locator("[data-stats-chart]").first()).toBeVisible({ timeout: 30_000 });

    const lastChart = page.locator("[data-stats-expand]").last();
    expect(await fullyShown(charts, lastChart)).toBe(false);
    const chartTravel = await wheelUntilStill(page, charts, charts);
    expect(chartTravel).toBeGreaterThan(0);
    expect(await fullyShown(charts, lastChart)).toBe(true);

    const list = page.locator("[data-stats-trade-list]");
    await expect(list.locator("[data-trade-row]")).toHaveCount(TRADE_ROWS);
    const lastTrade = list.locator(`[data-trade-row="scroll-${TRADE_ROWS - 1}"]`);
    expect(await fullyShown(list, lastTrade)).toBe(false);
    const tradeTravel = await wheelUntilStill(page, list, list);
    expect(tradeTravel).toBeGreaterThan(0);
    expect(await fullyShown(list, lastTrade)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("stats-scroll-tracking.png") });
  });

  test("the Personal tab scrolls with the wheel to its last row", async () => {
    const page = harness!.page;
    await page.locator('[data-stats-header] [data-tour-tab="personal"]').click();
    const panel = page.locator("[data-personal-profile]");
    await expect(panel.locator("[data-profile-name]")).toHaveText(profile.displayName!);
    await panel.locator('[data-profile-section="equipment"]').click();
    await expect(panel.locator("[data-profile-row]")).toHaveCount(50);

    const pager = panel.locator("[data-profile-next]");
    expect(await fullyShown(panel, pager)).toBe(false);
    const travel = await wheelUntilStill(page, panel, panel);
    expect(travel).toBeGreaterThan(0);
    expect(await fullyShown(panel, pager)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("stats-scroll-personal.png") });
  });
});
