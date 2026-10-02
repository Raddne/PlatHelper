import { describe, expect, it } from "vitest";

import {
  defaultLiveScraperSettings,
  normalizeLiveScraperSettings,
} from "../../config/shared/liveScraperSettings";
import {
  completeSetCount,
  normalizeLiveScraperTradeSyncFile,
  PENDING_RIVEN_TTL_MS,
  planRivenSale,
  planStockAfterSale,
  planWishlistAfterPurchase,
  queueNotice,
  resolvePendingRivens,
  splitPurchasePrice,
  stockRivenFromOwned,
  type PendingTradeRiven,
  type TradeSyncNotice,
} from "../../config/shared/liveScraperTradeSync";
import type { StockItem, WishlistItem } from "../../config/shared/liveScraperStock";
import type { StockRiven } from "../../config/shared/liveScraperRivenStock";
import type { DecodedRiven } from "../../config/shared/rivenTypes";

function stockRow(id: string, wfmId: string, owned: number, rank?: number): StockItem {
  return {
    id,
    wfmId,
    wfmUrl: wfmId,
    itemName: wfmId,
    subType: rank == null ? undefined : { rank },
    owned,
    bought: 0,
    listPrice: null,
    minPrice: null,
    isHidden: false,
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
  };
}

function wishRow(id: string, wfmId: string, quantity: number, rank?: number): WishlistItem {
  return {
    id,
    wfmId,
    wfmUrl: wfmId,
    itemName: wfmId,
    subType: rank == null ? undefined : { rank },
    quantity,
    listPrice: null,
    maxPrice: null,
    minPrice: null,
    isHidden: false,
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
  };
}

function stockRiven(id: string, weaponName: string, rivenName: string): StockRiven {
  return {
    id,
    sourceItemId: `src-${id}`,
    weaponName,
    rivenName,
    masteryReq: 8,
    rerolls: 0,
    polarity: "madurai",
    modRank: 8,
    stats: [{ tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 100 }],
    bought: 0,
    minPrice: null,
    listPrice: null,
    auctionId: null,
    isHidden: false,
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
  };
}

function ownedRiven(itemId: string, weaponName: string, rivenName: string): DecodedRiven {
  return {
    itemId,
    weaponName,
    weaponUniqueName: `/Lotus/Weapons/${weaponName}`,
    rivenName,
    masteryReq: 12,
    currentRank: 0,
    maxRank: 8,
    rerolls: 3,
    polarity: "naramon",
    disposition: 1.2,
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
    sheetRating: null,
    statPerfectness: 0.5,
    rivenType: "Rifle",
  };
}

describe("price split of one purchase", () => {
  it("divides a single kind by its count", () => {
    expect(splitPurchasePrice(100, [{ count: 3, lowestPrice: 50 }])).toEqual({
      split: null,
      perPiece: [33],
    });
  });

  it("weighs several kinds by lowest offer times count", () => {
    const result = splitPurchasePrice(100, [
      { count: 1, lowestPrice: 30 },
      { count: 2, lowestPrice: 10 },
    ]);

    // Weights 30 and 20: the first kind carries 60p, each of the other two 20p.
    expect(result).toEqual({ split: "market", perPiece: [60, 20] });
  });

  it("rounds each piece to whole platinum", () => {
    expect(
      splitPurchasePrice(100, [
        { count: 1, lowestPrice: 10 },
        { count: 1, lowestPrice: 10 },
        { count: 1, lowestPrice: 10 },
      ]).perPiece,
    ).toEqual([33, 33, 33]);
    expect(
      splitPurchasePrice(50, [
        { count: 1, lowestPrice: 1 },
        { count: 1, lowestPrice: 2 },
      ]).perPiece,
    ).toEqual([17, 33]);
  });

  it("splits evenly per piece when one kind has no offer", () => {
    expect(
      splitPurchasePrice(100, [
        { count: 1, lowestPrice: 30 },
        { count: 2, lowestPrice: null },
      ]),
    ).toEqual({ split: "even", perPiece: [33, 33] });
  });

  it("treats a price of zero as no offer", () => {
    expect(
      splitPurchasePrice(90, [
        { count: 1, lowestPrice: 0 },
        { count: 2, lowestPrice: 40 },
      ]),
    ).toEqual({ split: "even", perPiece: [30, 30] });
  });
});

