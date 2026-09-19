// Shared by every Live Scraper sub-engine that needs to know whether it
// already has a live WFM order for a given item+variant (this is Quantframe's
// get_order_info seed step, docs §B.5a: existing order found -> "Update",
// none found -> "Create"). WFM orders don't carry Quantframe's SubType, only
// a rank number and a subtype string, so matching is on those two dimensions.

import type { NormalisedOrder } from "./wfmOrders";

export function matchExistingOrder(
  orders: readonly NormalisedOrder[],
  catalogId: string,
  rank: number | null,
  subtype: string | null,
): NormalisedOrder | null {
  return (
    orders.find(
      (order) =>
        order.itemId === catalogId &&
        (order.modRank ?? null) === rank &&
        (order.subtype ?? null) === subtype,
    ) ?? null
  );
}
