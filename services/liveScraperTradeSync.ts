// Applies config/shared/liveScraperTradeSync.ts to a trade the game confirmed.
// ipc/tradeWorkflow.ts calls in once its auto-close attempt is over, whether
// or not the scraper engine is running; ipc/liveScraperIpc.ts wires the pushes
// to the main window and the inventory refresh that resolves bought rivens.

import { withScope } from "./logger";
import { createJsonCache } from "./jsonCache";
import * as wfmCatalog from "./wfmCatalog";
import { getInGameName } from "./wfmSession";
import { lookupTradedCatalogItem, parseTradedItemName } from "./tradeItemName";
import { fetchLowestInGameSellPrice } from "./liveScraperOrderBook";
import { getLiveScraperSettings } from "./liveScraperSettings";
import {
  batchStockWrites,
  createStockItem,
  listStockItems,
  listWishlistItems,
  updateStockItem,
  updateWishlistItem,
} from "./liveScraperStock";
import { createStockRiven, listStockRivens, updateStockRiven } from "./liveScraperRivenStock";
import { removeStockItem, removeStockRiven, removeWishlistItem } from "./liveScraperListingRemoval";
import { requestRivenPass } from "./liveScraperEngine";
import { decodeAllRivens } from "./rivenFingerprint";
import { normalizeErrorMessage } from "../config/shared/errors";
import { subTypeKey } from "../config/shared/liveScraperStock";
import { titleFromSlug } from "../config/shared/wfm";
import {
  completeSetCount,
  normalizeLiveScraperTradeSyncFile,
  planRivenSale,
  planStockAfterSale,
  planWishlistAfterPurchase,
  queueNotice,
  resolvePendingRivens,
  splitPurchasePrice,
  stockRivenFromOwned,
  type LiveScraperTradeSyncFile,
  type TradedStockKind,
  type TradeSyncNotice,
  type TradeSyncNoticeRow,
} from "../config/shared/liveScraperTradeSync";
import type { TradeEvent, TradeItem } from "../config/shared/statsTypes";
import type { TradeMatchPayload } from "../config/shared/tradeMatch";

const log = withScope("liveScraperTradeSync");

interface TradeSyncDeps {
  /** Stock, wishlist or riven stock changed. */
  onChanged: () => void;
  /** A price-split notice was queued. */
  onNotice: () => void;
  /** The game inventory currently loaded, if any. */
  getInventory: () => Record<string, unknown> | null;
}

let _deps: TradeSyncDeps | null = null;

export function initLiveScraperTradeSync(deps: TradeSyncDeps): void {
  _deps = deps;
}

// Pending rivens and unacknowledged notices, both of which must outlive a restart.
const cache = createJsonCache<LiveScraperTradeSyncFile>(
  "live-scraper-trade-sync.json",
  (parsed) => normalizeLiveScraperTradeSyncFile(parsed),
  { keepUnreadable: true },
);

let current: LiveScraperTradeSyncFile = cache.read() ?? {
  version: 1,
  pendingRivens: [],
  notices: [],
};

