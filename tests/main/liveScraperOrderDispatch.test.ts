import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  deleteOrder: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../services/wfmOrders", () => ({
  createOrder: mocks.createOrder,
  updateOrder: mocks.updateOrder,
  deleteOrder: mocks.deleteOrder,
}));
vi.mock("../../services/liveScraperOwnedOrders", () => ({
  markOrderOwned: vi.fn(),
  forgetOwnedOrder: vi.fn(),
}));

import { dispatchOrder } from "../../services/liveScraperOrderDispatch";
import type { NormalisedOrder } from "../../services/wfmOrders";

function order(overrides: Partial<NormalisedOrder> = {}): NormalisedOrder {
  return {
    id: "o1",
    orderType: "sell",
    platinum: 40,
    quantity: 1,
    visible: true,
    modRank: null,
    subtype: null,
    itemId: "catalog-1",
    itemName: "Serration",
    itemUrlName: "serration",
    itemThumb: null,
    ...overrides,
  };
}

const base = {
  orderType: "sell" as const,
  postPrice: 40,
  quantity: 1,
  modRank: null,
  subtype: null,
  itemId: "catalog-1",
};

describe("dispatchOrder visibility", () => {
  beforeEach(() => {
    mocks.createOrder.mockReset();
    mocks.createOrder.mockResolvedValue(order({ id: "new" }));
    mocks.updateOrder.mockReset();
    mocks.updateOrder.mockResolvedValue(order());
  });

  it("creates a visible order unless asked for a hidden one, and says which", async () => {
    const shown = await dispatchOrder({ ...base, existingOrder: null, ops: new Set(["Create"]) });
    const hidden = await dispatchOrder({
      ...base,
      existingOrder: null,
      ops: new Set(["Create"]),
      hidden: true,
    });
    expect(mocks.createOrder.mock.calls.map(([args]) => args.visible)).toEqual([true, false]);
    expect([shown.visible, hidden.visible]).toEqual([true, false]);
  });

  it("never changes an existing order's visibility, only reports it", async () => {
    const repriced = await dispatchOrder({
      ...base,
      postPrice: 45,
      existingOrder: order({ visible: false }),
      ops: new Set(["Update"]),
      hidden: false,
    });
    const unchanged = await dispatchOrder({
      ...base,
      existingOrder: order({ visible: true }),
      ops: new Set(["Update"]),
      hidden: true,
    });
    expect(mocks.updateOrder.mock.calls[0]?.[1]).not.toHaveProperty("visible");
    expect(mocks.updateOrder).toHaveBeenCalledTimes(1);
    expect(repriced).toMatchObject({ action: "updated", visible: false });
    expect(unchanged).toMatchObject({ action: "skipped", visible: true });
  });

  it("reports no visibility once the order is gone", async () => {
    mocks.deleteOrder.mockResolvedValue({ deleted: true, id: "o1" });
    const result = await dispatchOrder({
      ...base,
      existingOrder: order(),
      ops: new Set(["Update", "Delete"]),
    });
    expect(result.action).toBe("deleted");
    expect(result).not.toHaveProperty("visible");
  });
});