describe("complete set detection", () => {
  const ashPrime = {
    setSlug: "ash_prime_set",
    parts: [
      { slug: "ash_prime_blueprint", quantityInSet: 1 },
      { slug: "ash_prime_chassis", quantityInSet: 1 },
      { slug: "ash_prime_neuroptics", quantityInSet: 1 },
      { slug: "ash_prime_systems", quantityInSet: 1 },
    ],
  };
  const allParts = ashPrime.parts.map((part) => ({ wfmId: part.slug, count: 1 }));

  it("finds one set in exactly its parts", () => {
    expect(completeSetCount(allParts, ashPrime)).toBe(1);
  });

  it("counts several complete copies", () => {
    expect(
      completeSetCount(
        allParts.map((part) => ({ ...part, count: 2 })),
        ashPrime,
      ),
    ).toBe(2);
  });

  it("needs every part", () => {
    expect(completeSetCount(allParts.slice(1), ashPrime)).toBeNull();
  });

  it("rejects anything besides the parts", () => {
    expect(completeSetCount([...allParts, { wfmId: "serration", count: 1 }], ashPrime)).toBeNull();
  });

  it("rejects uneven part counts", () => {
    expect(
      completeSetCount([{ ...allParts[0], count: 2 }, ...allParts.slice(1)], ashPrime),
    ).toBeNull();
  });

  it("honours parts a set holds more than once", () => {
    const dualBlade = {
      setSlug: "dual_kamas_prime_set",
      parts: [
        { slug: "dual_kamas_prime_blueprint", quantityInSet: 1 },
        { slug: "dual_kamas_prime_blade", quantityInSet: 2 },
      ],
    };

    expect(
      completeSetCount(
        [
          { wfmId: "dual_kamas_prime_blueprint", count: 1 },
          { wfmId: "dual_kamas_prime_blade", count: 2 },
        ],
        dualBlade,
      ),
    ).toBe(1);
    expect(
      completeSetCount(
        [
          { wfmId: "dual_kamas_prime_blueprint", count: 1 },
          { wfmId: "dual_kamas_prime_blade", count: 1 },
        ],
        dualBlade,
      ),
    ).toBeNull();
  });

  it("never reads a ranked item as a set part", () => {
    expect(
      completeSetCount([{ ...allParts[0], subType: { rank: 0 } }, ...allParts.slice(1)], ashPrime),
    ).toBeNull();
  });
});

describe("wishlist after a purchase", () => {
  it("lowers the quantity and removes a row that reaches zero", () => {
    const plan = planWishlistAfterPurchase(
      [wishRow("w1", "serration", 3, 10), wishRow("w2", "ash_prime_set", 1)],
      [
        { wfmId: "serration", subType: { rank: 10 }, count: 2 },
        { wfmId: "ash_prime_set", count: 1 },
      ],
    );

    expect(plan).toEqual({ update: [{ id: "w1", quantity: 1 }], remove: ["w2"] });
  });

  it("matches on the variant too", () => {
    const plan = planWishlistAfterPurchase(
      [wishRow("w1", "serration", 3, 10)],
      [{ wfmId: "serration", subType: { rank: 0 }, count: 1 }],
    );

    expect(plan).toEqual({ update: [], remove: [] });
  });
});

describe("stock after a sale", () => {
  it("lowers owned, removes an emptied row and ignores unknown items", () => {
    const plan = planStockAfterSale(
      [stockRow("s1", "serration", 3, 10), stockRow("s2", "ash_prime_set", 1)],
      [
        { wfmId: "serration", subType: { rank: 10 }, count: 1 },
        { wfmId: "ash_prime_set", count: 1 },
        { wfmId: "not_in_stock", count: 4 },
      ],
    );

    expect(plan).toEqual({ update: [{ id: "s1", owned: 2 }], remove: ["s2"] });
  });

  it("removes the row when more was sold than it held", () => {
    expect(
      planStockAfterSale([stockRow("s1", "serration", 1)], [{ wfmId: "serration", count: 3 }]),
    ).toEqual({ update: [], remove: ["s1"] });
  });

  it("leaves another rank of the same item alone", () => {
    expect(
      planStockAfterSale(
        [stockRow("s1", "serration", 2, 0)],
        [{ wfmId: "serration", subType: { rank: 10 }, count: 1 }],
      ),
    ).toEqual({ update: [], remove: [] });
  });
});

