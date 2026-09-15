import {
  buildSafetyContext,
  reservableParts,
  safeToList,
  safetyKeyFor,
  type InventorySafetySettings,
  type SafetyContext,
  type SafetyReservation,
  type SafetyVerdict,
} from "../inventory/safetyRules.js";
import { getLookupByGameRef, getLookupByName } from "../inventoryMarket.js";
import {
  NO_PLAT_RANGE,
  platRangeActive,
  withinPlatRange,
  type PlatRange,
} from "../market/platRange.js";
import {
  listingUnitPrice,
  suggestPrice,
  type DampingRule,
  type PriceSuggestion,
  type PricingListing,
  type StrategyConfig,
} from "./pricingStrategies.js";
import { isRankedGroup } from "../../../config/shared/numeric.js";
import {
  WORKBENCH_MAX_ROWS_PER_RUN,
  type WorkbenchPlan,
  type WorkbenchPlanRow,
  type WorkbenchSafetySnapshot,
} from "../../../config/shared/tradeWorkbenchTypes.js";
import { isWfmExcludedSlug } from "../../../config/shared/wfmExclusions.js";
import { isActiveOrderStatus, normalizeSubtype } from "../../../config/shared/wfmOrders.js";
import type { ItemDbEntry, MasteryData, ParsedItem } from "../../types/inventory.js";
import type { WfmItemsLookup } from "../../types/ipc.js";
import type { WfmOrder } from "../../types/market.js";

export type WorkbenchQueueWarning =
  | "no-listing-data"
  | "low-liquidity"
  | "no-price"
  | "override-needed"
  | "fully-protected";

interface WorkbenchMarketInfo {
  lowestSell: number | null;
  highestBuy: number | null;
  /** Sellers currently ingame/online; the liquidity signal shown per row. */
  activeSellers: number;
  spread: number | null;
}

export interface WorkbenchQueueRow {
  rowId: string;
  item: ParsedItem;
  itemName: string;
  slug: string;
  rank: number | null;
  /** WFM subtype (relic refinement); null for items without one. */
  subtype: string | null;
  verdict: SafetyVerdict;
  /** Units to list; starts at the safe count and never exceeds the total. */
  quantity: number;
  /** Set by an explicit per-row confirmation; required beyond the safe count. */
  overrideAcknowledged: boolean;
  overrideAcknowledgedAt: number | null;
  selected: boolean;
  existingOrder: { id: string; platinum: number; quantity: number; perTrade: number } | null;
  market: WorkbenchMarketInfo | null;
  /** Raw sell book kept on the row so strategies can be re-applied locally. */
  sellBook: readonly PricingListing[] | null;
  suggestion: PriceSuggestion | null;
  manualPrice: number | null;
}

const RELIC_SUBTYPE_RE = /\b(intact|exceptional|flawless|radiant)\b/i;
/** Relic uniqueNames spell the refinement as a suffix with no separator. */
const RELIC_SUBTYPE_SUFFIX_RE = /(intact|exceptional|flawless|radiant)$/i;

/** The parser types name as string, but odd inventory rows have leaked other
 *  primitives (see 9bdc324f), and one bad row must not throw the queue away. */
function queueItemName(item: ParsedItem): string {
  return typeof item.name === "string" ? item.name : String(item.name ?? "");
}

/** Catalog-confirmed slugs only: a guessed slug cannot resolve to an item id at
 *  execution time, so it never enters the queue in the first place. */
export function resolveQueueSlug(item: ParsedItem, lookup: WfmItemsLookup): string | null {
  const byRef = getLookupByGameRef(item.internalName, lookup);
  if (byRef?.url_name) return byRef.url_name;
  const byName = getLookupByName(queueItemName(item), lookup);
  if (byName?.url_name) return byName.url_name;
  return null;
}

interface SelectionSafetyInput {
  itemDb: Record<string, ItemDbEntry>;
  settings: InventorySafetySettings;
  mastery: MasteryData | null;
  /** Mastery goal uniqueNames the user pinned in the planner. */
  pins: readonly string[];
  /** uniqueName -> owned copies, foundry claims already subtracted. */
  ownership?: ReadonlyMap<string, number>;
  /** Products the foundry is building; each covers one copy of the demand. */
  buildingUniqueNames?: ReadonlySet<string>;
}

interface MasteryIndex {
  mastery: MasteryData | null;
  mastered: ReadonlySet<string>;
  owned: ReadonlySet<string>;
}

