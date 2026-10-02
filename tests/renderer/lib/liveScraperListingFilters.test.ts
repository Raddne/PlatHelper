import { describe, expect, it } from "vitest";

import {
  ALL,
  STATUS_HIDDEN,
  STATUS_PAUSED,
  categoryLookup,
  countStatuses,
  defaultListingFilters,
  hasActiveFilters,
  keepPicked,
  ownedLookup,
  resetTabFilters,
  rivenFilter,
  rivenFilterOptions,
  rivenRowState,
  stockRowState,
  wtbFilter,
  wtbRowState,
  wtsFilter,
  type RivenFilters,
  type WtbFilterRow,
  type WtbFilters,
  type WtsFilters,
} from "../../../src/lib/liveScraper/listingFilters.js";
import type { StockItem } from "../../../config/shared/liveScraperStock.js";
import type { StockRiven, StockRivenStat } from "../../../config/shared/liveScraperRivenStock.js";
import type { WfmItemCategory } from "../../../config/shared/wfmItemCategory.js";
import type { ParsedItem } from "../../../src/types/inventory.js";

function wtbRow(overrides: Partial<WtbFilterRow>): WtbFilterRow {
  return {
    wfmUrl: "serration",
    itemName: "Serration",
    source: "wishlist",
    status: "live",
    listPrice: 20,
    hidden: false,
    paused: false,
    ...overrides,
  };
}

