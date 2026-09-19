// Removing a tracked row from the Live Scraper lists also takes its live
// warframe.market order/auction down. The WFM side goes first: if that call
// fails the row stays, so the list never claims a listing is gone while it is
// still up - and for an adopted sell order, dropping only the row would just
// get it re-adopted on the next tick anyway.

import { withScope } from "./logger";
import * as wfmCatalog from "./wfmCatalog";
import { deleteOrder, getMyOrders } from "./wfmOrders";
import { getInGameName } from "./wfmSession";
import { deleteRivenAuction } from "./wfmRivenSearch";
import { matchExistingOrder } from "./liveScraperOrderMatch";
import {
  deleteStockItem,
  deleteWishlistItem,
  listStockItems,
  listWishlistItems,
} from "./liveScraperStock";
import { deleteStockRiven, listStockRivens } from "./liveScraperRivenStock";
import { normalizeErrorMessage } from "../config/shared/errors";
import type { SubTypeLike } from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperListingRemoval");

type RemovalResult = { ok: true } | { ok: false; error: string };

async function deleteLiveOrder(
  side: "buy" | "sell",
  wfmUrl: string,
  subType: SubTypeLike | undefined,
): Promise<void> {
  // Signed out there is no order this session could reach - the row alone goes.
  if (!getInGameName()) return;
  const catalogItem = await wfmCatalog.lookupBySlug(wfmUrl);
  if (!catalogItem?.id) return;
  const mine = await getMyOrders();
  const rank = typeof subType?.rank === "number" ? subType.rank : null;
  const subtype = typeof subType?.subtype === "string" ? subType.subtype : null;
  const existing = matchExistingOrder(mine[side], catalogItem.id, rank, subtype);
  if (!existing) return;
  await deleteOrder(existing.id);
  log.info(`[Removal] deleted ${side} order ${existing.id} for ${wfmUrl}`);
}

export async function removeStockItem(id: string): Promise<RemovalResult> {
  const item = listStockItems().find((entry) => entry.id === id);
  if (!item) return { ok: false, error: "not found" };
  try {
    await deleteLiveOrder("sell", item.wfmUrl, item.subType);
  } catch (err) {
    const error = normalizeErrorMessage(err);
    log.warn(`[Removal] sell order for ${item.wfmUrl} could not be deleted, row kept:`, error);
    return { ok: false, error };
  }
  deleteStockItem(id);
  return { ok: true };
}

export async function removeWishlistItem(id: string): Promise<RemovalResult> {
  const item = listWishlistItems().find((entry) => entry.id === id);
  if (!item) return { ok: false, error: "not found" };
  try {
    await deleteLiveOrder("buy", item.wfmUrl, item.subType);
  } catch (err) {
    const error = normalizeErrorMessage(err);
    log.warn(`[Removal] buy order for ${item.wfmUrl} could not be deleted, row kept:`, error);
    return { ok: false, error };
  }
  deleteWishlistItem(id);
  return { ok: true };
}

export async function removeStockRiven(id: string): Promise<RemovalResult> {
  const riven = listStockRivens().find((entry) => entry.id === id);
  if (!riven) return { ok: false, error: "not found" };
  if (riven.auctionId) {
    const result = await deleteRivenAuction(riven.auctionId);
    if (!result.ok) {
      const error = result.error ?? "auction delete failed";
      log.warn(`[Removal] auction ${riven.auctionId} could not be deleted, row kept:`, error);
      return { ok: false, error };
    }
  }
  deleteStockRiven(id);
  return { ok: true };
}
