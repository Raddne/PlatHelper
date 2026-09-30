// Keeps the Live Scraper stock lists in step with trades the game confirmed in
// EE.log: a purchase goes into WTS at the price paid, a sale takes the item
// off. Pure decision logic; services/liveScraperTradeSync.ts fetches what it
// needs and applies the result.

import {
  rivenNameSuffix,
  type CreateStockRivenInput,
  type StockRiven,
} from "./liveScraperRivenStock";
import { subTypeKey, type StockItem, type WishlistItem } from "./liveScraperStock";
import type { SubTypeLike } from "./liveScraperSettings";
import type { DecodedRiven } from "./rivenTypes";
import { normalizeForSearch } from "./textNormalize";

/** One item kind a trade moved, keyed the way stock and wishlist rows are. */
export interface TradedStockKind {
  wfmId: string;
  subType?: SubTypeLike | undefined;
  count: number;
}

/** "market": in proportion to each kind's lowest in-game sell offer times its
 *  count. "even": the same amount for every piece. */
type PriceSplit = "market" | "even";

interface PriceSplitResult {
  /** Null when the purchase held one kind only, so nothing was divided. */
  split: PriceSplit | null;
  /** Bought per piece, one entry per kind, in the order the kinds came in. */
  perPiece: number[];
}

/** Divides the platinum one purchase cost over the kinds it held. A kind with
 *  no offer (null, or not a positive price) splits the whole trade evenly. */
export function splitPurchasePrice(
  platinum: number,
  kinds: readonly { count: number; lowestPrice: number | null }[],
): PriceSplitResult {
  if (kinds.length === 0) return { split: null, perPiece: [] };
  if (kinds.length === 1) {
    return { split: null, perPiece: [Math.round(platinum / Math.max(1, kinds[0].count))] };
  }
  const offers = kinds.map((kind) =>
    kind.lowestPrice != null && kind.lowestPrice > 0 ? kind.lowestPrice : null,
  );
  if (offers.every((offer) => offer != null)) {
    const weight = kinds.reduce((sum, kind, i) => sum + (offers[i] as number) * kind.count, 0);
    // A kind's share over its count reduces to platinum * offer / total weight.
    return {
      split: "market",
      perPiece: offers.map((offer) => Math.round((platinum * (offer as number)) / weight)),
    };
  }
  const pieces = kinds.reduce((sum, kind) => sum + kind.count, 0);
  return { split: "even", perPiece: kinds.map(() => Math.round(platinum / Math.max(1, pieces))) };
}

/** The shape services/wfmCatalog.ts resolveSetMembership answers with. */
interface SetDefinition {
  setSlug: string;
  parts: readonly { slug: string; quantityInSet: number }[];
}

/** How many complete copies of `set` the traded kinds make up when they are
 *  exactly its parts and nothing else; null otherwise. */
export function completeSetCount(
  kinds: readonly TradedStockKind[],
  set: SetDefinition,
): number | null {
  if (set.parts.length === 0 || kinds.some((kind) => kind.subType !== undefined)) return null;
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind.wfmId, (counts.get(kind.wfmId) ?? 0) + kind.count);
  if (counts.size !== set.parts.length) return null;

  let copies: number | null = null;
  for (const part of set.parts) {
    const have = counts.get(part.slug) ?? 0;
    if (have < 1 || have % part.quantityInSet !== 0) return null;
    const partCopies = have / part.quantityInSet;
    if (copies != null && partCopies !== copies) return null;
    copies = partCopies;
  }
  return copies;
}

function kindKey(kind: { wfmId: string; subType?: SubTypeLike | undefined }): string {
  return `${kind.wfmId}#${subTypeKey(kind.subType)}`;
}

/** Takes the traded counts off the rows holding the same item and variant. A
 *  row left with nothing is removed; pieces no row holds are ignored. */
