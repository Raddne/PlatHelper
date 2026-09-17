import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEraOcr } from "../../services/rewardScannerOcr";

const PNG = Buffer.from("png");

const stubImage = { toPNG: () => PNG, isEmpty: () => false };
const cropped = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../services/screenCapture", () => ({
  captureScreenFast: vi.fn(async () => ({
    image: stubImage,
    sourceType: "gdi",
    sourceName: "Warframe",
    sourceId: "1",
    sourceDisplayId: "1",
  })),
}));

vi.mock("../../services/rewardScannerImage", () => ({
  buildOcrVariants: () => [{ id: "raw", image: stubImage }],
  cropRect: () => {
    cropped.count += 1;
    return stubImage;
  },
  cropBand: () => {
    cropped.count += 1;
    return stubImage;
  },
}));

function deps(overrides: Partial<Parameters<typeof createEraOcr>[0]> = {}) {
  return {
    runOCR: vi.fn(async () => "windows file text"),
    runOCRBuffer: vi.fn(async () => "windows buffer text"),
    recognizeStrip: vi.fn(async () => ({ text: "paddle text" })),
    stripAvailable: () => true,
    readFile: vi.fn(() => PNG),
    ...overrides,
  };
}

describe("createEraOcr", () => {
  it("uses Windows OCR when it works", async () => {
    const d = deps();
    const ocr = createEraOcr({ ...d, isWindows: true });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("windows buffer text");
    expect(d.recognizeStrip).not.toHaveBeenCalled();
  });

  it("falls back to paddle when Windows OCR throws", async () => {
    const d = deps({ runOCRBuffer: vi.fn(async () => Promise.reject(new Error("no pack"))) });
    const ocr = createEraOcr({ ...d, isWindows: true });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("paddle text");
  });

  it("rethrows the Windows error when paddle is unavailable", async () => {
    const d = deps({
      runOCRBuffer: vi.fn(async () => Promise.reject(new Error("no pack"))),
      stripAvailable: () => false,
    });
    const ocr = createEraOcr({ ...d, isWindows: true });
    await expect(ocr.runOCRBuffer(PNG, 1000)).rejects.toThrow("no pack");
  });

  it("goes straight to paddle off-Windows", async () => {
    const d = deps();
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("paddle text");
    expect(d.runOCRBuffer).not.toHaveBeenCalled();
  });

  it("throws off-Windows when paddle is unavailable", async () => {
    const d = deps({ stripAvailable: () => false });
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 1000)).rejects.toThrow(/No OCR engine/);
  });

  it("resolves empty when paddle exceeds the timeout", async () => {
    const d = deps({
      recognizeStrip: vi.fn(() => new Promise<{ text: string } | null>(() => {})),
    });
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 25)).resolves.toBe("");
  });

  it("file variant reads the image for the paddle path", async () => {
    const d = deps();
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCR("C:/tmp/era.png", 1000)).resolves.toBe("paddle text");
    expect(d.readFile).toHaveBeenCalledWith("C:/tmp/era.png");
    expect(d.recognizeStrip).toHaveBeenCalledWith(PNG);
  });

  it("treats a null paddle read as empty text", async () => {
    const d = deps({ recognizeStrip: vi.fn(async () => null) });
    const ocr = createEraOcr({ ...d, isWindows: false });
    await expect(ocr.runOCRBuffer(PNG, 1000)).resolves.toBe("");
  });
});

describe("detectRelicSelectionEra budget", () => {
  let clock = 0;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    cropped.count = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
  });

  it("hands each crop only the budget left, so one pass cannot outlive it", async () => {
    const { detectRelicSelectionEra } = await import("../../services/rewardScannerEra");
    const granted: number[] = [];
    const ocr = {
      runOCR: vi.fn(async () => ""),
      // Each crop costs 800ms of the 2000ms pass budget and reads nothing.
      runOCRBuffer: vi.fn(async (_buffer: Buffer, timeoutMs: number) => {
        granted.push(timeoutMs);
        clock += 800;
        return "";
      }),
    };

    const startedAt = clock;
    const result = await detectRelicSelectionEra({ timeoutMs: 2000 }, ocr, {
      ocrTimeoutMs: 15_000,
    });

    expect(granted).toEqual([2000, 1200]);
    expect(clock - startedAt).toBeLessThanOrEqual(2000);
    expect(result.era).toBeNull();
  });

  it("stops cropping the rest of the ladder once the budget is spent", async () => {
    const { detectRelicSelectionEra } = await import("../../services/rewardScannerEra");
    const ocr = {
      runOCR: vi.fn(async () => ""),
      runOCRBuffer: vi.fn(async () => {
        clock += 1_000;
        return "";
      }),
    };

    await detectRelicSelectionEra({ timeoutMs: 1000 }, ocr, { ocrTimeoutMs: 15_000 });

    // The filter label burns the whole budget, so the 5 tile and 3 band rects
    // must not still pay for a crop plus an OCR variant build each.
    expect(ocr.runOCRBuffer).toHaveBeenCalledTimes(1);
    expect(cropped.count).toBe(1);
  });
});
