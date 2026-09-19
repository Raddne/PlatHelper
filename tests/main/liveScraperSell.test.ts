import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchOrder: vi.fn(),
  updateStockItem: vi.fn(),
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../services/wfmCatalog", () => ({
  lookupBySlug: async () => ({ id: "catalog-1" }),
}));
vi.mock("../../services/liveScraperStock", () => ({
  updateStockItem: mocks.updateStockItem,
}));
vi.mock("../../services/liveScraperOrderDispatch", () => ({
  dispatchOrder: mocks.dispatchOrder,
}));

import { progressStockItem } from "../../services/liveScraperSell";
import type { ItemMarketInfo } from "../../services/liveScraperOrderBook";
import type { ItemWtsSettings } from "../../config/shared/liveScraperSettings";
import type { StockItem } from "../../config/shared/liveScraperStock";

const OFF: ItemWtsSettings = {
  aboveLowest: 0,
  minProfit: -1,
  minSma: -1,
  maxPriceDrop: -1,
  minListingsBelow: -1,
};

const MARKET: ItemMarketInfo = {
  lowestPrice: 40,
  highestPrice: 30,
  sellVolume: 5,
  buyVolume: 5,
  sellPrices: [40, 42, 45, 50, 55],
  buyPrices: [30, 28, 25, 20, 15],
};

function stockItem(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: "stock-1",
    wfmId: "serration",
    wfmUrl: "serration",
    itemName: "Serration",
    subType: undefined,
    owned: 1,
    bought: 0,
    listPrice: null,
    minPrice: null,
    isHidden: false,
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("live scraper sell pricing", () => {
  beforeEach(() => {
    mocks.dispatchOrder.mockReset();
    mocks.dispatchOrder.mockResolvedValue({ action: "created", orderId: "o1" });
    mocks.updateStockItem.mockReset();
  });

  it("matches the lowest competing listing by default", async () => {
    const result = await progressStockItem(stockItem(), MARKET, null, [], OFF);
    expect(result.price).toBe(40);
  });

  it("lists a fixed amount above the lowest listing when asked to", async () => {
    const result = await progressStockItem(stockItem(), MARKET, null, [], {
      ...OFF,
      aboveLowest: 7,
    });
    expect(result.price).toBe(47);
    expect(mocks.dispatchOrder).toHaveBeenCalledWith(expect.objectContaining({ postPrice: 47 }));
  });

  it("still never goes under the row's minimum price", async () => {
    const result = await progressStockItem(stockItem({ minPrice: 60 }), MARKET, null, [], {
      ...OFF,
      aboveLowest: 7,
    });
    expect(result.price).toBe(60);
  });
});