function commit(next: LiveScraperTradeSyncFile): void {
  current = next;
  cache.write(current);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

interface ItemKind extends TradedStockKind {
  kind: "item";
  wfmUrl: string;
  itemName: string;
}

interface RivenKind {
  kind: "riven";
  weaponName: string;
  rivenName: string;
  count: number;
}

/** Something warframe.market does not list: it still cost part of the price. */
interface OtherKind {
  kind: "other";
  count: number;
}

type TradedKind = ItemKind | RivenKind | OtherKind;

function isItemKind(kind: TradedKind): kind is ItemKind {
  return kind.kind === "item";
}

function isRivenKind(kind: TradedKind): kind is RivenKind {
  return kind.kind === "riven";
}

/** Same item and variant in several lines of the trade window count as one kind. */
function classifyTradedItems(items: readonly TradeItem[]): TradedKind[] {
  const kinds: TradedKind[] = [];
  const itemKinds = new Map<string, ItemKind>();
  for (const item of items) {
    const parsed = parseTradedItemName(item.displayName);
    if (parsed.riven) {
      kinds.push({
        kind: "riven",
        weaponName: parsed.riven.weapon,
        rivenName: parsed.baseName,
        count: item.count,
      });
      continue;
    }
    const catalogItem = lookupTradedCatalogItem(item.displayName);
    const slug = catalogItem?.url_name;
    if (!catalogItem || !slug) {
      kinds.push({ kind: "other", count: item.count });
      continue;
    }
    // A rankable item added by hand always carries a rank, so an unranked name
    // counts as rank 0 to merge with that row.
    const rankable = (catalogItem.maxRank ?? 0) > 0;
    const subType = rankable ? { rank: parsed.rank ?? 0 } : undefined;
    const key = `${slug}#${subTypeKey(subType)}`;
    const known = itemKinds.get(key);
    if (known) {
      known.count += item.count;
      continue;
    }
    const kind: ItemKind = {
      kind: "item",
      wfmId: slug,
      wfmUrl: slug,
      itemName: catalogItem.item_name || titleFromSlug(slug),
      subType,
      count: item.count,
    };
    itemKinds.set(key, kind);
    kinds.push(kind);
  }
  return kinds;
}

/** The set the item kinds make up when they are exactly all its parts, k
 *  complete copies as one kind; null otherwise. */
async function findCompleteSet(items: readonly ItemKind[]): Promise<ItemKind | null> {
  if (items.length < 2) return null;
  const membership = await wfmCatalog.resolveSetMembership(items[0].wfmUrl);
  if (membership.kind !== "set") return null;
  const copies = completeSetCount(items, membership);
  if (copies == null) return null;
  const setItem = await wfmCatalog.lookupBySlug(membership.setSlug).catch(() => null);
  return {
    kind: "item",
    wfmId: membership.setSlug,
    wfmUrl: membership.setSlug,
    itemName: setItem?.item_name || titleFromSlug(membership.setSlug),
    subType: undefined,
    count: copies,
  };
}

/** All parts of one set, and nothing else, go in as the set. */
async function collapseCompleteSet(kinds: TradedKind[]): Promise<TradedKind[]> {
  if (!kinds.every(isItemKind)) return kinds;
  const set = await findCompleteSet(kinds);
  return set ? [set] : kinds;
}

/** What a sale takes off the stock. The game trades a set as its parts, so
 *  parts that make up complete sets come off a set row when there is one;
 *  without one they come off the part rows, never both. */
async function soldItemKinds(items: ItemKind[]): Promise<ItemKind[]> {
  const set = await findCompleteSet(items);
  if (!set) return items;
  const setKey = subTypeKey(set.subType);
  const hasSetRow = listStockItems().some(
    (row) => row.wfmId === set.wfmId && subTypeKey(row.subType) === setKey,
  );
  return hasSetRow ? [set] : items;
}

/** Each kind's lowest in-game sell offer, null where there is none. A riven's
 *  price needs the stats the log does not carry (only a heavy auction search
 *  could answer), and an unlisted item has none: either way the trade splits
 *  evenly, so nothing is fetched. One gap already decides that too. */
async function lowestOffers(kinds: readonly TradedKind[]): Promise<(number | null)[]> {
  const offers: (number | null)[] = kinds.map(() => null);
  if (kinds.length < 2 || !kinds.every(isItemKind)) return offers;
  const ownName = getInGameName();
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    offers[i] = await fetchLowestInGameSellPrice(kind.wfmUrl, kind.subType, ownName);
    if (offers[i] == null) break;
  }
  return offers;
}

async function removeWishlistRows(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const result = await removeWishlistItem(id, { ownedOrdersOnly: true });
    if (!result.ok) log.warn(`[TradeSync] wishlist row ${id} kept:`, result.error);
  }
}

