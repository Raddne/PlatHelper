import { execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

import { mainWindow } from "./mainWindow";
import { collectElectronArtifacts } from "./electronArtifacts";

interface ElectronTestHarnessOptions {
  entryPoint?: string;
  onApp?: (app: ElectronApplication) => void | Promise<void>;
  storage?: Record<string, string>;
  inventory?: unknown;
  onPage?: (page: Page) => void | Promise<void>;
  lang?: string;
  /** Leave app-language unset so detectLocale() falls through to the OS locale. */
  skipLanguageSeed?: boolean;
  userDataFiles?: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface ElectronTestHarness {
  app: ElectronApplication;
  page: Page;
  sandboxDir: string;
  helperDir: string;
}

const harnessState = new WeakMap<
  ElectronTestHarness,
  {
    options: ElectronTestHarnessOptions;
    saveArtifacts: (failed?: boolean, failure?: unknown) => Promise<void>;
  }
>();
const harnessProcesses = new WeakMap<ElectronApplication, ChildProcess>();

export async function launchElectronTestHarness(
  prefix: string,
  options: ElectronTestHarnessOptions = {},
): Promise<ElectronTestHarness> {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const localAppData = path.join(sandboxDir, "local");
  const userData = path.join(sandboxDir, "user-data");
  const helperDir = path.join(userData, "api-helper");
  fs.mkdirSync(localAppData, { recursive: true });
  fs.mkdirSync(helperDir, { recursive: true });
  fs.writeFileSync(
    path.join(helperDir, "inventory.json"),
    JSON.stringify(options.inventory ?? { Suits: [] }),
  );
  for (const [name, contents] of Object.entries(options.userDataFiles ?? {})) {
    fs.writeFileSync(path.join(userData, name), JSON.stringify(contents));
  }

  return startHarness(sandboxDir, options, true);
}

async function startHarness(
  sandboxDir: string,
  options: ElectronTestHarnessOptions,
  seedStorage: boolean,
): Promise<ElectronTestHarness> {
  const localAppData = path.join(sandboxDir, "local");
  const userData = path.join(sandboxDir, "user-data");
  const helperDir = path.join(userData, "api-helper");

  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.WFHELPER_DISABLE_KEYBOARD_HOOK = "1";
  env.LOCALAPPDATA = localAppData;
  env.WFHELPER_EE_LOG = path.join(localAppData, "Warframe", "EE.log");
  env.APPDATA = path.join(sandboxDir, "roaming");
  env.WFHELPER_USER_DATA = userData;
  Object.assign(env, options.env ?? {});

  let app: ElectronApplication | null = null;
  let saveArtifacts: ((failed?: boolean, failure?: unknown) => Promise<void>) | undefined;
  try {
    app = await electron.launch({
      args: ["--no-sandbox", `--lang=${options.lang ?? "en-US"}`, options.entryPoint ?? "."],
      env,
    });
    harnessProcesses.set(app, app.process());
    saveArtifacts = await collectElectronArtifacts(app, sandboxDir);
    await options.onApp?.(app);
    const page = await mainWindow(app);
    await options.onPage?.(page);
    await expect(page.locator("#app")).toBeVisible({ timeout: 90_000 });
    if (seedStorage)
      await page.evaluate(
        (storage) => {
          for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        },
        {
          "setup-completed-v2": "1",
          "feature-tour-done": "1",
          ...(options.skipLanguageSeed ? {} : { "app-language": "en" }),
          ...options.storage,
        },
      );
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });

    const harness = { app, page, sandboxDir, helperDir };
    harnessState.set(harness, { options, saveArtifacts });
    return harness;
  } catch (error) {
    saveArtifacts ??= await collectElectronArtifacts(app, sandboxDir);
    await saveArtifacts(true, error).catch((artifactError: unknown) =>
      console.warn("[harness] artifacts:", artifactError),
    );
    try {
      if (app) await stopElectron(app);
    } catch {
      // already gone
    }
    await saveArtifacts(true).catch((artifactError: unknown) =>
      console.warn("[harness] artifacts:", artifactError),
    );
    removeSandbox(sandboxDir);
    throw error;
  }
}

export async function restartElectronTestHarness(
  harness: ElectronTestHarness,
  options: Pick<ElectronTestHarnessOptions, "onPage" | "onApp"> = {},
): Promise<ElectronTestHarness> {
  const state = harnessState.get(harness);
  if (!state) throw new Error("Cannot restart an unknown Electron harness");
  await state.saveArtifacts();
  try {
    await stopElectron(harness.app);
  } finally {
    await state.saveArtifacts();
  }
  harnessState.delete(harness);
  return startHarness(harness.sandboxDir, { ...state.options, ...options }, false);
}

/** Viewport in CSS pixels. setViewportSize takes device pixels and the app
 * divides by the uiScale zoom, so the request is re-applied scaled. */
export async function setLayoutViewport(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  // After a reload the zoom can land a frame late, so a single probe would read
  // device pixels and skip the rescale. Settle on a width that repeats.
  let previous = NaN;
  let applied = await page.evaluate(() => window.innerWidth);
  for (let attempt = 0; attempt < 6 && applied !== previous; attempt += 1) {
    await page.waitForTimeout(75);
    previous = applied;
    applied = await page.evaluate(() => window.innerWidth);
  }
  if (applied !== previous || !applied) {
    throw new Error(`viewport width never settled (${previous} -> ${applied})`);
  }
  const zoom = width / applied;
  if (Math.abs(zoom - 1) < 0.01) return;
  await page.setViewportSize({
    width: Math.round(width * zoom),
    height: Math.round(height * zoom),
  });
  await page.waitForTimeout(75);
  const landed = await page.evaluate(() => window.innerWidth);
  if (Math.abs(landed - width) > Math.max(1, width * 0.01)) {
    throw new Error(`viewport landed at ${landed} CSS px, wanted ${width}`);
  }
}

