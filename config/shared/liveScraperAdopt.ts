// Adoption of sell orders the user already has on warframe.market (a
// WFHelper addition - Quantframe only manages what is in its stock table and
// wipes the rest). Every live sell order with no matching stock row becomes an
// "adopted" stock row so the WTS pass re-prices it like any other; an adopted
// row whose order is gone (sold, or removed by the user) is dropped instead of
// being re-listed. Pure decision logic; services/liveScraperAdopt.ts applies it.

import type { StockItem } from "./liveScraperStock";
import type { SubTypeLike } from "./liveScraperSettings";

export interface AdoptableOrder {
  itemUrlName: string | null;
  itemName: string;
  modRank: number | null;
  subtype: string | null;
  quantity: number;
  platinum: number;
}

interface AdoptionCreate {
  wfmUrl: string;
  itemName: string;
  subType: SubTypeLike | undefined;
  owned: number;
  listPrice: number;
}

interface AdoptionPlan {
  create: AdoptionCreate[];
  /** Adopted rows whose live order quantity changed (a partial sale). */
  updateOwned: { id: string; owned: number }[];
  /** Adopted rows with no live order left. */
  remove: string[];
}

function variantKey(
  wfmUrl: string | null,
  rank: number | null | undefined,
  subtype: string | null | undefined,
): string {
  return `${wfmUrl ?? ""}|${rank ?? ""}|${subtype ?? ""}`;
}

function stockKey(item: StockItem): string {
  return variantKey(item.wfmUrl, item.subType?.rank, item.subType?.subtype);
}

function orderKey(order: AdoptableOrder): string {
  return variantKey(order.itemUrlName, order.modRank, order.subtype);
}

export function planAdoption(
  stock: readonly StockItem[],
  sellOrders: readonly AdoptableOrder[],
): AdoptionPlan {
  const plan: AdoptionPlan = { create: [], updateOwned: [], remove: [] };
  const usable = sellOrders.filter((order) => order.itemUrlName);
  const stockByKey = new Map(stock.map((item) => [stockKey(item), item]));
  const liveKeys = new Set(usable.map(orderKey));
  const creating = new Set<string>();

  for (const order of usable) {
    const key = orderKey(order);
    const existing = stockByKey.get(key);
    if (!existing) {
      if (creating.has(key)) continue;
      creating.add(key);
      const subType: SubTypeLike = {};
      if (typeof order.modRank === "number") subType.rank = order.modRank;
      if (order.subtype) subType.subtype = order.subtype;
      plan.create.push({
        wfmUrl: order.itemUrlName as string,
        itemName: order.itemName,
        subType: Object.keys(subType).length > 0 ? subType : undefined,
        owned: Math.max(1, order.quantity),
        listPrice: order.platinum,
      });
    } else if (existing.adopted && order.quantity > 0 && existing.owned !== order.quantity) {
      plan.updateOwned.push({ id: existing.id, owned: order.quantity });
    }
  }

  for (const item of stock) {
    if (item.adopted && !liveKeys.has(stockKey(item))) plan.remove.push(item.id);
  }
  return plan;
}
