import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs script without type declarations
import { failedOnlyOnExitCrash as untyped } from "../../scripts/retry-exit-crash.mjs";

const failedOnlyOnExitCrash = untyped as (output: string) => boolean;

const CRASH = "Electron shutdown failed: Error: Electron process exit: 3221225477/null";

describe("retry on Electron's exit crash", () => {
  it("retries when the exit crash is the only reported failure", () => {
    expect(failedOnlyOnExitCrash(`PASS: a\nPASS: b\nFAILURES: ${CRASH}\n`)).toBe(true);
    expect(
      failedOnlyOnExitCrash(
        "  1 failed\n    Error: Electron process exited with 3221225477/null\n",
      ),
    ).toBe(true);
  });

  it("never retries a real failure, alone or next to the crash", () => {
    expect(failedOnlyOnExitCrash("FAILURES: real-full-4p.png[onnx] slot 2\n")).toBe(false);
    expect(failedOnlyOnExitCrash(`FAILURES: real-full-4p.png[onnx] slot 2, ${CRASH}\n`)).toBe(
      false,
    );
    expect(
      failedOnlyOnExitCrash(
        "    Error: expect(received).toBe(expected)\n    Error: Electron process exited with 3221225477/null\n",
      ),
    ).toBe(false);
  });

  it("does not retry a failure it cannot read", () => {
    expect(failedOnlyOnExitCrash("something exploded without a summary\n")).toBe(false);
    expect(failedOnlyOnExitCrash("")).toBe(false);
  });
});
