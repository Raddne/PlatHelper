// Isomorphic Live Scraper engine status shape, shared between
// services/liveScraperEngine.ts (main, produces it) and the renderer (consumes
// it over IPC). Mirrors the wfm scheduler health shape independently rather
// than importing services/wfmScheduler.ts, matching the convention already
// used by config/shared/marketAlertTypes.ts's MarketAlertSchedulerHealth.

interface LiveScraperSchedulerHealth {
  state: "ok" | "backoff" | "degraded";
  recentFailures: number;
  backoffUntil?: number;
}

/** One catalog-scan WTB candidate as the engine last saw it. Stock, wishlist
 *  and riven listings persist their own status/listPrice rows; scan candidates
 *  have no table, so the engine tracks them in memory for the listings panel. */
export interface LiveScraperWtbListing {
  wfmUrl: string;
  /** WFM catalog id - the key a buy-list max-price override is stored under. */
  wfmId: string;
  itemName: string;
  status:
    | "live"
    | "overpriced"
    | "underpriced"
    | "aboveAvgPrice"
    | "stockLimit"
    | "budget"
    | "orderLimit"
    | "error";
  /** Price of the live buy order; null when no order is up for this item. */
  listPrice: number | null;
  /** closedAvg - postPrice - 1 at last pricing; null when not computable. */
  potentialProfit: number | null;
  quantity: number;
  updatedAt: number;
}

export interface LiveScraperEngineStatus {
  running: boolean;
  lastTickAt: number | null;
  tickCount: number;
  lastMessage: string | null;
  lastError: string | null;
  scheduler: LiveScraperSchedulerHealth;
  wtbListings: LiveScraperWtbListing[];
}
