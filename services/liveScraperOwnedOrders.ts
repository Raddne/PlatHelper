// The warframe.market order IDs the Live Scraper created itself. Anything not
// in here was placed by the user (on the site or in another tool) and is off
// limits to every automatic delete: the start-up cleanup, the mode-mismatch
// cleanup and the catalog-scan buy pass. Deleting by hand from the Listings
// panel is the user's own call and does not go through this.

import { createJsonCache } from "./jsonCache";

interface OwnedOrdersFile {
  version: 1;
  orderIds: string[];
}

// Far above any WFM order cap; only stops the file growing forever when
// orders vanish without the scraper seeing the delete (filled, expired).
const MAX_TRACKED = 5000;

const cache = createJsonCache<OwnedOrdersFile>(
  "live-scraper-owned-orders.json",
  (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const ids = (parsed as { orderIds?: unknown }).orderIds;
    if (!Array.isArray(ids)) return null;
    return { version: 1, orderIds: ids.filter((id): id is string => typeof id === "string") };
  },
  { keepUnreadable: true },
);

let owned: Set<string> | null = null;

function load(): Set<string> {
  owned ??= new Set(cache.read()?.orderIds ?? []);
  return owned;
}

function persist(ids: Set<string>): void {
  cache.write({ version: 1, orderIds: [...ids].slice(-MAX_TRACKED) });
}

export function isOwnedOrder(orderId: string): boolean {
  return load().has(orderId);
}

export function markOrderOwned(orderId: string): void {
  const ids = load();
  if (ids.has(orderId)) return;
  ids.add(orderId);
  persist(ids);
}

export function forgetOwnedOrder(orderId: string): void {
  const ids = load();
  if (ids.delete(orderId)) persist(ids);
}

/** Drops IDs that are no longer on the account. Only call with order lists
 *  from a fetch that actually succeeded. */
export function pruneOwnedOrders(liveOrderIds: Iterable<string>): void {
  const ids = load();
  const live = new Set(liveOrderIds);
  let changed = false;
  for (const id of ids) {
    if (!live.has(id)) {
      ids.delete(id);
      changed = true;
    }
  }
  if (changed) persist(ids);
}

/** Test seam: forget the in-memory copy so the next call re-reads the file. */
export function resetOwnedOrdersForTest(): void {
  owned = null;
}
