import { createJsonCache } from "./jsonCache";
import {
  normalizeLiveScraperRivenStockFile,
  type CreateStockRivenInput,
  type LiveScraperRivenStockFile,
  type StockRiven,
} from "../config/shared/liveScraperRivenStock";

const cache = createJsonCache<LiveScraperRivenStockFile>(
  "live-scraper-riven-stock.json",
  (parsed) => normalizeLiveScraperRivenStockFile(parsed),
  { keepUnreadable: true },
);

let current: LiveScraperRivenStockFile = cache.read() ?? { version: 1, stockRivens: [] };

function commit(next: LiveScraperRivenStockFile): void {
  current = next;
  cache.write(current);
}

function newId(): string {
  return `lsr-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function listStockRivens(): StockRiven[] {
  return current.stockRivens;
}

export function createStockRiven(input: CreateStockRivenInput): StockRiven {
  const now = Date.now();
  const item: StockRiven = {
    id: newId(),
    sourceItemId: input.sourceItemId,
    weaponName: input.weaponName,
    rivenName: input.rivenName,
    masteryReq: input.masteryReq,
    rerolls: input.rerolls,
    polarity: input.polarity,
    modRank: input.modRank,
    stats: input.stats,
    bought: input.bought,
    minPrice: null,
    listPrice: null,
    auctionId: null,
    isHidden: false,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  commit({ ...current, stockRivens: [...current.stockRivens, item] });
  return item;
}

export function updateStockRiven(id: string, patch: Partial<StockRiven>): StockRiven | null {
  const index = current.stockRivens.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const updated: StockRiven = {
    ...current.stockRivens[index]!,
    ...patch,
    id,
    updatedAt: Date.now(),
  };
  const stockRivens = [...current.stockRivens];
  stockRivens[index] = updated;
  commit({ ...current, stockRivens });
  return updated;
}

export function deleteStockRiven(id: string): boolean {
  const next = current.stockRivens.filter((item) => item.id !== id);
  if (next.length === current.stockRivens.length) return false;
  commit({ ...current, stockRivens: next });
  return true;
}
