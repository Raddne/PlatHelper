// Isomorphic Live Scraper settings schema: types, defaults and normalization,
// shared between the main-process store (services/liveScraperSettings.ts,
// authoritative, persisted) and the renderer mirror (src/stores/liveScraperSettings.ts,
// IPC-backed). Ported from Quantframe's live_scraper settings struct — see
// docs/live-scraper/quantframe-reference.md §A for the field-by-field source.

/** `-1` (or below) is Quantframe's universal "no threshold, always pass" sentinel
 *  for every numeric setting in this feature — kept identical here for parity. */
export const DISABLED = -1;

/** "riven" switches riven selling on; the other three are the item passes. */
export type TradeMode = "buy" | "sell" | "wishlist" | "riven";
type StockMode = "all" | "item" | "riven";

export interface SubTypeLike {
  rank?: number;
  variant?: string;
  subtype?: string;
  amberStars?: number;
  cyanStars?: number;
}

export interface BlacklistEntry {
  wfmId: string;
  subType?: SubTypeLike | undefined;
  disabledFor: TradeMode[];
}

export interface BuyListEntry {
  wfmId: string;
  maxPrice: number;
}

export interface LiveScraperGeneralSettings {
  reportToWfm: boolean;
  autoDelete: boolean;
  autoTrade: boolean;
  /** Derived from tradeModes and kept in the file, so a build that still reads
   *  the old engine-mode switch sees the same choice. */
  stockMode: StockMode;
  tradeModes: TradeMode[];
  deleteConflictingOrders: boolean;
}

export interface ItemGeneralSettings {
  blacklist: BlacklistEntry[];
  buyList: BuyListEntry[];
}

export interface ItemWtbSettings {
  volumeThreshold: number;
  profitThreshold: number;
  avgPriceCap: number;
  maxTotalPriceCap: number;
  priceShiftThreshold: number;
  minWtbProfitMargin: number;
  tradingTaxCap: number;
  buyQuantity: number;
  quantityPerTrade: number;
  maxStockQuantity: number;
  maxPriceDrop: number;
  minListingsBelow: number;
}

export interface ItemWtsSettings {
  /** Fixed platinum added on top of the lowest competing sell listing; 0 matches it.
   *  Not in Quantframe - a PlatHelper addition. */
  aboveLowest: number;
  minProfit: number;
  minSma: number;
  maxPriceDrop: number;
  minListingsBelow: number;
}

export interface RivenGeneralSettings {
  updateInterval: number;
}

export interface RivenWtsSettings {
  minProfit: number;
  thresholdPercentage: number;
  maxResults: number;
}

/** The three Listings tabs, each of which can be hidden on warframe.market as a whole. */
export type ListingsTab = "wtb" | "wts" | "rivens";

/** Per tab: true keeps its warframe.market listings hidden - new ones are
 *  created hidden too. Mirrors what is live on WFM, so only the main process
 *  changes it (services/liveScraperWfmVisibility.ts), never a settings save. */
type HiddenOnWfm = Record<ListingsTab, boolean>;

export interface SyndicateWtsSettings {
  syndicates: string[];
  maxRankForType: string[];
  volumeThreshold: number;
  maxStandingCost: number;
  minPrice: number;
  maxPriceDrop: number;
  minListingsBelow: number;
}

export interface LiveScraperSettings {
  version: 1;
  general: LiveScraperGeneralSettings;
  items: {
    general: ItemGeneralSettings;
    wtb: ItemWtbSettings;
    wts: ItemWtsSettings;
  };
  rivens: {
    general: RivenGeneralSettings;
    wts: RivenWtsSettings;
  };
  syndicate: {
    wts: SyndicateWtsSettings;
  };
  hiddenOnWfm: HiddenOnWfm;
}

function defaultGeneral(): LiveScraperGeneralSettings {
  return {
    reportToWfm: true,
    autoDelete: true,
    autoTrade: true,
    stockMode: "all",
    tradeModes: ["buy", "sell", "wishlist", "riven"],
    deleteConflictingOrders: false,
  };
}

function defaultItemGeneral(): ItemGeneralSettings {
  return { blacklist: [], buyList: [] };
}

function defaultItemWtb(): ItemWtbSettings {
  return {
    volumeThreshold: 15,
    profitThreshold: 10,
    avgPriceCap: 600,
    maxTotalPriceCap: 100000,
    priceShiftThreshold: -1,
    minWtbProfitMargin: -1,
    tradingTaxCap: -1,
    buyQuantity: 1,
    quantityPerTrade: 1,
    maxStockQuantity: -1,
    maxPriceDrop: -1,
    minListingsBelow: -1,
  };
}

function defaultItemWts(): ItemWtsSettings {
  return { aboveLowest: 0, minProfit: 10, minSma: 3, maxPriceDrop: -1, minListingsBelow: -1 };
}

function defaultRivenGeneral(): RivenGeneralSettings {
  return { updateInterval: 120 };
}

