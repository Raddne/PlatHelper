import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stock: [] as Array<Record<string, unknown>>,
  wishlist: [] as Array<Record<string, unknown>>,
  rivens: [] as Array<Record<string, unknown>>,
  writes: [] as Array<[string, string, unknown]>,
  tabs: { wtb: false, wts: true, rivens: false },
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock("../../services/wfmCatalog", () => ({
  lookupBySlug: async (slug: string) => ({ id: `id-${slug}` }),
}));
vi.mock("../../services/liveScraperStock", () => ({
  batchStockWrites: (run: () => void) => run(),
  listStockItems: () => h.stock,
  listWishlistItems: () => h.wishlist,
  updateStockItem: (id: string, patch: Record<string, unknown>) =>
    h.writes.push(["stock", id, patch.wfmHidden]),
  updateWishlistItem: (id: string, patch: Record<string, unknown>) =>
    h.writes.push(["wish", id, patch.wfmHidden]),
}));
vi.mock("../../services/liveScraperRivenStock", () => ({
  listStockRivens: () => h.rivens,
  updateStockRiven: (id: string, patch: Record<string, unknown>) =>
    h.writes.push(["riven", id, patch.wfmHidden]),
}));
vi.mock("../../services/liveScraperSettings", () => ({
  getLiveScraperSettings: () => ({ hiddenOnWfm: h.tabs }),
}));

import {
  noteSwitched,
  rowCreateHidden,
  scanCreateHidden,
  scanHidden,
  setScanHidden,
  syncOrderRowVisibility,
  syncRivenRowVisibility,
} from "../../services/liveScraperListingVisibility";
import type { NormalisedOrder } from "../../services/wfmOrders";

const order = (id: string, itemId: string, visible: boolean): NormalisedOrder => ({
  id,
  orderType: "sell",
  platinum: 10,
  quantity: 1,
  visible,
  modRank: null,
  subtype: null,
  itemId,
  itemName: itemId,
  itemUrlName: null,
  itemThumb: null,
});

describe("listing visibility", () => {
  beforeEach(() => {
    h.stock = [
      { id: "s1", wfmUrl: "forma" },
      { id: "s2", wfmUrl: "serration", wfmHidden: true },
      { id: "s3", wfmUrl: "vitality", wfmHidden: true },
    ];
    h.wishlist = [{ id: "w1", wfmUrl: "ash_prime_set", wfmHidden: false }];
    h.rivens = [];
    h.writes.length = 0;
  });

  it("copies each row's order visibility and leaves rows without an order alone", async () => {
    await syncOrderRowVisibility(
      {
        sell: [order("o1", "id-forma", false), order("o2", "id-serration", true)],
        buy: [order("o3", "id-ash_prime_set", false)],
      },
      Date.now(),
    );
    expect(h.writes).toEqual([
      ["stock", "s1", true],
      ["stock", "s2", false],
      ["wish", "w1", true],
    ]);
  });

  it("does not let a snapshot older than a switch from the panel undo it", async () => {
    const fetchedAt = Date.now() - 1000;
    noteSwitched("stock:s1");
    await syncOrderRowVisibility({ sell: [order("o1", "id-forma", true)], buy: [] }, fetchedAt);
    expect(h.writes).toEqual([]);
  });

  it("syncs riven rows from the account's auctions", () => {
    h.rivens = [
      { id: "r1", auctionId: "a1" },
      { id: "r2", auctionId: "a2", wfmHidden: true },
      { id: "r3", auctionId: null },
    ];
    syncRivenRowVisibility(
      [
        { id: "a1", visible: false },
        { id: "a2", visible: true },
      ],
      Date.now(),
    );
    expect(h.writes).toEqual([
      ["riven", "r1", true],
      ["riven", "r2", false],
    ]);
  });

  it("creates a row's next listing its known way, else the tab's", () => {
    expect(rowCreateHidden("stock", "s1")).toBe(true);
    expect(rowCreateHidden("stock", "s3")).toBe(true);
    expect(rowCreateHidden("wish", "w1")).toBe(false);
    expect(scanCreateHidden("unknown")).toBe(false);
  });

  it("keeps a catalog-scan buy's state, unless a switch came after the snapshot", () => {
    const before = Date.now() - 1000;
    setScanHidden("id-x", true);
    expect(scanHidden("id-x")).toBe(true);
    noteSwitched("scan:id-x");
    setScanHidden("id-x", false, before);
    expect(scanHidden("id-x")).toBe(true);
    setScanHidden("id-x", false, Date.now() + 1000);
    expect(scanHidden("id-x")).toBe(false);
  });
});