async function syncPurchase(event: TradeEvent, itemsOn: boolean, rivensOn: boolean): Promise<void> {
  const received = event.items.filter((item) => item.direction === "received");
  const kinds = await collapseCompleteSet(classifyTradedItems(received));
  const applies = kinds.some(
    (kind) => (itemsOn && kind.kind === "item") || (rivensOn && kind.kind === "riven"),
  );
  if (!applies) return;

  const offers = await lowestOffers(kinds);
  const { split, perPiece } = splitPurchasePrice(
    event.platChange,
    kinds.map((kind, i) => ({ count: kind.count, lowestPrice: offers[i] })),
  );

  const rows: TradeSyncNoticeRow[] = [];
  let changed = false;
  if (itemsOn) {
    const bought = kinds
      .map((kind, i) => ({ kind, bought: perPiece[i] }))
      .filter((entry): entry is { kind: ItemKind; bought: number } => isItemKind(entry.kind));
    const wishlistPlan = planWishlistAfterPurchase(
      listWishlistItems(),
      bought.map((entry) => entry.kind),
    );
    batchStockWrites(() => {
      for (const { kind, bought: price } of bought) {
        createStockItem({
          wfmId: kind.wfmId,
          wfmUrl: kind.wfmUrl,
          itemName: kind.itemName,
          subType: kind.subType,
          owned: kind.count,
          bought: price,
          origin: "trade",
        });
        rows.push({ name: kind.itemName, quantity: kind.count, bought: price });
        log.info(`[TradeSync] bought ${kind.count}x ${kind.itemName} at ${price}p each -> WTS`);
      }
      for (const entry of wishlistPlan.update) {
        updateWishlistItem(entry.id, { quantity: entry.quantity });
      }
    });
    await removeWishlistRows(wishlistPlan.remove);
    changed = bought.length > 0;
  }

  if (rivensOn) {
    const pending = kinds
      .map((kind, i) => ({ kind, bought: perPiece[i] }))
      .filter((entry): entry is { kind: RivenKind; bought: number } => isRivenKind(entry.kind));
    if (pending.length > 0) {
      const now = Date.now();
      const entries = pending.flatMap(({ kind, bought }) =>
        Array.from({ length: kind.count }, () => ({
          id: newId("lsp"),
          weaponName: kind.weaponName,
          rivenName: kind.rivenName,
          bought,
          createdAt: now,
        })),
      );
      commit({ ...current, pendingRivens: [...current.pendingRivens, ...entries] });
      for (const { kind, bought } of pending) {
        rows.push({ name: kind.rivenName, quantity: kind.count, bought });
      }
      log.info(`[TradeSync] ${entries.length} bought riven(s) wait for the inventory`);
      resolvePendingTradeRivens(_deps?.getInventory() ?? null);
    }
  }

  if (split && rows.length > 0) {
    const notice: TradeSyncNotice = {
      id: newId("lsn"),
      createdAt: Date.now(),
      platinum: event.platChange,
      split,
      rows,
    };
    commit({ ...current, notices: queueNotice(current.notices, notice) });
    _deps?.onNotice();
  }
  if (changed) _deps?.onChanged();
}