export function selectOptionValues(select: Locator): Promise<string[]> {
  return select.evaluate((element) =>
    Array.from((element as HTMLSelectElement).options, (option) => option.value),
  );
}

/** Content size on the BrowserWindow itself: a Playwright viewport does not
 *  resize an Electron window. Throws when the window did not land there. */
export async function setWindowSize(
  harness: ElectronTestHarness,
  width: number,
  height: number,
): Promise<void> {
  const zoomFactor = await evaluateInMain(
    harness.app,
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes("renderer/dist/index.html"),
      );
      if (!win) throw new Error("main window not found");
      win.setContentSize(size.width, size.height);
      return win.webContents.getZoomFactor();
    },
    { width, height },
  );
  await harness.page.waitForTimeout(400);
  const landed = await harness.page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  // setContentSize takes device-independent px, the renderer reports CSS px, and
  // the display-derived UI zoom (config/runtime/uiScale.ts) divides the two.
  const zoom = zoomFactor > 0 ? zoomFactor : 1;
  const expected = { width: width / zoom, height: height / zoom };
  if (
    Math.abs(landed.width - expected.width) > 2 ||
    Math.abs(landed.height - expected.height) > 2
  ) {
    throw new Error(
      `window landed at ${landed.width}x${landed.height} css px, wanted ` +
        `${Math.round(expected.width)}x${Math.round(expected.height)} ` +
        `(${width}x${height} at zoom ${zoom})`,
    );
  }
}

/** Settings > Appearance > Font Sizes > Global Scale, applied through a reload;
 *  null clears the stored theme so the default scale comes back. */
export async function setFontScale(page: Page, scale: number | null): Promise<void> {
  await page.evaluate((value) => {
    if (value === null) localStorage.removeItem("wf_theme_settings");
    else
      localStorage.setItem(
        "wf_theme_settings",
        JSON.stringify({ version: 1, fontSizes: { globalScale: value } }),
      );
  }, scale);
  await page.reload();
  await page.waitForSelector("#sidebar", { state: "visible", timeout: 90_000 });
}

/** Sidebar labels are translated, so navigate by data-view. */
export async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`#sidebar [data-view="${view}"]`).click();
  await page.waitForTimeout(300);
}

export async function setDisplayLanguage(page: Page, code: string): Promise<void> {
  await page.locator('#sidebar [data-view="settings"]').click();
  await page.locator('[data-setting="language"] select').selectOption(code);
}

export async function overlayWindow(
  harness: ElectronTestHarness,
  match: string,
  reject?: string,
): Promise<Page> {
  const attempts = 60;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const win of harness.app.windows()) {
      const url = win.url();
      if (url.includes(match) && (!reject || !url.includes(reject))) return win;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`overlay window ${match} never appeared`);
}

/**
 * Playwright loses the main-process context while Electron is still opening
 * windows, surfacing as "Execution context was destroyed". Retry only that.
 */
export async function evaluateInMain<R, A>(
  app: ElectronApplication,
  fn: (electron: typeof import("electron"), arg: A) => R | Promise<R>,
  arg?: A,
): Promise<R> {
  let lastError: unknown;
  // Ten tries over five seconds: a loaded CI runner can spend that long between
  // the first window and a stable main context.
  const attempts = 10;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return (await app.evaluate(fn as never, arg as never)) as R;
    } catch (err) {
      if (!/Execution context was destroyed/i.test(String(err))) throw err;
      lastError = err;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

export function writeHarnessInventory(harness: ElectronTestHarness, inventory: unknown): void {
  fs.writeFileSync(path.join(harness.helperDir, "inventory.json"), JSON.stringify(inventory));
}

export async function closeElectronTestHarness(
  harness: ElectronTestHarness | undefined,
): Promise<void> {
  if (!harness) return;
  try {
    await harnessState
      .get(harness)
      ?.saveArtifacts()
      .catch((error: unknown) => console.warn("[harness] artifacts:", error));
    await stopElectron(harness.app);
  } catch (error) {
    await harnessState.get(harness)?.saveArtifacts(true, error);
    throw error;
  } finally {
    await harnessState
      .get(harness)
      ?.saveArtifacts()
      .catch((error: unknown) => console.warn("[harness] artifacts:", error));
    harnessState.delete(harness);
    removeSandbox(harness.sandboxDir);
  }
}

export async function stopElectron(app: ElectronApplication): Promise<void> {
  const child = harnessProcesses.get(app) ?? app.process();
  if (child.exitCode !== null || child.signalCode) {
    if (child.exitCode !== 0 || child.signalCode)
      throw new Error(`Electron process exited with ${child.exitCode}/${child.signalCode}`);
    return;
  }
  const closed = app.close().then(
    () => true,
    () => false,
  );
  if (!(await Promise.race([closed, delay(15_000)]))) {
    forceKillElectronTree(child.pid);
    await Promise.race([closed, delay(5_000)]);
    throw new Error("Electron did not close cleanly; its process tree was terminated");
  }
  if (child.exitCode !== 0 || child.signalCode) {
    throw new Error(`Electron process exited with ${child.exitCode}/${child.signalCode}`);
  }
}

// Node's kill only hits the main process; a surviving GPU or network service
// child keeps cache files locked and fails the sandbox delete with EBUSY.
function forceKillElectronTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // Already gone.
  }
}

function removeSandbox(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (error) {
    console.warn(`[harness] sandbox cleanup left ${dir}: ${String(error)}`);
  }
}

function delay(ms: number): Promise<false> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(false), ms).unref();
  });
}
