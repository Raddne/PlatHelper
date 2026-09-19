import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listings: [] as Array<Record<string, unknown>>,
  created: [] as number[],
  updated: [] as number[],
  updateResult: { ok: true } as { ok: boolean; error?: string; auctionId?: string },
  patches: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock("../../services/rivenData", () => ({ getRivenFamilySlug: () => "dual_toxocyst" }));
vi.mock("../../services/liveScraperRivenStock", () => ({
  updateStockRiven: (_id: string, patch: Record<string, unknown>) => h.patches.push(patch),
}));
vi.mock("../../services/wfmRivenSearch", () => ({
  searchSimilarRivens: async () => h.listings,
  createRivenAuction: async (opts: { buyoutPrice: number }) => {
    h.created.push(opts.buyoutPrice);
    return { ok: true, auctionId: "new-auction" };
  },
  updateRivenAuction: async (opts: { buyoutPrice: number }) => {
    h.updated.push(opts.buyoutPrice);
    return h.updateResult;
  },
  deleteRivenAuction: async () => ({ ok: true }),
}));

import { progressStockRiven } from "../../services/liveScraperRiven";
import type { StockRiven } from "../../config/shared/liveScraperRivenStock";

const WTS = { minProfit: 25, thresholdPercentage: 15, maxResults: 5 };

const listing = (id: string, price: number, seller = "other", status = "offline") => ({
  id,
  seller,
  sellerStatus: status,
  isDirectSell: true,
  buyoutPrice: price,
});

function riven(patch: Partial<StockRiven>): StockRiven {
  return {
    id: "r1",
    weaponName: "Dual Toxocyst",
    rivenName: "Dual Toxocyst Acri-critacan",
    stats: [],
    bought: 0,
    minPrice: null,
    listPrice: null,
    auctionId: null,
    isHidden: false,
    status: "pending",
    ...patch,
  } as StockRiven;
}

describe("progressStockRiven", () => {
  beforeEach(() => {
    h.listings = [3000, 3888, 4500, 4500, 4500, 7500].map((price, i) => listing(`a${i}`, price));
    h.created.length = 0;
    h.updated.length = 0;
    h.patches.length = 0;
    h.updateResult = { ok: true };
  });

  it("averages the lowest auctions, offline sellers included", async () => {
    const result = await progressStockRiven(riven({}), WTS, "me");
    expect(result).toMatchObject({ action: "created", price: 4077 });
  });

  it("with one result follows the cheapest auction, floored by the minimum price", async () => {
    const wts = { ...WTS, maxResults: 1 };
    expect((await progressStockRiven(riven({ minPrice: 3800 }), wts, "me")).price).toBe(3800);
    expect((await progressStockRiven(riven({ minPrice: 2000 }), wts, "me")).price).toBe(3000);
  });

  it("updates a live auction when the price moved", async () => {
    h.listings.push(listing("mine", 3800, "me"));
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 3800, minPrice: 2000 }),
      { ...WTS, maxResults: 1 },
      "me",
    );
    expect(result).toMatchObject({ action: "updated", price: 3000, auctionId: "mine" });
    expect(h.created).toEqual([]);
  });

  it("lists again at once when its auction vanished from a complete search", async () => {
    const result = await progressStockRiven(
      riven({ auctionId: "closed-elsewhere", listPrice: 4077 }),
      WTS,
      "me",
    );
    // Same price as before, which used to be skipped without noticing the loss.
    expect(result).toMatchObject({ action: "created", price: 4077, auctionId: "new-auction" });
    expect(h.updated).toEqual([]);
  });

  it("does not conclude anything from a capped search page", async () => {
    h.listings = Array.from({ length: 600 }, (_, i) => listing(`a${i}`, 3000 + i));
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 3002 }),
      WTS,
      "me",
    );
    expect(result.action).toBe("skipped");
    expect(h.created).toEqual([]);
  });

  it("recreates in the same pass when the update says the auction does not exist", async () => {
    h.listings = Array.from({ length: 600 }, (_, i) => listing(`a${i}`, 3000 + i));
    h.updateResult = { ok: false, error: "WFMClient API error: auction: app.form.not_exist" };
    const result = await progressStockRiven(
      riven({ auctionId: "gone", listPrice: 9999 }),
      WTS,
      "me",
    );
    expect(result).toMatchObject({ action: "created", auctionId: "new-auction" });
  });

  it("keeps its hands off after any other update failure", async () => {
    h.listings = Array.from({ length: 600 }, (_, i) => listing(`a${i}`, 3000 + i));
    h.updateResult = { ok: false, error: "rate limited" };
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 9999 }),
      WTS,
      "me",
    );
    expect(result).toMatchObject({ action: "skipped", auctionId: null });
    expect(h.created).toEqual([]);
  });
});
