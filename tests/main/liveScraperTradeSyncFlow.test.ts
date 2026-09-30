import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TradeEvent, TradeItem } from "../../config/shared/statsTypes";
import type { TradeMatchPayload } from "../../config/shared/tradeMatch";
import type { DecodedRiven } from "../../config/shared/rivenTypes";

interface FakeCatalogItem {
  id: string;
  url_name: string;
  item_name: string;
  maxRank: number | null;
}

const h = vi.hoisted(() => ({
  directory: "",
  catalog: [] as FakeCatalogItem[],
  resolveSetMembership: vi.fn(),
  fetchLowestInGameSellPrice: vi.fn(),
  getMyOrders: vi.fn(),
  deleteOrder: vi.fn(),
  deleteRivenAuction: vi.fn(),
  isOwnedOrder: vi.fn(),
  requestRivenPass: vi.fn(),
  decodeAllRivens: vi.fn(),
}));

vi.mock("../../services/userDataPath", () => ({
  userDataPath: (...segments: string[]) => path.join(h.directory, ...segments),
}));

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../services/wfmCatalog", () => ({
  ensureLoaded: async () => h.catalog.length,
  lookupByName: (name: string) =>
    h.catalog.find((item) => item.item_name.toLowerCase() === name.toLowerCase()) ?? null,
  lookupBySlug: async (slug: string) => h.catalog.find((item) => item.url_name === slug) ?? null,
  resolveSetMembership: h.resolveSetMembership,
}));

vi.mock("../../services/liveScraperOrderBook", () => ({
  fetchLowestInGameSellPrice: h.fetchLowestInGameSellPrice,
}));

vi.mock("../../services/wfmSession", () => ({ getInGameName: () => "Me" }));

vi.mock("../../services/wfmOrders", () => ({
  getMyOrders: h.getMyOrders,
  deleteOrder: h.deleteOrder,
}));

vi.mock("../../services/wfmRivenSearch", () => ({ deleteRivenAuction: h.deleteRivenAuction }));

vi.mock("../../services/liveScraperOwnedOrders", () => ({ isOwnedOrder: h.isOwnedOrder }));

vi.mock("../../services/liveScraperEngine", () => ({ requestRivenPass: h.requestRivenPass }));

vi.mock("../../services/rivenFingerprint", () => ({ decodeAllRivens: h.decodeAllRivens }));

const CATALOG: FakeCatalogItem[] = [
  { id: "id-serration", url_name: "serration", item_name: "Serration", maxRank: 10 },
  {
    id: "id-chassis",
    url_name: "ash_prime_chassis",
    item_name: "Ash Prime Chassis",
    maxRank: null,
  },
  {
    id: "id-neuroptics",
    url_name: "ash_prime_neuroptics",
    item_name: "Ash Prime Neuroptics",
    maxRank: null,
  },
  { id: "id-set", url_name: "ash_prime_set", item_name: "Ash Prime Set", maxRank: null },
  { id: "id-flow", url_name: "primed_flow", item_name: "Primed Flow", maxRank: 10 },
];

function item(displayName: string, count: number, direction: TradeItem["direction"]): TradeItem {
  return { internalName: "", displayName, count, direction };
}

function trade(type: TradeEvent["type"], platChange: number, items: TradeItem[]): TradeEvent {
  return { id: `t-${Math.random()}`, date: "2026-09-30T10:00:00.000Z", type, platChange, items };
}

function ownedRiven(itemId: string, rivenName: string): DecodedRiven {
  return {
    itemId,
    weaponName: "Rubico",
    weaponUniqueName: "/Lotus/Weapons/Rubico",
    rivenName,
    masteryReq: 10,
    currentRank: 0,
    maxRank: 8,
    rerolls: 0,
    polarity: "madurai",
    disposition: 1,
    stats: [
      {
        tag: "WeaponCritChanceMod",
        name: "Critical Chance",
        displayValue: 20,
        maxRankValue: 180,
        rollFloat: 0.5,
        grade: "B",
        positive: true,
        multiplier: false,
      },
    ],
    overallGrade: "B",
    attributeGrade: "Good",
    statPerfectness: 0.5,
    rivenType: "Rifle",
  };
}

const deps = { onChanged: vi.fn(), onNotice: vi.fn(), getInventory: vi.fn() };

/** Fresh module state over the current directory, as after an app restart. */
async function loadModules() {
  vi.resetModules();
  const sync = await import("../../services/liveScraperTradeSync");
  sync.initLiveScraperTradeSync(deps);
  return {
    sync,
    stock: await import("../../services/liveScraperStock"),
    rivens: await import("../../services/liveScraperRivenStock"),
    settings: await import("../../services/liveScraperSettings"),
  };
}