// Kept by payload identity so the safety engine's own memo still hits when only
// a lock or a spare changed.
let masteryIndexCache: MasteryIndex | null = null;

function masteryIndex(mastery: MasteryData | null): MasteryIndex {
  if (masteryIndexCache?.mastery === mastery) return masteryIndexCache;
  const mastered = new Set<string>();
  const owned = new Set<string>();
  for (const item of mastery?.items ?? []) {
    const uniqueName = item.uniqueName || item.internalName;
    if (!uniqueName) continue;
    // Ownership is its own field: mastered gear the player sold is gone, and
    // reading the status instead would hold its parts back forever.
    if (item.currentlyOwned === true) owned.add(uniqueName);
    if (item.status === "mastered") mastered.add(uniqueName);
  }
  masteryIndexCache = { mastery, mastered, owned };
  return masteryIndexCache;
}

/** Shared by the grid's eligibility pass and the sell queue; feeding it mastery
 *  and pins keeps pinnedGoal/unmasteredRecipe from silently degrading. */
export function buildSelectionSafetyContext(input: SelectionSafetyInput): SafetyContext {
  const { mastered: masteredUniqueNames, owned: ownedUniqueNames } = masteryIndex(input.mastery);

  // Same part list as the recipe rule, so a pinned goal never reserves a resource.
  const pinnedRequirements = new Map<string, number>();
  for (const pin of input.pins) {
    for (const part of reservableParts(input.itemDb, pin)) {
      const uniqueName = part.uniqueName ?? "";
      if (!uniqueName) continue;
      const count = typeof part.itemCount === "number" ? Math.floor(part.itemCount) : 1;
      const need = count > 0 ? count : 1;
      pinnedRequirements.set(uniqueName, (pinnedRequirements.get(uniqueName) ?? 0) + need);
    }
  }

  return buildSafetyContext({
    itemDb: input.itemDb,
    settings: input.settings,
    // No mastery data means every masterable item reads as unmastered, which
    // would reserve the whole account; the rule degrades instead.
    ...(input.mastery ? { masteredUniqueNames } : {}),
    pinnedRequirements,
    ...(input.ownership ? { ownedCounts: input.ownership } : {}),
    ownedUniqueNames,
    ...(input.buildingUniqueNames ? { buildingUniqueNames: input.buildingUniqueNames } : {}),
  });
}

function rowRank(item: ParsedItem): number | null {
  if (!isRankedGroup(item.inventoryGroup)) return null;
  return Number.isFinite(item.rank) ? Math.max(0, Math.floor(item.rank)) : 0;
}

/** Refinement of a relic projection uniqueName; the relic database is the
 *  only source that decodes DE's colour suffixes (EBronze, EPlatinum). */
type RelicQualityResolver = (uniqueName: string) => string | null;

export function relicSubtypeFor(item: ParsedItem, resolve?: RelicQualityResolver): string | null {
  if (item.inventoryGroup !== "relics") return null;
  const resolved = resolve?.(item.internalName);
  if (resolved) return resolved;
  // The item-DB name is refinement-free ("Axi A1 Relic"), so the uniqueName is
  // the only refinement the row carries; DE colour suffixes still read Intact.
  const match =
    RELIC_SUBTYPE_RE.exec(item.name) ?? RELIC_SUBTYPE_SUFFIX_RE.exec(item.internalName ?? "");
  return match ? match[1].toLowerCase() : "intact";
}

/** Pure; market data attaches later. */
export function buildQueueRows(
  items: readonly ParsedItem[],
  context: SafetyContext,
  lookup: WfmItemsLookup,
  relicQuality?: RelicQualityResolver,
): WorkbenchQueueRow[] {
  const rows: WorkbenchQueueRow[] = [];
  for (const item of items) {
    if (item.inventoryGroup === "incomplete_sets") continue;
    const slug = resolveQueueSlug(item, lookup);
    if (!slug || isWfmExcludedSlug(slug)) continue;
    const verdict = safeToList(item, context);
    if (verdict.total <= 0) continue;
    rows.push({
      rowId: `r${rows.length}`,
      item,
      itemName: queueItemName(item),
      slug,
      rank: rowRank(item),
      subtype: relicSubtypeFor(item, relicQuality),
      verdict,
      quantity: verdict.safe,
      overrideAcknowledged: false,
      overrideAcknowledgedAt: null,
      selected: false,
      existingOrder: null,
      market: null,
      sellBook: null,
      suggestion: null,
      manualPrice: null,
    });
  }
  return rows;
}

