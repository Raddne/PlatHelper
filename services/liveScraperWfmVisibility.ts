// Hides or shows warframe.market listings from the Listings panel: the marked
// rows, or with none marked the whole tab, whose switch then also decides how
// its new listings are created. One request per listing, through the shared
// WFM scheduler; the rows record the outcome for the Status column.

import { withScope } from "./logger";
import * as wfmCatalog from "./wfmCatalog";
import { getMyOrders, setOrdersVisible, type NormalisedOrder } from "./wfmOrders";
import { getInGameName } from "./wfmSession";
import { updateRivenAuction } from "./wfmRivenSearch";
import { fetchAllMyAuctions } from "./liveScraperRivenAdopt";
import { isOwnedOrder } from "./liveScraperOwnedOrders";
import {
  batchStockWrites,
  listStockItems,
  listWishlistItems,
  updateStockItem,
  updateWishlistItem,
} from "./liveScraperStock";
import { listStockRivens, updateStockRiven } from "./liveScraperRivenStock";
import { getLiveScraperSettings, setHiddenOnWfm } from "./liveScraperSettings";
import { noteSwitched, setAllScanHidden, setScanHidden } from "./liveScraperListingVisibility";
import {
  planAuctionVisibility,
  planOrderVisibility,
  type VisibilityRowKey,
  type VisibilitySelection,
} from "../config/shared/liveScraperWfmVisibility";
import { normalizeErrorMessage } from "../config/shared/errors";
import type { ListingsTab } from "../config/shared/liveScraperSettings";
import type { StockItem, WishlistItem } from "../config/shared/liveScraperStock";

const log = withScope("liveScraperWfmVisibility");

interface SwitchCounts {
  switched: number;
  failed: number;
  /** Listings covered, including the ones already in the wanted state. */
  total: number;
}

type WfmVisibilityResult = ({ ok: true } & SwitchCounts) | { ok: false; error: string };

let _busy = false;

async function rowKeys(rows: readonly (StockItem | WishlistItem)[]): Promise<VisibilityRowKey[]> {
  const keys: VisibilityRowKey[] = [];
  for (const row of rows) {
    const catalogItem = await wfmCatalog.lookupBySlug(row.wfmUrl);
    if (!catalogItem?.id) continue;
    keys.push({
      id: row.id,
      catalogId: catalogItem.id,
      rank: typeof row.subType?.rank === "number" ? row.subType.rank : null,
      subtype: typeof row.subType?.subtype === "string" ? row.subType.subtype : null,
    });
  }
  return keys;
}

function pick<T extends { id: string }>(rows: T[], selection: VisibilitySelection | null): T[] {
  if (!selection) return rows;
  const ids = new Set(selection.rowIds);
  return rows.filter((row) => ids.has(row.id));
}

async function switchOrders(
  tab: "wtb" | "wts",
  hidden: boolean,
  selection: VisibilitySelection | null,
): Promise<SwitchCounts> {
  const kind = tab === "wts" ? "stock" : "wish";
  const rows = pick<StockItem | WishlistItem>(
    tab === "wts" ? listStockItems() : listWishlistItems(),
    selection,
  );
  const scanIds = new Set(selection?.scanIds ?? []);
  // The scraper's own orders without a row are catalog-scan buys; marked ones
  // come in by catalog id, and with nothing marked all of them do.
  const alsoCovers = (order: NormalisedOrder): boolean =>
    isOwnedOrder(order.id) && (!selection || (order.itemId != null && scanIds.has(order.itemId)));

  const [keys, mine] = await Promise.all([rowKeys(rows), getMyOrders()]);
  const plan = planOrderVisibility(tab === "wts" ? mine.sell : mine.buy, keys, alsoCovers, !hidden);
  const results = await setOrdersVisible(
    plan.toSwitch.map((order) => order.id),
    !hidden,
  );
  const failedIds = new Set(results.filter((r) => "error" in r).map((r) => r.id));
  const hiddenAfter = (order: NormalisedOrder): boolean =>
    failedIds.has(order.id) ? !order.visible : hidden;

  // A row without an order keeps the wanted state for its next one.
  batchStockWrites(() => {
    for (const row of rows) {
      const order = plan.rowOrders.get(row.id);
      const value = order ? hiddenAfter(order) : hidden;
      noteSwitched(`${kind}:${row.id}`);
      if (row.wfmHidden === value) continue;
      if (kind === "stock") updateStockItem(row.id, { wfmHidden: value });
      else updateWishlistItem(row.id, { wfmHidden: value });
    }
  });
  if (tab === "wtb") {
    if (!selection) setAllScanHidden(hidden);
    for (const catalogId of scanIds) {
      noteSwitched(`scan:${catalogId}`);
      setScanHidden(catalogId, hidden);
    }
    const rowOrderIds = new Set([...plan.rowOrders.values()].map((order) => order.id));
    for (const order of plan.covered) {
      if (rowOrderIds.has(order.id) || !order.itemId) continue;
      noteSwitched(`scan:${order.itemId}`);
      setScanHidden(order.itemId, hiddenAfter(order));
    }
  }
  return {
    switched: plan.toSwitch.length - failedIds.size,
    failed: failedIds.size,
    total: plan.covered.length,
  };
}

