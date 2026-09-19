// Phase 8: executes the cleanup decision from config/shared/liveScraperOrderCleanup.ts
// against real WFM orders (docs/live-scraper/quantframe-reference.md §B.7).
// Runs at the very start of every item-engine tick, before any pricing pass.

import { withScope } from "./logger";
import { deleteOrder } from "./wfmOrders";
import * as wfmCatalog from "./wfmCatalog";
import { listStockItems } from "./liveScraperStock";
import { forgetOwnedOrder, isOwnedOrder, pruneOwnedOrders } from "./liveScraperOwnedOrders";
import type { NormalisedOrder } from "./wfmOrders";
import { computeOrdersToDelete } from "../config/shared/liveScraperOrderCleanup";
import type { LiveScraperSettings } from "../config/shared/liveScraperSettings";

const log = withScope("liveScraperOrderCleanup");

interface OrderCleanupResult {
  attempted: number;
  deleted: number;
  failed: number;
  /** IDs actually removed, so a caller reusing the pre-cleanup order snapshot
   *  for the rest of the tick can filter them out instead of acting on
   *  now-dead order IDs. */
  deletedIds: string[];
}

function sellKey(itemId: string | null, rank: number | null, subtype: string | null): string {
  return `${itemId ?? ""}|${rank ?? ""}|${subtype ?? ""}`;
}

/** A sell order counts as the scraper's own only when it matches a tracked
 *  stock item (same identity progressStockItem matches on) - anything else is
 *  a listing the user placed by hand and must survive the cleanup. */
async function collectManagedSellKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const item of listStockItems()) {
    if (item.adopted) continue; // the user's own listing - never the scraper's to delete
    const catalogItem = await wfmCatalog.lookupBySlug(item.wfmUrl);
    if (!catalogItem?.id) continue;
    const rank = typeof item.subType?.rank === "number" ? item.subType.rank : null;
    const subtype = typeof item.subType?.subtype === "string" ? item.subType.subtype : null;
    keys.add(sellKey(catalogItem.id, rank, subtype));
  }
  return keys;
}

/** Deletes IDs one at a time (mirrors item.rs:64-104's sequential loop) - a
 *  single delete failure is logged and does not abort the rest of the batch,
 *  and `shouldContinue` is checked before each delete so a mid-pass Stop
 *  doesn't keep firing WFM requests. */
export async function runOrderCleanup(
  settings: LiveScraperSettings,
  myOrders: { buy: readonly NormalisedOrder[]; sell: readonly NormalisedOrder[] },
  justStarted: boolean,
  shouldContinue: () => boolean,
): Promise<OrderCleanupResult> {
  pruneOwnedOrders([...myOrders.buy, ...myOrders.sell].map((order) => order.id));
  const managedSellKeys = await collectManagedSellKeys();
  const ids = computeOrdersToDelete(
    settings,
    myOrders,
    justStarted,
    (order) => managedSellKeys.has(sellKey(order.itemId, order.modRank, order.subtype)),
    (order) => isOwnedOrder(order.id),
  );
  const deletedIds: string[] = [];
  let failed = 0;
  for (const id of ids) {
    if (!shouldContinue()) break;
    try {
      await deleteOrder(id);
      forgetOwnedOrder(id);
      deletedIds.push(id);
    } catch (err) {
      failed += 1;
      log.warn(
        `[Cleanup] failed to delete order ${id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  if (ids.length > 0) {
    log.info(
      `[Cleanup] ${justStarted ? "full wipe" : "mode-mismatch"}: deleted ${deletedIds.length}/${ids.length}` +
        (failed > 0 ? ` (${failed} failed)` : ""),
    );
  }
  return { attempted: ids.length, deleted: deletedIds.length, failed, deletedIds };
}