/** Mirrors the id `buildBaseInventoryItems` puts on an inventory row, so a card
 *  the user ticked joins the queue rows built from the same ParsedItem. */
export function selectionKeyFor(item: ParsedItem): string {
  const key = item.inventoryKey;
  return typeof key === "string" && key.trim().length > 0 ? key : item.internalName;
}

/** Inventory keys the queue would accept, for the grid's per-row eligibility
 *  check. Built from `buildQueueRows` so there is one definition of sellable. */
export function eligibleSelectionKeys(
  items: readonly ParsedItem[],
  context: SafetyContext,
  lookup: WfmItemsLookup,
): Set<string> {
  const keys = new Set<string>();
  for (const row of buildQueueRows(items, context, lookup)) {
    keys.add(selectionKeyFor(row.item));
  }
  return keys;
}

/** Queue rows for ticked inventory only; every rank row of a selected item comes
 *  through since they share its selection key, and each starts ticked already. */
export function buildSelectedQueueRows(
  items: readonly ParsedItem[],
  context: SafetyContext,
  lookup: WfmItemsLookup,
  selection: ReadonlySet<string>,
  relicQuality?: RelicQualityResolver,
): WorkbenchQueueRow[] {
  const picked = items.filter((item) => selection.has(selectionKeyFor(item)));
  return buildQueueRows(picked, context, lookup, relicQuality).map((row) => ({
    ...row,
    selected: true,
  }));
}

/** Stable across rebuilds, unlike `rowId`, which is the build-order index. One
 *  selection key can expand to several rank rows, so the rank is part of it. */
function queueRowIdentity(row: WorkbenchQueueRow): string {
  return `${selectionKeyFor(row.item)}::${row.slug}::${row.rank ?? ""}::${row.subtype ?? ""}`;
}

/** Carries a prior row's fetched market data and price edits onto its freshly
 *  built counterpart. The safety verdict is always the fresh one. */
function carryQueueRow(prior: WorkbenchQueueRow, fresh: WorkbenchQueueRow): WorkbenchQueueRow {
  const merged = setRowQuantity(
    {
      ...fresh,
      selected: prior.selected,
      market: prior.market,
      sellBook: prior.sellBook,
      suggestion: prior.suggestion,
      manualPrice: prior.manualPrice,
      overrideAcknowledged: false,
      overrideAcknowledgedAt: null,
    },
    prior.quantity,
  );
  // An acknowledgement survives only an identical verdict and amount: anything
  // the safety engine re-evaluated has to be consented to again.
  if (!prior.overrideAcknowledged) return merged;
  const same =
    merged.quantity === prior.quantity &&
    merged.verdict.safe === prior.verdict.safe &&
    merged.verdict.total === prior.verdict.total;
  if (!same) return merged;
  return {
    ...merged,
    overrideAcknowledged: true,
    overrideAcknowledgedAt: prior.overrideAcknowledgedAt,
  };
}

/** Rebuilds the queue without discarding what the user already loaded: rows whose
 *  identity survived keep their order book, price and quantity; dropped rows fall away. */
export function mergeQueueRows(
  previous: readonly WorkbenchQueueRow[],
  next: readonly WorkbenchQueueRow[],
): WorkbenchQueueRow[] {
  if (previous.length === 0) return [...next];
  const byIdentity = new Map(previous.map((row) => [queueRowIdentity(row), row]));
  return next.map((row) => {
    const prior = byIdentity.get(queueRowIdentity(row));
    return prior ? carryQueueRow(prior, row) : row;
  });
}

/** Strips fetched order-book data so an aged queue re-prices before it can execute.
 *  Quantities and typed prices are the user's own input and stay. */
export function dropStaleMarketData(
  rows: readonly WorkbenchQueueRow[],
): readonly WorkbenchQueueRow[] {
  return rows.map((row) => ({ ...row, sellBook: null, market: null, suggestion: null }));
}

/** Relic refinements share one slug and carry no rank, so without the subtype
 *  every refinement of a relic would reprice the same order. */
