import { beforeEach, describe, expect, it, vi } from "vitest";

type Listing = Record<string, unknown>;
interface SearchOpts {
  positiveStats?: string[];
  negativeStats?: string[];
  directOnly?: boolean;
  ascOnly?: boolean;
}

const h = vi.hoisted(() => ({
  listings: [] as Listing[],
  /** Per-search answer; the default hands every tier the same listings. */
  search: null as null | ((opts: SearchOpts) => Listing[]),
  searchError: null as Error | null,
  searches: [] as SearchOpts[],
  goodRolls: null as null | { goodAttrs: { mandatory: string[]; optional: string[] }[] },
  created: [] as number[],
  createdNames: [] as string[],
  updated: [] as number[],
  updatedVisible: [] as Array<boolean | undefined>,
  updateResult: { ok: true } as { ok: boolean; error?: string; auctionId?: string },
  deleted: [] as string[],
  deleteResult: { ok: true } as { ok: boolean; error?: string },
  patches: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock("../../services/rivenData", () => ({ getRivenFamilySlug: () => "dual_toxocyst" }));
vi.mock("../../services/rivenBestAttributes", () => ({
  getGoodRolls: () => (h.goodRolls ? { ...h.goodRolls, acceptedBadAttrs: [] } : null),
}));
vi.mock("../../services/liveScraperRivenStock", () => ({
  updateStockRiven: (_id: string, patch: Record<string, unknown>) => h.patches.push(patch),
}));
vi.mock("../../services/wfmRivenSearch", () => ({
  searchSimilarRivensOrThrow: async (_slug: string, opts: SearchOpts) => {
    h.searches.push(opts);
    if (h.searchError) throw h.searchError;
    return h.search ? h.search(opts) : h.listings;
  },
  createRivenAuction: async (opts: { buyoutPrice: number; rivenName: string }) => {
    h.created.push(opts.buyoutPrice);
    h.createdNames.push(opts.rivenName);
    return { ok: true, auctionId: "new-auction" };
  },
  updateRivenAuction: async (opts: { buyoutPrice: number; visible?: boolean }) => {
    h.updated.push(opts.buyoutPrice);
    h.updatedVisible.push(opts.visible);
    return h.updateResult;
  },
  deleteRivenAuction: async (id: string) => {
    h.deleted.push(id);
    return h.deleteResult;
  },
}));

import {
  listStockRivenAt,
  progressStockRiven,
  quoteLowestRivenPrice,
  rivenSearchTerms,
} from "../../services/liveScraperRiven";
import { WfmApiError } from "../../services/wfmTypes";
import type { StockRiven } from "../../config/shared/liveScraperRivenStock";

const WTS = { minProfit: 25, thresholdPercentage: 15, maxResults: 5 };
const RATE_LIMIT = "Warframe.market rate limit hit. Please wait 60s before trying again.";

const listing = (id: string, price: number, seller = "other", status = "offline") => ({
  id,
  seller,
  sellerStatus: status,
  isDirectSell: true,
  buyoutPrice: price,
});

const STATS = [
  { tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 150 },
  { tag: "WeaponCritDamageMod", positive: true, multiplier: false, value: 120 },
  { tag: "WeaponArmorPiercingDamageMod", positive: false, multiplier: false, value: 30 },
];

function riven(patch: Partial<StockRiven>): StockRiven {
  return {
    id: "r1",
    weaponName: "Dual Toxocyst",
    rivenName: "Dual Toxocyst Acri-critacan",
    stats: STATS,
    bought: 0,
    minPrice: null,
    listPrice: null,
    auctionId: null,
    isHidden: false,
    status: "pending",
    ...patch,
  } as StockRiven;
}

/** The account's auction list as the adoption sync hands it over. */
const live = (...ids: string[]) => new Set(ids);

function reset(): void {
  h.listings = [3000, 3888, 4500, 4500, 4500, 7500].map((price, i) => listing(`a${i}`, price));
  h.search = null;
  h.searchError = null;
  h.searches.length = 0;
  h.goodRolls = null;
  h.created.length = 0;
  h.createdNames.length = 0;
  h.updated.length = 0;
  h.updatedVisible.length = 0;
  h.updateResult = { ok: true };
  h.deleted.length = 0;
  h.deleteResult = { ok: true };
  h.patches.length = 0;
}

describe("progressStockRiven", () => {
  beforeEach(reset);

  it("averages the lowest fixed-price listings, offline sellers included", async () => {
    const result = await progressStockRiven(riven({}), WTS, "me");
    expect(result).toMatchObject({ action: "created", price: 4077 });
    expect(h.searches[0]).toMatchObject({
      positiveStats: ["critical_chance", "critical_damage"],
      negativeStats: ["puncture_damage"],
      directOnly: true,
      ascOnly: true,
    });
  });

  it("creates the auction under the riven's own name, without the weapon", async () => {
    await progressStockRiven(riven({}), WTS, "me");
    expect(h.createdNames).toEqual(["acri-critacan"]);
  });

  it("with one result follows the cheapest listing, floored by the minimum price", async () => {
    const wts = { ...WTS, maxResults: 1 };
    expect((await progressStockRiven(riven({ minPrice: 3800 }), wts, "me")).price).toBe(3800);
    expect((await progressStockRiven(riven({ minPrice: 2000 }), wts, "me")).price).toBe(3000);
  });

  it("treats -1 as no sample limit and no price threshold", async () => {
    const wts = { ...WTS, maxResults: -1, thresholdPercentage: -1 };
    expect((await progressStockRiven(riven({}), wts, "me")).price).toBe(4648);
  });

  it("updates a live auction when the price moved", async () => {
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 3800, minPrice: 2000 }),
      { ...WTS, maxResults: 1 },
      "me",
      () => false,
      live("mine"),
    );
    expect(result).toMatchObject({ action: "updated", price: 3000, auctionId: "mine" });
    expect(h.created).toEqual([]);
    expect(h.updatedVisible).toEqual([true]);
  });

  it("keeps a hidden auction hidden when it re-prices it", async () => {
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 3800 }),
      { ...WTS, maxResults: 1 },
      "me",
      () => true,
      live("mine"),
    );
    expect(result).toMatchObject({ action: "updated", auctionId: "mine" });
    expect(h.updatedVisible).toEqual([false]);
  });

  it("creates a hidden riven's auction and hides it right away", async () => {
    const result = await progressStockRiven(riven({}), WTS, "me", () => true);
    expect(result).toMatchObject({ action: "created", auctionId: "new-auction" });
    expect(h.created).toEqual([4077]);
    expect(h.updatedVisible).toEqual([false]);
    expect(h.patches.at(-1)).toMatchObject({ wfmHidden: true });
  });

  it("records a new auction as visible when hiding it failed", async () => {
    h.updateResult = { ok: false, error: "rate limited" };
    await progressStockRiven(riven({}), WTS, "me", () => true);
    expect(h.patches.at(-1)).toMatchObject({ auctionId: "new-auction", wfmHidden: false });
  });

  it("trusts the account's auction list, not the public search, on whether its auction is up", async () => {
    // A hidden auction is never in the public search; the account list has it.
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 4077 }),
      WTS,
      "me",
      () => true,
      live("mine"),
    );
    expect(result).toMatchObject({ action: "skipped", auctionId: "mine" });
    expect(h.created).toEqual([]);
  });

  it("lists again at once when its auction is gone from the account", async () => {
    const result = await progressStockRiven(
      riven({ auctionId: "closed-elsewhere", listPrice: 4077 }),
      WTS,
      "me",
      () => false,
      live("some-other-auction"),
    );
    expect(result).toMatchObject({ action: "created", price: 4077, auctionId: "new-auction" });
    expect(h.updated).toEqual([]);
    // The dead id is dropped before anything else, whatever the create does.
    expect(h.patches[0]).toEqual({ auctionId: null, listPrice: null });
  });

  it("keeps its auction when the account list is not available", async () => {
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 4077 }),
      WTS,
      "me",
      () => false,
      null,
    );
    expect(result).toMatchObject({ action: "skipped", auctionId: "mine" });
    expect(h.created).toEqual([]);
  });

  it("recreates in the same pass when the update says the auction does not exist", async () => {
    h.updateResult = { ok: false, error: "WFMClient API error: auction: app.form.not_exist" };
    const result = await progressStockRiven(
      riven({ auctionId: "gone", listPrice: 9999 }),
      WTS,
      "me",
      () => false,
      live("gone"),
    );
    expect(result).toMatchObject({ action: "created", auctionId: "new-auction" });
  });

  it("keeps the auction id after any other update failure", async () => {
    // Dropping it made the next pass create a second auction for the same riven.
    h.updateResult = { ok: false, error: RATE_LIMIT };
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 9999 }),
      WTS,
      "me",
      () => false,
      live("mine"),
    );
    expect(result).toMatchObject({ action: "skipped", auctionId: "mine", rateLimited: true });
    expect(h.created).toEqual([]);
    expect(h.patches).toEqual([]);
  });

  it("leaves the riven as it is when the search fails", async () => {
    h.searchError = new WfmApiError(RATE_LIMIT, "WFM_RATE_LIMITED", 429);
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 4077, status: "live" }),
      WTS,
      "me",
      () => false,
      live("mine"),
    );
    expect(result).toMatchObject({ action: "skipped", auctionId: "mine", rateLimited: true });
    expect(result.error).toMatch(/search failed/);
    expect(h.patches).toEqual([]);
    expect(h.created).toEqual([]);
    expect(h.deleted).toEqual([]);
  });

  it("does not count bid auctions or a lone listing as a price", async () => {
    h.listings = [
      listing("bid", 50),
      { ...listing("bid2", 60), isDirectSell: false },
      { ...listing("bid3", 70), isDirectSell: false },
    ];
    const result = await progressStockRiven(riven({}), WTS, "me");
    expect(result).toMatchObject({ action: "skipped", auctionId: null, price: null });
    expect(h.created).toEqual([]);
    expect(h.patches.at(-1)).toEqual({ status: "noSellers", listPrice: null });
  });

  it("falls back to the same positive stats when too few identical rolls are listed", async () => {
    h.search = (opts) =>
      opts.negativeStats?.length
        ? [listing("troll", 9500)]
        : [listing("b0", 300), listing("b1", 350), listing("b2", 400)];
    const result = await progressStockRiven(riven({}), WTS, "me");
    expect(result).toMatchObject({ action: "created", price: 350 });
    expect(h.searches.map((s) => s.negativeStats)).toEqual([["puncture_damage"], []]);
  });

  it("then to the stats that matter for the weapon", async () => {
    h.goodRolls = {
      goodAttrs: [{ mandatory: ["WeaponCritChanceMod"], optional: ["WeaponFireIterationsMod"] }],
    };
    h.search = (opts) =>
      opts.positiveStats?.length === 1
        ? [listing("k0", 200), listing("k1", 250), listing("k2", 300)]
        : [listing("one", 5000)];
    const result = await progressStockRiven(riven({}), WTS, "me");
    expect(result).toMatchObject({ action: "created", price: 250 });
    expect(h.searches.map((s) => s.positiveStats)).toEqual([
      ["critical_chance", "critical_damage"],
      ["critical_chance", "critical_damage"],
      ["critical_chance"],
    ]);
  });

  it("closes the auction and keeps the row when no comparable price exists", async () => {
    h.listings = [];
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 26, status: "live" }),
      WTS,
      "me",
      () => false,
      live("mine"),
    );
    expect(result).toMatchObject({ action: "deleted", auctionId: null, price: null });
    expect(h.deleted).toEqual(["mine"]);
    expect(h.patches).toEqual([{ status: "noSellers", listPrice: null, auctionId: null }]);
  });

  it("never lists a riven without a comparable price, whatever it cost", async () => {
    // Quantframe listed it at bought + minProfit + 1 here: 26p for a 0p riven.
    h.listings = [];
    const result = await progressStockRiven(riven({ bought: 500, minPrice: 700 }), WTS, "me");
    expect(result).toMatchObject({ action: "skipped", auctionId: null, price: null });
    expect(h.created).toEqual([]);
  });

  it("retries the close next pass when warframe.market refused it", async () => {
    h.listings = [];
    h.deleteResult = { ok: false, error: RATE_LIMIT };
    const result = await progressStockRiven(
      riven({ auctionId: "mine", listPrice: 26, status: "live" }),
      WTS,
      "me",
      () => false,
      live("mine"),
    );
    expect(result).toMatchObject({ action: "skipped", auctionId: "mine", rateLimited: true });
    expect(h.patches).toEqual([]);
  });

  it("leaves an adopted auction up at the user's price without a comparable listing", async () => {
    h.listings = [];
    const result = await progressStockRiven(
      riven({ adopted: true, auctionId: "theirs", listPrice: 800, minPrice: 800, status: "live" }),
      WTS,
      "me",
      () => false,
      live("theirs"),
    );
    expect(result).toMatchObject({ action: "skipped", auctionId: "theirs", price: 800 });
    expect(h.deleted).toEqual([]);
    expect(h.patches).toEqual([{ status: "noSellers" }]);
  });
});

