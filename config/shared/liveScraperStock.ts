// Isomorphic Stock (owned items to sell) / Wishlist (items to buy) schema for
// the Live Scraper engine. Quantframe persists these as `stock_item`/`wish_list`
// DB tables (see docs/live-scraper/quantframe-reference.md §B.2) — WFHelper has
// no equivalent, so this is a new design, deliberately trimmed to what the
// Phase 2 engine skeleton needs. Extended as pricing logic (Phase 3+) needs
// more fields (min/max price overrides, status, price history).

import type { SubTypeLike, TradeMode } from "./liveScraperSettings";

export type StockEntryStatus =
  | "pending"
  | "live"
  | "toLowProfit"
  | "noSellers"
  | "noBuyers"
  | "inactive"
  | "smaLimit"
  | "overpriced"
  | "underpriced"
  | "maxPriceDrop";

export interface StockItem {
  id: string;
  wfmId: string;
  wfmUrl: string;
  itemName: string;
  subType?: SubTypeLike | undefined;
  /** Quantity currently owned and available to sell. */
  owned: number;
  /** Cost basis; 0 means unknown/free (e.g. farmed). */
  bought: number;
  listPrice: number | null;
  /** Per-item floor override; null defers to the WTS tab's global minProfit/minSma. */
  minPrice: number | null;
  isHidden: boolean;
  /** True for a row created from a sell order the user already had on
   *  warframe.market (config/shared/liveScraperAdopt.ts). Such a listing is
   *  re-priced like any other but never deleted by the scraper, and never
   *  re-created once it is gone. */
  adopted?: boolean | undefined;
  /** Last known warframe.market visibility of the listing (true = hidden); a new
   *  listing is created the same way. Undefined until known. */
  wfmHidden?: boolean | undefined;
  status: StockEntryStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WishlistItem {
  id: string;
  wfmId: string;
  wfmUrl: string;
  itemName: string;
  subType?: SubTypeLike | undefined;
  /** Quantity to buy. */
  quantity: number;
  listPrice: number | null;
  /** Per-item ceiling/floor overrides; null means "no override". */
  maxPrice: number | null;
  minPrice: number | null;
  isHidden: boolean;
  /** Last known warframe.market visibility of the listing (true = hidden); a new
   *  listing is created the same way. Undefined until known. */
  wfmHidden?: boolean | undefined;
  status: StockEntryStatus;
  createdAt: number;
  updatedAt: number;
}

export interface LiveScraperStockFile {
  version: 1;
  stock: StockItem[];
  wishlist: WishlistItem[];
}

export interface CreateStockItemInput {
  wfmId: string;
  wfmUrl: string;
  itemName: string;
  subType?: SubTypeLike | undefined;
  owned: number;
  bought: number;
}

export interface CreateWishlistItemInput {
  wfmId: string;
  wfmUrl: string;
  itemName: string;
  subType?: SubTypeLike | undefined;
  quantity: number;
  maxPrice?: number | undefined;
}

const STATUSES: readonly StockEntryStatus[] = [
  "pending",
  "live",
  "toLowProfit",
  "noSellers",
  "noBuyers",
  "inactive",
  "smaLimit",
  "overpriced",
  "underpriced",
  "maxPriceDrop",
];

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSubType(raw: unknown): SubTypeLike | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  const out: SubTypeLike = {};
  if (typeof e.rank === "number") out.rank = e.rank;
  if (typeof e.variant === "string") out.variant = e.variant;
  if (typeof e.subtype === "string") out.subtype = e.subtype;
  if (typeof e.amberStars === "number") out.amberStars = e.amberStars;
  if (typeof e.cyanStars === "number") out.cyanStars = e.cyanStars;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeStatus(value: unknown): StockEntryStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as StockEntryStatus)
    : "pending";
}

function normalizeStockItem(raw: unknown): StockItem | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id === "") return null;
  if (typeof e.wfmId !== "string" || e.wfmId === "") return null;
  const now = Date.now();
  return {
    id: e.id,
    wfmId: e.wfmId,
    wfmUrl: str(e.wfmUrl, e.wfmId),
    itemName: str(e.itemName, e.wfmId),
    subType: normalizeSubType(e.subType),
    owned: Math.max(0, num(e.owned, 0)),
    bought: Math.max(0, num(e.bought, 0)),
    listPrice: numOrNull(e.listPrice),
    minPrice: numOrNull(e.minPrice),
    isHidden: bool(e.isHidden, false),
    adopted: e.adopted === true ? true : undefined,
    wfmHidden: typeof e.wfmHidden === "boolean" ? e.wfmHidden : undefined,
    status: normalizeStatus(e.status),
    createdAt: num(e.createdAt, now),
    updatedAt: num(e.updatedAt, now),
  };
}

function normalizeWishlistItem(raw: unknown): WishlistItem | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id === "") return null;
  if (typeof e.wfmId !== "string" || e.wfmId === "") return null;
  const now = Date.now();
  return {
    id: e.id,
    wfmId: e.wfmId,
    wfmUrl: str(e.wfmUrl, e.wfmId),
    itemName: str(e.itemName, e.wfmId),
    subType: normalizeSubType(e.subType),
    quantity: Math.max(1, num(e.quantity, 1)),
    listPrice: numOrNull(e.listPrice),
    maxPrice: numOrNull(e.maxPrice),
    minPrice: numOrNull(e.minPrice),
    isHidden: bool(e.isHidden, false),
    wfmHidden: typeof e.wfmHidden === "boolean" ? e.wfmHidden : undefined,
    status: normalizeStatus(e.status),
    createdAt: num(e.createdAt, now),
    updatedAt: num(e.updatedAt, now),
  };
}

export function normalizeLiveScraperStockFile(raw: unknown): LiveScraperStockFile {
  const empty: LiveScraperStockFile = { version: 1, stock: [], wishlist: [] };
  if (!raw || typeof raw !== "object") return empty;
  const e = raw as Record<string, unknown>;
  if (e.version !== 1) return empty;
  const stock = Array.isArray(e.stock)
    ? e.stock.map(normalizeStockItem).filter((v): v is StockItem => v !== null)
    : [];
  const wishlist = Array.isArray(e.wishlist)
    ? e.wishlist.map(normalizeWishlistItem).filter((v): v is WishlistItem => v !== null)
    : [];
  return { version: 1, stock, wishlist };
}

/** Matches Quantframe's blacklist semantics (docs §A.1): a `subType: undefined`
 *  entry blacklists every variant of that item for the listed modes; a concrete
 *  `subType` only blacklists that exact variant. */
export function isBlacklisted(
  blacklist: readonly {
    wfmId: string;
    subType?: SubTypeLike | undefined;
    disabledFor: TradeMode[];
  }[],
  wfmId: string,
  subType: SubTypeLike | undefined,
  mode: TradeMode,
): boolean {
  return blacklist.some((entry) => {
    if (entry.wfmId !== wfmId || !entry.disabledFor.includes(mode)) return false;
    if (entry.subType === undefined) return true;
    return subTypeEquals(entry.subType, subType);
  });
}

function subTypeEquals(a: SubTypeLike | undefined, b: SubTypeLike | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.rank === b.rank &&
    a.variant === b.variant &&
    a.subtype === b.subtype &&
    a.amberStars === b.amberStars &&
    a.cyanStars === b.cyanStars
  );
}
