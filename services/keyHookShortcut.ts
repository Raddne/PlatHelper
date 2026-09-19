import path from "node:path";
import { parseAccelerator, type ParsedAccelerator } from "./acceleratorVk";

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

interface Binding {
  handler: () => void;
  parsed: ParsedAccelerator;
}

interface FallbackShortcut {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  unregisterAll?: () => void;
}

interface KeyHookShortcut {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  dispose: () => void;
}

interface HookProcess {
  postMessage: (message: unknown) => void;
  kill: () => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => HookProcess;
}

export function createKeyHookShortcut(options: {
  log: Logger;
  loadFallback?: () => FallbackShortcut;
  spawnHookProcess?: (modulePath: string) => HookProcess;
}): KeyHookShortcut {
  const { log } = options;
  // Lazy: only pull in electron's globalShortcut if the hook actually fails.
  const loadFallback =
    options.loadFallback ??
    (() => (require("electron") as typeof import("electron")).globalShortcut);
  const spawnHookProcess =
    options.spawnHookProcess ??
    ((modulePath: string) => {
      const { utilityProcess } = require("electron") as typeof import("electron");
      return utilityProcess.fork(modulePath, [], {
        serviceName: "PlatHelper Key Hook",
        stdio: "ignore",
      }) as unknown as HookProcess;
    });
  const bindings = new Map<string, Binding>();

  let hookProcess: HookProcess | null = null;
  let hookProcessSpawned = false;
  let fallback: FallbackShortcut | null = null;

  function getFallback(): FallbackShortcut {
    if (!fallback) fallback = loadFallback();
    return fallback;
  }

  function watchPayload(): Array<ParsedAccelerator & { id: string }> {
    return [...bindings.entries()].map(([id, b]) => ({ id, ...b.parsed }));
  }

  function pushWatch(): void {
    if (hookProcess && hookProcessSpawned) {
      hookProcess.postMessage({ type: "setWatch", watch: watchPayload() });
    }
  }

  // Give up on the hook: move existing bindings and route future calls to it.
  function switchToFallback(reason: string): void {
    if (fallback) return; // already fell back
    log.warn("[KeyHook] falling back to globalShortcut:", reason);
    stopHookProcess();
    const gs = getFallback();
    for (const [accelerator, b] of bindings) {
      try {
        gs.register(accelerator, b.handler);
      } catch (err) {
        log.warn("[KeyHook] fallback register failed:", accelerator, String(err));
      }
    }
  }

  function ensureHookProcess(): boolean {
    if (fallback) return false; // committed to fallback for this session
    if (hookProcess) return true;
    try {
      const createdProcess = spawnHookProcess(path.join(__dirname, "keyHookWorker.js"));
      hookProcess = createdProcess;
      hookProcessSpawned = false;
      createdProcess.on("spawn", () => {
        if (hookProcess !== createdProcess) return;
        hookProcessSpawned = true;
        pushWatch();
      });
      createdProcess.on("message", (...args: unknown[]) => {
        const value = args[0];
        const m = value as { type?: string; id?: string; message?: string };
        switch (m?.type) {
          case "hotkey":
            if (m.id) bindings.get(m.id)?.handler();
            break;
          case "ready":
            log.info("[KeyHook] low-level keyboard hook installed");
            break;
          case "error":
            if (hookProcess === createdProcess) switchToFallback(m.message || "process error");
            break;
        }
      });
      createdProcess.on("error", (...args: unknown[]) => {
        if (hookProcess !== createdProcess) return;
        switchToFallback(args.map(String).join(": "));
      });
      createdProcess.on("exit", (...args: unknown[]) => {
        if (hookProcess !== createdProcess) return;
        hookProcess = null;
        hookProcessSpawned = false;
        if (!fallback && bindings.size > 0) {
          switchToFallback(`utility process exited (${Number(args[0])})`);
        }
      });
      return true;
    } catch (err) {
      hookProcess = null;
      hookProcessSpawned = false;
      switchToFallback(String(err));
      return false;
    }
  }

  function stopHookProcess(): void {
    if (!hookProcess) return;
    const child = hookProcess;
    hookProcess = null;
    hookProcessSpawned = false;
    child.kill();
  }

  function register(accelerator: string, callback: () => void): boolean {
    if (fallback) return getFallback().register(accelerator, callback);

    const parsed = parseAccelerator(accelerator);
    if (!parsed) {
      log.warn("[KeyHook] cannot map accelerator, skipping:", accelerator);
      return false;
    }
    if (!ensureHookProcess()) return getFallback().register(accelerator, callback);
    bindings.set(accelerator, { handler: callback, parsed });
    pushWatch();
    return true;
  }

  function unregister(accelerator: string): void {
    if (fallback) {
      getFallback().unregister(accelerator);
      return;
    }
    if (!bindings.delete(accelerator)) return;
    pushWatch();
  }

  function dispose(): void {
    bindings.clear();
    stopHookProcess();
    if (fallback) fallback.unregisterAll?.();
  }

  return { register, unregister, dispose };
}