function stockItem(overrides: Partial<StockItem>): StockItem {
  return {
    id: "s1",
    wfmId: "serration",
    wfmUrl: "serration",
    itemName: "Serration",
    owned: 1,
    bought: 0,
    listPrice: 20,
    minPrice: null,
    isHidden: false,
    status: "live",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const stat = (tag: string, positive = true): StockRivenStat => ({
  tag,
  positive,
  multiplier: false,
  value: 1,
});

function riven(overrides: Partial<StockRiven>): StockRiven {
  return {
    id: "r1",
    sourceItemId: "src",
    weaponName: "Boar",
    rivenName: "Boar Sati-hexatis",
    masteryReq: 10,
    rerolls: 0,
    polarity: "madurai",
    modRank: 8,
    stats: [stat("WeaponCritChanceMod"), stat("WeaponFireIterationsMod")],
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

// What the main process answers: one resolved type per catalog slug.
const FACTS: Record<string, WfmItemCategory> = {
  serration: "mod",
  axi_h3_relic: "relic",
  vitality: "mod",
  virtuos_strike: "arcane",
};

const wtb = (overrides: Partial<WtbFilters>): WtbFilters => ({
  ...defaultListingFilters().wtb,
  ...overrides,
});
const wts = (overrides: Partial<WtsFilters>): WtsFilters => ({
  ...defaultListingFilters().wts,
  ...overrides,
});
const rv = (overrides: Partial<RivenFilters>): RivenFilters => ({
  ...defaultListingFilters().rivens,
  ...overrides,
});
type OwnedOf = (slug: string | null, name: string) => boolean;
const nobodyOwns: OwnedOf = () => false;

describe("categoryLookup", () => {
  it("takes the main process's answer for a catalog slug", () => {
    const categoryOf = categoryLookup(FACTS);
    expect(categoryOf("serration", "Serration")).toBe("mod");
    expect(categoryOf("virtuos_strike", "Virtuos Strike")).toBe("arcane");
    expect(categoryOf("vitality", "Vitality")).toBe("mod");
  });

  it("decides from slug and name alone until the answer is in", () => {
    const categoryOf = categoryLookup({});
    expect(categoryOf("ash_prime_set", "Ash Prime Set")).toBe("set");
    expect(categoryOf("axi_h3_relic", "Axi H3 Relic")).toBe("relic");
    expect(categoryOf("ash_prime_chassis", "Ash Prime Chassis")).toBe("part");
    expect(categoryOf("braton_receiver", "Braton Receiver")).toBe("part");
    // Neither game path nor rank is known yet, so a mod reads as misc.
    expect(categoryOf("vitality", "Vitality")).toBe("misc");
    expect(categoryOf(null, "Kuva")).toBe("misc");
  });
});

describe("ownedLookup", () => {
  const inventory = [{ name: "Serration", amount: 2 } as ParsedItem];

  it("reads the loaded inventory", () => {
    const ownedOf = ownedLookup(inventory, {}, []);
    expect(ownedOf("serration", "Serration")).toBe(true);
    expect(ownedOf("vitality", "Vitality")).toBe(false);
  });

  it("falls back to stock rows that still hold one when no inventory is loaded", () => {
    const ownedOf = ownedLookup([], {}, [
      stockItem({ wfmUrl: "vitality", owned: 1 }),
      stockItem({ id: "s2", wfmUrl: "serration", owned: 0 }),
    ]);
    expect(ownedOf("vitality", "Vitality")).toBe(true);
    expect(ownedOf("serration", "Serration")).toBe(false);
  });
});

describe("wtbFilter", () => {
  const rows = [
    wtbRow({ wfmUrl: "serration", itemName: "Serration" }),
    wtbRow({ wfmUrl: "axi_h3_relic", itemName: "Axi H3 Relic", source: "scan", status: "budget" }),
    wtbRow({ wfmUrl: "vitality", itemName: "Vitality", listPrice: 12, hidden: true }),
    wtbRow({ wfmUrl: "forma", itemName: "Forma", status: "pending", paused: true }),
  ];
  const names = (filters: WtbFilters, ownedOf: OwnedOf = nobodyOwns): string[] =>
    rows.filter(wtbFilter(filters, categoryLookup(FACTS), ownedOf)).map((row) => row.itemName);

  it("narrows by type, source and owned", () => {
    expect(names(wtb({ type: "mod" }))).toEqual(["Serration", "Vitality"]);
    expect(names(wtb({ type: "relic" }))).toEqual(["Axi H3 Relic"]);
    expect(names(wtb({ source: "scan" }))).toEqual(["Axi H3 Relic"]);
    const ownsSerration = (slug: string | null): boolean => slug === "serration";
    expect(names(wtb({ owned: "yes" }), ownsSerration)).toEqual(["Serration"]);
    expect(names(wtb({ owned: "no" }), ownsSerration)).toEqual([
      "Axi H3 Relic",
      "Vitality",
      "Forma",
    ]);
  });

  it("narrows by status, the hidden-on-WFM state and paused rows", () => {
    expect(names(wtb({ status: "budget" }))).toEqual(["Axi H3 Relic"]);
    expect(names(wtb({ status: STATUS_HIDDEN }))).toEqual(["Vitality"]);
    expect(names(wtb({ status: STATUS_PAUSED }))).toEqual(["Forma"]);
  });

  it("combines filters", () => {
    expect(names(wtb({ type: "mod", status: STATUS_HIDDEN }))).toEqual(["Vitality"]);
    expect(names(wtb({ type: "relic", source: "wishlist" }))).toEqual([]);
  });

  it("only counts a row hidden when it has a live listing, like the status badge", () => {
    expect(wtbRowState(wtbRow({ listPrice: null, hidden: true })).hidden).toBe(false);
    expect(wtbRowState(wtbRow({ listPrice: 5, hidden: true })).hidden).toBe(true);
    expect(stockRowState(stockItem({ listPrice: null, wfmHidden: true })).hidden).toBe(false);
    expect(rivenRowState(riven({ auctionId: null, wfmHidden: true })).hidden).toBe(false);
    expect(rivenRowState(riven({ auctionId: "a1", wfmHidden: true })).hidden).toBe(true);
  });
});

describe("wtsFilter", () => {
  const stock = [
    stockItem({ id: "hand", itemName: "Serration" }),
    stockItem({ id: "trade", wfmUrl: "axi_h3_relic", itemName: "Axi H3 Relic", origin: "trade" }),
    stockItem({ id: "wfm", wfmUrl: "vitality", itemName: "Vitality", adopted: true }),
    stockItem({ id: "both", wfmUrl: "forma", itemName: "Forma", adopted: true, origin: "trade" }),
  ];
  const ids = (filters: WtsFilters): string[] =>
    stock.filter(wtsFilter(filters, categoryLookup(FACTS))).map((item) => item.id);

  it("tells trade, hand-added and taken-over rows apart, taken-over winning", () => {
    expect(ids(wts({ origin: "trade" }))).toEqual(["trade"]);
    expect(ids(wts({ origin: "manual" }))).toEqual(["hand"]);
    expect(ids(wts({ origin: "adopted" }))).toEqual(["wfm", "both"]);
  });

  it("narrows by type and paused rows", () => {
    expect(ids(wts({ type: "mod" }))).toEqual(["hand", "wfm"]);
    const paused = [...stock, stockItem({ id: "paused", isHidden: true })];
    expect(
      paused
        .filter(wtsFilter(wts({ status: STATUS_PAUSED }), categoryLookup(FACTS)))
        .map((item) => item.id),
    ).toEqual(["paused"]);
  });
});

describe("rivenFilter", () => {
  const rivens = [
    riven({ id: "crit-ms", stats: [stat("WeaponCritChanceMod"), stat("WeaponFireIterationsMod")] }),
    riven({
      id: "crit-cd-neg",
      weaponName: "Rubico",
      polarity: "naramon",
      rerolls: 4,
      masteryReq: 14,
      stats: [
        stat("WeaponCritChanceMod"),
        stat("WeaponCritDamageMod"),
        stat("WeaponZoomFovMod", false),
      ],
    }),
    riven({
      id: "ms-neg",
      masteryReq: 8,
      rerolls: 1,
      stats: [stat("WeaponFireIterationsMod"), stat("WeaponRecoilReductionMod", false)],
    }),
  ];
  const ids = (filters: RivenFilters): string[] =>
    rivens.filter(rivenFilter(filters)).map((entry) => entry.id);

  it("needs every picked positive", () => {
    expect(ids(rv({ positives: ["WeaponCritChanceMod"] }))).toEqual(["crit-ms", "crit-cd-neg"]);
    expect(ids(rv({ positives: ["WeaponCritChanceMod", "WeaponFireIterationsMod"] }))).toEqual([
      "crit-ms",
    ]);
    // A stat rolled as the negative is not a positive.
    expect(ids(rv({ positives: ["WeaponZoomFovMod"] }))).toEqual([]);
  });

  it("narrows by negative: none, has one, or one stat", () => {
    expect(ids(rv({ negative: "none" }))).toEqual(["crit-ms"]);
    expect(ids(rv({ negative: "some" }))).toEqual(["crit-cd-neg", "ms-neg"]);
    expect(ids(rv({ negative: "WeaponZoomFovMod" }))).toEqual(["crit-cd-neg"]);
  });

  it("narrows by weapon, polarity, rerolls and mastery rank", () => {
    expect(ids(rv({ weapon: "Rubico" }))).toEqual(["crit-cd-neg"]);
    expect(ids(rv({ polarity: "madurai" }))).toEqual(["crit-ms", "ms-neg"]);
    expect(ids(rv({ rerolls: "unrolled" }))).toEqual(["crit-ms"]);
    expect(ids(rv({ rerolls: "rolled" }))).toEqual(["crit-cd-neg", "ms-neg"]);
    expect(ids(rv({ mr: "8" }))).toEqual(["ms-neg"]);
    expect(ids(rv({ mr: "12" }))).toEqual(["crit-ms", "ms-neg"]);
    expect(ids(rv({ mr: "16" }))).toEqual(["crit-ms", "crit-cd-neg", "ms-neg"]);
  });

  it("offers only what the tracked rivens have, stats sorted by display name", () => {
    expect(rivenFilterOptions(rivens)).toEqual({
      weapons: ["Boar", "Rubico"],
      positives: ["WeaponCritChanceMod", "WeaponCritDamageMod", "WeaponFireIterationsMod"],
      negatives: ["WeaponRecoilReductionMod", "WeaponZoomFovMod"],
      polarities: ["madurai", "naramon"],
    });
  });

  it("never offers a stored value spelled like a fixed entry, which would repeat its key", () => {
    const odd = [
      riven({
        id: "odd",
        weaponName: ALL,
        polarity: ALL,
        stats: [stat(ALL), stat("none", false), stat("some", false), stat(ALL, false)],
      }),
      riven({ id: "plain", stats: [stat("WeaponZoomFovMod", false)] }),
    ];
    expect(rivenFilterOptions(odd)).toEqual({
      weapons: ["Boar"],
      positives: [ALL],
      negatives: ["WeaponZoomFovMod"],
      polarities: ["madurai"],
    });
  });
});

describe("filter state", () => {
  it("is active per tab and resets one tab alone", () => {
    const filters = defaultListingFilters();
    expect(hasActiveFilters(filters, "wtb")).toBe(false);
    filters.wtb.owned = "yes";
    filters.rivens.positives = ["WeaponCritChanceMod"];
    expect(hasActiveFilters(filters, "wtb")).toBe(true);
    expect(hasActiveFilters(filters, "wts")).toBe(false);
    expect(hasActiveFilters(filters, "rivens")).toBe(true);

    resetTabFilters(filters, "wtb");
    expect(hasActiveFilters(filters, "wtb")).toBe(false);
    expect(filters.rivens.positives).toEqual(["WeaponCritChanceMod"]);
  });

  it("counts statuses, hidden and paused rows", () => {
    const counts = countStatuses([
      { status: "live", hidden: true, paused: false },
      { status: "live", hidden: false, paused: false },
      { status: "pending", hidden: false, paused: true },
    ]);
    expect([...counts.byStatus]).toEqual([
      ["live", 2],
      ["pending", 1],
    ]);
    expect(counts.hidden).toBe(1);
    expect(counts.paused).toBe(1);
  });

  it("keeps a picked value listed once its rows are gone", () => {
    expect(keepPicked(["Boar"], ["Rubico"])).toEqual(["Boar", "Rubico"]);
    expect(keepPicked(["Boar"], [ALL])).toEqual(["Boar"]);
    expect(keepPicked(["WeaponZoomFovMod"], ["none"])).toEqual(["WeaponZoomFovMod"]);
  });
});
