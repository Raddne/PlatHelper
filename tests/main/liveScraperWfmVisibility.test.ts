import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  planAuctionVisibility,
  planOrderVisibility,
} from "../../config/shared/liveScraperWfmVisibility";
import { normalizeLiveScraperSettings } from "../../config/shared/liveScraperSettings";

const h = vi.hoisted(() => ({
  signedIn: true,
  hidden: { wtb: false, wts: false, rivens: false } as Record<string, boolean>,
  saved: [] as Array<[string, boolean]>,
  sell: [] as Array<Record<string, unknown>>,
  buy: [] as Array<Record<string, unknown>>,
  ordersError: null as Error | null,
  switched: [] as Array<[string[], boolean]>,
  auctions: [] as Array<Record<string, unknown>>,
  auctionUpdates: [] as Array<Record<string, unknown>>,
  rowWrites: [] as Array<[string, string, unknown]>,
  scan: new Map<string, boolean>(),
  scanAll: [] as boolean[],
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock("../../services/wfmSession", () => ({
  getInGameName: () => (h.signedIn ? "me" : null),
}));
vi.mock("../../services/wfmCatalog", () => ({
  lookupBySlug: async (slug: string) => ({ id: `id-${slug}` }),
}));
vi.mock("../../services/wfmOrders", () => ({
  getMyOrders: async () => {
    if (h.ordersError) throw h.ordersError;
    return { sell: h.sell, buy: h.buy };
  },
  setOrdersVisible: async (ids: string[], visible: boolean) => {
    h.switched.push([ids, visible]);
    return ids.map((id) => (id === "fails" ? { id, error: "rate limited" } : { id }));
  },
}));
vi.mock("../../services/wfmRivenSearch", () => ({
  updateRivenAuction: async (opts: Record<string, unknown>) => {
    h.auctionUpdates.push(opts);
    return { ok: true };
  },
}));
vi.mock("../../services/liveScraperRivenAdopt", () => ({
  fetchAllMyAuctions: async () => h.auctions,
}));
vi.mock("../../services/liveScraperOwnedOrders", () => ({
  isOwnedOrder: (id: string) => id.startsWith("owned"),
}));
vi.mock("../../services/liveScraperStock", () => ({
  batchStockWrites: (run: () => void) => run(),
  listStockItems: () => [
    { id: "s1", wfmUrl: "serration", subType: { rank: 10 } },
    { id: "s2", wfmUrl: "vitality", subType: undefined, wfmHidden: true },
  ],
  listWishlistItems: () => [{ id: "w1", wfmUrl: "ash_prime_set", subType: undefined }],
  updateStockItem: (id: string, patch: Record<string, unknown>) =>
    h.rowWrites.push(["stock", id, patch.wfmHidden]),
  updateWishlistItem: (id: string, patch: Record<string, unknown>) =>
    h.rowWrites.push(["wish", id, patch.wfmHidden]),
}));
vi.mock("../../services/liveScraperRivenStock", () => ({
  listStockRivens: () => [
    { id: "r1", auctionId: "a1" },
    { id: "r2", auctionId: null },
  ],
  updateStockRiven: (id: string, patch: Record<string, unknown>) =>
    h.rowWrites.push(["riven", id, patch.wfmHidden]),
}));
vi.mock("../../services/liveScraperListingVisibility", () => ({
  noteSwitched: () => {},
  setScanHidden: (catalogId: string, hidden: boolean) => h.scan.set(catalogId, hidden),
  setAllScanHidden: (hidden: boolean) => h.scanAll.push(hidden),
}));
vi.mock("../../services/liveScraperSettings", () => ({
  getLiveScraperSettings: () => ({ hiddenOnWfm: h.hidden }),
  setHiddenOnWfm: (tab: string, hidden: boolean) => {
    h.hidden = { ...h.hidden, [tab]: hidden };
    h.saved.push([tab, hidden]);
  },
}));

import { setListingsHiddenOnWfm } from "../../services/liveScraperWfmVisibility";

const order = (id: string, itemId: string, modRank: number | null, visible = true) => ({
  id,
  itemId,
  modRank,
  subtype: null,
  visible,
});

describe("planOrderVisibility", () => {
  const rows = [{ id: "row-1", catalogId: "serration", rank: 10, subtype: null }];

  it("covers the orders a row matches, variant included, and whatever else is asked for", () => {
    const plan = planOrderVisibility(
      [
        order("row", "serration", 10),
        order("other-rank", "serration", 0),
        order("by-hand", "vitality", null),
        order("owned-scan", "vitality", null),
      ],
      rows,
      (o) => o.id === "owned-scan",
      false,
    );
    expect(plan.covered.map((o) => o.id)).toEqual(["row", "owned-scan"]);
    expect(plan.toSwitch.map((o) => o.id)).toEqual(["row", "owned-scan"]);
    expect(plan.rowOrders.get("row-1")?.id).toBe("row");
  });

  it("only switches what is not in the wanted state yet", () => {
    const plan = planOrderVisibility(
      [order("row", "serration", 10, false)],
      rows,
      () => false,
      false,
    );
    expect(plan.covered).toHaveLength(1);
    expect(plan.toSwitch).toEqual([]);
  });
});

describe("planAuctionVisibility", () => {
  it("covers the auctions the rows are linked to", () => {
    const plan = planAuctionVisibility(
      [
        { id: "a1", visible: true },
        { id: "a2", visible: false },
        { id: "not-a-row", visible: true },
      ],
      new Set(["a1", "a2"]),
      false,
    );
    expect(plan.covered.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(plan.toSwitch.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("hiddenOnWfm setting", () => {
  it("defaults to visible and survives normalization", () => {
    const empty = normalizeLiveScraperSettings({ version: 1 });
    expect(empty.hiddenOnWfm).toEqual({ wtb: false, wts: false, rivens: false });
    const kept = normalizeLiveScraperSettings({ version: 1, hiddenOnWfm: { wts: true } });
    expect(kept.hiddenOnWfm).toEqual({ wtb: false, wts: true, rivens: false });
  });
});

describe("setListingsHiddenOnWfm", () => {
  beforeEach(() => {
    h.signedIn = true;
    h.hidden = { wtb: false, wts: false, rivens: false };
    h.saved.length = 0;
    h.sell = [
      order("row", "id-serration", 10),
      order("row-2", "id-vitality", null, false),
      order("by-hand", "id-forma", null),
    ];
    h.buy = [order("wish", "id-ash_prime_set", null), order("owned-scan", "id-x", null)];
    h.ordersError = null;
    h.switched.length = 0;
    h.auctions = [];
    h.auctionUpdates.length = 0;
    h.rowWrites.length = 0;
    h.scan.clear();
    h.scanAll.length = 0;
  });

  it("switches the whole tab, saves its switch and records every row", async () => {
    const saved: boolean[] = [];
    const result = await setListingsHiddenOnWfm("wts", true, null, () => saved.push(h.hidden.wts));
    expect(saved).toEqual([true]);
    expect(h.switched).toEqual([[["row"], false]]);
    // s2 was already recorded hidden, so only s1 needs a write.
    expect(h.rowWrites).toEqual([["stock", "s1", true]]);
    expect(result).toEqual({ ok: true, switched: 1, failed: 0, total: 2 });
  });

  it("with rows marked, switches only those and leaves the tab's switch alone", async () => {
    const result = await setListingsHiddenOnWfm("wts", false, { rowIds: ["s2"], scanIds: [] });
    expect(h.saved).toEqual([]);
    expect(h.switched).toEqual([[["row-2"], true]]);
    expect(h.rowWrites).toEqual([["stock", "s2", false]]);
    expect(result).toEqual({ ok: true, switched: 1, failed: 0, total: 1 });
  });

  it("covers marked catalog-scan buys by catalog id", async () => {
    await setListingsHiddenOnWfm("wtb", true, { rowIds: [], scanIds: ["id-x"] });
    expect(h.switched).toEqual([[["owned-scan"], false]]);
    expect(h.rowWrites).toEqual([]);
    expect(h.scan.get("id-x")).toBe(true);
    expect(h.scanAll).toEqual([]);
  });

  it("covers wishlist orders and every catalog-scan buy on the whole WTB tab", async () => {
    await setListingsHiddenOnWfm("wtb", true, null);
    expect(h.switched).toEqual([[["wish", "owned-scan"], false]]);
    expect(h.rowWrites).toEqual([["wish", "w1", true]]);
    expect(h.scanAll).toEqual([true]);
    expect(h.scan.get("id-x")).toBe(true);
  });

  it("records a refused order as still visible", async () => {
    h.buy = [order("owned-a", "id-x", null), order("fails", "id-ash_prime_set", null)];
    expect(await setListingsHiddenOnWfm("wtb", true, null)).toEqual({
      ok: true,
      switched: 1,
      failed: 1,
      total: 2,
    });
    expect(h.rowWrites).toEqual([["wish", "w1", false]]);
  });

  it("keeps the old state when the orders cannot be read", async () => {
    h.ordersError = new Error("offline");
    const result = await setListingsHiddenOnWfm("wts", true, null);
    expect(result).toMatchObject({ ok: false });
    expect(h.hidden.wts).toBe(false);
  });

  it("does nothing while signed out", async () => {
    h.signedIn = false;
    expect(await setListingsHiddenOnWfm("wts", true, null)).toEqual({
      ok: false,
      error: "not signed in",
    });
    expect(h.saved).toEqual([]);
  });

  it("resends a riven auction as listed, with only the visibility changed", async () => {
    h.auctions = [
      {
        id: "a1",
        visible: false,
        buyoutPlatinum: 900,
        startingPlatinum: null,
        isDirectSell: true,
        minimalReputation: 3,
        note: "gg",
      },
      { id: "not-mine", visible: false },
    ];
    const result = await setListingsHiddenOnWfm("rivens", false, { rowIds: ["r1"], scanIds: [] });
    expect(h.auctionUpdates).toEqual([
      {
        auctionId: "a1",
        buyoutPrice: 900,
        startingPrice: null,
        minReputation: 3,
        description: "gg",
        visible: true,
      },
    ]);
    expect(h.rowWrites).toEqual([["riven", "r1", false]]);
    expect(result).toEqual({ ok: true, switched: 1, failed: 0, total: 1 });
  });
});