function matchExistingOrder(row: WorkbenchQueueRow, orders: readonly WfmOrder[]): WfmOrder | null {
  const subtype = normalizeSubtype(row.subtype);
  return (
    orders.find(
      (order) =>
        order.orderType === "sell" &&
        order.itemUrlName === row.slug &&
        (row.rank == null || order.modRank === row.rank) &&
        (subtype == null || normalizeSubtype(order.subtype) === subtype),
    ) ?? null
  );
}

function existingOrderOf(
  row: WorkbenchQueueRow,
  myOrders: readonly WfmOrder[],
): WorkbenchQueueRow["existingOrder"] {
  const existing = matchExistingOrder(row, myOrders);
  if (!existing) return null;
  // A bulk listing of our own prices per trade, so the strategy needs the
  // divisor to keep its suggestion in the same units.
  const perTrade = existing.perTrade ?? 1;
  return {
    id: existing.id,
    platinum: existing.platinum,
    quantity: existing.quantity,
    perTrade: Number.isInteger(perTrade) && perTrade > 0 ? perTrade : 1,
  };
}

/** Re-joins rows to a freshly fetched own-order list, leaving the market data
 *  they already loaded alone; the retry after a failed orders fetch uses it. */
export function attachExistingOrders(
  rows: readonly WorkbenchQueueRow[],
  myOrders: readonly WfmOrder[],
): WorkbenchQueueRow[] {
  return rows.map((row) => ({ ...row, existingOrder: existingOrderOf(row, myOrders) }));
}

export function attachMarketData(
  row: WorkbenchQueueRow,
  sellBook: readonly PricingListing[] | null,
  buyBook: readonly PricingListing[] | null,
  myOrders: readonly WfmOrder[],
): WorkbenchQueueRow {
  let market: WorkbenchMarketInfo | null = null;
  if (sellBook) {
    // Per-item prices: a bulk order's listed price covers several items, so the
    // listed number is not what the row competes against.
    const activeSell = sellBook.filter((entry) => isActiveOrderStatus(entry.status));
    const lowestSell = activeSell.length > 0 ? Math.min(...activeSell.map(listingUnitPrice)) : null;
    const activeBuy = (buyBook ?? []).filter((entry) => isActiveOrderStatus(entry.status));
    const highestBuy = activeBuy.length > 0 ? Math.max(...activeBuy.map(listingUnitPrice)) : null;
    market = {
      lowestSell,
      highestBuy,
      activeSellers: activeSell.length,
      spread: lowestSell != null && highestBuy != null ? lowestSell - highestBuy : null,
    };
  }
  return { ...row, sellBook, market, existingOrder: existingOrderOf(row, myOrders) };
}

export function rowsNeedingMarketData(rows: readonly WorkbenchQueueRow[]): WorkbenchQueueRow[] {
  return rows.filter((row) => row.selected && !row.sellBook);
}

interface QueueMarketBook {
  sell: readonly PricingListing[] | null;
  buy: readonly PricingListing[] | null;
}

interface MarketLoadRow {
  rowId: string;
}

