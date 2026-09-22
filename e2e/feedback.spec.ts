import { expect, test } from "@playwright/test";

import type { FeedbackReport } from "../config/shared/feedback";
import { FEEDBACK_SUBMIT } from "../config/shared/ipcChannels";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

test("feedback previews optional data and preserves a failed draft without duplicate sends", async () => {
  const testInfo = test.info();
  let harness: ElectronTestHarness | undefined;
  const pageErrors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-feedback-", {
      onPage: (page) => {
        page.on("pageerror", (error) => pageErrors.push(error.message));
      },
    });
    const { app, page } = harness;
    await setLayoutViewport(page, 1280, 1000);
    await evaluateInMain(
      app,
      ({ ipcMain }, channel) => {
        const scope = globalThis as unknown as {
          feedbackTestReports: unknown[];
          feedbackTestRelease?: () => void;
        };
        scope.feedbackTestReports = [];
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (_event, report: unknown) => {
          scope.feedbackTestReports.push(report);
          if (scope.feedbackTestReports.length === 1) return { ok: false, error: "unavailable" };
          await new Promise<void>((resolve) => {
            scope.feedbackTestRelease = resolve;
          });
          return { ok: true };
        });
      },
      FEEDBACK_SUBMIT,
    );

    const open = page.locator("#sidebar [data-feedback-open]");
    await expect(open).toBeVisible();
    const buttonBounds = await open.boundingBox();
    const sidebarBounds = await page.locator("#sidebar").boundingBox();
    expect(buttonBounds!.y).toBeGreaterThan(sidebarBounds!.y + sidebarBounds!.height * 0.75);
    await open.click();
    const modal = page.locator("[data-feedback-modal]");
    await expect(modal).toBeVisible();
    await expect(page.locator("[data-feedback-metadata]")).toBeVisible();
    await expect(page.locator("[data-feedback-kind]")).toHaveValue("bug");
    await expect(page.locator("[data-feedback-diagnostics]")).not.toBeChecked();
    await expect(page.locator("[data-feedback-diagnostics-preview]")).toHaveCount(0);
    await expect(page.locator("[data-feedback-send]")).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("feedback-default.png") });

    await page.locator("[data-feedback-title]").fill("Reward preview test");
    await page
      .locator("[data-feedback-description]")
      .fill("The reward preview is missing a field.");
    await page.locator("[data-feedback-send]").click();
    await expect(page.locator("[data-feedback-error]")).toBeVisible();
    await expect(page.locator("[data-feedback-title]")).toHaveValue("Reward preview test");
    await expect(page.locator("[data-feedback-description]")).toHaveValue(
      "The reward preview is missing a field.",
    );
    const firstReports = await evaluateInMain(
      app,
      () =>
        (globalThis as unknown as { feedbackTestReports: FeedbackReport[] }).feedbackTestReports,
    );
    expect(firstReports).toHaveLength(1);
    expect(firstReports[0]).toMatchObject({ kind: "bug", title: "Reward preview test" });
    expect(firstReports[0]!.appVersion).toBeTruthy();
    expect(firstReports[0]).not.toHaveProperty("contact");
    expect(firstReports[0]).not.toHaveProperty("diagnostics");
    expect(firstReports[0]).not.toHaveProperty("screenshot");
    await page.screenshot({ path: testInfo.outputPath("feedback-failed-draft.png") });

    await page.locator("[data-feedback-kind]").selectOption("feature");
    await page.locator("[data-feedback-contact]").fill("test-discord-handle");
    await page.locator("[data-feedback-diagnostics]").check();
    await expect(page.locator("[data-feedback-diagnostics-preview]")).toBeVisible();
    const file = page.locator("[data-feedback-screenshot]");
    await file.setInputFiles({
      name: "invalid.png",
      mimeType: "image/png",
      buffer: Buffer.from("invalid image"),
    });
    await expect(page.locator("[data-feedback-screenshot-error]")).toBeVisible();
    await expect(page.locator("[data-feedback-screenshot-preview]")).toHaveCount(0);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
    await file.setInputFiles({
      name: "preview.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from(png, "base64"), Buffer.from("private-file-metadata")]),
    });
    await expect(page.locator("[data-feedback-screenshot-preview]")).toBeVisible();
    await expect(page.locator("[data-feedback-screenshot-error]")).toHaveCount(0);
    await page.locator("[data-feedback-screenshot-remove]").click();
    await expect(page.locator("[data-feedback-screenshot-preview]")).toHaveCount(0);
    await file.setInputFiles({
      name: "preview.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from(png, "base64"), Buffer.from("private-file-metadata")]),
    });
    await expect(page.locator("[data-feedback-screenshot-preview]")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("feedback-reviewed.png") });

    await page.locator("[data-feedback-send]").click();
    await expect(page.locator("[data-feedback-send]")).toBeDisabled();
    await expect(page.locator("[data-feedback-close]")).toBeDisabled();
    await expect(page.locator("[data-feedback-title]")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();
    await page
      .locator("[data-feedback-form]")
      .evaluate((form) =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    await expect
      .poll(() =>
        evaluateInMain(
          app,
          () =>
            (globalThis as unknown as { feedbackTestReports: unknown[] }).feedbackTestReports
              .length,
        ),
      )
      .toBe(2);
    const reports = await evaluateInMain(
      app,
      () =>
        (globalThis as unknown as { feedbackTestReports: FeedbackReport[] }).feedbackTestReports,
    );
    expect(reports[1]).toMatchObject({
      kind: "feature",
      contact: "test-discord-handle",
      diagnostics: { locale: "en", view: expect.any(String), uiScale: expect.any(Number) },
      screenshot: { mediaType: "image/png", data: expect.any(String) },
    });
    expect(
      Buffer.from(reports[1]!.screenshot!.data, "base64").includes("private-file-metadata"),
    ).toBe(false);
    expect(reports[1]!.screenshot).not.toHaveProperty("name");
    expect(reports[1]!.screenshot).not.toHaveProperty("path");
    await evaluateInMain(app, () => {
      (globalThis as unknown as { feedbackTestRelease: () => void }).feedbackTestRelease();
    });
    await expect(page.locator("[data-feedback-success]")).toBeVisible();
    await expect(page.locator("[data-feedback-send]")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("feedback-success.png") });
    await page.locator("[data-feedback-close]").click();
    await expect(modal).toHaveCount(0);
    await open.click();
    await expect(page.locator("[data-feedback-title]")).toHaveValue("");
    await expect(page.locator("[data-feedback-diagnostics]")).not.toBeChecked();
    await expect(page.locator("[data-feedback-screenshot-preview]")).toHaveCount(0);
    await page.locator("[data-feedback-cancel]").click();
    expect(pageErrors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
