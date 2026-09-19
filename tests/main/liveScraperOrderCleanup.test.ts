import { describe, expect, it } from "vitest";

import { computeOrdersToDelete as computeWithOwnership } from "../../config/shared/liveScraperOrderCleanup";
import { defaultLiveScraperSettings } from "../../config/shared/liveScraperSettings";
import type { LiveScraperSettings, TradeMode } from "../../config/shared/liveScraperSettings";
import type { CleanupOrderLike } from "../../config/shared/liveScraperOrderCleanup";

function order(id: string, orderType: "buy" | "sell", itemId = `item-${id}`): CleanupOrderLike {
  return { id, orderType, itemId, modRank: null, subtype: null };
}

function settingsWith(overrides: {
  autoDelete?: boolean;
  deleteConflictingOrders?: boolean;
  tradeModes?: TradeMode[];
  blacklist?: LiveScraperSettings["items"]["general"]["blacklist"];
}): LiveScraperSettings {
  const base = defaultLiveScraperSettings();
  return {
    ...base,
    general: {
      ...base.general,
      autoDelete: overrides.autoDelete ?? base.general.autoDelete,
      deleteConflictingOrders:
        overrides.deleteConflictingOrders ?? base.general.deleteConflictingOrders,
      tradeModes: overrides.tradeModes ?? base.general.tradeModes,
    },
    items: {
      ...base.items,
      general: {
        ...base.items.general,
        blacklist: overrides.blacklist ?? base.items.general.blacklist,
      },
    },
  };
}

// The mode and blacklist rules below are tested with every order counting as
// scraper-created; ownership has its own block at the end.
const computeOrdersToDelete = (
  settings: LiveScraperSettings,
  myOrders: { buy: CleanupOrderLike[]; sell: CleanupOrderLike[] },
  justStarted: boolean,
  isManagedSell?: (order: CleanupOrderLike) => boolean,
): string[] => computeWithOwnership(settings, myOrders, justStarted, isManagedSell, () => true);

describe("computeOrdersToDelete", () => {
  it("does nothing when both autoDelete and deleteConflictingOrders are off", () => {
    const settings = settingsWith({ autoDelete: false, deleteConflictingOrders: false });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy")], sell: [order("s1", "sell")] },
      true,
    );
    expect(ids).toEqual([]);
  });

  it("full-wipes every order on the first tick when autoDelete is on", () => {
    const settings = settingsWith({ autoDelete: true });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy"), order("b2", "buy")], sell: [order("s1", "sell")] },
      true,
      () => true,
    );
    expect(ids.sort()).toEqual(["b1", "b2", "s1"]);
  });

  it("spares blacklisted items from the first-tick full wipe", () => {
    const settings = settingsWith({
      autoDelete: true,
      blacklist: [{ wfmId: "item-b1", subType: undefined, disabledFor: ["buy"] }],
    });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy"), order("b2", "buy")], sell: [] },
      true,
    );
    expect(ids).toEqual(["b2"]);
  });

  it("does not full-wipe on a later tick even with autoDelete on", () => {
    const settings = settingsWith({ autoDelete: true, tradeModes: ["buy", "sell", "wishlist"] });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy")], sell: [order("s1", "sell")] },
      false,
    );
    expect(ids).toEqual([]);
  });

  it("wipes sell orders when Buy+WishList are active but Sell is not", () => {
    const settings = settingsWith({
      autoDelete: false,
      deleteConflictingOrders: true,
      tradeModes: ["buy", "wishlist"],
    });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy")], sell: [order("s1", "sell"), order("s2", "sell")] },
      false,
      () => true,
    );
    expect(ids.sort()).toEqual(["s1", "s2"]);
  });

  it("wipes buy orders when Sell is the only active mode", () => {
    const settings = settingsWith({ deleteConflictingOrders: true, tradeModes: ["sell"] });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy")], sell: [order("s1", "sell")] },
      false,
    );
    expect(ids).toEqual(["b1"]);
  });

  it("does nothing for any other trade-mode combination", () => {
    const settings = settingsWith({
      deleteConflictingOrders: true,
      tradeModes: ["buy", "sell", "wishlist"],
    });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy")], sell: [order("s1", "sell")] },
      false,
    );
    expect(ids).toEqual([]);
  });

  it("never full-wipes a sell order the scraper does not manage", () => {
    const settings = settingsWith({ autoDelete: true });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [order("b1", "buy")], sell: [order("manual", "sell"), order("managed", "sell")] },
      true,
      (o) => o.id === "managed",
    );
    expect(ids.sort()).toEqual(["b1", "managed"]);
  });

  it("keeps manual sell orders through the mode-mismatch cleanup too", () => {
    const settings = settingsWith({
      deleteConflictingOrders: true,
      tradeModes: ["buy", "wishlist"],
    });
    const ids = computeOrdersToDelete(
      settings,
      { buy: [], sell: [order("manual", "sell"), order("managed", "sell")] },
      false,
      (o) => o.id === "managed",
    );
    expect(ids).toEqual(["managed"]);
  });

  it("deletes no sell order at all when no managed-sell predicate is given", () => {
    const settings = settingsWith({ autoDelete: true });
    const ids = computeOrdersToDelete(settings, { buy: [], sell: [order("s1", "sell")] }, true);
    expect(ids).toEqual([]);
  });
});

describe("computeOrdersToDelete ownership", () => {
  const mine = {
    buy: [order("hand-buy", "buy"), order("own-buy", "buy")],
    sell: [order("hand-sell", "sell"), order("own-sell", "sell")],
  };
  const own = (o: CleanupOrderLike): boolean => o.id.startsWith("own-");

  it("deletes nothing at all when the caller names no own orders", () => {
    const settings = settingsWith({ autoDelete: true });
    expect(computeWithOwnership(settings, mine, true, () => true)).toEqual([]);
  });

  it("the start-up wipe only takes orders the scraper created", () => {
    const settings = settingsWith({ autoDelete: true });
    expect(computeWithOwnership(settings, mine, true, () => true, own).sort()).toEqual([
      "own-buy",
      "own-sell",
    ]);
  });

  it("the sell-only mode cleanup leaves hand-placed buy orders alone", () => {
    const settings = settingsWith({ autoDelete: true, tradeModes: ["sell"] });
    expect(computeWithOwnership(settings, mine, false, () => true, own)).toEqual(["own-buy"]);
  });
});
