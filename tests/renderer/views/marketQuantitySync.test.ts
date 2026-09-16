import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// syncQuantitiesToInventory is private to the view and drives a WFM PATCH per
// listing, so the guard reads the handler's source instead of mounting it.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

describe("market quantity sync", () => {
  it("sends quantity only, so a price edited during the run survives", () => {
    const source = readFileSync(resolve(ROOT, "src/views/MarketView.svelte"), "utf8");
    const body = functionBody(source, "syncQuantitiesToInventory");

    expect(body).toContain("quantity: update.quantity");
    // A platinum captured when the plan was built would undo a later reprice.
    expect(body).not.toContain("platinum");
  });
});
