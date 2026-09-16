import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "electron";

import { writeFileAtomicSync } from "./atomicFile";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";
import { getWarframeProcessState } from "./warframeStatus";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("WarframeLifecycle");
const LOGIN_ITEM_NAME = "WFHelperWarframeWatcher";
const LEGACY_TASK_NAME = "WFHelperWarframeWatcher";
const TASK_FOLDER = "WFHelper";
const EXIT_GRACE_MS = 10_000;

function systemRoot(): string {
  return process.env.SystemRoot || "C:\\Windows";
}

function runSchtasks(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync(path.join(systemRoot(), "System32", "schtasks.exe"), args, {
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.error) return { ok: false, output: normalizeErrorMessage(result.error) };
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""} ${result.stderr ?? ""}`.trim(),
  };
}

/** schtasks error text is localized, so absence is probed instead of matched. */
function removeTask(name: string): void {
  if (!runSchtasks(["/Query", "/TN", name]).ok) return;
  const removed = runSchtasks(["/Delete", "/TN", name, "/F"]);
  if (!removed.ok) {
    log.warn(`Could not remove the sign-in task ${name}:`, removed.output || "unknown error");
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** schtasks rejects a UTF-8 task file outright ("encoding cannot be changed"). */
function encodeTaskXml(xml: string): Uint8Array {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
}

function accountName(): string {
  return process.env.USERNAME || os.userInfo().username;
}

function taskUserId(): string {
  const domain = process.env.USERDOMAIN || process.env.COMPUTERNAME || "";
  return domain ? `${domain}\\${accountName()}` : accountName();
}

/** The task is per-account: its trigger, principal and userData paths are. The
 *  uninstaller rebuilds this name from %USERNAME%. */
function watcherTaskName(): string {
  return `${TASK_FOLDER}\\WarframeWatcher-${accountName()}`;
}

/** conhost --headless allocates no console; powershell.exe alone paints one until
 *  -WindowStyle Hidden applies, and Windows Terminal ignores that switch entirely. */
function watcherTaskXml(powershell: string, watcherArgs: string[]): string {
  const user = escapeXml(taskUserId());
  const command = escapeXml(path.join(systemRoot(), "System32", "conhost.exe"));
  const quoted = watcherArgs.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg));
  const taskArgs = escapeXml(["--headless", `"${powershell}"`, ...quoted].join(" "));
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>WFHelper</Author>
    <Description>Starts WFHelper when Warframe launches and closes it after Warframe exits. Remove this task to turn the feature off.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>${command}</Command><Arguments>${taskArgs}</Arguments></Exec>
  </Actions>
</Task>`;
}

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
      log.info("Warframe exited; closing WFHelper");
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
  const taskFile = userDataPath("warframe-watcher-task.xml");
  const register = (value: boolean) => {
    if (process.env.WFHELPER_USER_DATA) return;
    app.setLoginItemSettings({ name: LOGIN_ITEM_NAME, openAtLogin: false });
    removeTask(LEGACY_TASK_NAME);
    const name = watcherTaskName();
    if (!value) {
      removeTask(name);
      fs.rmSync(taskFile, { force: true });
      return;
    }
    writeFileAtomicSync(taskFile, encodeTaskXml(watcherTaskXml(powershell, args)));
    const created = runSchtasks(["/Create", "/TN", name, "/XML", taskFile, "/F"]);
    if (!created.ok) {
      throw new Error(`Windows refused the sign-in task: ${created.output || "unknown error"}`);
    }
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
