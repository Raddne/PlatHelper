import { describe, expect, it } from "vitest";

import {
  planRivenAdoption,
  type AdoptableAuction,
} from "../../config/shared/liveScraperRivenAdopt";
import type { StockRiven } from "../../config/shared/liveScraperRivenStock";

const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

function auction(overrides: Partial<AdoptableAuction> = {}): AdoptableAuction {
  return {
    id: "a1",
    weaponUrlName: "rubico",
    rivenSuffix: "Crita-visican",
    buyoutPlatinum: 900,
    platinum: 900,
    isDirectSell: true,
    modRank: 8,
    rerolls: 12,
    masteryLevel: 14,
    polarity: "madurai",
    stats: [
      { urlName: "critical_chance", value: 140.2, positive: true },
      { urlName: "multishot", value: 95, positive: true },
      { urlName: "zoom", value: -40, positive: false },
    ],
    ...overrides,
  };
}

function row(overrides: Partial<StockRiven> = {}): StockRiven {
  return {
    id: "r1",
    sourceItemId: "",
    weaponName: "Rubico",
    rivenName: "Crita-visican",
    masteryReq: 14,
    rerolls: 12,
    polarity: "madurai",
    modRank: 8,
    stats: [{ tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 140.2 }],
    bought: 0,
    minPrice: null,
    listPrice: null,
    auctionId: null,
    isHidden: false,
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("riven auction adoption", () => {
  it("turns a live auction into a row with its stats and price", () => {
    const plan = planRivenAdoption([], [auction()], slugOf);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({
      auctionId: "a1",
      weaponSlug: "rubico",
      rivenName: "Crita-visican",
      listPrice: 900,
      rerolls: 12,
    });
    expect(plan.create[0]!.stats).toEqual([
      { tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 140.2 },
      { tag: "WeaponFireIterationsMod", positive: true, multiplier: false, value: 95 },
      // A negative arrives as a signed value; rows keep magnitude plus the flag.
      { tag: "WeaponZoomFovMod", positive: false, multiplier: false, value: 40 },
    ]);
  });

  it("leaves auctions it already tracks alone", () => {
    const plan = planRivenAdoption([row({ auctionId: "a1" })], [auction()], slugOf);
    expect(plan).toEqual({ create: [], link: [], remove: [] });
  });

  it("links a hand-added row without an auction instead of duplicating it", () => {
    const plan = planRivenAdoption([row()], [auction()], slugOf);
    expect(plan.create).toEqual([]);
    expect(plan.link).toEqual([{ id: "r1", auctionId: "a1", listPrice: 900 }]);
  });

  it("links a row named with its weapon to the auction that carries only the suffix", () => {
    // Rows added from the game are named "Rubico Crita-visican"; the auction
    // knows only "crita-visican". Left unlinked, the auction became a second
    // row of the same riven and the row created a second auction.
    const plan = planRivenAdoption(
      [row({ rivenName: "Rubico Crita-visican" })],
      [auction({ rivenSuffix: "crita-visican" })],
      slugOf,
    );
    expect(plan.create).toEqual([]);
    expect(plan.link).toEqual([{ id: "r1", auctionId: "a1", listPrice: 900 }]);
  });

  it("drops an adopted row once its auction is gone, but never a hand-added one", () => {
    const stock = [
      row({ id: "adopted", auctionId: "sold", adopted: true }),
      row({ id: "manual", auctionId: "closed", rivenName: "Other" }),
    ];
    expect(planRivenAdoption(stock, [], slugOf).remove).toEqual(["adopted"]);
  });

  it("skips auctions without a price or without any known stat", () => {
    const plan = planRivenAdoption(
      [],
      [
        auction({ id: "bid", buyoutPlatinum: null, platinum: 0 }),
        auction({ id: "odd", stats: [{ urlName: "not_a_stat", value: 1, positive: true }] }),
        auction({ id: "lich", weaponUrlName: null }),
      ],
      slugOf,
    );
    expect(plan.create).toEqual([]);
  });

  it("never takes over an auction that accepts bids", () => {
    // Re-pricing sends starting price = buyout, which warframe.market answers
    // with cant_convert_to_order_bids_exists once somebody has bid.
    const bidAuction = auction({ id: "bids", isDirectSell: false, buyoutPlatinum: 2000 });
    const plan = planRivenAdoption([row({ auctionId: null })], [bidAuction], slugOf);
    expect(plan.create).toEqual([]);
    expect(plan.link).toEqual([]);
  });

  it("lets go of an adopted row whose auction is a bid auction", () => {
    const stock = [row({ id: "adopted", auctionId: "bids", adopted: true })];
    const bidAuction = auction({ id: "bids", isDirectSell: false });
    expect(planRivenAdoption(stock, [bidAuction], slugOf).remove).toEqual(["adopted"]);
  });
});