function takeFromRows<T extends { id: string; wfmId: string; subType?: SubTypeLike | undefined }>(
  rows: readonly T[],
  amountOf: (row: T) => number,
  kinds: readonly TradedStockKind[],
): { update: { id: string; left: number }[]; remove: string[] } {
  const wanted = new Map<string, number>();
  for (const kind of kinds)
    wanted.set(kindKey(kind), (wanted.get(kindKey(kind)) ?? 0) + kind.count);

  const update: { id: string; left: number }[] = [];
  const remove: string[] = [];
  for (const row of rows) {
    const key = kindKey(row);
    const open = wanted.get(key) ?? 0;
    if (open < 1) continue;
    const have = amountOf(row);
    const taken = Math.min(have, open);
    wanted.set(key, open - taken);
    if (have - taken <= 0) remove.push(row.id);
    else update.push({ id: row.id, left: have - taken });
  }
  return { update, remove };
}

/** Wishlist rows a purchase covered: each loses the bought count, and one
 *  that reaches 0 is removed. */
export function planWishlistAfterPurchase(
  wishlist: readonly WishlistItem[],
  bought: readonly TradedStockKind[],
): { update: { id: string; quantity: number }[]; remove: string[] } {
  const plan = takeFromRows(wishlist, (row) => row.quantity, bought);
  return {
    update: plan.update.map((entry) => ({ id: entry.id, quantity: entry.left })),
    remove: plan.remove,
  };
}

/** Stock rows a sale covered: each loses the sold count, and one that
 *  reaches 0 is removed. */
export function planStockAfterSale(
  stock: readonly StockItem[],
  sold: readonly TradedStockKind[],
): { update: { id: string; owned: number }[]; remove: string[] } {
  const plan = takeFromRows(stock, (row) => row.owned, sold);
  return {
    update: plan.update.map((entry) => ({ id: entry.id, owned: entry.left })),
    remove: plan.remove,
  };
}

/** Rivens are told apart by weapon and riven name; case and spacing aside. */
function isSameRiven(
  a: { weaponName: string; rivenName: string },
  b: { weaponName: string; rivenName: string },
): boolean {
  return (
    normalizeForSearch(a.weaponName) === normalizeForSearch(b.weaponName) &&
    normalizeForSearch(rivenNameSuffix(a.weaponName, a.rivenName)) ===
      normalizeForSearch(rivenNameSuffix(b.weaponName, b.rivenName))
  );
}

/** A riven bought in a trade. The log names it but carries no stats, so it
 *  waits here until the inventory shows it. */
export interface PendingTradeRiven {
  id: string;
  weaponName: string;
  /** As the trade window showed it, e.g. "Rubico Visio-Critatis". */
  rivenName: string;
  bought: number;
  createdAt: number;
}

export const PENDING_RIVEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Pairs each pending riven with an owned one of the same weapon and name
 *  that no stock riven tracks yet, oldest entry first. Entries past the TTL
 *  are dropped; the rest keep waiting. */
export function resolvePendingRivens<
  R extends { itemId: string; weaponName: string; rivenName: string },
>(
  pending: readonly PendingTradeRiven[],
  owned: readonly R[],
  trackedItemIds: ReadonlySet<string>,
  now: number,
): { resolved: { pending: PendingTradeRiven; riven: R }[]; remaining: PendingTradeRiven[] } {
  const claimed = new Set(trackedItemIds);
  const resolved: { pending: PendingTradeRiven; riven: R }[] = [];
  const remaining: PendingTradeRiven[] = [];
  for (const entry of pending) {
    if (now - entry.createdAt > PENDING_RIVEN_TTL_MS) continue;
    const riven = owned.find(
      (candidate) =>
        candidate.itemId !== "" && !claimed.has(candidate.itemId) && isSameRiven(candidate, entry),
    );
    if (riven) {
      claimed.add(riven.itemId);
      resolved.push({ pending: entry, riven });
    } else {
      remaining.push(entry);
    }
  }
  return { resolved, remaining };
}

/** The stock riven for an owned one, built the way the Live Scraper view adds
 *  a riven by hand (LiveScraperView.svelte addStockRiven): listed at max rank
 *  with the max-rank stat values, and the same fallbacks the create IPC fills. */