describe("quick list from the Rivens tab", () => {
  beforeEach(() => {
    reset();
    h.listings = [
      listing("a0", 3000, "other", "offline"),
      listing("a1", 3888, "other", "ingame"),
      listing("a2", 4000, "other", "online"),
      listing("a3", 4100, "other", "ingame"),
      listing("mine", 100, "me", "online"),
    ];
  });

  it("quotes the cheapest comparable buyout, own auction excluded", async () => {
    expect(await quoteLowestRivenPrice("Dual Toxocyst", STATS, "me", false)).toEqual({
      ok: true,
      price: 3000,
      listings: 4,
    });
  });

  it("can restrict the quote to sellers who are online or in game", async () => {
    expect(await quoteLowestRivenPrice("Dual Toxocyst", STATS, "me", true)).toEqual({
      ok: true,
      price: 3888,
      listings: 3,
    });
  });

  it("reports no price when nothing comparable is listed", async () => {
    h.listings = [listing("a0", 3000), listing("a1", 3100)];
    expect(await quoteLowestRivenPrice("Dual Toxocyst", STATS, "me", false)).toMatchObject({
      price: null,
      listings: 0,
    });
  });

  it("posts the auction at the confirmed price and records it for the engine", async () => {
    const result = await listStockRivenAt(riven({}), 3000);
    expect(result).toEqual({ ok: true, auctionId: "new-auction" });
    expect(h.created).toEqual([3000]);
    expect(h.patches).toEqual([
      { status: "live", listPrice: 3000, auctionId: "new-auction", wfmHidden: false },
    ]);
  });

  it("builds the search terms from the stat tags", () => {
    const terms = rivenSearchTerms("Dual Toxocyst", [
      { tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 1 },
      { tag: "WeaponArmorPiercingDamageMod", positive: false, multiplier: false, value: -1 },
    ]);
    expect(terms).toEqual({
      weaponSlug: "dual_toxocyst",
      positive: ["critical_chance"],
      negative: ["puncture_damage"],
    });
  });
});