interface QueueMarketLoadOptions<T extends MarketLoadRow> {
  fetchBook: (row: T) => Promise<QueueMarketBook | null>;
  onRow: (row: T, book: QueueMarketBook | null) => void;
  minIntervalMs?: number;
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface QueueMarketLoadSummary {
  loaded: number;
  failedRowIds: string[];
  cancelled: boolean;
}

/** warframe.market budgets per IP at roughly 2.5 requests/second. */
const MARKET_LOAD_INTERVAL_MS = 400;

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function loadQueueMarketData<T extends MarketLoadRow>(
  targets: readonly T[],
  options: QueueMarketLoadOptions<T>,
): Promise<QueueMarketLoadSummary> {
  const interval = options.minIntervalMs ?? MARKET_LOAD_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? defaultSleep;
  const summary: QueueMarketLoadSummary = { loaded: 0, failedRowIds: [], cancelled: false };
  let lastStartedAt: number | null = null;

  for (const target of targets) {
    if (options.isCancelled?.()) {
      summary.cancelled = true;
      break;
    }
    if (lastStartedAt != null) {
      const elapsed = now() - lastStartedAt;
      if (elapsed < interval) await wait(interval - elapsed);
      // The gap can outlive the modal, so cancellation is re-read after it.
      if (options.isCancelled?.()) {
        summary.cancelled = true;
        break;
      }
    }
    lastStartedAt = now();
    const book = await options.fetchBook(target);
    if (book?.sell) summary.loaded += 1;
    else summary.failedRowIds.push(target.rowId);
    options.onRow(target, book);
  }
  return summary;
}

export function applyStrategy(
  row: WorkbenchQueueRow,
  config: StrategyConfig,
  ownUserName: string | null,
  damping?: DampingRule,
): WorkbenchQueueRow {
  if (!row.sellBook) return { ...row, suggestion: null };
  const suggestion = suggestPrice(
    config,
    {
      sellListings: row.sellBook,
      currentPrice: row.existingOrder?.platinum ?? null,
      ownPerTrade: row.existingOrder?.perTrade ?? 1,
      ownUserName,
    },
    damping,
  );
  return { ...row, suggestion };
}

/** Clamped to the account total; crossing the safe count clears any previous
 *  acknowledgement so protection has to be re-confirmed for the new amount. */
export function setRowQuantity(row: WorkbenchQueueRow, quantity: number): WorkbenchQueueRow {
  const next = Math.max(0, Math.min(row.verdict.total, Math.floor(quantity)));
  const keepAck = row.overrideAcknowledged && next <= row.quantity;
  return {
    ...row,
    quantity: next,
    overrideAcknowledged: next > row.verdict.safe ? keepAck : false,
    overrideAcknowledgedAt: next > row.verdict.safe && keepAck ? row.overrideAcknowledgedAt : null,
  };
}

export function acknowledgeRowOverride(row: WorkbenchQueueRow, at: number): WorkbenchQueueRow {
  if (row.quantity <= row.verdict.safe) return row;
  return { ...row, overrideAcknowledged: true, overrideAcknowledgedAt: at };
}

export function rowNeedsOverride(row: WorkbenchQueueRow): boolean {
  return row.quantity > row.verdict.safe;
}

export function effectivePrice(row: WorkbenchQueueRow): number | null {
  if (row.manualPrice != null) return row.manualPrice;
  if (row.suggestion?.price != null) return row.suggestion.price;
  return row.existingOrder?.platinum ?? null;
}

export type QueueListedFilter = "all" | "unlisted" | "listed";

interface QueueRowFilter {
  text?: string;
  plat?: PlatRange;
  listed?: QueueListedFilter;
}

/** What a plat bound is measured against: the price the row would list at, and
 *  the cheapest competing listing while the user has priced nothing yet. */
function queueFilterPrice(row: WorkbenchQueueRow): number | null {
  return effectivePrice(row) ?? row.market?.lowestSell ?? null;
}

function matchesQueueText(row: WorkbenchQueueRow, text: string): boolean {
  const needle = text.trim().toLowerCase();
  return needle ? row.itemName.toLowerCase().includes(needle) : true;
}

function matchesQueueListed(row: WorkbenchQueueRow, listed: QueueListedFilter): boolean {
  if (listed === "all") return true;
  return listed === "listed" ? row.existingOrder != null : row.existingOrder == null;
}

/** Every matching row, uncapped (the display cap belongs to the view). A filter
 *  never touches `selected`, so a hidden ticked row still goes out with the plan. */
export function filterQueueRows(
  rows: readonly WorkbenchQueueRow[],
  filter: QueueRowFilter = {},
): WorkbenchQueueRow[] {
  const plat = filter.plat ?? NO_PLAT_RANGE;
  const listed = filter.listed ?? "all";
  const text = filter.text ?? "";
  return rows.filter(
    (row) =>
      matchesQueueText(row, text) &&
      matchesQueueListed(row, listed) &&
      withinPlatRange(queueFilterPrice(row), plat),
  );
}

/** Rows a plat bound drops for having no price yet. Shown next to the bounds so
 *  an empty list reads as unloaded market data rather than as no matches. */
export function unpricedHiddenCount(
  rows: readonly WorkbenchQueueRow[],
  filter: QueueRowFilter = {},
): number {
  if (!platRangeActive(filter.plat ?? NO_PLAT_RANGE)) return 0;
  return filterQueueRows(rows, { ...filter, plat: NO_PLAT_RANGE }).filter(
    (row) => queueFilterPrice(row) == null,
  ).length;
}

export function rowWarnings(row: WorkbenchQueueRow): WorkbenchQueueWarning[] {
  const warnings: WorkbenchQueueWarning[] = [];
  if (row.verdict.safe === 0 && !row.overrideAcknowledged) warnings.push("fully-protected");
  if (!row.sellBook) warnings.push("no-listing-data");
  else if ((row.market?.activeSellers ?? 0) < 3) warnings.push("low-liquidity");
  if (effectivePrice(row) == null) warnings.push("no-price");
  if (rowNeedsOverride(row) && !row.overrideAcknowledged) warnings.push("override-needed");
  return warnings;
}

export function bindingReasonKeys(verdict: SafetyVerdict): string[] {
  return verdict.reservations
    .filter((reservation: SafetyReservation) => reservation.binding)
    .map((reservation) => reservation.reasonKey);
}

/** Selected rows the user still has to price. Execute stays blocked while any
 *  exists, so a strategy that priced nothing cannot go out as a partial run. */
export function unpricedSelectedRows(rows: readonly WorkbenchQueueRow[]): WorkbenchQueueRow[] {
  return rows.filter((row) => row.selected && row.quantity > 0 && effectivePrice(row) == null);
}

function executableRows(rows: readonly WorkbenchQueueRow[]): WorkbenchQueueRow[] {
  return rows.filter(
    (row) =>
      row.selected &&
      row.quantity > 0 &&
      effectivePrice(row) != null &&
      (!rowNeedsOverride(row) || row.overrideAcknowledged),
  );
}

interface WorkbenchPlanBuild {
  plan: WorkbenchPlan;
  /** True when the selection exceeds the per-run cap; nothing was truncated. */
  overCap: boolean;
}

/** The journal keys preexisting order ids and intents by planId, so two plans
 *  built in the same millisecond must not collide on the timestamp alone. */
let planSequence = 0;

export function buildPlanFromRows(
  rows: readonly WorkbenchQueueRow[],
  now: number,
  myOrders: readonly WfmOrder[] = [],
): WorkbenchPlanBuild {
  const eligible = executableRows(rows);
  const planRows: WorkbenchPlanRow[] = eligible.map((row) => {
    const price = effectivePrice(row) as number;
    const planRow: WorkbenchPlanRow = {
      rowId: row.rowId,
      mode: row.existingOrder ? "update" : "create",
      slug: row.slug,
      itemName: row.itemName,
      quantity: row.quantity,
      platinum: price,
    };
    if (row.rank != null) planRow.rank = row.rank;
    if (row.subtype) planRow.subtype = row.subtype;
    if (row.existingOrder) planRow.orderId = row.existingOrder.id;
    if (rowNeedsOverride(row) && row.overrideAcknowledged) {
      planRow.override = {
        acknowledgedAt: row.overrideAcknowledgedAt ?? now,
        reasonKeys: bindingReasonKeys(row.verdict),
      };
    }
    return planRow;
  });
  const plan: WorkbenchPlan = {
    planId: `plan-${now}-${++planSequence}`,
    createdAt: now,
    rows: planRows,
  };
  // Recorded before anything is sent, so review can tell a created order from
  // one that was already on the account.
  const knownOrderIds = myOrders.map((order) => order.id).filter((id) => Boolean(id));
  if (knownOrderIds.length > 0) plan.knownOrderIds = knownOrderIds;
  return { plan, overCap: planRows.length > WORKBENCH_MAX_ROWS_PER_RUN };
}

/** Fresh snapshot at confirm time: verdicts are recomputed from the live
 *  safety context, never copied from what the queue was built with. */
export function captureSafetySnapshot(
  rows: readonly WorkbenchQueueRow[],
  context: SafetyContext,
  now: number,
): WorkbenchSafetySnapshot {
  const snapshot: WorkbenchSafetySnapshot = { capturedAt: now, rows: {} };
  for (const row of rows) {
    const verdict = safeToList(row.item, context);
    snapshot.rows[row.rowId] = { safe: verdict.safe, total: verdict.total };
  }
  return snapshot;
}

/** Stable key for per-item safety settings (locks, spares). */
export function rowSafetyKey(row: WorkbenchQueueRow): string {
  return safetyKeyFor(row.item);
}

interface WorkbenchTotals {
  rows: number;
  units: number;
  platinum: number;
}

export function planTotals(rows: readonly WorkbenchQueueRow[]): WorkbenchTotals {
  const eligible = executableRows(rows);
  return {
    rows: eligible.length,
    units: eligible.reduce((sum, row) => sum + row.quantity, 0),
    platinum: eligible.reduce((sum, row) => sum + row.quantity * (effectivePrice(row) ?? 0), 0),
  };
}