function defaultRivenWts(): RivenWtsSettings {
  return { minProfit: 25, thresholdPercentage: 15, maxResults: 5 };
}

function defaultSyndicateWts(): SyndicateWtsSettings {
  return {
    syndicates: [],
    maxRankForType: ["mod"],
    volumeThreshold: 10,
    maxStandingCost: 10000,
    minPrice: 10,
    maxPriceDrop: -1,
    minListingsBelow: -1,
  };
}

function defaultHiddenOnWfm(): HiddenOnWfm {
  return { wtb: false, wts: false, rivens: false };
}

export function defaultLiveScraperSettings(): LiveScraperSettings {
  return {
    version: 1,
    general: defaultGeneral(),
    items: { general: defaultItemGeneral(), wtb: defaultItemWtb(), wts: defaultItemWts() },
    rivens: { general: defaultRivenGeneral(), wts: defaultRivenWts() },
    syndicate: { wts: defaultSyndicateWts() },
    hiddenOnWfm: defaultHiddenOnWfm(),
  };
}

const TRADE_MODES: readonly TradeMode[] = ["buy", "sell", "wishlist", "riven"];
const STOCK_MODES: readonly StockMode[] = ["all", "item", "riven"];
/** Stored by builds before the riven switch; it never did anything. */
const RETIRED_TRADE_MODES: readonly string[] = ["syndicate"];

function stockModeFor(tradeModes: readonly TradeMode[]): StockMode {
  const rivens = tradeModes.includes("riven");
  const items = tradeModes.some((mode) => mode !== "riven");
  if (rivens) return items ? "all" : "riven";
  return "item";
}

/** Switches one trade mode and keeps the derived stockMode in step. */
export function withTradeMode(
  general: LiveScraperGeneralSettings,
  mode: TradeMode,
  on: boolean,
): LiveScraperGeneralSettings {
  const others = general.tradeModes.filter((entry) => entry !== mode);
  const tradeModes = on ? [...others, mode] : others;
  return { ...general, tradeModes, stockMode: stockModeFor(tradeModes) };
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function strArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : fallback;
}
function tradeModeArray(value: unknown, fallback: TradeMode[]): TradeMode[] {
  if (!Array.isArray(value)) return fallback;
  const current = value.filter((v) => !RETIRED_TRADE_MODES.includes(v as string));
  const out = current.filter((v): v is TradeMode => TRADE_MODES.includes(v as TradeMode));
  return out.length > 0 || current.length === 0 ? out : fallback;
}

function normalizeSubType(raw: unknown): SubTypeLike | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entry = raw as Record<string, unknown>;
  const out: SubTypeLike = {};
  if (typeof entry.rank === "number") out.rank = entry.rank;
  if (typeof entry.variant === "string") out.variant = entry.variant;
  if (typeof entry.subtype === "string") out.subtype = entry.subtype;
  if (typeof entry.amberStars === "number") out.amberStars = entry.amberStars;
  if (typeof entry.cyanStars === "number") out.cyanStars = entry.cyanStars;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeBlacklist(raw: unknown): BlacklistEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BlacklistEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.wfmId !== "string" || e.wfmId === "") continue;
    out.push({
      wfmId: e.wfmId,
      subType: normalizeSubType(e.subType),
      disabledFor: tradeModeArray(e.disabledFor, []),
    });
  }
  return out;
}

function normalizeBuyList(raw: unknown): BuyListEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: BuyListEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.wfmId !== "string" || e.wfmId === "") continue;
    out.push({ wfmId: e.wfmId, maxPrice: num(e.maxPrice, 0) });
  }
  return out;
}

/** Older files chose rivens with stockMode alone ("all" or "riven" meant on,
 *  "riven" also switched the item passes off); newer ones list "riven" among
 *  the trade modes and write a stockMode that agrees. Both read the same. */
function normalizeTradeModes(rawModes: unknown, rawStockMode: unknown): TradeMode[] {
  const modes = tradeModeArray(rawModes, ["buy", "sell", "wishlist"]);
  const stockMode = str(rawStockMode, "all");
  const known = (STOCK_MODES as readonly string[]).includes(stockMode) ? stockMode : "all";
  const rivens = modes.includes("riven") || known !== "item";
  const items = known === "riven" ? [] : modes.filter((mode) => mode !== "riven");
  return rivens ? [...items, "riven"] : items;
}

function normalizeGeneral(raw: unknown): LiveScraperGeneralSettings {
  const e = (raw ?? {}) as Record<string, unknown>;
  const d = defaultGeneral();
  const tradeModes = normalizeTradeModes(e.tradeModes, e.stockMode);
  return {
    reportToWfm: bool(e.reportToWfm, d.reportToWfm),
    autoDelete: bool(e.autoDelete, d.autoDelete),
    autoTrade: bool(e.autoTrade, d.autoTrade),
    stockMode: stockModeFor(tradeModes),
    tradeModes,
    deleteConflictingOrders: bool(e.deleteConflictingOrders, d.deleteConflictingOrders),
  };
}

