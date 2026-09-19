import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

import { writeFileAtomicSync } from "./atomicFile";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";
import { getWarframeProcessState } from "./warframeStatus";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("WarframeLifecycle");
const LOGIN_ITEM_NAME = "PlatHelperWarframeWatcher";
const EXIT_GRACE_MS = 10_000;
let enabled = false;
let configured = false;
let seenGame = false;
let absentSince: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let quitApp: (() => void) | null = null;
let queue: Promise<void> = Promise.resolve();

function tick(): void {
  if (!enabled || !quitApp) return;
  const running = getWarframeProcessState();
  if (running === null) {
    absentSince = null;
  } else if (running) {
    seenGame = true;
    absentSince = null;
  } else if (seenGame) {
    absentSince ??= Date.now();
    if (Date.now() - absentSince >= EXIT_GRACE_MS) {
      seenGame = false;
      log.info("Warframe exited; closing PlatHelper");
      quitApp();
    }
  }
}

async function apply(nextEnabled: boolean): Promise<void> {
  if (process.platform !== "win32") {
    if (nextEnabled) throw new Error("Warframe automatic launch is supported on Windows only");
    return;
  }
  if (configured && enabled === nextEnabled) return;
  const configFile = userDataPath("warframe-watcher.json");
  const scriptFile = userDataPath("warframe-watcher.ps1");
  if (!enabled && !nextEnabled && !fs.existsSync(configFile) && !fs.existsSync(scriptFile)) {
    configured = true;
    return;
  }
  const powershell = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptFile,
    "-ConfigPath",
    configFile,
    "-ExpectedExecutable",
    process.execPath,
  ];
  const loginArgs = args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg));
  const register = (value: boolean) => {
    // Isolated app tests must never register themselves in the user's sign-in settings.
    if (process.env.WFHELPER_USER_DATA) return;
    app.setLoginItemSettings({
      name: LOGIN_ITEM_NAME,
      openAtLogin: value,
      path: powershell,
      args: loginArgs,
    });
  };
  const previous = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : null;
  const previousScript = fs.existsSync(scriptFile) ? fs.readFileSync(scriptFile, "utf8") : null;
  try {
    if (nextEnabled) {
      const source = app.isPackaged
        ? path.join(process.resourcesPath, "scripts", "warframe-watcher.ps1")
        : path.join(app.getAppPath(), "scripts", "warframe-watcher.ps1");
      const script = fs.readFileSync(source, "utf8");
      const launch = {
        executable: process.execPath,
        arguments: [...(app.isPackaged ? [] : [`"${app.getAppPath()}"`]), "--warframe-auto-launch"],
        exitGraceMs: EXIT_GRACE_MS,
      };
      const revision = createHash("sha256")
        .update(script)
        .update(JSON.stringify(launch))
        .digest("hex");
      if (!fs.existsSync(scriptFile) || fs.readFileSync(scriptFile, "utf8") !== script) {
        writeFileAtomicSync(scriptFile, script);
      }
      writeFileAtomicSync(
        configFile,
        JSON.stringify({ enabled: true, revision, ...launch, appPid: process.pid }),
      );
    } else {
      writeFileAtomicSync(configFile, JSON.stringify({ enabled: false }));
    }
    register(nextEnabled);
    if (nextEnabled) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(powershell, args, {
          windowsHide: true,
          detached: true,
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    } else {
      fs.rmSync(scriptFile, { force: true });
      fs.rmSync(configFile, { force: true });
    }
    enabled = nextEnabled;
    configured = true;
    seenGame = false;
    absentSince = null;
    tick();
  } catch (error) {
    if (previous !== null) writeFileAtomicSync(configFile, previous);
    else writeFileAtomicSync(configFile, JSON.stringify({ enabled: false }));
    if (previousScript !== null) writeFileAtomicSync(scriptFile, previousScript);
    else fs.rmSync(scriptFile, { force: true });
    register(enabled);
    log.warn("Could not configure automatic launch:", normalizeErrorMessage(error));
    throw error;
  }
}

export function configureWarframeLifecycle(nextEnabled: boolean): Promise<void> {
  const result = queue.then(() => apply(nextEnabled));
  queue = result.catch(() => undefined);
  return result;
}

export function startWarframeLifecycle(quit: () => void): void {
  quitApp = quit;
  if (timer) return;
  timer = setInterval(tick, 2000);
  timer.unref();
}

export function stopWarframeLifecycle(): void {
  if (timer) clearInterval(timer);
  timer = null;
  quitApp = null;
}
