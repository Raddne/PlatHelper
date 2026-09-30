import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyClosedWfmListing,
  marketContracts,
  marketOrders,
  marketSelected,
  marketViewState,
  mutateMarketSelected,
  setMarketViewState,
} from "../../../src/stores/market.js";
import type { WfmContract, WfmOrder } from "../../../src/types/market.js";

function order(id: string, quantity: number): WfmOrder {
  return {
    id,
    orderType: "sell",
    platinum: 20,
    quantity,
    visible: true,
    modRank: null,
    itemId: `item-${id}`,
    itemName: `Item ${id}`,
    itemUrlName: `item_${id}`,
    itemThumb: null,
  };
}

function contract(id: string): WfmContract {
  return {
    id,
    itemName: `Riven ${id}`,
    itemId: null,
    itemUrlName: null,
    weaponUrlName: null,
    rivenSuffix: null,
    itemThumb: null,
    platinum: 100,
    buyoutPlatinum: null,
    startingPlatinum: null,
    quantity: 1,
    visible: true,
    modRank: null,
    rerolls: null,
    masteryLevel: null,
    polarity: null,
    minimalReputation: null,
    isDirectSell: false,
    listedAt: null,
    updatedAt: null,
    note: null,
    stats: [],
    listingUrl: "",
    sourceType: null,
  };
}

describe("applyClosedWfmListing", () => {
  beforeEach(() => {
    marketOrders.set({ sell: [order("a", 3), order("b", 1)], buy: [order("c", 2)] });
    marketContracts.set({
      contracts: [contract("r1"), contract("r2")],
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    marketSelected.set(new Set());
    setMarketViewState({ ordersLastFetch: 1_000, contractsLastFetch: 1_000 });
  });

  it("decrements a partially closed order and keeps the row", () => {
    applyClosedWfmListing({ kind: "order", orderId: "a", quantity: 2 });

    const orders = get(marketOrders);
    expect(orders.sell.map((entry) => [entry.id, entry.quantity])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("drops the row once the closed quantity covers the listing", () => {
    applyClosedWfmListing({ kind: "order", orderId: "b", quantity: 1 });

    expect(get(marketOrders).sell.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("closes buy-side orders too and clears their selection", () => {
    mutateMarketSelected((selected) => {
      selected.add("c");
    });

    applyClosedWfmListing({ kind: "order", orderId: "c", quantity: 5 });

    expect(get(marketOrders).buy).toEqual([]);
    expect(get(marketSelected).has("c")).toBe(false);
  });

  it("removes a closed riven contract", () => {
    applyClosedWfmListing({ kind: "contract", orderId: "r1", quantity: 1 });

    expect(get(marketContracts).contracts.map((entry) => entry.id)).toEqual(["r2"]);
    expect(get(marketOrders).sell).toHaveLength(2);
  });

  it("invalidates the fetch timers so the next visit refetches the truth", () => {
    applyClosedWfmListing({ kind: "order", orderId: "a", quantity: 1 });

    expect(get(marketViewState).ordersLastFetch).toBe(0);
    expect(get(marketViewState).contractsLastFetch).toBe(0);
  });

  it("ignores a match without an id", () => {
    applyClosedWfmListing({ kind: "order", orderId: "", quantity: 1 });

    expect(get(marketOrders).sell).toHaveLength(2);
    expect(get(marketViewState).ordersLastFetch).toBe(1_000);
  });
});

describe("marketSessionLoaded", () => {
  // Module state: each case starts from a fresh import.
  async function freshStore() {
    vi.resetModules();
    return import("../../../src/stores/market.js");
  }

  it("stays false on the placeholder session until something writes one", async () => {
    const store = await freshStore();
    expect(get(store.marketSessionLoaded)).toBe(false);
    expect(get(store.marketSession).loggedIn).toBe(false);
    store.marketSession.set({ loggedIn: true, userName: "Tenno", platform: "pc" });
    expect(get(store.marketSessionLoaded)).toBe(true);
    expect(get(store.marketSession).userName).toBe("Tenno");
  });

  it("counts a sign-out and a failed start-up read as known", async () => {
    const cleared = await freshStore();
    cleared.clearMarketAccountState();
    expect(get(cleared.marketSessionLoaded)).toBe(true);

    const failed = await freshStore();
    failed.markMarketSessionLoaded();
    expect(get(failed.marketSessionLoaded)).toBe(true);
    expect(get(failed.marketSession).loggedIn).toBe(false);
  });
});