function normalizeItemGeneral(raw: unknown): ItemGeneralSettings {
  const e = (raw ?? {}) as Record<string, unknown>;
  return { blacklist: normalizeBlacklist(e.blacklist), buyList: normalizeBuyList(e.buyList) };
}

function normalizeItemWtb(raw: unknown): ItemWtbSettings {
  const e = (raw ?? {}) as Record<string, unknown>;
  const d = defaultItemWtb();
  return {
    volumeThreshold: num(e.volumeThreshold, d.volumeThreshold),
    profitThreshold: num(e.profitThreshold, d.profitThreshold),
    avgPriceCap: num(e.avgPriceCap, d.avgPriceCap),
    maxTotalPriceCap: num(e.maxTotalPriceCap, d.maxTotalPriceCap),
    priceShiftThreshold: num(e.priceShiftThreshold, d.priceShiftThreshold),
    minWtbProfitMargin: num(e.minWtbProfitMargin, d.minWtbProfitMargin),
    tradingTaxCap: num(e.tradingTaxCap, d.tradingTaxCap),
    buyQuantity: num(e.buyQuantity, d.buyQuantity),
    quantityPerTrade: num(e.quantityPerTrade, d.quantityPerTrade),
    maxStockQuantity: num(e.maxStockQuantity, d.maxStockQuantity),
    maxPriceDrop: num(e.maxPriceDrop, d.maxPriceDrop),
    minListingsBelow: num(e.minListingsBelow, d.minListingsBelow),
  };
}

function normalizeItemWts(raw: unknown): ItemWtsSettings {
  const e = (raw ?? {}) as Record<string, unknown>;
  const d = defaultItemWts();
  return {
    aboveLowest: Math.max(0, num(e.aboveLowest, d.aboveLowest)),
    minProfit: num(e.minProfit, d.minProfit),
    minSma: num(e.minSma, d.minSma),
    maxPriceDrop: num(e.maxPriceDrop, d.maxPriceDrop),
    minListingsBelow: num(e.minListingsBelow, d.minListingsBelow),
  };
}

function normalizeRivenGeneral(raw: unknown): RivenGeneralSettings {
  const e = (raw ?? {}) as Record<string, unknown>;
  return { updateInterval: num(e.updateInterval, defaultRivenGeneral().updateInterval) };
}

function normalizeRivenWts(raw: unknown): RivenWtsSettings {
  const e = (raw ?? {}) as Record<string, unknown>;
  const d = defaultRivenWts();
  return {
    minProfit: num(e.minProfit, d.minProfit),
    thresholdPercentage: num(e.thresholdPercentage, d.thresholdPercentage),
    maxResults: num(e.maxResults, d.maxResults),
  };
}

function normalizeSyndicateWts(raw: unknown): SyndicateWtsSettings {
  const e = (raw ?? {}) as Record<string, unknown>;
  const d = defaultSyndicateWts();
  return {
    syndicates: strArray(e.syndicates, d.syndicates),
    maxRankForType: strArray(e.maxRankForType, d.maxRankForType),
    volumeThreshold: num(e.volumeThreshold, d.volumeThreshold),
    maxStandingCost: num(e.maxStandingCost, d.maxStandingCost),
    minPrice: num(e.minPrice, d.minPrice),
    maxPriceDrop: num(e.maxPriceDrop, d.maxPriceDrop),
    minListingsBelow: num(e.minListingsBelow, d.minListingsBelow),
  };
}

function normalizeHiddenOnWfm(raw: unknown): HiddenOnWfm {
  const e = (raw ?? {}) as Record<string, unknown>;
  const d = defaultHiddenOnWfm();
  return {
    wtb: bool(e.wtb, d.wtb),
    wts: bool(e.wts, d.wts),
    rivens: bool(e.rivens, d.rivens),
  };
}

export function normalizeLiveScraperSettings(raw: unknown): LiveScraperSettings {
  if (!raw || typeof raw !== "object") return defaultLiveScraperSettings();
  const e = raw as Record<string, unknown>;
  if (e.version !== 1) return defaultLiveScraperSettings();
  const items = (e.items ?? {}) as Record<string, unknown>;
  const rivens = (e.rivens ?? {}) as Record<string, unknown>;
  const syndicate = (e.syndicate ?? {}) as Record<string, unknown>;
  return {
    version: 1,
    general: normalizeGeneral(e.general),
    items: {
      general: normalizeItemGeneral(items.general),
      wtb: normalizeItemWtb(items.wtb),
      wts: normalizeItemWts(items.wts),
    },
    rivens: {
      general: normalizeRivenGeneral(rivens.general),
      wts: normalizeRivenWts(rivens.wts),
    },
    syndicate: { wts: normalizeSyndicateWts(syndicate.wts) },
    hiddenOnWfm: normalizeHiddenOnWfm(e.hiddenOnWfm),
  };
}
