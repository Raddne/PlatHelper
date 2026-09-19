// Applies config/shared/liveScraperAdopt.ts's plan to the stock store.

import { withScope } from "./logger";
import {
  createStockItem,
  deleteStockItem,
  listStockItems,
  updateStockItem,
} from "./liveScraperStock";
import { planAdoption } from "../config/shared/liveScraperAdopt";
import type { NormalisedOrder } from "./wfmOrders";

const log = withScope("liveScraperAdopt");

/** Only call with a sell-order list from a fetch that actually succeeded - an
 *  empty list from a failed fetch would drop every adopted row. */
export function syncAdoptedSellOrders(mySellOrders: readonly NormalisedOrder[]): void {
  const plan = planAdoption(listStockItems(), mySellOrders);
  for (const entry of plan.create) {
    const created = createStockItem({
      wfmId: entry.wfmUrl,
      wfmUrl: entry.wfmUrl,
      itemName: entry.itemName,
      subType: entry.subType,
      owned: entry.owned,
      bought: 0,
    });
    // The price the user chose is the floor: the scraper may follow the market
    // up from there, never undercut what they asked for. Editable per row.
    updateStockItem(created.id, {
      adopted: true,
      listPrice: entry.listPrice,
      minPrice: entry.listPrice,
      status: "live",
    });
    log.info(`[Adopt] now managing existing sell order: ${entry.itemName} @ ${entry.listPrice}p`);
  }
  for (const entry of plan.updateOwned) updateStockItem(entry.id, { owned: entry.owned });
  for (const id of plan.remove) {
    deleteStockItem(id);
    log.info(`[Adopt] sell order gone (sold or removed) - dropped stock row ${id}`);
  }
}