function readSyncFile(): { pendingRivens: unknown[]; notices: unknown[] } {
  return JSON.parse(
    fs.readFileSync(path.join(h.directory, "live-scraper-trade-sync.json"), "utf8"),
  );
}

describe("live scraper trade sync", () => {
  beforeEach(() => {
    h.directory = fs.mkdtempSync(path.join(os.tmpdir(), "trade-sync-"));
    h.catalog = CATALOG;
    for (const mock of [
      h.resolveSetMembership,
      h.fetchLowestInGameSellPrice,
      h.getMyOrders,
      h.deleteOrder,
      h.deleteRivenAuction,
      h.isOwnedOrder,
      h.requestRivenPass,
      h.decodeAllRivens,
      deps.onChanged,
      deps.onNotice,
      deps.getInventory,
    ]) {
      mock.mockReset();
    }
    h.resolveSetMembership.mockResolvedValue({ kind: "not-set" });
    h.getMyOrders.mockResolvedValue({ sell: [], buy: [] });
    h.deleteOrder.mockResolvedValue({ deleted: true });
    h.deleteRivenAuction.mockResolvedValue({ ok: true });
    h.isOwnedOrder.mockReturnValue(false);
    deps.getInventory.mockReturnValue(null);
  });

  afterEach(() => {
    fs.rmSync(h.directory, { recursive: true, force: true });
  });

  it("puts a one-kind purchase into WTS at the price per piece, ranked and tagged", async () => {
    const { sync, stock } = await loadModules();

    await sync.syncConfirmedTrade(
      trade("purchase", 90, [item("Serration (RANK 3)", 3, "received")]),
      [],
    );

    expect(stock.listStockItems()).toEqual([
      expect.objectContaining({
        wfmId: "serration",
        subType: { rank: 3 },
        owned: 3,
        bought: 30,
        origin: "trade",
      }),
    ]);
    expect(h.fetchLowestInGameSellPrice).not.toHaveBeenCalled();
    expect(deps.onChanged).toHaveBeenCalled();
    expect(deps.onNotice).not.toHaveBeenCalled();
    expect(sync.listTradeSyncNotices()).toEqual([]);
  });

  it("reads an unranked name of a rankable item as rank 0, so it merges with a row added by hand", async () => {
    const { sync, stock } = await loadModules();
    const manual = stock.createStockItem({
      wfmId: "serration",
      wfmUrl: "serration",
      itemName: "Serration",
      subType: { rank: 0 },
      owned: 1,
      bought: 20,
    });

    await sync.syncConfirmedTrade(trade("purchase", 40, [item("Serration", 1, "received")]), []);

    expect(stock.listStockItems()).toEqual([
      expect.objectContaining({ id: manual.id, subType: { rank: 0 }, owned: 2, bought: 30 }),
    ]);
  });

  it("tops up a row, averages the cost and works the purchase off the wishlist", async () => {
    const { sync, stock } = await loadModules();
    const manual = stock.createStockItem({
      wfmId: "serration",
      wfmUrl: "serration",
      itemName: "Serration",
      subType: { rank: 10 },
      owned: 1,
      bought: 10,
    });
    stock.createWishlistItem({
      wfmId: "serration",
      wfmUrl: "serration",
      itemName: "Serration",
      subType: { rank: 10 },
      quantity: 3,
    });
    const flowWish = stock.createWishlistItem({
      wfmId: "primed_flow",
      wfmUrl: "primed_flow",
      itemName: "Primed Flow",
      subType: { rank: 0 },
      quantity: 1,
    });
    h.fetchLowestInGameSellPrice.mockImplementation(async (slug: string) =>
      slug === "serration" ? 20 : 60,
    );
    h.getMyOrders.mockResolvedValue({
      sell: [],
      buy: [{ id: "buy-flow", itemId: "id-flow", modRank: 0, subtype: null }],
    });
    h.isOwnedOrder.mockImplementation((id: string) => id === "buy-flow");

    await sync.syncConfirmedTrade(
      trade("purchase", 100, [
        item("Serration (RANK 10)", 2, "received"),
        item("Primed Flow (RANK 0)", 1, "received"),
      ]),
      [],
    );

    // Weights 2 x 20 and 1 x 60: 20p per Serration, 60p for the Primed Flow.
    const serration = stock.listStockItems().find((row) => row.id === manual.id);
    expect(serration).toMatchObject({ owned: 3, bought: 17, origin: "trade" });
    expect(stock.listStockItems().find((row) => row.wfmId === "primed_flow")).toMatchObject({
      owned: 1,
      bought: 60,
      origin: "trade",
    });
    expect(stock.listWishlistItems().map((row) => [row.wfmId, row.quantity])).toEqual([
      ["serration", 1],
    ]);
    expect(stock.listWishlistItems().some((row) => row.id === flowWish.id)).toBe(false);
    // The emptied wishlist row takes the scraper's own buy order with it.
    expect(h.deleteOrder).toHaveBeenCalledWith("buy-flow");

    expect(deps.onNotice).toHaveBeenCalledTimes(1);
    expect(sync.listTradeSyncNotices()).toEqual([
      expect.objectContaining({
        platinum: 100,
        split: "market",
        rows: [
          { name: "Serration", quantity: 2, bought: 20 },
          { name: "Primed Flow", quantity: 1, bought: 60 },
        ],
      }),
    ]);
  });

  it("splits evenly when one kind has no in-game offer, and still enters every item", async () => {
    const { sync, stock } = await loadModules();
    h.fetchLowestInGameSellPrice.mockImplementation(async (slug: string) =>
      slug === "serration" ? 20 : null,
    );

    await sync.syncConfirmedTrade(
      trade("purchase", 90, [
        item("Serration (RANK 10)", 2, "received"),
        item("Ash Prime Chassis", 1, "received"),
      ]),
      [],
    );

    expect(stock.listStockItems().map((row) => [row.wfmId, row.owned, row.bought])).toEqual([
      ["serration", 2, 30],
      ["ash_prime_chassis", 1, 30],
    ]);
    expect(sync.listTradeSyncNotices()[0]).toMatchObject({ split: "even" });
  });

  it("enters exactly all parts of one set as the set", async () => {
    const { sync, stock } = await loadModules();
    h.resolveSetMembership.mockResolvedValue({
      kind: "set",
      setSlug: "ash_prime_set",
      parts: [
        { slug: "ash_prime_chassis", quantityInSet: 1 },
        { slug: "ash_prime_neuroptics", quantityInSet: 1 },
      ],
    });

    await sync.syncConfirmedTrade(
      trade("purchase", 120, [
        item("Ash Prime Chassis", 1, "received"),
        item("Ash Prime Neuroptics", 1, "received"),
      ]),
      [],
    );

    expect(stock.listStockItems()).toEqual([
      expect.objectContaining({
        wfmId: "ash_prime_set",
        itemName: "Ash Prime Set",
        owned: 1,
        bought: 120,
      }),
    ]);
    expect(h.fetchLowestInGameSellPrice).not.toHaveBeenCalled();
    expect(deps.onNotice).not.toHaveBeenCalled();
  });

  it("lowers owned on a sale and deletes only the scraper's own order of an emptied row", async () => {
    const { sync, stock } = await loadModules();
    const add = (wfmId: string, itemName: string, owned: number) =>
      stock.createStockItem({ wfmId, wfmUrl: wfmId, itemName, owned, bought: 0 });
    const serration = stock.createStockItem({
      wfmId: "serration",
      wfmUrl: "serration",
      itemName: "Serration",
      subType: { rank: 10 },
      owned: 2,
      bought: 0,
    });
    const chassis = add("ash_prime_chassis", "Ash Prime Chassis", 1);
    const neuroptics = add("ash_prime_neuroptics", "Ash Prime Neuroptics", 1);
    const flow = stock.createStockItem({
      wfmId: "primed_flow",
      wfmUrl: "primed_flow",
      itemName: "Primed Flow",
      subType: { rank: 10 },
      owned: 1,
      bought: 0,
    });
    h.getMyOrders.mockResolvedValue({
      sell: [
        { id: "sell-chassis", itemId: "id-chassis", modRank: null, subtype: null },
        { id: "sell-neuroptics", itemId: "id-neuroptics", modRank: null, subtype: null },
      ],
      buy: [],
    });
    // Only the neuroptics listing is the scraper's; the chassis one the user
    // placed, and the Primed Flow order the auto-close already took down.
    h.isOwnedOrder.mockImplementation((id: string) => id === "sell-neuroptics");

    await sync.syncConfirmedTrade(
      trade("sale", 200, [
        item("Serration (RANK 10)", 1, "given"),
        item("Ash Prime Chassis", 1, "given"),
        item("Ash Prime Neuroptics", 1, "given"),
        item("Primed Flow (RANK 10)", 1, "given"),
      ]),
      [],
    );

    expect(stock.listStockItems().map((row) => [row.id, row.owned])).toEqual([[serration.id, 1]]);
    const gone = [chassis.id, neuroptics.id, flow.id];
    expect(stock.listStockItems().some((row) => gone.includes(row.id))).toBe(false);
    expect(h.deleteOrder).toHaveBeenCalledTimes(1);
    expect(h.deleteOrder).toHaveBeenCalledWith("sell-neuroptics");
    expect(deps.onChanged).toHaveBeenCalled();
  });

  describe("selling the parts of a set", () => {
    const ashPrime = {
      kind: "set",
      setSlug: "ash_prime_set",
      parts: [
        { slug: "ash_prime_chassis", quantityInSet: 1 },
        { slug: "ash_prime_neuroptics", quantityInSet: 1 },
      ],
    };
    const soldParts = (copies: number) =>
      trade("sale", 150 * copies, [
        item("Ash Prime Chassis", copies, "given"),
        item("Ash Prime Neuroptics", copies, "given"),
      ]);

    async function stockWith(rows: [wfmId: string, owned: number][]) {
      const modules = await loadModules();
      for (const [wfmId, owned] of rows) {
        modules.stock.createStockItem({ wfmId, wfmUrl: wfmId, itemName: wfmId, owned, bought: 0 });
      }
      return modules;
    }

    beforeEach(() => {
      h.resolveSetMembership.mockResolvedValue(ashPrime);
    });

    it("takes complete copies off the set row and leaves the part rows alone", async () => {
      const { sync, stock } = await stockWith([
        ["ash_prime_set", 3],
        ["ash_prime_chassis", 1],
        ["ash_prime_neuroptics", 1],
      ]);

      await sync.syncConfirmedTrade(soldParts(2), []);

      expect(stock.listStockItems().map((row) => [row.wfmId, row.owned])).toEqual([
        ["ash_prime_set", 1],
        ["ash_prime_chassis", 1],
        ["ash_prime_neuroptics", 1],
      ]);
    });

    it("removes the set row at 0 through the gated removal", async () => {
      const { sync, stock } = await stockWith([
        ["ash_prime_set", 1],
        ["ash_prime_chassis", 1],
      ]);
      h.getMyOrders.mockResolvedValue({
        sell: [
          { id: "sell-set", itemId: "id-set", modRank: null, subtype: null },
          { id: "sell-chassis", itemId: "id-chassis", modRank: null, subtype: null },
        ],
        buy: [],
      });
      h.isOwnedOrder.mockImplementation((id: string) => id === "sell-set");

      await sync.syncConfirmedTrade(soldParts(1), []);

      expect(stock.listStockItems().map((row) => [row.wfmId, row.owned])).toEqual([
        ["ash_prime_chassis", 1],
      ]);
      expect(h.deleteOrder).toHaveBeenCalledTimes(1);
      expect(h.deleteOrder).toHaveBeenCalledWith("sell-set");
    });

    it("matches the part rows when no set row exists", async () => {
      const { sync, stock } = await stockWith([
        ["ash_prime_chassis", 1],
        ["ash_prime_neuroptics", 2],
      ]);

      await sync.syncConfirmedTrade(soldParts(1), []);

      expect(stock.listStockItems().map((row) => [row.wfmId, row.owned])).toEqual([
        ["ash_prime_neuroptics", 1],
      ]);
    });
  });

  it("ignores a swap and leaves a side whose switch is off alone", async () => {
    const { sync, stock, settings } = await loadModules();

    await sync.syncConfirmedTrade(
      trade("trade", 0, [item("Serration (RANK 0)", 1, "received")]),
      [],
    );
    expect(stock.listStockItems()).toEqual([]);

    const current = settings.getLiveScraperSettings();
    settings.setLiveScraperSettings({
      ...current,
      general: { ...current.general, tradeSyncItems: false },
    });
    await sync.syncConfirmedTrade(
      trade("purchase", 50, [item("Serration (RANK 0)", 1, "received")]),
      [],
    );
    expect(stock.listStockItems()).toEqual([]);
  });

  it("keeps a bought riven pending until the inventory shows it, across a restart", async () => {
    const first = await loadModules();

    await first.sync.syncConfirmedTrade(
      trade("purchase", 500, [item("Rubico Visio-Critatis (RIVEN RANK 0)", 1, "received")]),
      [],
    );

    expect(first.rivens.listStockRivens()).toEqual([]);
    expect(readSyncFile().pendingRivens).toEqual([
      expect.objectContaining({
        weaponName: "Rubico",
        rivenName: "Rubico Visio-Critatis",
        bought: 500,
      }),
    ]);

    const { sync, rivens } = await loadModules();
    h.decodeAllRivens.mockReturnValue({
      unveiled: [
        ownedRiven("r-old", "Rubico Croni-tempis"),
        ownedRiven("r-new", "Rubico Visio-critatis"),
      ],
      veiled: [],
      veiledUnseen: [],
    });
    sync.resolvePendingTradeRivens({ Upgrades: [] });

    expect(rivens.listStockRivens()).toEqual([
      expect.objectContaining({
        sourceItemId: "r-new",
        rivenName: "Rubico Visio-critatis",
        modRank: 8,
        bought: 500,
        origin: "trade",
        stats: [{ tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 180 }],
      }),
    ]);
    expect(readSyncFile().pendingRivens).toEqual([]);
    expect(h.requestRivenPass).toHaveBeenCalled();
    expect(deps.onChanged).toHaveBeenCalled();
  });

  it("splits evenly when a riven is part of the purchase", async () => {
    const { sync, stock } = await loadModules();

    await sync.syncConfirmedTrade(
      trade("purchase", 300, [
        item("Serration (RANK 10)", 2, "received"),
        item("Rubico Visio-Critatis (RIVEN RANK 0)", 1, "received"),
      ]),
      [],
    );

    expect(h.fetchLowestInGameSellPrice).not.toHaveBeenCalled();
    expect(stock.listStockItems()).toEqual([expect.objectContaining({ owned: 2, bought: 100 })]);
    expect(sync.listTradeSyncNotices()[0]).toMatchObject({
      split: "even",
      rows: [
        { name: "Serration", quantity: 2, bought: 100 },
        { name: "Rubico Visio-Critatis", quantity: 1, bought: 100 },
      ],
    });
  });

  it("removes a sold stock riven and skips an auction the auto-close already closed", async () => {
    const { sync, rivens } = await loadModules();
    const base = {
      sourceItemId: "",
      weaponName: "Rubico",
      masteryReq: 8,
      rerolls: 0,
      polarity: "madurai",
      modRank: 8,
      stats: [{ tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 100 }],
      bought: 0,
    };
    const closedOne = rivens.createStockRiven({ ...base, rivenName: "Rubico Visio-critatis" });
    const openOne = rivens.createStockRiven({ ...base, rivenName: "Rubico Croni-tempis" });
    rivens.updateStockRiven(closedOne.id, { auctionId: "auction-closed" });
    rivens.updateStockRiven(openOne.id, { auctionId: "auction-open" });
    const closed: TradeMatchPayload[] = [
      {
        kind: "contract",
        orderId: "auction-closed",
        itemName: "Rubico Visio-Critatis",
        itemUrlName: "rubico",
        itemThumb: null,
        quantity: 1,
        platinum: 400,
        partner: "Buyer",
        type: "sale",
      },
    ];

    await sync.syncConfirmedTrade(
      trade("sale", 700, [
        item("Rubico Visio-Critatis (RIVEN RANK 8)", 1, "given"),
        item("Rubico Croni-Tempis (RIVEN RANK 8)", 1, "given"),
      ]),
      closed,
    );

    expect(rivens.listStockRivens()).toEqual([]);
    expect(h.deleteRivenAuction).toHaveBeenCalledTimes(1);
    expect(h.deleteRivenAuction).toHaveBeenCalledWith("auction-open");
  });

  it("keeps a notice across a restart until it is acknowledged", async () => {
    const first = await loadModules();
    h.fetchLowestInGameSellPrice.mockResolvedValue(10);
    await first.sync.syncConfirmedTrade(
      trade("purchase", 40, [
        item("Serration (RANK 10)", 1, "received"),
        item("Ash Prime Chassis", 1, "received"),
      ]),
      [],
    );
    const [notice] = first.sync.listTradeSyncNotices();
    expect(notice).toBeDefined();

    const second = await loadModules();
    expect(second.sync.listTradeSyncNotices().map((entry) => entry.id)).toEqual([notice.id]);
    expect(second.sync.acknowledgeTradeSyncNotice(notice.id)).toBe(true);
    expect(second.sync.acknowledgeTradeSyncNotice(notice.id)).toBe(false);

    const third = await loadModules();
    expect(third.sync.listTradeSyncNotices()).toEqual([]);
  });
});
