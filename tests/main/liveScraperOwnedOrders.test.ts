import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../services/userDataPath", () => ({
  userDataPath: (...segments: string[]) => path.join(mocks.directory, ...segments),
}));

import {
  forgetOwnedOrder,
  isOwnedOrder,
  markOrderOwned,
  pruneOwnedOrders,
  resetOwnedOrdersForTest,
} from "../../services/liveScraperOwnedOrders";

describe("live scraper owned orders", () => {
  beforeEach(() => {
    mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "owned-orders-"));
    resetOwnedOrdersForTest();
  });

  afterEach(() => {
    fs.rmSync(mocks.directory, { recursive: true, force: true });
  });

  it("knows nothing until the scraper creates an order, and remembers across restarts", () => {
    expect(isOwnedOrder("a")).toBe(false);
    markOrderOwned("a");
    resetOwnedOrdersForTest();
    expect(isOwnedOrder("a")).toBe(true);
    forgetOwnedOrder("a");
    resetOwnedOrdersForTest();
    expect(isOwnedOrder("a")).toBe(false);
  });

  it("prunes orders that are no longer on the account", () => {
    markOrderOwned("a");
    markOrderOwned("b");
    pruneOwnedOrders(["b", "someone-elses"]);
    expect(isOwnedOrder("a")).toBe(false);
    expect(isOwnedOrder("b")).toBe(true);
    expect(isOwnedOrder("someone-elses")).toBe(false);
  });
});
