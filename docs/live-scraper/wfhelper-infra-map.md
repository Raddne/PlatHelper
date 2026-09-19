# Live Scraper — Existing WFHelper Codebase Map

Produced by an architecture-mapping pass over this repository before implementing the Live Scraper engine, so it builds on existing infrastructure instead of duplicating it. Pairs with `docs/live-scraper/quantframe-reference.md` (the target algorithm spec).

## 1. Order CRUD

`services/wfmOrders.ts` exports exactly six functions — this is the complete set, nothing missing:

```ts
getMyOrders(): Promise<{ sell: NormalisedOrder[]; buy: NormalisedOrder[] }>          // wfmOrders.ts:110
createOrder({ itemId, orderType, platinum, quantity, visible?, modRank?, perTrade?, subtype? }): Promise<NormalisedOrder>  // :178
updateOrder(orderId, { platinum?, quantity?, visible?, modRank?, subtype? }): Promise<NormalisedOrder>  // :272
deleteOrder(orderId): Promise<{ deleted: boolean; id: string }>                     // :303
closeOrder(orderId, quantity): Promise<WfmCloseOrderResult>                         // :309
setOrdersVisible(orderIds: string[], visible: boolean): Promise<Array<NormalisedOrder | {id,error}>>  // :325 — loops updateOrder() sequentially, not a real bulk endpoint
```

Notes / gaps:
- **No order cache.** `getMyOrders()` hits `GET /v2/orders/my` live every call (wfmOrders.ts:115) and re-enriches every order via `wfmCatalog.lookupById` (wfmOrders.ts:126). Nothing in the codebase memoizes this — every consumer (`ipc/wfmIpc.ts:164`, `tradeWorkbench.ts:107/589`) refetches. The engine needs its own in-memory "my orders" snapshot to avoid refetching every tick.
- **`closeOrder` has no IPC handler at all** — only reachable from main-process code. Fine for the engine (main-process itself), but it's effectively untested/unused today.
- Bulk create/update/delete exists only inside `services/tradeWorkbench.ts` — a higher-level "plan executor" with its own journal, not a bulk API wrapper worth reusing wholesale for a live-scraper loop.
- IPC wiring for these lives in `ipc/wfmIpc.ts:164,190,215,228,241`; mutating ones (create/update/delete/setVisible) are exposed through a **separate `window.tradeApi` bridge** (preload.ts:414-422), not `window.api` — a deliberate security split for order-mutating calls.

## 2. Per-item competing-order lookup

Two implementations exist, neither a clean reusable service function as-is:

