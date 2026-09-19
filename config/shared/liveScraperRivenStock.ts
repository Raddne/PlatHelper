// Phase 7: riven-selling stock list (docs/live-scraper/quantframe-reference.md
// §B.2/§B.4f's stock_riven). Unlike item stock, a riven listing must carry its
// exact rolled stat *values*, not just which stats it has (WFM's auction-create
// payload needs real attribute values) - so a StockRiven entry is a snapshot of
// one of the player's own decoded rivens (config/shared/rivenTypes.ts's
// DecodedRiven, already produced from the live game-save inventory) at the
// moment it was added, plus the same bought/minPrice/status stock-list
// bookkeeping StockItem already has. There is no "type in a hypothetical
// riven" entry path, deliberately - a fabricated stat profile could never
// become a real, sellable auction.

import type { StockEntryStatus } from "./liveScraperStock";

export interface StockRivenStat {
  /** Internal stat tag (config/shared/wfmRivenVocabulary.ts's vocabulary),
   *  converted to WFM's url_name at auction-create/search time. */
  tag: string;
  positive: boolean;
  multiplier: boolean;
  /** Rolled value at the snapshotted mod rank - the number WFM's auction
   *  payload actually needs, not just the stat's presence. */
  value: number;
}

export interface StockRiven {
  id: string;
  /** The decoded riven's itemId at add-time - informational only (rivens
   *  aren't re-synced from inventory once added; a re-roll makes a new
   *  itemId, so the old stock entry simply stops matching anything real and
   *  the user re-adds it). */
  sourceItemId: string;
  weaponName: string;
  rivenName: string;
  masteryReq: number;
  rerolls: number;
  polarity: string;
  modRank: number;
  stats: StockRivenStat[];
  bought: number;
  minPrice: number | null;
  listPrice: number | null;
  /** The live WFM auction id once created; null until progressStockRiven's
   *  first successful create. WFHelper owns this mapping itself - there is no
   *  "list my auctions" endpoint in play, so a failed update/delete just
   *  clears this and lets the next tick recreate the auction. */
  auctionId: string | null;
  isHidden: boolean;
  status: StockEntryStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CreateStockRivenInput {
  sourceItemId: string;
  weaponName: string;
  rivenName: string;
  masteryReq: number;
  rerolls: number;
  polarity: string;
  modRank: number;
  stats: StockRivenStat[];
  bought: number;
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
function normalizeStatus(value: unknown): StockEntryStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as StockEntryStatus)
    : "pending";
}

function normalizeStat(raw: unknown): StockRivenStat | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.tag !== "string" || !e.tag) return null;
  return {
    tag: e.tag,
    positive: bool(e.positive, true),
    multiplier: bool(e.multiplier, false),
    value: num(e.value, 0),
  };
}

function normalizeStockRiven(raw: unknown): StockRiven | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id === "") return null;
  if (typeof e.weaponName !== "string" || !e.weaponName) return null;
  const stats = Array.isArray(e.stats)
    ? e.stats.map(normalizeStat).filter((s): s is StockRivenStat => s !== null)
    : [];
  if (stats.length === 0) return null;
  const now = Date.now();
  return {
    id: e.id,
    sourceItemId: str(e.sourceItemId, ""),
    weaponName: e.weaponName,
    rivenName: str(e.rivenName, e.weaponName),
    masteryReq: Math.max(0, num(e.masteryReq, 0)),
    rerolls: Math.max(0, num(e.rerolls, 0)),
    polarity: str(e.polarity, "madurai"),
    modRank: Math.max(0, num(e.modRank, 8)),
    stats,
    bought: Math.max(0, num(e.bought, 0)),
    minPrice: numOrNull(e.minPrice),
    listPrice: numOrNull(e.listPrice),
    auctionId: typeof e.auctionId === "string" && e.auctionId ? e.auctionId : null,
    isHidden: bool(e.isHidden, false),
    status: normalizeStatus(e.status),
    createdAt: num(e.createdAt, now),
    updatedAt: num(e.updatedAt, now),
  };
}

export interface LiveScraperRivenStockFile {
  version: 1;
  stockRivens: StockRiven[];
}

export function normalizeLiveScraperRivenStockFile(raw: unknown): LiveScraperRivenStockFile {
  const empty: LiveScraperRivenStockFile = { version: 1, stockRivens: [] };
  if (!raw || typeof raw !== "object") return empty;
  const e = raw as Record<string, unknown>;
  if (e.version !== 1) return empty;
  const stockRivens = Array.isArray(e.stockRivens)
    ? e.stockRivens.map(normalizeStockRiven).filter((v): v is StockRiven => v !== null)
    : [];
  return { version: 1, stockRivens };
}
