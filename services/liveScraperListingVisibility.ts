// Whether each Live Scraper listing is hidden on warframe.market, kept in step
// with the account: rows carry it as `wfmHidden`, catalog-scan buys have it in
// memory here. A switch from the Listings panel wins over an order snapshot
// taken before it.

import { withScope } from "./logger";
import * as wfmCatalog from "./wfmCatalog";
import { matchExistingOrder } from "./liveScraperOrderMatch";
import {
  batchStockWrites,
  listStockItems,
  listWishlistItems,
  updateStockItem,
  updateWishlistItem,
} from "./liveScraperStock";
import { listStockRivens, updateStockRiven } from "./liveScraperRivenStock";
import { getLiveScraperSettings } from "./liveScraperSettings";
import type { NormalisedOrder } from "./wfmOrders";
import type { StockItem, WishlistItem } from "../config/shared/liveScraperStock";

const log = withScope("liveScraperListingVisibility");

type RowKind = "stock" | "wish" | "riven";

/** When the panel last switched a listing, by `<kind>:<row id>` or `scan:<catalog id>`. */
const _switchedAt = new Map<string, number>();
/** Catalog-scan buys by catalog id; they have no row to carry the state. */
const _scanHidden = new Map<string, boolean>();

export function noteSwitched(key: string): void {
  _switchedAt.set(key, Date.now());
}

function switchedSince(key: string, at: number): boolean {
  return (_switchedAt.get(key) ?? 0) > at;
}

/** How a new listing for this row is created: its last known state, else the tab's. */
export function rowCreateHidden(kind: RowKind, id: string): boolean {
  const tabs = getLiveScraperSettings().hiddenOnWfm;
  if (kind === "stock") return listStockItems().find((r) => r.id === id)?.wfmHidden ?? tabs.wts;
  if (kind === "wish") return listWishlistItems().find((r) => r.id === id)?.wfmHidden ?? tabs.wtb;
  return listStockRivens().find((r) => r.id === id)?.wfmHidden ?? tabs.rivens;
}

export function scanHidden(catalogId: string): boolean | undefined {
  return _scanHidden.get(catalogId);
}

export function scanCreateHidden(catalogId: string): boolean {
  return _scanHidden.get(catalogId) ?? getLiveScraperSettings().hiddenOnWfm.wtb;
}

/** `observedAt` marks a value read from an order snapshot, which a later
 *  switch from the panel overrides. */
export function setScanHidden(catalogId: string, hidden: boolean, observedAt?: number): void {
  if (observedAt != null && switchedSince(`scan:${catalogId}`, observedAt)) return;
  _scanHidden.set(catalogId, hidden);
}

export function setAllScanHidden(hidden: boolean): void {
  for (const catalogId of _scanHidden.keys()) _scanHidden.set(catalogId, hidden);
}

async function observedHidden(
  orders: readonly NormalisedOrder[],
  row: StockItem | WishlistItem,
): Promise<boolean | undefined> {
  const catalogItem = await wfmCatalog.lookupBySlug(row.wfmUrl);
  if (!catalogItem?.id) return undefined;
  const rank = typeof row.subType?.rank === "number" ? row.subType.rank : null;
  const subtype = typeof row.subType?.subtype === "string" ? row.subType.subtype : null;
  const order = matchExistingOrder(orders, catalogItem.id, rank, subtype);
  return order ? !order.visible : undefined;
}

/** Copies each row's order visibility from a fresh snapshot of the account.
 *  Rows without an order keep their value: it says how the next one is made.
 *  Never throws; a failed pass only leaves the display a tick behind. */
export async function syncOrderRowVisibility(
  snapshot: { sell: readonly NormalisedOrder[]; buy: readonly NormalisedOrder[] },
  fetchedAt: number,
): Promise<void> {
  try {
    await syncRows(snapshot, fetchedAt);
  } catch (err) {
    log.warn("[Visibility] row sync skipped this tick:", err);
  }
}

async function syncRows(
  snapshot: { sell: readonly NormalisedOrder[]; buy: readonly NormalisedOrder[] },
  fetchedAt: number,
): Promise<void> {
  const writes: Array<() => void> = [];
  for (const item of listStockItems()) {
    const hidden = await observedHidden(snapshot.sell, item);
    if (hidden === undefined || hidden === item.wfmHidden) continue;
    writes.push(() => {
      if (!switchedSince(`stock:${item.id}`, fetchedAt))
        updateStockItem(item.id, { wfmHidden: hidden });
    });
  }
  for (const item of listWishlistItems()) {
    const hidden = await observedHidden(snapshot.buy, item);
    if (hidden === undefined || hidden === item.wfmHidden) continue;
    writes.push(() => {
      if (!switchedSince(`wish:${item.id}`, fetchedAt)) {
        updateWishlistItem(item.id, { wfmHidden: hidden });
      }
    });
  }
  if (writes.length > 0) batchStockWrites(() => writes.forEach((write) => write()));
}

/** The same for riven rows, from the account's own auction list. */
export function syncRivenRowVisibility(
  auctions: readonly { id: string; visible: boolean }[],
  fetchedAt: number,
): void {
  const byId = new Map(auctions.map((auction) => [auction.id, auction]));
  for (const riven of listStockRivens()) {
    const auction = riven.auctionId ? byId.get(riven.auctionId) : undefined;
    if (!auction || riven.wfmHidden === !auction.visible) continue;
    if (switchedSince(`riven:${riven.id}`, fetchedAt)) continue;
    updateStockRiven(riven.id, { wfmHidden: !auction.visible });
  }
}