**A. `services/marketAlerts.ts` (main process) — private, not exported.**
```ts
// marketAlerts.ts:281
async function wfmGetV2(path): Promise<unknown> { return wfmClient.requestV2("GET", path, { priority: "background" }); }
// marketAlerts.ts:639
const raw = await wfmGetV2(`/orders/item/${encodeURIComponent(match.itemUrlName)}`);
const orders = parseOrderViews(raw).filter(o => !isOwnListing(o.owner) && matchItemOrder(match, o, owned));
```
`parseOrderViews` (marketAlerts.ts:484) filters: `visible !== false`, platform is `pc` OR `user.crossplay === true`. No online-status filter of its own (left to `matchItemOrder`'s optional `match.statuses` gate), no subtype/rank filter at all. `isOwnListing()` (marketAlerts.ts:563) excludes the signed-in user's own orders by case-insensitive name match against `_deps.getOwnName()` (wired to `wfmSession.getInGameName()`).

**B. `config/shared/wfmOrders.ts` — public, isomorphic, richer, reused elsewhere (just not in the main-process engine).**
```ts
bestOrderPrice(entries: {platinum,status}[], orderType: "sell"|"buy", activeOnly: boolean): number | null      // :84
normalizeWfmOrderBookSide(rawOrders: unknown, orderType: "sell"|"buy", rankFilter: number|null, limit?, subtypeFilter?: string|null): WfmOrderBookEntry[]  // :124
isActiveOrderStatus(status): boolean  // "ingame" | "online"   // :80
extractWfmOrderList(payload: unknown): unknown[] | null        // :106
```
`normalizeWfmOrderBookSide` filters `visible !== false`, filters by exact rank and subtype (missing subtype counts as `"intact"`), drops `atragraph` mod variant unless explicitly requested, and **sorts** (sell ascending / buy descending by price, tie-broken by quantity desc then name). This is the "lowest sell / highest buy" primitive. Does **not** exclude the user's own orders or filter by platform/crossplay — callers must do that separately (as `marketAlerts.ts` does with `isOwnListing`).

**Decision: the engine calls `wfmClient.requestV2("GET", "/orders/item/{slug}", { priority: "background" })` (mirroring `marketAlerts.ts:281,639`) and pipes the raw payload through `normalizeWfmOrderBookSide` + `bestOrderPrice` from `config/shared/wfmOrders.ts`, adding its own "exclude own orders" filter the same way `marketAlerts.ts:563` does.** Combines the best of both existing implementations without duplicating either.

## 3. Price statistics — richer cache exists, but renderer-driven and chart-only

`services/wfmStatsPrice.ts` is a single cached median per slug, TTL-based, backed by `wfmClient.request`.

A richer structure exists — `config/shared/marketStats.ts`'s `MarketStatPoint` (`source, time, volume, median, movingAvg, avgPrice, openPrice, closedPrice, minPrice, maxPrice, donchTop, donchBot, rank`), persisted per-slug via `services/marketStatsHistory.ts::mergeMarketStatsHistory(slug, incoming, mode, now?)` to `<userData>/market-stats/{slug}.json`.

**But** this is fed entirely from the renderer: `src/components/market/MarketBrowseStats.svelte:193` fetches `https://api.warframe.market/v1/items/{slug}/statistics` **directly from the renderer**, bypassing `wfmClient`/`wfmScheduler`, then IPCs the points to `marketStatsHistory.mergeMarketStatsHistory`. No main-process code populates it and no IPC handler reads it back — it only exists to seed the Browse chart, only when a user opens it.

**Conclusion: no ready-made main-process "rich per-item stats" fetcher exists.** Need a new main-process fetcher against `/items/{slug}/statistics`, mirroring `wfmStatsPrice.ts`'s pattern but routed through `wfmClient.request` with `{priority:"background"}`. Can either reuse `MarketStatPoint`'s shape/`marketStatsHistory.ts` persistence, or build a purpose-built cache. **Trading tax has zero predictive/lookup data anywhere** — the only `tradeTax` field in the codebase is a historical fact recorded per completed trade in the ledger (`config/shared/tradeLedgerTypes.ts`), not a per-item lookup table. Needs a new data source (WFM item catalog entries carry a `ducats`/`tradingTax`-ish field in some APIs — verify against the live `/items` endpoint when building this, don't assume).

## 4. Stock / Wishlist persistence — does not exist, must be designed from scratch

Nothing matches "items I hold with a bought price" or "items I want to buy with a target price" as active engine input anywhere in `services/`/`config/`.

Closest existing things:
1. **`src/stores/liveScraperSettings.ts`** (built this session) — `BuyListEntry {wfmId, maxPrice}` is a price-cap override, not an owned-item-with-bought-price record; there's no `sellList`/stock entry type. Renderer-only, `localStorage`-backed.
2. **`services/tradeLedgerStore.ts`** — persisted historical trade log (`<userData>/trade-ledger/{year}.json.gz`), each `TradeEvent` has `platChange`, `items: TradeItem[]` (`displayName, count, direction, wfmSlug?`), `credits?`, `tradeTax?`. A record of completed trades, not an active stock list.
3. **`src/stores/inventorySelection.ts`** — `SavedSelection {name, keys, alertWhenComplete?, lastComplete?}`, a UI multi-select mechanism over live game-inventory data feeding `tradeWorkbench.ts`'s bulk-sell flow. Not a persisted for-sale list with a target price.

**Decision: design stock/wishlist persistence new**, using the house `jsonCache`/`createJsonCache` pattern (used by `marketAlerts.ts`, `marketStatsHistory.ts`, `tradeWorkbench.ts`) under `userDataPath()` — main-process authoritative, matching how every other always-on engine in this codebase persists its state.

## 5. Scheduling / rate limiting — `services/wfmScheduler.ts`

```ts
export function scheduleWfmRequest<T>(
  attempt: (attemptNumber: number, ctx: WfmAttemptContext) => Promise<WfmAttemptOutcome<T>>,
  options?: { priority?: "interactive" | "background"; label?: string }
): Promise<T>
```
- Global token bucket: `RATE_PER_SECOND: 2.5`, `BURST_TOKENS: 5`, `MAX_CONCURRENT: 3`, `MAX_BACKGROUND_CONCURRENT: 2` (background priority never takes the last slot).
- `MAX_QUEUE_DEPTH: 64` — throws `WFM_QUEUE_FULL` `WfmApiError` if exceeded.
- Retries: up to `MAX_RETRIES: 3`, exponential backoff (`RETRY_BASE_MS: 750`, factor 2, ceiling 2500ms) + jitter, capped by `MAX_RETRY_WAIT_MS: 10_000`.
- On HTTP 429: arms a global gate (`DEFAULT_RATE_LIMIT_GATE_MS: 30_000`, respects `Retry-After`, clamped `[1s, 5min]`) that holds **every** WFM call app-wide, not just the failing one.
- `attempt` returns `WfmAttemptOutcome<T>` (`{kind:"ok",value}` | `{kind:"failure", error, status?, retryAfterMs?, retryable, transient}`) instead of throwing.
- Health introspection: `getWfmSchedulerHealth(): { state: "ok"|"backoff"|"degraded"; backoffUntil?; recentFailures }` — `marketAlerts.ts` checks this every tick (`if (getWfmSchedulerHealth().state !== "ok") return;`) to skip work entirely while unhealthy. **The engine must do the same** — this is a deliberate, meaningful improvement over Quantframe, which (per the reference doc §B.6) has no such health-aware backoff at all.

Ordinary calls don't call `scheduleWfmRequest` directly — `wfmClient.request`/`requestV2` already wrap it. Every WFM request the engine makes should pass `{priority: "background"}` (house convention, matches `marketAlerts.ts`, `wfmStatsPrice.ts:62`).

## 6. Background loop pattern — `marketAlerts.ts` is the house style

```ts
const TICK_MS = 60_000;
const INITIAL_DELAY_MS = 30_000;
let _timer: ReturnType<typeof setInterval> | null = null;
let _startTimer: ReturnType<typeof setTimeout> | null = null;
let _stopped = false;
let _ticking = false;   // re-entrancy guard

export function initMarketAlerts(deps): void {
  _deps = deps; _stopped = false; state(); seen(); hits();
  if (_timer || _startTimer) return;   // idempotent
  _startTimer = setTimeout(() => {
    _startTimer = null;
    void tick();
    _timer = setInterval(() => void tick(), TICK_MS);
  }, INITIAL_DELAY_MS);
}

export function stopMarketAlerts(): void {
  _stopped = true;
  if (_timer) clearInterval(_timer);
  if (_startTimer) clearTimeout(_startTimer);
  _timer = null; _startTimer = null;
}
```
Plain `setInterval`/`setTimeout` — no custom scheduler class. Every mutating path re-checks `_stopped`/rule-currency after an `await` so a delete/stop racing an in-flight tick can't resurrect state. `tick()` is capped (`MAX_REQUESTS_PER_TICK = 4`) and self-paced per-rule via `_nextEvalAt`/`_cooldownUntil` maps rather than firing everything every tick.

Status/progress to the renderer is poll + push hybrid:
- `getMarketAlertEngineStatus(): MarketAlertEngineStatus` — `{running, ruleCount, enabledCount, lastTickAt, requestsLastHour, scheduler: {state, recentFailures, backoffUntil?}, lastError, rulesRecoveredAt}`.
- `emitChanged()` on any state mutation → `ipc/marketAlertsIpc.ts` → `pushAlertsChanged()` → `window.webContents.send(MARKET_ALERTS_CHANGED)`.
- Renderer additionally polls status every 20s as a belt-and-suspenders refresh (for cooldown countdowns that need to tick with no new event).

Other background loops (`eeLogMonitor.ts`'s `startWatching`/`stopWatching`, `apiHelperRunner.startPolling`/`stopPolling`) follow the same `start*`/`stop*` naming and idempotent-restart convention.

## 7. App startup/shutdown wiring — `main.ts`

The `ipc/*Ipc.ts` module's `register()` function is the actual boot hook — it both registers `ipcMain.handle` channels *and* calls the service's init/arm function with production dependencies. `main.ts` never calls a service's init function directly.

Startup (`main.ts:476` `registerIpcHandlers()`):
```ts
marketAlertsIpc.register();      // :495 — internally calls marketAlerts.initMarketAlerts({...deps})
tradeWorkbenchIpc.register();    // :496
tradeLedgerIpc.register();       // :497
```

Shutdown (`main.ts:831` `app.on("before-quit", ...)`):
```ts
markQuitting();                       // services/appLifecycle.ts
inventoryIpc.stopInventoryWatcher();
apiHelperRunner.stopPolling();
eeLogMonitor.stopWatching();
marketAlerts.stopMarketAlerts();      // called directly on the service, not via the Ipc module
stopOverlayHotkeyGate();
stopWarframeLifecycle();
...
```
`services/appLifecycle.ts` only provides `markQuitting()`/`isQuitting()`/`shouldHideOnClose()` — a shared flag, not a service registry. Each service is wired individually by name in `main.ts`.

**Plan for the engine:** `ipc/liveScraperIpc.ts` with a `register()` that calls `handleAuthorized` for its channels and calls `liveScraperEngine.initLiveScraper({...deps})`; call `liveScraperIpc.register()` alongside the others in `registerIpcHandlers()`; add `liveScraperEngine.stopLiveScraper()` next to `marketAlerts.stopMarketAlerts()` in the `before-quit` handler.

## 8. Full IPC wiring trace — `marketAlerts` end to end

Channel constants — `config/shared/ipcChannels.ts`: `MARKET_ALERTS_LIST`, `_SAVE`, `_DELETE`, `_SET_ENABLED`, `_CLEAR_COOLDOWN`, `_HITS`, `_CLEAR_HITS`, `_STATUS`, `_TEST_FIRE`, `_EXPORT`, `_IMPORT`, `_CHANGED` (one-way push).

Handler registration — `ipc/marketAlertsIpc.ts:107` `register()`:
```ts
handleAuthorized(MARKET_ALERTS_LIST, assertMainRendererSender, () => marketAlerts.listMarketAlertRules());
handleAuthorized(MARKET_ALERTS_STATUS, assertMainRendererSender, () => ({
  ...marketAlerts.getMarketAlertEngineStatus(),
  cooldowns: marketAlerts.getMarketAlertCooldowns(),
}));
```
`handleAuthorized(channel, assertMainRendererSender, handler)` (`ipc/ipcSecurity.ts`) verifies the IPC sender is the main renderer frame before running the handler — every handler in this codebase uses it.

Push channel: `pushAlertsChanged()` — `ctx.mainWindow.webContents.send(MARKET_ALERTS_CHANGED)` — wired as the `onChanged` dependency passed to `initMarketAlerts(...)`.

Preload exposure — `preload.ts:296-323`:
```ts
onMarketAlertsChanged: ipcDataBridge<IpcEventMap["market-alerts:changed"]>(ipcRenderer, MARKET_ALERTS_CHANGED),
marketAlertsList: inv<"marketAlertsList">(MARKET_ALERTS_LIST),
marketAlertsStatus: inv<"marketAlertsStatus">(MARKET_ALERTS_STATUS),
```
`inv<K>(channel)` wraps `ipcRenderer.invoke(channel, ...args)` typed against `IpcInvokeMap`. `ipcDataBridge<T>(ipcRenderer, channel)` wraps `ipcRenderer.on(channel, ...)`/`removeListener` into subscribe/unsubscribe. All exposed on `window.api` via `contextBridge.exposeInMainWorld("api", {...})` — except order-mutating calls, which go on the separate `window.tradeApi`.

Renderer consumption (`src/components/market/alerts/MarketAlertsView.svelte:22-79`) — component owns state directly, no dedicated store:
```ts
import { invoke, on } from "../../../lib/ipc.js";
let status = $state<MarketAlertStatusPayload | null>(null);
async function refreshLive(): Promise<void> {
  const [hitList, engineStatus] = await Promise.all([invoke("marketAlertsGetHits"), invoke("marketAlertsStatus")]);
  hits = hitList; status = engineStatus;
}
$effect(() => {
  void refresh();
  const off = on("market-alerts:changed", () => void refreshLive());   // push-driven
  const timer = setInterval(() => void refreshLive(), LIVE_REFRESH_MS); // 20s poll fallback
  return () => { off(); clearInterval(timer); };
});
```
`lib/ipc.ts` exports `invoke<K>(channel, ...args): Promise<Return>`, `on<K>(channel, cb): () => void`, `send<K>(channel, ...args): void`, all typed against `src/types/ipc.ts`'s `IpcInvokeMap`/`IpcEventMap`/`IpcSendMap`.

**Plan for the engine:** replicate exactly — channels in `config/shared/ipcChannels.ts` → `ipc/liveScraperIpc.ts` (`register()` + a `push*Changed()` sender) → `preload.ts` additions (start/stop/status/settings as `inv<>()`, one `onLiveScraperChanged` via `ipcDataBridge`) → renderer component/store using `invoke`/`on` + a light interval poll, mirroring `MarketAlertsView.svelte`.

## 9. Critical architecture decision this map forces

`src/stores/liveScraperSettings.ts` currently persists to **renderer `localStorage` only**. The main-process engine needs to *read* these settings to decide what to trade. Two options:
- (a) push settings to main via IPC on every renderer-side change, main process keeps its own copy in sync, or
- (b) **move authoritative persistence into the main process** (`jsonCache` under `userDataPath()`, matching every other engine), and turn the renderer store into a thin IPC-backed mirror (calls `invoke("liveScraperGetSettings")`/`invoke("liveScraperUpdateSettings", patch)` instead of touching `localStorage` directly, refreshed via the same `on("live-scraper:changed", ...)` push channel as everything else).

**Decision: (b)**, for consistency with the established house pattern (main-process-authoritative state for every other always-on engine) and because the engine is the actual consumer of this data, not the renderer.