describe("pending trade rivens", () => {
  const now = 1_000_000_000_000;
  const pending = (id: string, rivenName: string, createdAt = now): PendingTradeRiven => ({
    id,
    weaponName: "Rubico",
    rivenName,
    bought: 300,
    createdAt,
  });

  it("pairs a pending riven with the owned one of the same weapon and name", () => {
    const owned = [
      ownedRiven("r1", "Rubico", "Rubico Croni-tempis"),
      ownedRiven("r2", "Rubico", "Rubico Visio-critatis"),
    ];

    const result = resolvePendingRivens(
      [pending("p1", "Rubico Visio-Critatis")],
      owned,
      new Set(),
      now,
    );

    expect(result.resolved.map((entry) => entry.riven.itemId)).toEqual(["r2"]);
    expect(result.remaining).toEqual([]);
  });

  it("skips rivens a stock row already tracks and hands each owned riven out once", () => {
    const owned = [
      ownedRiven("r1", "Rubico", "Rubico Visio-critatis"),
      ownedRiven("r2", "Rubico", "Rubico Visio-critatis"),
    ];

    const result = resolvePendingRivens(
      [pending("p1", "Rubico Visio-Critatis"), pending("p2", "Rubico Visio-Critatis")],
      owned,
      new Set(["r1"]),
      now,
    );

    expect(result.resolved.map((entry) => [entry.pending.id, entry.riven.itemId])).toEqual([
      ["p1", "r2"],
    ]);
    expect(result.remaining.map((entry) => entry.id)).toEqual(["p2"]);
  });

  it("drops an entry after seven days and keeps a younger one waiting", () => {
    const result = resolvePendingRivens(
      [
        pending("old", "Rubico Visio-Critatis", now - PENDING_RIVEN_TTL_MS - 1),
        pending("young", "Rubico Visio-Critatis", now - PENDING_RIVEN_TTL_MS + 60_000),
      ],
      [],
      new Set(),
      now,
    );

    expect(result.resolved).toEqual([]);
    expect(result.remaining.map((entry) => entry.id)).toEqual(["young"]);
  });

  it("builds the stock riven at max rank, tagged as a trade", () => {
    const input = stockRivenFromOwned(ownedRiven("r1", "Rubico", "Rubico Visio-critatis"), 300);

    expect(input).toMatchObject({
      sourceItemId: "r1",
      weaponName: "Rubico",
      rivenName: "Rubico Visio-critatis",
      masteryReq: 12,
      rerolls: 3,
      polarity: "naramon",
      modRank: 8,
      bought: 300,
      origin: "trade",
    });
    expect(input.stats).toEqual([
      { tag: "WeaponCritChanceMod", positive: true, multiplier: false, value: 180 },
    ]);
  });
});

describe("riven sale", () => {
  it("takes one stock riven per sold piece by weapon and name", () => {
    const stock = [
      stockRiven("a", "Rubico", "Rubico Visio-critatis"),
      stockRiven("b", "Rubico", "Rubico Croni-tempis"),
      stockRiven("c", "Kuva Bramma", "Kuva Bramma Visio-critatis"),
    ];

    expect(
      planRivenSale(stock, [
        { weaponName: "Rubico", rivenName: "Rubico Visio-Critatis", count: 1 },
      ]),
    ).toEqual(["a"]);
    expect(
      planRivenSale(stock, [{ weaponName: "Lanka", rivenName: "Lanka Visio-Critatis", count: 1 }]),
    ).toEqual([]);
  });
});

describe("trade notices", () => {
  const notice = (id: string): TradeSyncNotice => ({
    id,
    createdAt: 1,
    platinum: 100,
    split: "market",
    rows: [{ name: "Serration", quantity: 1, bought: 100 }],
  });

  it("queues in arrival order and caps the backlog", () => {
    let notices: TradeSyncNotice[] = [];
    for (let i = 0; i < 60; i++) notices = queueNotice(notices, notice(`n${i}`));

    expect(notices).toHaveLength(50);
    expect(notices[0].id).toBe("n10");
    expect(notices.at(-1)?.id).toBe("n59");
  });

  it("reads back what it wrote and drops what it cannot use", () => {
    const file = normalizeLiveScraperTradeSyncFile({
      version: 1,
      pendingRivens: [
        {
          id: "p1",
          weaponName: "Rubico",
          rivenName: "Rubico Visio-Critatis",
          bought: 300,
          createdAt: 5,
        },
        { id: "p2", weaponName: "Rubico" },
      ],
      notices: [notice("n1"), { id: "n2", split: "somehow", rows: [] }],
    });

    expect(file.pendingRivens.map((entry) => entry.id)).toEqual(["p1"]);
    expect(file.notices).toEqual([notice("n1")]);
    expect(normalizeLiveScraperTradeSyncFile({ version: 2 })).toEqual({
      version: 1,
      pendingRivens: [],
      notices: [],
    });
  });
});

describe("trade sync settings", () => {
  it("defaults both switches on", () => {
    expect(defaultLiveScraperSettings().general).toMatchObject({
      tradeSyncItems: true,
      tradeSyncRivens: true,
    });
  });

  it("fills them in for a file written before they existed", () => {
    const general = normalizeLiveScraperSettings({
      version: 1,
      general: { reportToWfm: false, autoTrade: false },
    }).general;

    expect(general).toMatchObject({ tradeSyncItems: true, tradeSyncRivens: true });
    // The legacy switch keeps whatever an older build stored.
    expect(general.autoTrade).toBe(false);
  });

  it("keeps a stored choice and ignores a value that is not a boolean", () => {
    const general = normalizeLiveScraperSettings({
      version: 1,
      general: { tradeSyncItems: false, tradeSyncRivens: "no" },
    }).general;

    expect(general.tradeSyncItems).toBe(false);
    expect(general.tradeSyncRivens).toBe(true);
  });
});
