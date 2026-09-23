// Phase 4: the generic create/update/delete dispatcher for the Live Scraper
// engine, mirroring Quantframe's progress_order (docs/live-scraper/
// quantframe-reference.md §B.5a). The ops set is seeded "Create" or "Update"
// by whether the caller found an existing WFM order for this item+variant,
// then possibly widened with "Delete" by the caller's own pricing logic -
// that combination selects the branch below. Shared by wishlist buying now
// and item WTS/WTB selling once those phases land, so pricing logic never
// has to touch the WFM order API directly.
//
// Deliberate deviation from Quantframe: Quantframe issues an Update call on
// every tick even when price/quantity are unchanged (the reference doc notes
// it only skips the *UI refresh* event on a no-op update, not the API call
// itself). This dispatcher skips the API call entirely when nothing would
// actually change, to spend WFHelper's shared rate-limit budget only on
// mutations that matter - a stricter, safer posture than the source, in the
// same spirit as the scheduler health-check backoff already documented in
// docs/live-scraper/wfhelper-infra-map.md §5.

import { withScope } from "./logger";
import { createOrder, updateOrder, deleteOrder, type NormalisedOrder } from "./wfmOrders";
import { forgetOwnedOrder, markOrderOwned } from "./liveScraperOwnedOrders";
import { normalizeErrorMessage } from "../config/shared/errors";
import { isOrderLimitError } from "../config/shared/wfmOrders";

const log = withScope("liveScraperOrderDispatch");

interface DispatchOrderParams {
  orderType: "buy" | "sell";
  postPrice: number;
  quantity: number;
  modRank: number | null;
  subtype: string | null;
  itemId: string;
  existingOrder: NormalisedOrder | null;
  ops: Set<string>;
  /** Create the order hidden on warframe.market. An existing order keeps
   *  whatever visibility it has. */
  hidden?: boolean;
}

export interface DispatchOrderResult {
  action: "created" | "updated" | "deleted" | "skipped";
  orderId: string | null;
  error?: string;
  /** WFM rejected the create because the account is already at its total-order
   *  cap (docs §B.5a's can_create_order gate) - callers that dispatch many
   *  candidates in one pass (the WTB loop especially) should stop issuing
   *  further creates for the rest of that pass once this comes back true,
   *  since every subsequent one would fail identically. */
  orderLimitReached?: boolean;
  /** The order's visibility once the call is done; undefined when none is left. */
  visible?: boolean;
}

export async function dispatchOrder(params: DispatchOrderParams): Promise<DispatchOrderResult> {
  const { ops, existingOrder, orderType, postPrice, quantity, modRank, subtype, itemId } = params;
  const hidden = params.hidden === true;

  try {
    if (ops.has("Create") && !ops.has("Delete")) {
      try {
        const order = await createOrder({
          itemId,
          orderType,
          platinum: postPrice,
          quantity,
          visible: !hidden,
          modRank,
          subtype,
        });
        markOrderOwned(order.id);
        return { action: "created", orderId: order.id, visible: !hidden };
      } catch (err) {
        if (isOrderLimitError(err)) {
          log.warn(
            `[LiveScraperOrderDispatch] ${orderType} order for ${itemId} skipped - WFM order limit reached`,
          );
          return {
            action: "skipped",
            orderId: null,
            error: "WFM order limit reached",
            orderLimitReached: true,
          };
        }
        throw err;
      }
    }

    if (ops.has("Update") && !ops.has("Delete")) {
      if (!existingOrder) {
        return {
          action: "skipped",
          orderId: null,
          error: "Update requested with no existing order",
        };
      }
      const visible = existingOrder.visible;
      if (existingOrder.platinum === postPrice && existingOrder.quantity === quantity) {
        return { action: "skipped", orderId: existingOrder.id, visible };
      }
      const order = await updateOrder(existingOrder.id, {
        platinum: postPrice,
        quantity,
        modRank,
        subtype,
      });
      return { action: "updated", orderId: order.id, visible };
    }

    if (ops.has("Update") && ops.has("Delete")) {
      if (!existingOrder) return { action: "skipped", orderId: null };
      await deleteOrder(existingOrder.id);
      forgetOwnedOrder(existingOrder.id);
      return { action: "deleted", orderId: existingOrder.id };
    }

    // "Create"+"Delete" (a brand-new item immediately flagged bad) or no
    // flags at all: nothing to create and nothing to delete.
    return { action: "skipped", orderId: existingOrder?.id ?? null };
  } catch (err) {
    const message = normalizeErrorMessage(err);
    log.error(`[LiveScraperOrderDispatch] ${orderType} order for ${itemId} failed:`, message);
    return {
      action: "skipped",
      orderId: existingOrder?.id ?? null,
      error: message,
      ...(existingOrder ? { visible: existingOrder.visible } : {}),
    };
  }
}
