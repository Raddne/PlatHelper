import { createJsonCache } from "./jsonCache";
import {
  normalizeLiveScraperStockFile,
  type CreateStockItemInput,
  type CreateWishlistItemInput,
  type LiveScraperStockFile,
  type StockItem,
  type WishlistItem,
} from "../config/shared/liveScraperStock";

const cache = createJsonCache<LiveScraperStockFile>(
  "live-scraper-stock.json",
  (parsed) => normalizeLiveScraperStockFile(parsed),
  { keepUnreadable: true },
);

let current: LiveScraperStockFile = cache.read() ?? { version: 1, stock: [], wishlist: [] };

function commit(next: LiveScraperStockFile): void {
  current = next;
  cache.write(current);
}

function newId(): string {
  return `ls-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function listStockItems(): StockItem[] {
  return current.stock;
}

export function listWishlistItems(): WishlistItem[] {
  return current.wishlist;
}

export function createStockItem(input: CreateStockItemInput): StockItem {
  const now = Date.now();
  // Same item + sub-type already tracked: merge quantity and average the cost
  // basis, rather than creating a duplicate row (mirrors Quantframe's
  // StockItemMutation::add_item merge behavior, docs §B.2/Appendix).
  const existingIndex = current.stock.findIndex(
    (item) => item.wfmId === input.wfmId && subTypeKey(item.subType) === subTypeKey(input.subType),
  );
  if (existingIndex !== -1) {
    const existing = current.stock[existingIndex]!;
    const totalOwned = existing.owned + input.owned;
    const totalCost = existing.bought * existing.owned + input.bought * input.owned;
    const merged: StockItem = {
      ...existing,
      owned: totalOwned,
      bought: totalOwned > 0 ? Math.round(totalCost / totalOwned) : existing.bought,
      updatedAt: now,
    };
    const stock = [...current.stock];
    stock[existingIndex] = merged;
    commit({ ...current, stock });
    return merged;
  }

  const item: StockItem = {
    id: newId(),
    wfmId: input.wfmId,
    wfmUrl: input.wfmUrl,
    itemName: input.itemName,
    subType: input.subType,
    owned: input.owned,
    bought: input.bought,
    listPrice: null,
    minPrice: null,
    isHidden: false,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  commit({ ...current, stock: [...current.stock, item] });
  return item;
}

export function updateStockItem(id: string, patch: Partial<StockItem>): StockItem | null {
  const index = current.stock.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const updated: StockItem = { ...current.stock[index]!, ...patch, id, updatedAt: Date.now() };
  const stock = [...current.stock];
  stock[index] = updated;
  commit({ ...current, stock });
  return updated;
}

export function deleteStockItem(id: string): boolean {
  const next = current.stock.filter((item) => item.id !== id);
  if (next.length === current.stock.length) return false;
  commit({ ...current, stock: next });
  return true;
}

export function createWishlistItem(input: CreateWishlistItemInput): WishlistItem {
  const now = Date.now();
  const existingIndex = current.wishlist.findIndex(
    (item) => item.wfmId === input.wfmId && subTypeKey(item.subType) === subTypeKey(input.subType),
  );
  if (existingIndex !== -1) {
    const existing = current.wishlist[existingIndex]!;
    const merged: WishlistItem = {
      ...existing,
      quantity: existing.quantity + input.quantity,
      maxPrice: input.maxPrice ?? existing.maxPrice,
      updatedAt: now,
    };
    const wishlist = [...current.wishlist];
    wishlist[existingIndex] = merged;
    commit({ ...current, wishlist });
    return merged;
  }

  const item: WishlistItem = {
    id: newId(),
    wfmId: input.wfmId,
    wfmUrl: input.wfmUrl,
    itemName: input.itemName,
    subType: input.subType,
    quantity: input.quantity,
    listPrice: null,
    maxPrice: input.maxPrice ?? null,
    minPrice: null,
    isHidden: false,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  commit({ ...current, wishlist: [...current.wishlist, item] });
  return item;
}

export function updateWishlistItem(id: string, patch: Partial<WishlistItem>): WishlistItem | null {
  const index = current.wishlist.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const updated: WishlistItem = {
    ...current.wishlist[index]!,
    ...patch,
    id,
    updatedAt: Date.now(),
  };
  const wishlist = [...current.wishlist];
  wishlist[index] = updated;
  commit({ ...current, wishlist });
  return updated;
}

export function deleteWishlistItem(id: string): boolean {
  const next = current.wishlist.filter((item) => item.id !== id);
  if (next.length === current.wishlist.length) return false;
  commit({ ...current, wishlist: next });
  return true;
}

function subTypeKey(
  subType: { rank?: number; variant?: string; subtype?: string } | undefined,
): string {
  if (!subType) return "";
  return `${subType.rank ?? ""}|${subType.variant ?? ""}|${subType.subtype ?? ""}`;
}
