import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  signal: AbortSignal | null | undefined;
  settle: (text: string) => void;
  fail: (err: Error) => void;
  promise: Promise<{ text: string; confidence: number }>;
}

const probe = vi.hoisted(() => ({ calls: [] as Call[] }));

const recognize = (
  _input: Buffer | string,
  _accuracy?: number | null,
  _langs?: string[] | null,
  signal?: AbortSignal | null,
) => {
  let settle!: (text: string) => void;
  let fail!: (err: Error) => void;
  const promise = new Promise<{ text: string; confidence: number }>((resolve, reject) => {
    settle = (text) => resolve({ text, confidence: 1 });
    fail = reject;
  });
  probe.calls.push({ signal, settle, fail, promise });
  return promise;
};

async function load() {
  vi.resetModules();
  probe.calls = [];
  const mod = await import("../../services/ocrServer");
  mod.setNativeRecognizeForTest(recognize);
  return mod;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("native OCR lifetime", () => {
  it("hands the addon a signal it can cancel on", async () => {
    const ocr = await load();

    const run = ocr.nativeOcrBuffer(Buffer.from("x"), 1000);
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(probe.calls[0].signal?.aborted).toBe(false);

    probe.calls[0].settle("hello");
    await expect(run).resolves.toBe("hello");
  });

  it("aborts the native task when the deadline passes instead of abandoning it", async () => {
    const ocr = await load();

    const run = ocr.nativeOcrBuffer(Buffer.from("x"), 500);
    const settled = expect(run).rejects.toThrow(/timeout after 500ms/);

    await vi.advanceTimersByTimeAsync(500);
    expect(probe.calls[0].signal?.aborted).toBe(true);

    probe.calls[0].fail(new Error("aborted"));
    await settled;
  });

  it("does not leave a rejected abandoned task unhandled", async () => {
    const ocr = await load();

    const run = ocr.nativeOcrBuffer(Buffer.from("x"), 500);
    const settled = expect(run).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(500);

    probe.calls[0].fail(new Error("addon exploded"));

    await settled;
    await vi.advanceTimersByTimeAsync(0);
  });

  it("waits for work that is still inside the addon before shutdown continues", async () => {
    const ocr = await load();

    void ocr.nativeOcrBuffer(Buffer.from("x"), 0).catch(() => undefined);
    let drained = false;
    void ocr.drainNativeOcr(5000).then(() => {
      drained = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(false);

    probe.calls[0].settle("done");
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(true);
  });

  it("gives up draining rather than blocking shutdown forever", async () => {
    const ocr = await load();

    void ocr.nativeOcrBuffer(Buffer.from("x"), 0).catch(() => undefined);
    let drained = false;
    void ocr.drainNativeOcr(1000).then(() => {
      drained = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(drained).toBe(true);

    probe.calls[0].settle("late");
    await vi.advanceTimersByTimeAsync(0);
  });

  it("returns at once when nothing is in flight", async () => {
    const ocr = await load();

    await expect(ocr.drainNativeOcr(1000)).resolves.toBeUndefined();
  });
});