export function stockRivenFromOwned(riven: DecodedRiven, bought: number): CreateStockRivenInput {
  return {
    sourceItemId: riven.itemId,
    weaponName: riven.weaponName,
    rivenName: riven.rivenName || riven.weaponName,
    masteryReq: riven.masteryReq,
    rerolls: riven.rerolls,
    polarity: riven.polarity || "madurai",
    modRank: riven.maxRank,
    stats: riven.stats.map((stat) => ({
      tag: stat.tag,
      positive: stat.positive,
      multiplier: stat.multiplier,
      value: Number.isFinite(stat.maxRankValue) ? stat.maxRankValue : 0,
    })),
    bought,
    origin: "trade",
  };
}

/** Stock rivens a sale took out, one per sold piece. */
export function planRivenSale(
  stock: readonly StockRiven[],
  sold: readonly { weaponName: string; rivenName: string; count: number }[],
): string[] {
  const taken = new Set<string>();
  for (const piece of sold) {
    for (let n = 0; n < piece.count; n++) {
      const match = stock.find((riven) => !taken.has(riven.id) && isSameRiven(riven, piece));
      if (!match) break;
      taken.add(match.id);
    }
  }
  return [...taken];
}

export interface TradeSyncNoticeRow {
  name: string;
  quantity: number;
  /** Bought per piece, as it went into the list. */
  bought: number;
}

/** Shown once in the main window: one purchase held several kinds, and this
 *  is how its platinum was divided. Kept until the user acknowledges it. */
export interface TradeSyncNotice {
  id: string;
  createdAt: number;
  platinum: number;
  split: PriceSplit;
  rows: TradeSyncNoticeRow[];
}

// Only a cap for a window nobody opens for weeks; the oldest go first.
const MAX_NOTICES = 50;

export function queueNotice(
  notices: readonly TradeSyncNotice[],
  notice: TradeSyncNotice,
): TradeSyncNotice[] {
  return [...notices, notice].slice(-MAX_NOTICES);
}

export interface LiveScraperTradeSyncFile {
  version: 1;
  pendingRivens: PendingTradeRiven[];
  notices: TradeSyncNotice[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePendingRiven(raw: unknown): PendingTradeRiven | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) return null;
  if (typeof e.weaponName !== "string" || !e.weaponName) return null;
  if (typeof e.rivenName !== "string" || !e.rivenName) return null;
  if (!finite(e.createdAt)) return null;
  return {
    id: e.id,
    weaponName: e.weaponName,
    rivenName: e.rivenName,
    bought: finite(e.bought) ? Math.max(0, e.bought) : 0,
    createdAt: e.createdAt,
  };
}

function normalizeNoticeRow(raw: unknown): TradeSyncNoticeRow | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.name !== "string" || !e.name) return null;
  return {
    name: e.name,
    quantity: finite(e.quantity) ? Math.max(1, e.quantity) : 1,
    bought: finite(e.bought) ? Math.max(0, e.bought) : 0,
  };
}

function normalizeNotice(raw: unknown): TradeSyncNotice | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) return null;
  if (e.split !== "market" && e.split !== "even") return null;
  const rows = Array.isArray(e.rows)
    ? e.rows.map(normalizeNoticeRow).filter((row): row is TradeSyncNoticeRow => row !== null)
    : [];
  if (rows.length === 0) return null;
  return {
    id: e.id,
    createdAt: finite(e.createdAt) ? e.createdAt : 0,
    platinum: finite(e.platinum) ? Math.max(0, e.platinum) : 0,
    split: e.split,
    rows,
  };
}

export function normalizeLiveScraperTradeSyncFile(raw: unknown): LiveScraperTradeSyncFile {
  const empty: LiveScraperTradeSyncFile = { version: 1, pendingRivens: [], notices: [] };
  if (!raw || typeof raw !== "object") return empty;
  const e = raw as Record<string, unknown>;
  if (e.version !== 1) return empty;
  return {
    version: 1,
    pendingRivens: Array.isArray(e.pendingRivens)
      ? e.pendingRivens
          .map(normalizePendingRiven)
          .filter((entry): entry is PendingTradeRiven => entry !== null)
      : [],
    notices: Array.isArray(e.notices)
      ? e.notices
          .map(normalizeNotice)
          .filter((entry): entry is TradeSyncNotice => entry !== null)
          .slice(-MAX_NOTICES)
      : [],
  };
}
