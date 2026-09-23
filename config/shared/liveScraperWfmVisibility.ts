// Which warframe.market listings a hide/show from the Listings panel covers
// (services/liveScraperWfmVisibility.ts). Pure, so the matching rules are
// testable without the stores or WFM.

/** The fields of an own order (services/wfmOrders.ts's NormalisedOrder) this needs. */
interface VisibilityOrder {
  id: string;
  itemId: string | null;
  modRank: number | null;
  subtype: string | null;
  visible: boolean;
}

/** One row as the engine identifies its order: catalog id plus the variant. */
export interface VisibilityRowKey {
  id: string;
  catalogId: string;
  rank: number | null;
  subtype: string | null;
}

interface VisibilityPlan<T> {
  /** Every listing the switch covers. */
  covered: T[];
  /** The covered listings not yet in the wanted state. */
  toSwitch: T[];
}

/** Rows' orders (the engine's matchExistingOrder rule) plus whatever
 *  `alsoCovers` adds, such as catalog-scan buys that have no row. A
 *  hand-placed order that is no row stays as it is. */
export function planOrderVisibility<T extends VisibilityOrder>(
  orders: readonly T[],
  rows: readonly VisibilityRowKey[],
  alsoCovers: (order: T) => boolean,
  visible: boolean,
): VisibilityPlan<T> & { rowOrders: Map<string, T> } {
  const rowOrders = new Map<string, T>();
  for (const row of rows) {
    const order = orders.find(
      (o) =>
        o.itemId === row.catalogId &&
        (o.modRank ?? null) === row.rank &&
        (o.subtype ?? null) === row.subtype,
    );
    if (order) rowOrders.set(row.id, order);
  }
  const matched = new Set([...rowOrders.values()].map((order) => order.id));
  const covered = orders.filter((order) => matched.has(order.id) || alsoCovers(order));
  return {
    covered,
    toSwitch: covered.filter((order) => order.visible !== visible),
    rowOrders,
  };
}

/** Riven rows cover the auctions they are linked to. */
export function planAuctionVisibility<T extends { id: string; visible: boolean }>(
  auctions: readonly T[],
  auctionIds: ReadonlySet<string>,
  visible: boolean,
): VisibilityPlan<T> {
  const covered = auctions.filter((auction) => auctionIds.has(auction.id));
  return { covered, toSwitch: covered.filter((auction) => auction.visible !== visible) };
}

/** Marked rows of one Listings tab: row ids, plus the catalog ids of marked
 *  catalog-scan buys on the WTB tab. */
export interface VisibilitySelection {
  rowIds: string[];
  scanIds: string[];
}