async function switchAuctions(
  hidden: boolean,
  selection: VisibilitySelection | null,
): Promise<SwitchCounts> {
  const rows = pick(listStockRivens(), selection);
  const ids = new Set(rows.map((row) => row.auctionId).filter((id): id is string => id != null));
  const auctions = ids.size > 0 ? await fetchAllMyAuctions() : [];
  const plan = planAuctionVisibility(auctions, ids, !hidden);
  const failedIds = new Set<string>();
  for (const auction of plan.toSwitch) {
    // The PUT replaces the entry, so everything else is resent as it is listed,
    // the same way the Market tab's own visibility toggle does it.
    const result = await updateRivenAuction({
      auctionId: auction.id,
      buyoutPrice: auction.buyoutPlatinum,
      startingPrice: auction.isDirectSell ? null : (auction.startingPlatinum ?? null),
      minReputation: auction.minimalReputation ?? 0,
      description: auction.note ?? "",
      visible: !hidden,
    });
    if (!result.ok) {
      failedIds.add(auction.id);
      log.warn(`[Visibility] auction ${auction.id} could not be switched:`, result.error);
    }
  }
  const byId = new Map(plan.covered.map((auction) => [auction.id, auction]));
  for (const row of rows) {
    const auction = row.auctionId ? byId.get(row.auctionId) : undefined;
    const value = auction && failedIds.has(auction.id) ? !auction.visible : hidden;
    noteSwitched(`riven:${row.id}`);
    if (row.wfmHidden !== value) updateStockRiven(row.id, { wfmHidden: value });
  }
  return {
    switched: plan.toSwitch.length - failedIds.size,
    failed: failedIds.size,
    total: plan.covered.length,
  };
}

/** `selection` null means the whole tab. `onSaved` runs once a whole-tab
 *  switch is stored, before the (possibly long) run over the listings. */
export async function setListingsHiddenOnWfm(
  tab: ListingsTab,
  hidden: boolean,
  selection: VisibilitySelection | null,
  onSaved?: () => void,
): Promise<WfmVisibilityResult> {
  if (_busy) return { ok: false, error: "busy" };
  if (!getInGameName()) return { ok: false, error: "not signed in" };
  _busy = true;
  const previous = getLiveScraperSettings().hiddenOnWfm[tab];
  if (!selection) {
    setHiddenOnWfm(tab, hidden);
    onSaved?.();
  }
  try {
    const counts =
      tab === "rivens"
        ? await switchAuctions(hidden, selection)
        : await switchOrders(tab, hidden, selection);
    log.info(
      `[Visibility] ${tab}${selection ? " (marked rows)" : ""} ${hidden ? "hidden" : "shown"} ` +
        `on WFM: ${counts.switched}/${counts.total} switched, ${counts.failed} failed`,
    );
    return { ok: true, ...counts };
  } catch (err) {
    // The listings could not even be read, so none was switched: keep the old state.
    if (!selection) setHiddenOnWfm(tab, previous);
    const error = normalizeErrorMessage(err);
    log.warn(`[Visibility] ${tab} could not be switched:`, error);
    return { ok: false, error };
  } finally {
    _busy = false;
  }
}
