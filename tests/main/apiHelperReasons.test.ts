import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp",
    isPackaged: false,
  },
}));

import {
  fileContainsMarker,
  helperFailureReason,
  linuxAuthzReason,
  nextHelperPollDelayMs,
  shouldRetryAfterGameLogin,
  shouldUseWindowsNativeFallback,
} from "../../services/apiHelperRunner";

describe("helperFailureReason", () => {
  it("maps the helper's documented exit codes", () => {
    expect(helperFailureReason(1)).toBe("game-not-running");
    expect(helperFailureReason(2)).toBe("access-denied");
    expect(helperFailureReason(3)).toBe("not-logged-in");
  });

  it("treats unknown codes as generic errors", () => {
    expect(helperFailureReason(0)).toBe("error");
    expect(helperFailureReason(5)).toBe("error");
    expect(helperFailureReason(null)).toBe("error");
  });
});

describe("linuxAuthzReason", () => {
  it("reports a blocked /proc/<pid>/mem as ptrace-denied, never as an elevated game", () => {
    expect(linuxAuthzReason("mem-open-EACCES")).toBe("ptrace-denied");
    expect(linuxAuthzReason("mem-open-EPERM")).toBe("ptrace-denied");
  });

  it("maps a missing process and leaves token misses to EE.log", () => {
    expect(linuxAuthzReason("process-not-found")).toBe("game-not-running");
    expect(linuxAuthzReason("crumbs-not-found")).toBeNull();
    expect(linuxAuthzReason("crumbs-ambiguous")).toBeNull();
  });
});

describe("nextHelperPollDelayMs", () => {
  const INTERVAL = 600_000;

  it("keeps the full cooldown after a successful run", () => {
    expect(nextHelperPollDelayMs(true, null, INTERVAL)).toBe(INTERVAL);
  });

  it("retries fast when the run never reached the API", () => {
    expect(nextHelperPollDelayMs(false, "game-not-running", INTERVAL)).toBe(90_000);
    expect(nextHelperPollDelayMs(false, "access-denied", INTERVAL)).toBe(90_000);
    expect(nextHelperPollDelayMs(false, "ptrace-denied", INTERVAL)).toBe(90_000);
    expect(nextHelperPollDelayMs(false, "not-logged-in", INTERVAL)).toBe(90_000);
  });

  it("keeps the cooldown for failures that did touch the API", () => {
    expect(nextHelperPollDelayMs(false, "api-failed", INTERVAL)).toBe(INTERVAL);
    expect(nextHelperPollDelayMs(false, "error", INTERVAL)).toBe(INTERVAL);
    expect(nextHelperPollDelayMs(false, null, INTERVAL)).toBe(INTERVAL);
  });

  it("keeps the cooldown for the persistent token-not-found state", () => {
    expect(nextHelperPollDelayMs(false, "token-not-found", INTERVAL)).toBe(INTERVAL);
  });

  it("never retries slower than the configured interval", () => {
    expect(nextHelperPollDelayMs(false, "not-logged-in", 30_000)).toBe(30_000);
  });
});

describe("shouldRetryAfterGameLogin", () => {
  it("retries only failures that a completed login can resolve", () => {
    expect(shouldRetryAfterGameLogin(false, null, null)).toBe(true);
    expect(shouldRetryAfterGameLogin(false, false, "game-not-running")).toBe(true);
    expect(shouldRetryAfterGameLogin(false, false, "not-logged-in")).toBe(true);
    expect(shouldRetryAfterGameLogin(false, false, "token-not-found")).toBe(true);
    expect(shouldRetryAfterGameLogin(false, false, "api-failed")).toBe(false);
    expect(shouldRetryAfterGameLogin(false, false, "access-denied")).toBe(false);
    expect(shouldRetryAfterGameLogin(false, false, "ptrace-denied")).toBe(false);
    expect(shouldRetryAfterGameLogin(false, true, null)).toBe(false);
  });

  it("queues behind an in-flight poll and rechecks its result", () => {
    expect(shouldRetryAfterGameLogin(true, true, null)).toBe(true);
    expect(shouldRetryAfterGameLogin(false, true, null)).toBe(false);
  });
});

describe("shouldUseWindowsNativeFallback", () => {
  it("uses the compatibility scan when the helper is absent or misses a logged-in token", () => {
    expect(shouldUseWindowsNativeFallback(false, null)).toBe(true);
    expect(shouldUseWindowsNativeFallback(true, "token-not-found")).toBe(true);
    expect(shouldUseWindowsNativeFallback(true, "error")).toBe(true);
  });

  it("does not duplicate API or non-recoverable helper attempts", () => {
    expect(shouldUseWindowsNativeFallback(true, "api-failed")).toBe(false);
    expect(shouldUseWindowsNativeFallback(true, "access-denied")).toBe(false);
    expect(shouldUseWindowsNativeFallback(true, "game-not-running")).toBe(false);
    expect(shouldUseWindowsNativeFallback(true, "not-logged-in")).toBe(false);
  });
});

describe("fileContainsMarker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-eelog-"));
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string): string => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  };

  it("finds the login marker", async () => {
    const p = write("login.log", "boot\nSys [Info]: Logging in as GKAlbe\nmore\n");
    expect(await fileContainsMarker(p, "Logging in as ")).toBe(true);
  });

  it("returns false when the marker is absent", async () => {
    const p = write("nologin.log", "boot\nstill at the login screen\n");
    expect(await fileContainsMarker(p, "Logging in as ")).toBe(false);
  });

  it("returns false for a missing file", async () => {
    expect(await fileContainsMarker(path.join(dir, "nope.log"), "x")).toBe(false);
  });

  it("finds a marker that straddles a chunk boundary", async () => {
    const p = write("boundary.log", "abcdeMARKERfghij");
    expect(await fileContainsMarker(p, "MARKER", 8)).toBe(true);
  });
});
