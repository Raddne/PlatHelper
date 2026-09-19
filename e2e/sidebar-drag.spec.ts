import { test, expect, type Locator, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test.describe("sidebar drag and drop", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-sidebar-drag-e2e-");
    page = harness.page;
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  const row = (view: string): Locator => page.locator(`#sidebar [data-sidebar-row="view:${view}"]`);

  const order = (): Promise<string[]> =>
    page
      .locator("#sidebar [data-sidebar-row]")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.sidebarRow ?? ""));

  /** Presses on `from`, moves in small steps to a height inside `to`, and stops there. */
  async function dragTo(from: Locator, to: Locator, relativeY: number): Promise<void> {
    // Let the previous drop's reflow animation settle before measuring rows.
    await page.waitForTimeout(350);
    await from.scrollIntoViewIfNeeded();
    const start = await from.boundingBox();
    if (!start) throw new Error("drag source not visible");
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    const end = await to.boundingBox();
    if (!end) throw new Error("drag target not visible");
    // Off to the side on purpose: only the pointer's height may pick the target.
    await page.mouse.move(end.x + end.width * 0.8, end.y + end.height * relativeY, { steps: 12 });
  }

  test("nothing moves while dragging; the line marks the slot and release applies it once", async () => {
    const before = await order();
    const marketIndex = before.indexOf("view:market");
    const foundryIndex = before.indexOf("view:foundry");
    expect(marketIndex).toBeGreaterThan(foundryIndex);

    await dragTo(row("market"), row("foundry"), 0.1);
    await expect(page.locator("[data-sidebar-drop-line]")).toBeVisible();
    expect(await order()).toEqual(before);

    await page.mouse.up();
    await expect(page.locator("[data-sidebar-drop-line]")).toHaveCount(0);
    // The reflow is animated, from rest, in the same frame the order changes.
    const animating = await page.evaluate(
      () => document.querySelector("#sidebar")?.getAnimations({ subtree: true }).length ?? 0,
    );
    expect(animating).toBeGreaterThan(0);

    const after = await order();
    expect(after.indexOf("view:market")).toBe(after.indexOf("view:foundry") - 1);
    expect(page.locator("#sidebar [data-view='market']")).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a drop where the row already sits changes nothing and shows no line", async () => {
    const before = await order();
    await dragTo(row("market"), row("foundry"), 0.05);
    await expect(page.locator("[data-sidebar-drop-line]")).toHaveCount(0);
    await page.mouse.up();
    expect(await order()).toEqual(before);
  });

  test("Escape cancels a drag", async () => {
    const before = await order();
    await dragTo(row("market"), row("stats"), 0.9);
    await expect(page.locator("[data-sidebar-drop-line]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-sidebar-drop-line]")).toHaveCount(0);
    await page.mouse.up();
    expect(await order()).toEqual(before);
  });

  test("a plain click still navigates", async () => {
    await row("stats").click();
    await expect(page.locator("#sidebar [data-view='stats']")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("dropping on the middle of a row founds a group; a member can be pulled back out", async () => {
    await dragTo(row("mastery"), row("stats"), 0.5);
    await expect(row("stats")).toHaveClass(/nav-btn-armed/);
    await expect(page.locator("[data-sidebar-drop-line]")).toHaveCount(0);
    await page.mouse.up();

    const header = page.locator("#sidebar [data-sidebar-row-group]");
    await expect(header).toHaveCount(1);
    // Typing a name (spaces included) and confirming must not fold the group.
    await page.keyboard.type("My group");
    await page.keyboard.press("Enter");
    await expect(header).toContainText("My group");
    let rows = await order();
    const headerIndex = rows.findIndex((key) => key.startsWith("group:"));
    expect(rows.slice(headerIndex + 1, headerIndex + 3)).toEqual(["view:stats", "view:mastery"]);

    // Onto the top edge of a plain row below the group: leaves the group.
    await dragTo(row("mastery"), row("world"), 0.1);
    await expect(page.locator("[data-sidebar-drop-line]")).toBeVisible();
    await page.mouse.up();
    rows = await order();
    expect(rows.indexOf("view:mastery")).toBe(rows.indexOf("view:world") - 1);
    expect(rows[rows.indexOf("view:mastery") - 1]).toBe("view:stats");
  });

  test("a group header drags its whole block", async () => {
    // The group dissolved when its second member left, so found it again.
    await expect(page.locator("#sidebar [data-sidebar-row-group]")).toHaveCount(0);
    await dragTo(row("mastery"), row("stats"), 0.5);
    await page.mouse.up();
    const header = page.locator("#sidebar [data-sidebar-row-group]");
    await expect(header).toHaveCount(1);
    await page.keyboard.press("Enter");

    // A target away from the list's visible end, where the list would auto-scroll under the pointer.
    await dragTo(header, row("world"), 0.9);
    await expect(page.locator("[data-sidebar-drop-line]")).toBeVisible();
    await page.mouse.up();
    const rows = await order();
    const wiki = rows.indexOf("view:world");
    expect(rows[wiki + 1]?.startsWith("group:")).toBe(true);
    expect(rows.slice(wiki + 2, wiki + 4)).toEqual(["view:stats", "view:mastery"]);
  });
});
