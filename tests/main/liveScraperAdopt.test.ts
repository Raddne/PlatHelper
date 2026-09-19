import { describe, expect, it } from "vitest";

import { planAdoption, type AdoptableOrder } from "../../config/shared/liveScraperAdopt";
import type { StockItem } from "../../config/shared/liveScraperStock";

function order(overrides: Partial<AdoptableOrder> = {}): AdoptableOrder {
  return {
    itemUrlName: "serration",
    itemName: "Serration",
    modRank: 0,
    subtype: null,
    quantity: 2,
    platinum: 40,
    ...overrides,
  };
}

function stockItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: "s1",
    wfmId: "serration",
    wfmUrl: "serration",
    itemName: "Serration",
    subType: { rank: 0 },
    owned: 2,
    bought: 0,
    listPrice: 40,
    minPrice: null,
    isHidden: false,
    adopted: true,
    status: "live",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("planAdoption", () => {
  it("adopts a sell order that has no stock row yet", () => {
    const plan = planAdoption([], [order()]);
    expect(plan.create).toEqual([
      { wfmUrl: "serration", itemName: "Serration", subType: { rank: 0 }, owned: 2, listPrice: 40 },
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("treats different ranks of one item as separate listings", () => {
    const plan = planAdoption([stockItem()], [order(), order({ modRank: 10, platinum: 90 })]);
    expect(plan.create.map((c) => c.subType)).toEqual([{ rank: 10 }]);
  });

  it("adopts an unranked item without a sub type and only once per variant", () => {
    const o = order({ itemUrlName: "forma", itemName: "Forma", modRank: null });
    const plan = planAdoption([], [o, o]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]?.subType).toBeUndefined();
  });

  it("skips orders whose item could not be resolved", () => {
    expect(planAdoption([], [order({ itemUrlName: null })]).create).toEqual([]);
  });

  it("leaves a user-added stock row alone", () => {
    const manual = stockItem({ adopted: undefined, owned: 5 });
    const plan = planAdoption([manual], [order()]);
    expect(plan).toEqual({ create: [], updateOwned: [], remove: [] });
  });

  it("follows a partial sale on an adopted row", () => {
    const plan = planAdoption([stockItem()], [order({ quantity: 1 })]);
    expect(plan.updateOwned).toEqual([{ id: "s1", owned: 1 }]);
  });

  it("drops an adopted row once its order is gone, but never a user-added one", () => {
    const manual = stockItem({ id: "s2", wfmUrl: "hornet_strike", adopted: undefined });
    const plan = planAdoption([stockItem(), manual], []);
    expect(plan.remove).toEqual(["s1"]);
  });
});
