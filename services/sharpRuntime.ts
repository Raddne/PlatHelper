import os from "node:os";

import type sharpNs from "sharp";

// libvips sizes its pool from the CPU count: a 12-core machine had 23 libvips
// worker threads alive during one reward scan, beside ONNX and the OCR server.
const MAX_SHARP_CONCURRENCY = 4;

let configured = false;

export function sharpConcurrencyTarget(cpuCount = os.cpus().length): number {
  const half = Math.floor((Number.isFinite(cpuCount) ? cpuCount : 1) / 2);
  return Math.max(1, Math.min(MAX_SHARP_CONCURRENCY, half));
}

/** The one place sharp is loaded, so its thread pool is bounded before any
 *  pipeline runs. */
export function loadSharp(): typeof sharpNs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp: typeof sharpNs = require("sharp");
  if (!configured) {
    configured = true;
    try {
      sharp.concurrency(sharpConcurrencyTarget());
    } catch {
      // an older binding without concurrency() still works, just unbounded
    }
  }
  return sharp;
}