async function syncSale(
  event: TradeEvent,
  itemsOn: boolean,
  rivensOn: boolean,
  closed: readonly TradeMatchPayload[],
): Promise<void> {
  const given = event.items.filter((item) => item.direction === "given");
  const kinds = classifyTradedItems(given);
  let changed = false;

  if (itemsOn) {
    const sold = await soldItemKinds(kinds.filter(isItemKind));
    const plan = planStockAfterSale(listStockItems(), sold);
    batchStockWrites(() => {
      for (const entry of plan.update) updateStockItem(entry.id, { owned: entry.owned });
    });
    for (const id of plan.remove) {
      // Same removal as a delete by hand, except that a listing the user placed stays up.
      const result = await removeStockItem(id, { ownedOrdersOnly: true });
      if (!result.ok) log.warn(`[TradeSync] sold-out stock row ${id} kept:`, result.error);
    }
    changed = plan.update.length + plan.remove.length > 0;
  }

  if (rivensOn) {
    const ids = planRivenSale(listStockRivens(), kinds.filter(isRivenKind));
    const closedAuctions = new Set(
      closed.filter((match) => match.kind === "contract").map((match) => match.orderId),
    );
    for (const id of ids) {
      const riven = listStockRivens().find((entry) => entry.id === id);
      // The auto-close already closed this auction; closing it again would
      // fail, and a failed close keeps the row.
      if (riven?.auctionId && closedAuctions.has(riven.auctionId)) {
        updateStockRiven(id, { auctionId: null });
      }
      const result = await removeStockRiven(id);
      if (!result.ok) log.warn(`[TradeSync] sold stock riven ${id} kept:`, result.error);
      else changed = true;
    }
  }

  if (changed) _deps?.onChanged();
}

async function applyTrade(event: TradeEvent, closed: readonly TradeMatchPayload[]): Promise<void> {
  // A swap has no clear platinum direction, so it neither adds nor removes.
  if (event.type !== "purchase" && event.type !== "sale") return;
  const { tradeSyncItems, tradeSyncRivens } = getLiveScraperSettings().general;
  if (!tradeSyncItems && !tradeSyncRivens) return;
  try {
    // Names resolve against the market catalog, which a trade right after
    // start-up can beat.
    await wfmCatalog.ensureLoaded().catch(() => 0);
    if (event.type === "purchase") await syncPurchase(event, tradeSyncItems, tradeSyncRivens);
    else await syncSale(event, tradeSyncItems, tradeSyncRivens, closed);
  } catch (err) {
    log.warn(`[TradeSync] trade ${event.id} not applied:`, normalizeErrorMessage(err));
  }
}

let _queue: Promise<void> = Promise.resolve();

/** Applies one confirmed trade to the stock lists. Trades run one after the
 *  other, so two quick sales of one item never both work from the same row. */
export function syncConfirmedTrade(
  event: TradeEvent,
  closed: readonly TradeMatchPayload[],
): Promise<void> {
  const run = _queue.then(() => applyTrade(event, closed));
  _queue = run.catch(() => undefined);
  return run;
}

/** Turns pending trade rivens the inventory now shows into stock rivens.
 *  Runs right after a purchase and on every inventory refresh. */
export function resolvePendingTradeRivens(inventory: Record<string, unknown> | null): void {
  if (current.pendingRivens.length === 0) return;
  try {
    const owned = inventory ? decodeAllRivens(inventory).unveiled : [];
    const tracked = new Set(listStockRivens().map((riven) => riven.sourceItemId));
    const { resolved, remaining } = resolvePendingRivens(
      current.pendingRivens,
      owned,
      tracked,
      Date.now(),
    );
    if (remaining.length === current.pendingRivens.length) return;
    for (const { pending, riven } of resolved) {
      createStockRiven(stockRivenFromOwned(riven, pending.bought));
      log.info(`[TradeSync] bought riven ${riven.rivenName} at ${pending.bought}p -> WTS`);
    }
    commit({ ...current, pendingRivens: remaining });
    if (resolved.length > 0) {
      requestRivenPass();
      _deps?.onChanged();
    }
  } catch (err) {
    log.warn("[TradeSync] pending rivens not resolved:", normalizeErrorMessage(err));
  }
}

export function listTradeSyncNotices(): TradeSyncNotice[] {
  return current.notices;
}

export function acknowledgeTradeSyncNotice(id: string): boolean {
  const notices = current.notices.filter((notice) => notice.id !== id);
  if (notices.length === current.notices.length) return false;
  commit({ ...current, notices });
  return true;
}
