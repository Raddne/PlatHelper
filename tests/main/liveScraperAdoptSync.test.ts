import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../services/userDataPath", () => ({
  userDataPath: (...segments: string[]) => path.join(mocks.directory, ...segments),
}));

mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-sync-"));

import { syncAdoptedSellOrders } from "../../services/liveScraperAdopt";
import { listStockItems } from "../../services/liveScraperStock";
import type { NormalisedOrder } from "../../services/wfmOrders";

describe("adopting existing sell orders", () => {
  afterAll(() => {
    fs.rmSync(mocks.directory, { recursive: true, force: true });
  });

  it("keeps the price the user listed at as the row's minimum price", () => {
    const order = {
      id: "o1",
      orderType: "sell",
      itemId: "item-1",
      itemUrlName: "ash_prime_set",
      itemName: "Ash Prime Set",
      platinum: 140,
      quantity: 2,
      modRank: null,
      subtype: null,
    } as unknown as NormalisedOrder;

    syncAdoptedSellOrders([order]);

    expect(listStockItems()).toHaveLength(1);
    expect(listStockItems()[0]).toMatchObject({
      adopted: true,
      owned: 2,
      listPrice: 140,
      minPrice: 140,
    });
  });
});
