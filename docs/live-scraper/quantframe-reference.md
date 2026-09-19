# Quantframe "Live Scraper" — Technical Reference for Clean-Room Reimplementation

This document is an exhaustive behavioral extraction of Quantframe's Live Scraper feature (auto-pricing/auto-trading engine against warframe.market), covering the settings schema (frontend + Rust) and the Rust engine algorithm, for reimplementation in WFHelper (Node/Electron/TS).

All file paths are relative to the Quantframe 1.6.27 source tree (`quantframe-react-1.6.27`) unless otherwise noted. The `wf-market` crate referenced below is an external git dependency (`git = "https://github.com/KibbeWater/wf-market", rev = "aba1d268a7a0f76d54ba3dcd862d2f3a4f7e3496"`), read from the local cargo checkout for this analysis.

---

## PART A — Settings Schema

### A.0 Top-level shape

`src-tauri/src/app/types/settings/live_scraper_settings.rs:5-11`

```rust
pub struct LiveScraperSettings {
    pub general: LiveScraperGeneralSettings,
    pub items: ItemSettings,      // { general, wtb, wts }
    pub rivens: RivenSettings,    // { general, wts }
    pub syndicate: SyndicateSettings, // { wts }
}
```

Frontend form path prefix: `settings.live_scraper.*` (this is a sub-object of the giant `TauriTypes.Settings` Mantine form — `src/components/Forms/Settings/Tabs/LiveTrading/index.tsx`). UI tabs map 1:1 to sub-structs: **General** → `live_scraper.general` + `live_scraper.items.general`, **Item** → `live_scraper.items.{wtb,wts}`, **Riven** → `live_scraper.rivens.*`, **Syndicate** (dev-only tab, `hide: !import.meta.env.DEV`) → `live_scraper.syndicate.wts`.

### A.1 General tab (`Tabs/General/index.tsx`)

Struct: `LiveScraperGeneralSettings` (`src-tauri/src/app/types/settings/live_scraper_general_settings.rs:4-12`)

| Field (path: `live_scraper.general.*`) | Rust type | Default | UI control | Meaning |
|---|---|---|---|---|
| `report_to_wfm` | `bool` | `true` | Checkbox | "Will add a transaction to Warframe Market" — gates whether buy-side WFM order sync happens at all (see `handle_wfm_item`, §B.5). |
| `auto_delete` | `bool` | `true` | Checkbox | "Automatically delete stock items". Also drives the one-time full-wipe of non-blacklisted orders on scraper start (see `orders_to_delete`, §B.7) and enables the recurring "trade-mode mismatch" cleanup. Checking this triggers a confirmation modal on Start ("This action will delete all non-blacklisted orders on WFM."). |
| `auto_trade` | `bool` | `true` | Checkbox | "Automatically add/sell stock if true" (general auto-trade master toggle; not gated on anywhere in the read engine code inspected — appears reserved/legacy). |
| `delete_conflicting_orders` | `bool` | `false` | Checkbox | "Will delete other trade types if true — example: if buy is enabled will delete sell/wishlist items if they are not blacklisted." Together with `auto_delete`, ORs into the gate that enables `delete_unwanted_orders` to run each cycle (see §B.7 — the flag does **not** change the deletion logic itself, only whether the routine executes at all). |
| `stock_mode` | `enum StockMode` (`All`\|`Item`\|`Riven`) | `All` | `Select` (not deselectable) | Which sub-engine(s) the main loop drives: `Item` → item engine only, `Riven` → riven engine only, `All` → both. There is no `Syndicate` stock mode value — syndicate processing is nested inside the Item engine's per-item operation set (see §B.2) and is currently short-circuited/disabled in code. |
| `trade_modes` | `Vec<TradeMode>` (`Buy`\|`Sell`\|`WishList`\|`Syndicate`) | `[Buy, Sell, WishList]` | `MultiSelect`, **disabled unless `stock_mode` is `Item` or `All`** | Which of Buy/Sell/Wishlist/Syndicate categories are "active" this session. `LiveScraperSettings::has_trade_mode(mode)` = `general.trade_modes.contains(&mode)` (`live_scraper_settings.rs:13-15`). This is the actual "which trade modes are active" toggle — a plain multi-select array, not per-item flags. |

`TradeMode` and `StockMode` are custom-serialized enums (`src-tauri/src/enums/trade_mode.rs`, `stock_mode.rs`) — JSON wire values are lowercase strings: `"buy" | "sell" | "wishlist" | "syndicate"` and `"all" | "item" | "riven"` respectively (with an `Unknown(String)` fallback variant that logs a critical error if an unrecognized string is deserialized).

#### Blacklist mechanism (`live_scraper.items.general.blacklist`)

Struct: `BlackListItemSetting` (`src-tauri/src/app/types/settings/black_list_item_setting.rs:6-13`)

```rust
pub struct BlackListItemSetting {
    pub wfm_id: String,             // serde rename "wfmId", alias "wfm_id"
    pub sub_type: Option<SubType>,  // serde rename "subType", alias "sub_type"
    pub disabled_for: Vec<TradeMode>,
}
```

- `disabled_for` is the list of `TradeMode`s (Buy/Sell/WishList/Syndicate) for which this specific item (optionally scoped to a specific `sub_type`, e.g. a rank/variant) is excluded from processing. The UI's "Disabled For" column just renders this array joined by comma.
- Matching logic — `BlackListItemSetting::is_disabled_for(wfm_id, sub_type, mode)` (lines 16-27):
  ```rust
  if self.wfm_id == wfm_id && self.sub_type.is_none() && self.disabled_for.contains(mode) { return true; }
  self.wfm_id == wfm_id && self.sub_type == *sub_type && self.disabled_for.contains(mode)
  ```
  i.e. a blacklist entry with `sub_type: None` blacklists **all sub-types/variants** of that item for the listed modes; an entry with a concrete `sub_type` only blacklists that exact variant.
- `ItemGeneralSettings::is_item_blacklisted` (`item_general_settings.rs:14-26`) is `true` if **any** blacklist entry matches. This is what gates entry into `collect_interesting_items` (§B.2), into `is_blacklisted()` checks inside each `progress_*` function (§B.4), and into the `orders_to_delete` full-wipe (§B.7).
- UI: the General tab's "Edit Blacklist" button swaps to a dual-list (`SelectMultipleItems`) picker (`GeneralPanel` component, view mode `Blacklist`). Before adding an item to the blacklist the UI forces the user to pick at least one trade mode in a small modal (`formLeft.values.disable_for`); if none picked, adding is rejected with a notification ("No trade modes selected…"). The left/available list can be filtered by name (regex-ish substring match, case-insensitive), tag, trade-tax range slider (0–2,100,000, step 1000), and MR-requirement range slider (0–15, step 1).

#### Buy list (`live_scraper.items.general.buy_list`)

Struct: `BuyListItemSetting { wfm_id: String, max_price: i64 }` (`buy_list_item_setting.rs`). Per-item override of the maximum price the WTB engine will post for that specific item, regardless of the global `wtb.avg_price_cap`. Looked up via `ItemGeneralSettings::get_item_max_price(wfm_id)` which returns `0` (= "no override") if not present (`item_general_settings.rs:27-34`). UI: "Edit Buy List" view — a `CreateItemForm` (item picker + numeric "bought" price) that appends `{wfmId, max_price}`, plus a `DataTable` listing/deleting entries.

### A.2 Item → WTB tab (`Tabs/Item/Accordion/WTB/index.tsx`)

Struct: `ItemWtbSettings` (`src-tauri/src/app/types/settings/item_wtb_settings.rs:4-17`), path prefix `live_scraper.items.wtb.*`. This is the **buy-order** (I want to buy stock) engine.

| Field | Type | Default | UI min/max | Description (from `public/lang/en.json`) |
|---|---|---|---|---|
| `volume_threshold` | `i64` | `15` | min `-1`, max `999` | "Minimum volume to consider for trading". Item must have `volume > threshold` in cached price stats. `-1` disables the filter. |
| `profit_threshold` | `i64` | `10` | min `-1`, max `999` | "Minimum profit to consider for trading" — used both as an "interesting item" filter (`item.profit > threshold`) and post-hoc as the minimum acceptable `market_info.price_range` (bid-ask spread) before flagging `Delete`+`Underpriced` (§B.4). |
| `avg_price_cap` | `i64` | `600` | min `-1` | "Maximum average price to consider for trading". Global ceiling: if computed `post_price > avg_price_cap`, order flagged `AboveAvgPrice` + `Delete`. |
| `max_total_price_cap` | `i64` | `100000` | min `-1`, max `150000` | "Maximum total price to consider for trading -1 for no limit". Platinum budget cap across **all** open WTB orders combined; enforced via the 0/1 knapsack solver (§B.4/B.6). |
| `price_shift_threshold` | `i64` | `-1` | min `-1`, max `100` | "Minimum price shift to consider for trading" — filters interesting items on `week_price_shift >= threshold`. |
| `min_wtb_profit_margin` | `i64` | `-1` | min `-1` | "Minimum profit margin for WTB trades" — filters interesting items on `profit_margin >= threshold`. |
| `trading_tax_cap` | `i64` | `-1` | min `-1` | "Maximum tax to consider for trading" — filters interesting items on `trading_tax < cap`. |
| `buy_quantity` | `i64` | `1` | min `1`, max `6` | "The quantity of goods to buy" — sets `ItemEntry.buy_quantity` for `TradeMode::Buy` entries (posted order quantity). |
| `quantity_per_trade` | `i64` | `1` | min `1`, max `999`, **hidden** (`display="none"` in UI) | "The quantity of goods to trade per transaction: NOTE this is only valid for some items like arcanes" — maps to WFM's `per_trade` order param, but only applied when `item_info.bulk_tradable` is true (`get_per_trade`, §B.5 helpers); field exists in settings but is not wired to this UI control's value (dead/legacy control). |
| `max_stock_quantity` | `i64` | `-1` | min `-1`, max `999` | "Maximum quantity of an item to have in stock before stopping WTB order creation. Set to -1 to disable." If current stock `owned >= max_stock_quantity`, the WTB order is deleted and creation skipped (§B.4). |
| `max_price_drop` | `i64` | `-1` | min `-1` | UI label **"Max Price Increase"**. "Maximum platinum increase to follow on buy orders. Limits how much your buy price can go up in one cycle. -1 to disable. Overridden by Min Listings Below." Fed into `should_apply_max_price_drop` for `OrderType::Buy` (§B.4). |
| `min_listings_below` | `i64` | `-1` | min `-1` | UI label **"Min Buyers Above"**. "Minimum number of buy orders above your current price to override the Max Price Increase limit. -1 to disable." |

Every field's `rightSection` renders a `TooltipIcon` with the tooltip text above and a documentation link (`https://quantframe.app/features/live-trading/settings/item/wtb#...`).

### A.3 Item → WTS tab (`Tabs/Item/Accordion/WTS/index.tsx`)

Struct: `ItemWtsSettings` (`item_wts_settings.rs:4-9`), path prefix `live_scraper.items.wts.*`. This is the **sell-order** (I own stock, want to sell) engine.

| Field | Type | Default | UI min/max | Description |
|---|---|---|---|---|
| `min_profit` | `i64` | `10` | min `-1`, max `999` | "Minimum profit to consider for trading" — floor on `post_price - bought_price`; if under, price is raised (§B.4). |
| `min_sma` | `i64` | `3` | min `-1` | "Minimum Simple Moving Average to consider for trading" — SMA = the cached `moving_avg` closed-price stat; used as `closed_avg - min_sma` floor (§B.4). |
| `max_price_drop` | `i64` | `-1` | min `-1` | "Maximum platinum drop to follow automatically. -1 to disable. When disabled, price will always follow the lowest listing unless overridden by Min Listings Below." |
| `min_listings_below` | `i64` | `-1` | min `-1` | "Minimum number of listings below your price to override the max price drop limit. -1 to disable. Example: 3 means follow down only when 4+ sellers are below you." |

**IMPORTANT quirk (verified in source):** `progress_buying` (WTB) and `progress_selling` (WTS) both call `should_apply_max_price_drop` using `settings.wtb.max_price_drop` / `settings.wtb.min_listings_below` (`live_scraper/modules/item.rs:438-448` for buying, and **also** `item.rs:711-713` for selling — the selling code path reads `settings.wtb.max_price_drop, settings.wtb.min_listings_below`, NOT `settings.wts.max_price_drop/min_listings_below`). This means, as shipped, the WTS tab's "Max Price Drop"/"Min Listings Below" fields are **not actually consulted by the selling algorithm** — both buy and sell price-drop damping currently read the WTB values.

**Decision for the WFHelper port (2026-09, confirmed with the user): FIX this, do not replicate.** The WFHelper `progress_selling` implementation must call its damping guard with `items.wts.maxPriceDrop`/`items.wts.minListingsBelow` (the WTS-tab fields), not the WTB ones. This is a deliberate behavioral deviation from Quantframe — keep it documented here so nobody "fixes" it back to match Quantframe by mistake while diffing behavior.

### A.4 Item → Summary tab (`Tabs/Item/Accordion/Summary/index.tsx`)

Read-only debug/preview panel. "Show Interesting WTB Items" button calls Tauri command `live_scraper_get_interesting_wtb_items(settings: ItemSettings)` → `src-tauri/src/commands/live_scraper.rs:40-53`, which runs `get_interesting_items()` (§B.2's WTB filter) against the *currently unsaved form values* and lists `name | volume | min_price | profit | trading_tax` in a paginated `DataTable`. Not part of the live engine; purely a "what would WTB pick up with these settings" preview.

### A.5 Riven tab (`Tabs/Riven/index.tsx`)

Structs: `RivenGeneralSettings` (`riven_general_settings.rs:4-6`) and `RivenWtsSettings` (`riven_wts_settings.rs:4-8`). Riven mode is **sell-only** (there is no Riven WTB in this codebase).

| Field (path) | Type | Default | UI min | Description |
|---|---|---|---|---|
| `live_scraper.rivens.wts.min_profit` | `i64` | `25` | `-1` | "Minimum profit to consider for trading" — floor on `post_price - stock_riven.bought`. |
| `live_scraper.rivens.wts.threshold_percentage` | `f64` | `15.0` | `-1` | "Percentage threshold for trading" (UI subtitle text actually says "Minimum Price Shift" in the doc link but label/tooltip say threshold %). Fed as the raw `threshold_percentage` arg into `average_filtered_lowest_prices` (§B.4) — **note:** the helper multiplies by `(1.0 + threshold_percentage)` directly with no `/100` division, so the stored default `15.0` literally means "keep auctions priced up to 1600% of the lowest" — almost certainly meant to be a fraction (e.g. `0.15`) but shipped as a raw percentage number. **Decision for the WFHelper port (2026-09, confirmed with the user): keep as shipped (raw multiplier, default 15) for now, not "fixed" to a fraction — reproduce the literal formula in §B.4f verbatim.** Revisit only if the user asks for it later; the UI field description calls this out explicitly so it isn't mistaken for a bug during testing. |
| `live_scraper.rivens.wts.max_results` (UI: "Limit To") | `i64` | `5` | `-1` | "Limit the number of trades" — actually used as `limit_to`: how many of the lowest-priced live auctions to sample for the average (§B.4). |
| `live_scraper.rivens.general.update_interval` | `i64` (seconds) | `120` | `-1` | "Interval for updating riven trades" — throttles how often the riven sub-engine runs a full pass (§B.1). |

### A.6 Syndicate tab (dev-only, `hide: !import.meta.env.DEV`) (`Tabs/Syndicate/Accordion/WTS/index.tsx`)

Struct: `LiveSyndicateWtsSettings` (`live_syndicate_wts_settings.rs:4-12`), path prefix `live_scraper.syndicate.wts.*`. Marked "Syndicate 👑 (WIP)" in the UI and, per §B.2/B.3, its data-collection path is currently short-circuited in the Rust engine (`return Ok(...)` before the syndicate branch even runs) — i.e. **shipped but functionally disabled**.

| Field | Type | Default | Description |
|---|---|---|---|
| `max_standing_cost` | `i64` | `10000` | "Maximum standing cost to consider for trading". |
| `volume_threshold` | `i64` | `10` | "Minimum volume threshold to consider for trading". |
| `min_price` | `i64` | `10` | Not exposed in this UI panel (no control for it), but present in the struct; used as the standing-price floor filter server-side. |
| `max_price_drop` | `i64` | `-1` | UI label "Max Price Increase" — same semantics as item WTB's field, fed into `should_apply_max_price_drop`. |
| `min_listings_below` | `i64` | `-1` | UI label "Min Buyers Above". |
| `max_rank_for_type` | `Vec<String>` | `["mod"]` | MultiSelect of `"mod"` / `"arcane"` — controls whether max-rank (upgraded) or rank-0 syndicate items are considered, via a closure filter (see `get_syndicate_interesting_items`, §B.2). |
| `syndicates` | `Vec<String>` (syndicate `uniqueName`s) | `[]` | MultiSelect populated from `api.cache.getSyndicates()` (`canSelect` items only); empty = all syndicates allowed. |

---

## PART B — Engine Algorithm (`src-tauri/src/live_scraper/`)

### B.0 High-level component map

- `client.rs` → `LiveScraperState`: owns the running/just-started atomics, the async loop, and lazily-initialized `ItemModule` / `RivenModule` singletons.
- `modules/item.rs` → `ItemModule`: drives Buy(WTB)/Sell(WTS)/Wishlist/Syndicate-stub for **items**.
- `modules/riven.rs` → `RivenModule`: drives Sell(WTS) for **rivens** (auctions, not orders).
- `modules/helpers.rs`: shared filtering, order CRUD orchestration (`progress_order`), the knapsack budget solver, blacklist/eligibility helpers, `should_apply_max_price_drop`.
- `types/item_entry.rs` → `ItemEntry`/`ItemMarketInfo`: the per-item work unit carried through a cycle.
- `commands/live_scraper.rs`: Tauri commands (`live_scraper_toggle`, `live_scraper_get_state`, `live_scraper_get_interesting_wtb_items`).
- `handlers/base.rs::handle_wfm_item`: **not** part of the scraper's pricing loop — it's the order-quantity-reconciliation function invoked from the Stock-Item/Wish-List command handlers when the user (or auto-trade) manually records a buy/sell, to close/delete/update the corresponding live WFM order by the traded quantity. Documented in §B.5b.

### B.1 Trigger / loop structure — start, stop, and cadence

**Start/stop is a single toggle command**, not separate start/stop commands:

- Frontend: `LiveScraperControl` component calls `api.live_scraper.toggle()` (mutation) → Tauri command `live_scraper_toggle` (`src-tauri/src/commands/live_scraper.rs:15-31`). If the scraper is not running, it calls `live_scraper.start()`; if running, `live_scraper.stop()`. Either way it re-emits `UIEvent::UpdateLiveScraperRunningState` with the new boolean.
- If the user is about to **start** the scraper and `settings.live_scraper.general.auto_delete` is true, the UI first shows a confirm modal ("Are you sure you want to start live scraping? This action will delete all non-blacklisted orders on WFM.") before calling toggle.
- A separate read-only command `live_scraper_get_state` returns `{ is_running: bool }` for polling/hydration.

**`LiveScraperState::start()`** (`client.rs:44-159`):
1. Guards against double-start via `is_running.swap(true, SeqCst)` — if already `true`, logs a warning and returns (idempotent).
2. Sets `just_started = true` (this flag is consumed once by the item engine's deletion logic, §B.7).
3. If `stock_mode` is `All` or `Item`, eagerly calls `wfm_client.order().cache_orders_mut().apply_trade_info()` (attaches cached price stats — `closed_avg`, `potential_profit` — onto the locally cached order list) before the loop starts.
4. Lazily constructs `ItemModule` and `RivenModule` singletons (`init_modules`).
5. Spawns a `tauri::async_runtime` task running an **event-driven-by-polling** `while is_running { ... }` loop — **not** a fixed-interval scheduler with separate timers per sub-system; it's a single loop with a flat 1-second sleep at the bottom (`tokio::time::sleep(Duration::from_secs(1))`, `client.rs:154`), and internal cadence for the Riven pass is self-managed via an elapsed-time check.

**Per-iteration logic (`client.rs:79-156`)**, on every loop tick (i.e., roughly every ~1s + however long the previous tick's work took, since it's not tokio::interval — it's sleep-then-loop):
1. If `stock_mode ∈ {Riven, All}`:
   - Compute `time_elapsed = last_riven_update.elapsed()`.
   - If `time_elapsed > Duration::from_secs(update_interval)` (default 120s): run `riven().check().await`, then reset `last_riven_update = Instant::now()`.
   - Else: emit a `SendLiveScraperMessage` UI event with i18n key `riven.cooldown` and `{ seconds: update_interval - time_elapsed }` (drives the "Riven Cooldown: N seconds remaining" UI text) — **no actual work happens** this tick for the riven side.
   - On `Err` from `riven().check()`: log to `live_scraper_riven.log`; if the error's `log_level` is `Critical` or `Error`, **stop the whole scraper** (`is_running.store(false)`), play an error sound (`windows_xp_error.mp3`), and emit an error toast. Otherwise (e.g. `Warning`) the loop just continues to the next tick.
2. If `stock_mode ∈ {Item, All}`: run `item().check().await`.
   - On `Err`: derive a `log_level` by inspecting a `type` property on the error (`e.properties.get_property_value("type", "")`) — `"ParsingError" | "BadRequest" | "Unknown" | "InternalServerError" | "InvalidType"` are forced to `Critical`; anything else defaults to `Warning`. Then same stop/no-stop branching as above (Critical/Error → stop scraper + error sound + toast; else continue).
3. Sleep 1 second.
4. `just_started.store(false)` — this happens **after the first full iteration completes**, so `just_started` is only `true` during iteration #1 of a given start-session.

`LiveScraperState::stop()` just flips `is_running` to `false`; the spawned task observes this at the top of its `while` condition on the next tick and the task ends naturally (no explicit task handle/abort is kept — it's cooperative).

There is **no per-sub-system on/off from `trade_modes`** at the loop level — `trade_modes` (Buy/Sell/WishList/Syndicate) only affects which entries `collect_interesting_items` produces (§B.2); `stock_mode` (All/Item/Riven) is what gates whether the Item vs Riven module runs at all each tick.

### B.2 "Interesting item" collection (`collect_interesting_items`, `helpers.rs:226-341`)

Called once per Item-engine tick, at the very top of `ItemModule::check()` (after `delete_unwanted_orders`, §B.7). Builds a `HashMap<uuid, ItemEntry>` keyed by `ItemEntry::uuid()` (`"{wfm_url}-{sub_type.shot_display()}"` or just `wfm_url` if no sub-type), so a single physical item can accumulate **multiple simultaneous operations** (e.g. both `Sell` and `WishList`) if it qualifies for more than one mode.

**Debug override**: if `settings.debugging.live_scraper.entries` (non-empty `Vec<ItemEntry>`, from `DebuggingSettings`) is set, that literal list is returned immediately and none of the below runs — a manual test-fixture escape hatch.

Otherwise, for each active trade mode (checked via `LiveScraperSettings::has_trade_mode`, i.e. membership in `general.trade_modes`):

1. **Buy** (`TradeMode::Buy` active):
   - Source: `get_interesting_items(&settings.live_scraper.items)` (§below) — a **statistics-filtered candidate list**, not a persisted "wishlist" — this is the "cold outreach" WTB path that scans the whole tradable-item price-stat cache for items meeting the WTB thresholds.
   - `ItemEntry::from(&item)` sets `operations = ["Buy"]`, `priority = 0`, `order_type = "closed"`, then `.set_quantity(OrderType::Buy, settings.wtb.buy_quantity)`.
   - **Eligibility**: `!stock_item_settings.general.is_item_blacklisted(wfm_id, sub_type, TradeMode::Buy)`. Must exist in this filtered price-stat cache; there is **no DB table requirement** for Buy mode (contrast with Sell/WishList below).
2. **Sell** (`TradeMode::Sell` active):
   - Source: **all rows of the `stock_item` DB table** (`StockItemQuery::get_all(conn, StockItemPaginationQueryDto::new(1, -1))` — page size `-1` = unbounded/all).
   - For each stock item not blacklisted for `Sell`: if an entry already exists for that uuid (e.g. it also qualified for Buy), mutate it in place — `priority = 1`, `sell_quantity = item.owned`, `stock_id = Some(item.id)`, `operations.add("Sell")`. Otherwise insert a fresh `ItemEntry::from(&item).set_quantity(OrderType::Sell, item.owned)` (`priority=1`, `operations=["Sell"]`, `order_type="closed"`).
   - **Eligibility = "must exist in the stock DB table" + not blacklisted for Sell.** There is no separate "is it worth selling" price filter at collection time — that's all inside `progress_selling` (§B.4).
3. **WishList** (`TradeMode::WishList` active):
   - Source: **all rows of the `wish_list` DB table** (`WishListQuery::get_all`, unbounded).
   - Same merge/insert pattern: `priority = 2`, `buy_quantity = item.quantity`, `wish_list_id = Some(item.id)`, `operations.add("WishList")`, else fresh `ItemEntry::from(&item)` (`priority=2`, `buy_quantity=item.quantity`, `operations=["WishList"]`, `order_type="buy"`).
   - **Eligibility = "must exist in the wish_list DB table" + not blacklisted for WishList.**
4. **Syndicate** (`TradeMode::Syndicate` active): the function **returns immediately** with whatever was collected so far (`return Ok(interesting_items.into_values().collect());` at `helpers.rs:315`), before ever reaching the syndicate-fetch code below it — i.e. **syndicate collection is dead code in the shipped build** (a permission-gated `get_syndicate_interesting_items` call and merge-into-map logic exists below the early return but is unreachable). If reimplementing "as designed" rather than "as shipped", the intended logic was: require `PermissionsFlags::syndicate_prices_search`; fetch `qf_client.syndicate().get_prices(...)` (a QF backend endpoint, not WFM), filter via closures — `volume > volume_threshold`, `standing_cost <= max_standing_cost`, rank-vs-`max_rank_for_type` (item counts as eligible if it has no sub_type/rank, otherwise `rank > 0` required when `max_rank_for_type` contains `"mod"`/`"arcane_enhancement"`, else `rank <= 0` required), `syndicates.is_empty() || syndicates.contains(item.syndicate_unique_name)`, and `min_price <= item.min_price` (or disabled) — then merge with `operations.add("Syndicate")`.

**`get_interesting_items(settings: &ItemSettings)`** (`helpers.rs:113-173`) — the WTB candidate filter, reading from the local **price-statistics cache** (`cache.item_price()`, distinct from live WFM order books):
```
profit_margin_filter := disabled(min_wtb_profit_margin) || item.profit_margin >= min_wtb_profit_margin
volume_filter        := disabled(volume_threshold)      || item.volume       >  volume_threshold
profit_filter         := disabled(profit_threshold)      || item.profit       >  profit_threshold
avg_price_filter       := disabled(avg_price_cap)         || item.avg_price    <= avg_price_cap
week_price_shift_filter:= disabled(price_shift_threshold) || item.week_price_shift >= price_shift_threshold
trading_tax_cap_filter  := disabled(trading_tax_cap)      || item.trading_tax  <  trading_tax_cap
combined := volume_filter && profit_filter && avg_price_filter && week_price_shift_filter
            && trading_tax_cap_filter && profit_margin_filter
```
where `is_disabled(v) := v <= -1` (`helpers.rs:35-37`) — i.e. **`-1` (or lower) means "no threshold, always pass"** for every numeric setting in this whole feature. All comparisons are strict except `avg_price` (`<=`) and `trading_tax` (`<`, note the input is `<` not `<=` — a value **equal** to the cap fails). There's a `INTERESTING_ITEMS: OnceLock<HashMap<String, Vec<ItemPriceInfo>>>` memoization cache keyed by `ItemSettings::get_query_id()` (a colon-joined string of the WTB+WTS threshold values), but nothing in the codebase ever calls `.set()` on it — **the cache is permanently empty and this memoization is dead code**; every call recomputes from `cache.item_price().get_by_filter(combined_filter)`.

### B.3 Fetching & filtering competing WFM orders/auctions

**Item orders** — `ItemModule::process_items` (`item.rs:196-218`), per item:
1. `load_orders(...)` → (unless `debugging.live_scraper.fake_orders` is on and a cached fixture file exists) `fetch_and_cache_orders` → `wfm_client.order().get_orders_by_item(item_url)` — a fresh REST call to WFM per item, returning `OrderList<OrderWithUser>` (buy+sell arrays with embedded user info).
2. `orders.filter_by_sub_type(SubType::from(entry.sub_type), exclude=false)` — **retain only orders whose sub-type exactly matches** this item entry's variant (rank/rune/etc.).
3. `orders.filter_username(&my_wfm_username, exclude=true)` — **remove my own orders** from the competitor list.
4. `orders.filter_user_status(StatusType::InGame, exclude=false)` — **retain only orders from sellers/buyers currently "in game"** (WFM's online-status field) — offline/away users are excluded from price competition entirely.
5. `orders.sort_by_platinum()` — sell orders ascending by platinum (cheapest seller first), buy orders descending by platinum (highest bidder first) (`wf-market/src/types/order_list.rs:121-126`).
6. `entry.apply_market_info(&orders)` computes `buy_market_info`/`sell_market_info` = `{ lowest_price, highest_price, price_range, volume }` per side, where `price_range` is defined asymmetrically (`order_list.rs:263-272`):
   ```
   price_range(order_type):
       lowest  = lowest_price(Sell)
       highest = highest_price(Buy)
       if order_type == Sell:  return highest - lowest   // highest_buy - lowest_sell
       if order_type == Buy:   return lowest  - highest   // lowest_sell - highest_buy
   ```
   (Both branches reference the same two numbers — `lowest_price(Sell)` and `highest_price(Buy)` — just negated; this is effectively "the buy-sell spread", used as `market_info.price_range < profit_threshold` in the WTB path, §B.4.)

**Implementation note for the WFHelper port (Phase 3, `services/liveScraperOrderBook.ts`):** step 4's "active" filter reuses the house `isActiveOrderStatus()` helper (`config/shared/wfmOrders.ts`), which treats **both** `"ingame"` and `"online"` as active — Quantframe's filter is stricter (`StatusType::InGame` only, away/online-but-not-in-game sellers excluded). Deliberately not narrowed to match Quantframe exactly: `isActiveOrderStatus` is shared, already-tested house logic used by every other order-book consumer in this codebase (market alerts, etc.), and narrowing it here would fork behavior from the rest of the app for a minor edge case. Kept as a known, minor deviation — revisit only if real-world testing shows it materially changes which competing orders get counted.

**Riven auctions** — `RivenModule::check` (`riven.rs:144-192`), per riven-in-stock:
1. `wfm_client.auction().search_auctions(get_filter(stock_riven))` — a live search request, **not** a per-riven-URL GET like items; the filter (`get_filter`, `riven.rs:425-480`) is built from `AuctionFilter::new(Riven, weapon_url).with_buyout_policy("direct").with_user_activity(InGame).with_sort_by("price_asc")`, plus optional positive/negative stat requirements, MR range, re-roll range, polarity, and similarity, all sourced from the stock riven's own saved `filter` config (not from the Live Scraper settings tab — riven-specific filter fields live on the stock riven record itself).
2. On `TooManyRequests` (429) from the search call: emit `riven.rate_limited` UI event with `seconds: retry_after`, then `continue` to the **next** riven in the list (no actual sleep/backoff is performed in code — it's advisory to the UI only; see §B.6).
3. `live_auctions.filter_username(my_username, exclude=true)` then `.sort_by_platinum()`.
4. `average_filtered_lowest_prices(live_auctions.prices(), max_results, threshold_percentage)` (see §B.4 for the formula) computes the target post price.

### B.4 Price computation (exact formulas)

#### B.4a `should_apply_max_price_drop` — shared damping guard (`helpers.rs:735-772`)

```rust
fn should_apply_max_price_drop(
    max_price_drop: i64, min_listings_below: i64,
    current_order_price: i64, post_price: i64,
    prices: Vec<i64>, order_type: OrderType,
) -> Option<String> {
    if is_disabled(max_price_drop) && is_disabled(min_listings_below) { return None; }

    let (is_price_invalid, price_change, listing_count) = match order_type {
        Buy  => (current_order_price > post_price,
                 post_price - current_order_price,
                 prices.iter().filter(|&&p| p > current_order_price).count()),
        Sell => (current_order_price < post_price,
                 current_order_price - post_price,
                 prices.iter().filter(|&&p| p < current_order_price).count()),
    };

    if is_price_invalid { return None; }   // price moved the "safe" direction — no damping needed

    let should_skip = !is_disabled(max_price_drop)
        && price_change > max_price_drop
        && (is_disabled(min_listings_below) || listing_count <= min_listings_below);

    if should_skip { Some("MaxPriceDrop".to_string()) } else { None }
}
```
Plain-English: this guards against **chasing the market too far in one tick**.
- For **Buy** orders: "invalid" (skip the guard) if our current live order price is already *above* the new computed price (i.e. price is dropping/staying, which is safe for a buyer — no cap needed on *decreases*). The guard only fires when the new price would be a further **increase** beyond `current_order_price` (`post_price - current_order_price`, i.e. `price_change`) that exceeds `max_price_drop` (mislabeled — for buy orders it's actually the max *increase*, per UI copy "Max Price Increase"), UNLESS at least `min_listings_below + 1` other competing buy orders are priced above `current_order_price` (`listing_count`), in which case the increase is allowed through anyway ("if enough buyers are already above you, it's safe to follow them up").
- For **Sell** orders: symmetric — "invalid"/skip if current order price is already below the new price (price rising is safe for a seller). The guard fires when the computed **drop** (`current_order_price - post_price`) exceeds `max_price_drop`, UNLESS at least `min_listings_below + 1` other sellers are already priced below `current_order_price`.
- When the guard fires, the caller **clamps `post_price` back to `current_order_price`** (i.e. don't move the price at all this cycle) and tags the trade-operation set with `"MaxPriceDrop"`.
- `-1` (or below) on either `max_price_drop` or `min_listings_below` disables that part of the guard per `is_disabled`.

#### B.4b Item WTB — `progress_buying` (`item.rs:352-594`)

```
per_trade         = get_per_trade(item_info)   // Some(1) if item_info.bulk_tradable else None
closed_avg        = price.moving_avg.unwrap_or(0.0)
post_price        = entry.buy_market_info.highest_price     // best (highest) competing buy order price
(order_id, current_order_price, properties, ops) = get_order_info(entry, Buy, wfm_client)

// 1. Blacklist gate
if is_blacklisted(settings, item_info, entry, Buy) -> return (no-op)

// 2. No-volume gate
if buy_market_info.volume == 0 || sell_market_info.volume == 0 -> return (no-op; "no market volume")

// 3. Max stock quantity gate (only if entry has a stock_id, i.e. we already track it)
if !disabled(max_stock_quantity) && stock_item.owned >= max_stock_quantity:
    delete_order(Buy) ; return

// 4. Damping guard
if let Some(reason) = should_apply_max_price_drop(wtb.max_price_drop, wtb.min_listings_below,
                                                    current_order_price, post_price,
                                                    live_orders.get_price_list(Buy, None), Buy):
    post_price = current_order_price
    ops.add(reason)

closed_avg_metric = closed_avg as i64 - post_price     // negative => we're bidding above the historical average
potential_profit  = closed_avg_metric - 1               // 1 plat buffer

// 5. Per-item max price override (buy_list)
item_max_price = settings.general.get_item_max_price(item_info.wfm_id)   // 0 if none set
if item_max_price > 0 && post_price > item_max_price:
    ops.add("AboveMaxBuyPrice"); post_price = item_max_price

// 6. Global average price cap
if !disabled(avg_price_cap) && post_price > avg_price_cap:
    ops.add("AboveAvgPrice"); ops.add("Delete")

// 7. Global knapsack budget check (see §B.4e) — may set ops.add("Skip"); ops.add("Delete"); return early
//    (runs only if !disabled(max_total_price_cap))

// 8. Overpriced check
if closed_avg_metric < 0:
    ops.add("Delete"); ops.add("Overpriced")

// 9. Underpriced / spread-too-thin check
if market_info.price_range < profit_threshold:
    ops.add("Delete"); ops.add("Underpriced")

progress_order(Buy, post_price, per_trade, ops, ...)   // §B.5
```

#### B.4c Item WTS — `progress_selling` (`item.rs:597-845`)

```
per_trade   = get_per_trade(item_info)
closed_avg  = price.moving_avg.unwrap_or(0.0) as i64
stock_item  = entry.get_stock_item_or_error()
bought_price= stock_item.bought
market_info = entry.sell_market_info
(_, current_order_price, properties, ops) = get_order_info(entry, Sell, wfm_client)

(min_price, min_profit, min_sma) = stock_item.properties["min_price"|"min_profit"|"min_sma"]  // per-item overrides, Option<i64>

// 1. Blacklist gate -> return
// 2. Hidden+Inactive -> return (no-op); Hidden+not-Inactive -> set Inactive, list_price=None, locked=true, ops.add("Delete")

// 3. Determine starting price
lowest_price =
    if market_info.volume >= 2:           market_info.lowest_price
    elif min_price.is_none():             0   // and: ops.add("Delete"); ops.add("NoSellers"); status=NoSellers; list_price=None; locked=true
    else:                                  0   // fallback path (comment: "using bought price as fallback" though code literally assigns 0 here — see note below)

post_price = lowest_price

// 4. Clamp to per-item minimum
if let Some(min_price) = min_price:
    post_price = max(post_price, min_price)
    if changed: ops.add("MinimumPrice")

// 5. Damping guard — NOTE: reads settings.wtb.max_price_drop/min_listings_below, not settings.wts.* (see §A.3 quirk)
if let Some(reason) = should_apply_max_price_drop(wtb.max_price_drop, wtb.min_listings_below,
                                                    current_order_price, post_price,
                                                    live_orders.get_price_list(Sell, None), Sell):
    post_price = current_order_price; ops.add(reason)

// 6. SMA floor
minimum_sma = min_sma.unwrap_or(settings.wts.min_sma)
if !disabled(minimum_sma) && post_price < (closed_avg - minimum_sma) && lowest_price > bought_price:
    post_price = closed_avg
    ops.add("SMALimit"); status=SMALimit; list_price=post_price; locked=true

// 7. Minimum profit floor
profit = post_price - bought_price
minimum_profit = min_profit.unwrap_or(settings.wts.min_profit)
if !disabled(minimum_profit) && profit < minimum_profit:
    post_price += (minimum_profit - profit)
    status=ToLowProfit; list_price=post_price; locked=true; ops.add("LowProfit")
    profit = post_price - bought_price   // recompute after adjustment

// 8. Persist + floor
stock_item.list_price = post_price; status = Live; push price history
post_price = max(post_price, 1)   // WFM hard floor: 1 platinum

progress_order(Sell, post_price, per_trade, ops, ...)
entry.finalize_stock_item(...)   // flush stock_item DB row if dirty
```
Note on step 3: when there are 0–1 competing sellers and **no `min_price` override** exists, the item is explicitly abandoned this cycle (`Delete` + `NoSellers`, `post_price` forced to `0` but irrelevant since it deletes). When a `min_price` override **does** exist, `lowest_price` (and thus the initial `post_price`) is `0`, and the subsequent clamp step (`post_price.max(min_price)`) is what actually pulls the price up to something sane — i.e., with `< 2` sellers, the sell price is effectively driven entirely by the `min_price` override (or floors at `0`→then `1` if no override and not deleted, which can't happen since the no-override branch always adds `Delete`).

#### B.4d Item Wishlist buying — `progress_wish_list` (`item.rs:848-1007`)

```
market = entry.buy_market_info
wishlist_item = entry.get_wishlist_item_or_error()
(min_price, max_price) = wishlist_item.properties["min_price"|"max_price"]   // default 0i64 each (0 = "no override")

if wishlist_item.is_hidden:
    if status == InActive: return (no-op)
    else: status=InActive; list_price=None; locked=true; ops.add("Delete")

post_price =
    if market.volume == 0:  ops.add("NoBuyers"); status=NoBuyers; price.avg_price as i64
    else:                    market.highest_price       // best competing buy order

if max_price > 0 && post_price > max_price: post_price = max_price; ops.add("MaxPrice")
if min_price > 0 && post_price < min_price: post_price = min_price; ops.add("MinPrice")

post_price = max(post_price, 1)   // WFM floor

status = Live; if status == Live: push price history

progress_order(Buy, post_price, per_trade, ops, ...)
entry.finalize_wishlist_item(...)
```
Note: **no `should_apply_max_price_drop` damping** is applied to wishlist buying — it always snaps straight to the (clamped) highest competing buy price every cycle.

#### B.4e Syndicate selling — `progress_syndicate` (`item.rs:1010-1122`) — currently unreachable per §B.2

```
market = entry.sell_market_info
post_price = market.lowest_price
if let Some(reason) = should_apply_max_price_drop(syndicate.wts.max_price_drop, syndicate.wts.min_listings_below,
                                                    current_order_price, post_price,
                                                    live_orders.get_price_list(Sell, None), Sell):
    post_price = current_order_price; ops.add(reason)
post_price = max(post_price, 1)
progress_order(Sell, post_price, per_trade, ops, ...)
```
(No min-profit / min-standing-cost enforcement is present in this function despite the settings existing — those fields are only consulted at the *collection* filter stage in `get_syndicate_interesting_items`, §B.2, which itself is unreachable.)

#### B.4f Riven selling — `RivenModule::check` price block (`riven.rs:186-224`)

```
post_price = average_filtered_lowest_prices(live_auctions.prices(), settings.wts.max_results, settings.wts.threshold_percentage)

if live_auctions.total_auctions() == 0:
    post_price = stock_riven.bought + settings.wts.min_profit + 1
    status = NoSellers; list_price = post_price; locked = true

min_price = stock_riven.properties["min_price"]   // Option<i64>, per-riven override
if let Some(minimum_price) = min_price:
    post_price = max(post_price, minimum_price)
    if changed: ops.add("MinimumPrice")

profit = post_price - stock_riven.bought
if !disabled(min_profit) && profit < min_profit:
    post_price += (min_profit - profit)
    status = ToLowProfit; list_price = post_price; locked = true; ops.add("LowProfit")
    profit = post_price - stock_riven.bought
```

`average_filtered_lowest_prices(prices, limit_to, threshold_percentage)` (`utils/src/helper.rs:335-366`) — `prices` must already be ascending (guaranteed by the earlier `sort_by_platinum`):
```rust
if prices.is_empty() { return -1; }
top = prices.take(limit_to as usize)               // lowest `limit_to` auctions only
if top.is_empty() { return -1; }
min_price = top.first()
threshold = min_price as f64 * (1.0 + threshold_percentage)   // NOTE: raw multiplier, no /100 — see A.5 quirk
top.retain(|&p| p <= threshold as i64)
if top.is_empty() { return -1; }
return top.sum() / top.len()                        // integer average of the surviving lowest auctions
```
There is **no `should_apply_max_price_drop` damping** applied to riven pricing at all — riven prices always snap to the freshly recomputed average each pass (subject only to the `min_price` and `min_profit` clamps above).

### B.5 What happens with the computed price

#### B.5a `progress_order` — the actual create/update/delete dispatcher used by the live-scraper price loop (`helpers.rs:528-661`)

This is the function that decides the WFM side-effect for **every** `progress_*` call above (buying/selling/wishlist/syndicate/riven-equivalent). Riven uses its own analogous branch inline in `riven.rs:249-394` against the Auction API (same shape, different endpoint) — documented together here since the branching logic is identical in spirit.

```rust
let can_create_order = wfm_client.order().can_create_order();   // order-limit gate
let quantity = entry.get_quantity(order_type);
let order_id = properties["id"];   // "" if entry has no live order yet (see get_order_info)

if trade_operations.has("Create") && !trade_operations.has("Delete") && can_create_order {
    // CREATE — order_id was empty, meaning get_order_info found no existing WFM order for this wfm_id+subtype+side
    wfm_client.order().create(CreateOrderParams::new_with_subtype(
        entry.wfm_id, order_type, post_price, quantity, visible=true,
        per_trade, sub_type
    ).with_properties(properties))
    // on success: emits UIEvent::RefreshWfmOrders

} else if trade_operations.has("Update") && !trade_operations.has("Delete") {
    // UPDATE — an existing order was found (get_order_info seeded ops with "Update")
    wfm_client.order().update(order_id, UpdateOrderParams::new()
        .with_platinum(post_price)
        .with_quantity(quantity)
        .with_per_trade(per_trade)
        .with_properties(properties))
    // on success: emits UIEvent::RefreshWfmOrders ONLY IF original_update_string != update_string
    //   (i.e. only if the "p:{price}" string actually changed vs the cached snapshot — avoids UI churn on no-op updates)

} else if trade_operations.has("Update") && trade_operations.has("Delete") {
    // DELETE — an existing order was found AND some earlier step flagged "Delete"
    wfm_client.order().delete(order_id)
    // on success: emits UIEvent::RefreshWfmOrders

} else if !can_create_order {
    // SKIP — would create, but hit WFM's per-account order-count limit
    warning("Item has reached the order limit. Skipping.")

} else {
    // SKIP — e.g. "Create"+"Delete" both set (a brand-new order that was immediately deemed undesirable —
    //         nothing to delete since it never existed), or no operation flags at all
    warning("Item is not optimal for buying. Skipping.")
}
```

Key branching rule to reproduce exactly: **`get_order_info` seeds `ops` with either `"Create"` (no existing order found in the locally cached order list) or `"Update"` (existing order found)** — this seed, combined with whatever the pricing function additionally `.add("Delete")`s, is what selects the branch. So: *new item, not flagged bad* → Create. *Existing order, not flagged bad* → Update (even if price is unchanged — an update call is still issued every cycle unless the code elsewhere skips calling `progress_order` at all). *Existing order, flagged bad* (`Update`+`Delete`) → Delete. *New item that immediately got flagged bad* (`Create`+`Delete`, e.g. knapsack rejection before ever having an order) → neither create nor delete fires; it just gets skipped with the generic "not optimal" warning (there is nothing to delete). `delete_order()` (`helpers.rs:663-681`) is a thin wrapper that calls `progress_order` with `post_price=1`, `per_trade=Some(1)`, and empty properties/ops — it relies on the caller to have already set `ops` appropriately via the `Update`/`Delete` combination (used directly by the max-stock-quantity branch in `progress_buying`, §B.4b step 3).

`get_order_info` (`helpers.rs:343-372`) also stashes `original_update_string = "p:{order.platinum}"` (the price at fetch time) onto `properties`, and `set_order_market_metrics` (`helpers.rs:389-428`) later sets `update_string = "p:{post_price}"` (the *new* price) — the diff between these two strings is the "did the price actually change" check gating the `RefreshWfmOrders` UI event on updates, as noted above.

#### B.5b `handle_wfm_item` — order-quantity reconciliation on manual/auto trade completion (`handlers/base.rs:41-146`)

This is a **separate** function from the pricing loop, invoked from `commands/stock_item.rs`, `commands/wish_list.rs`, `handlers/stock_item.rs`, `handlers/wish_list.rs` whenever the app records that some quantity of an item was actually bought or sold (e.g., the user manually logs a purchase, or an automated "detect completed trade" flow fires). Its job is to shrink/close/delete the corresponding **live WFM order** by the traded quantity — distinct from the scraper's own repricing:

```rust
pub async fn handle_wfm_item(wfm_id, sub_type, quantity, order_type, operations) -> Result<String, Error> {
    let delete = operations.has("ShouldDelete");

    // Reporting gate — buy-side sync can be globally disabled
    if order_type == Buy && !settings.live_scraper.general.report_to_wfm && !operations.has("ForceOrderSync") {
        return Ok("SkippedBuyWfmReportDisabled");
    }

    let Some(mut order) = wfm_client.order().cache_orders().find_order(wfm_id, sub_type, order_type)
    else { return Ok("NoOrder"); };   // nothing to reconcile — no local order for this item/side

    order.quantity = max(order.quantity - quantity, 0);

    let reporting_enabled = settings.live_scraper.general.report_to_wfm;
    let should_close  = reporting_enabled && !delete;
    let should_delete = delete || order.quantity == 0;

    if should_close {
        wfm_client.order().close(order.id, quantity);   // "close" = a WFM stat-only decrement endpoint (records the sale toward the order) without altering the platinum price
        return Ok("Closed");
    }
    if should_delete {
        wfm_client.order().delete(order.id);
        return Ok("Deleted");
    }
    // Otherwise, plain quantity update
    wfm_client.order().update(order.id, UpdateOrderParams::default().with_quantity(order.quantity));
    return Ok("Updated");
}
```
Branch precedence, verbatim: **`should_close` is checked before `should_delete`** — so even when the new quantity would hit `0`, if `report_to_wfm` is enabled and the caller did **not** pass `ShouldDelete`, the code calls **Close** and returns early (Close never checks the resulting quantity itself — it's WFM's own "close/complete" call, semantically distinct from Delete). `Delete` only fires when either the caller explicitly requested it (`operations.has("ShouldDelete")`) or `report_to_wfm` is off and the resulting quantity is `0`. If reporting is on, remaining quantity > 0, and delete wasn't requested, it falls through to a plain quantity `Update`.

### B.6 Rate limiting, throttling, and error handling

- **No explicit per-request delay/backoff** is coded anywhere in the item or riven modules between sequential WFM API calls — items/rivens are processed strictly sequentially in a `for` loop with `.await` on each network call; the only throttle is the outer loop's 1-second sleep between full ticks (§B.1) and the riven sub-engine's `update_interval`-second gate.
- **Riven auction-search 429 (`TooManyRequests`)**: caught explicitly, emits a `riven.rate_limited` UI event carrying `retry_after` (drives "Rate Limited: Waiting for N seconds before continuing" text), then `continue`s to the next riven in the same pass — **no actual sleep/wait is executed**; it's purely informational/cosmetic and the loop does not literally pause for `retry_after` seconds before hitting the API again on a subsequent riven or the next pass.
- **General WFM API errors during order create/update/delete** — routed through `handler_wfm_error` (`helpers.rs:490-526`):
  - `AuctionLimitExceeded` → `LogLevel::Warning`.
  - `OrderLimitExceededSamePrice` | `NotFound` | `OrderLimitExceeded` → also `LogLevel::Warning`, **and** proactively refreshes the local order cache (`wfm_client.order().my_orders().await` then `cache_orders_mut().apply_trade_info()`) so the next cycle sees fresh state (self-healing against stale-cache-caused conflicts).
  - Anything else → `LogLevel::Error`.
  - The resulting `Error` is propagated up (`?`/`return Err`) through `progress_order` → `progress_buying`/`progress_selling`/`progress_wish_list` → `process_items`'s per-item loop, which does `return Err(e...)` on failure — **this aborts the remaining items in the current cycle's sorted list** (does not just skip the failing item and continue to the next one within the same tick). The error then propagates out of `ItemModule::check()` to the outer loop in `client.rs`, which (per §B.1) either stops the whole scraper (Critical/Error) or just logs and lets the next 1-second tick retry everything from scratch (Warning). Net effect: a single item's transient API error (e.g., a benign order-limit conflict, classified Warning) causes that cycle to bail out early on the remaining lower-priority items, but the *entire* interesting-item set is recomputed and reprocessed from the top on the very next tick ~1s later — so it self-corrects quickly rather than perma-skipping.
  - Riven's per-riven loop is more granular: only the specific 429 case is caught and `continue`s (skip just this riven, keep going); any other API error during auction search/create/update/delete does `return Err(...)`, aborting the rest of that riven pass immediately (propagates to `client.rs` for the same Critical/Warning branching).

### B.7 `delete_unwanted_orders` / `orders_to_delete` cleanup logic (`item.rs:51-106`, `helpers.rs:439-473`)

Runs at the very start of every `ItemModule::check()` tick, **before** `collect_interesting_items`.

**Gate** (`item.rs:58-62`):
```rust
if !settings.live_scraper.general.delete_conflicting_orders
   && !settings.live_scraper.general.auto_delete {
    return Ok(());   // neither flag set — no cleanup pass at all, ever
}
```
i.e. the routine runs on every tick as long as **either** `auto_delete` or `delete_conflicting_orders` is on.

**`orders_to_delete(settings, client, my_orders)`** (`helpers.rs:439-473`) decides *which* order IDs to nuke:
```rust
if settings.live_scraper.general.auto_delete && client.just_started {
    // FULL WIPE — first tick of this start-session only (see just_started semantics, §B.1)
    return my_orders.to_vec().filter(|item| {
        let mode = if item.order_type == Buy { TradeMode::Buy } else { TradeMode::Sell };
        !settings.live_scraper.items.general.is_item_blacklisted(item.item_id, item.subtype, mode)
    }).map(|item| item.id);
}

// Normal (non-just-started) ticks: only two specific trade-mode combinations trigger cleanup —
match (has(Buy), has(Sell), has(WishList)) {
    (true, false, true)  => my_orders.order_ids(Sell),   // Buy+Wishlist active but Sell inactive -> wipe ALL sell orders
    (false, true, false) => my_orders.order_ids(Buy),    // Sell-only active -> wipe ALL buy orders
    _                     => vec![],                      // every other combination: no ongoing cleanup
}
```
So: **`just_started`** means "this is the very first tick since the user pressed Start" — on that one tick, if `auto_delete` is on, **every** currently-open WFM order (buy and sell) that isn't covered by a blacklist entry for its side gets queued for deletion, regardless of current `trade_modes` (this is the destructive behavior the UI's start-confirmation modal warns about). On all subsequent ticks, the (much narrower) mode-mismatch cleanup applies: it only fires for exactly two mode combinations (`Buy+WishList active, Sell inactive` deletes sell orders; `Sell-only active` deletes buy orders) and otherwise does nothing — note `delete_conflicting_orders` itself is **not** referenced inside `orders_to_delete`'s conditional logic; it only widens the outer gate in `delete_unwanted_orders` (so setting `delete_conflicting_orders=true, auto_delete=false` still gets you the ongoing mode-mismatch cleanup every tick, but never the one-time full wipe, since that specifically checks `auto_delete`).

**Deletion execution** (`item.rs:64-104`): iterates the returned IDs one at a time (`current_index` counts down from `len` to `1`), checking `should_stop()` (scraper stopped or user banned) before each and breaking early if so; calls `wfm_client.order().delete(id).await` per ID; on success emits `SendLiveScraperMessage` with i18n key `item.deleted` and `{current, total, id}` (drives "Deleting Orders: N/Total" UI text); on failure just logs an error and **continues** to the next ID (a single delete failure doesn't abort the batch).

### B.8 Additional budget-enforcement logic: the knapsack passes

Two separate knapsack invocations exist, both using the same 0/1-knapsack DP solver `knapsack(items: Vec<(platinum, profit, wfm_id, order_id)>, max_weight) -> (selected, unselected)` (`helpers.rs:175-224`; standard bounded-weight DP maximizing summed `profit` subject to summed `platinum <= max_weight`, with a `choice[i][w]` table for reconstruction; note this only runs when `max_total_price_cap` is not disabled and treats platinum values as **usize weights**, so it's O(n × cap) — fine for typical caps like 100,000).

1. **Per-item, inline in `progress_buying`** (`item.rs:475-520`): before finalizing this item's operations, gathers `extract_order_summary(Buy)` — `(platinum, potential_profit, wfm_id, order_id)` tuples — from **all currently cached buy orders**, appends a synthetic entry for *this* item (if not already present) using the just-computed `post_price`/`potential_profit`, runs knapsack against `max_total_price_cap`, and if this item's `wfm_id` is **not** in the selected set, adds `"Skip"` + `"Delete"` and returns immediately (skips the rest of `progress_buying`, including all the later Overpriced/Underpriced checks — the knapsack rejection is decisive and short-circuits).
2. **Global, once at the end of `process_items`** (`item.rs:311-346`): after all items in the cycle have been individually processed (and thus the WFM order cache reflects all just-issued creates/updates), re-extracts `extract_order_summary(Buy)` from the **latest** cached order list and re-runs knapsack. Any order in the `unselected` result is deleted via `wfm_client.order().delete()`, **except** orders that were newly created this very cycle (tracked via an `existing_buy_order_ids: HashSet<String>` snapshot taken at the *start* of `process_items`, before any processing) — those are deliberately spared "to let them survive until next check" (comment at `item.rs:333-335`), avoiding create-then-immediately-delete churn for genuinely new items that happen to lose the second knapsack pass narrowly.

### B.9 UI progress/state events emitted while running

All defined in `src-tauri/src/types/ui_events.rs` and emitted via the `send_event!` macro (wraps Tauri's event-emit to the frontend). The frontend's `LiveScraperControl` component (`src/components/Forms/LiveScraperControl/index.tsx`) subscribes via a context (`useLiveScraperContext`) exposing `{ is_running, message }`, and renders `message.i18nKey`/`message.values` through a `TextTranslate` component whenever `is_running` is true.

| Rust event | Wire name | Emitted from | Payload | i18n key / UI text |
|---|---|---|---|---|
| `UpdateLiveScraperRunningState` | `LiveScraper:UpdateRunningState` | `commands/live_scraper.rs` on toggle | `bool` | drives the Start/Stop button label + `is_running` state |
| `SendLiveScraperMessage` | `LiveScraper:OnMessage` | `client.rs` (riven cooldown), `item.rs` (checking/deleted), `riven.rs` (checking/rate_limited) | `{ i18nKey, values }` | see below |
| `RefreshWfmOrders` | `LiveScraper:RefreshWfmOrders` | `progress_order` on create/update(price-changed)/delete | `{ source }` | tells the UI to re-fetch the live order list |
| `RefreshWfmAuctions` | `Wfm:RefreshAuctions` | `riven.rs` on auction create/delete | `{ source }` | re-fetch riven auctions |
| `RefreshStockItems` | `LiveScraper:RefreshStockItems` | `ItemEntry::finalize_stock_item` (only if `stock_item.update_gui()`) | `{ id, source }` | re-fetch stock table row |
| `RefreshStockRivens` | `LiveScraper:RefreshStockRivens` | `riven.rs` after DB update | `{ id, source }` | re-fetch stock-riven table row |
| `RefreshWishListItems` | `LiveScraper:RefreshWishListItems` | `ItemEntry::finalize_wishlist_item` | `{ id, source }` | re-fetch wishlist table row |

Specific progress messages (i18n keys under `components.live_scraper_control.*` in `public/lang/en.json`):
- `item.checking` → `"Checking Item: {{name}} {{current}}/{{total}}"` — emitted once per item at the top of the per-item loop in `process_items` (`item.rs:184-194`), payload `{current, total, name, sub_type, price}` (price = cached `ItemPriceInfo`).
- `item.deleted` → `"Deleting Orders: {{current}}/{{total}}"` — emitted per deleted order in `delete_unwanted_orders`.
- `riven.checking` → `"Checking Riven: {{name}} {{mod_name}} {{current}}/{{total}}"` — emitted once per riven in `RivenModule::check`.
- `riven.cooldown` → `"Riven Cooldown: {{seconds}} seconds remaining"` — emitted by the outer loop in `client.rs` when the riven `update_interval` hasn't elapsed yet.
- `riven.rate_limited` → `"Rate Limited: Waiting for {{seconds}} seconds before continuing"` — emitted on a 429 from auction search.

---

## Appendix — Misc reference data useful for a faithful port

- **`StockStatus` enum** (`entity/src/enums/stock_status.rs`): `Pending | Live | ToLowProfit | NoSellers | NoBuyers | InActive | SMALimit | OrderLimit | Overpriced | Underpriced | MaxPriceDrop` — the states the algorithms above set on stock/wishlist/riven rows to reflect why a price landed where it did (surfaced in the main Live Scraper page's status column, outside the scope of this settings/engine doc but useful for parity).
- **`OperationSet`** (`utils/src/operation_set.rs`) is just an ordered `Vec<String>` with dedup-on-add (`add` is a no-op if already present) — reproduce as a `Set<string>` or ordered unique array in TS; the specific string tags used as control-flow signals across this doc are: `"Create"`, `"Update"`, `"Delete"`, `"Skip"`, `"MaxPriceDrop"`, `"MinimumPrice"`, `"AboveMaxBuyPrice"`, `"AboveAvgPrice"`, `"Overpriced"`, `"Underpriced"`, `"SMALimit"`, `"LowProfit"`, `"NoSellers"`, `"NoBuyers"`, `"MaxPrice"`, `"MinPrice"`.
- **`is_disabled(v) = v <= -1`** is the universal "sentinel disable value" convention for every numeric threshold setting in this feature — always use `-1` (not `0`) as "off" when porting the UI's `min={-1}` NumberInputs.
- **Platinum floor**: WFM does not accept `0`-platinum orders; every pricing path finishes with `post_price = max(post_price, 1)` before submission.
- **Order-list sort direction matters for "lowest/highest" semantics**: sell orders sorted ascending (index 0 = cheapest/best-for-buyer), buy orders sorted descending (index 0 = highest/best-for-seller) — `OrderList::new`/`sort_by_platinum` in the vendored `wf-market` crate (`types/order_list.rs:95-126`).
- **Settings struct nesting reference** (for path-string generation in a TS port):
  ```
  live_scraper
  ├─ general: { report_to_wfm, auto_delete, auto_trade, stock_mode, trade_modes[], delete_conflicting_orders }
  ├─ items
  │  ├─ general: { blacklist: [{wfmId, subType?, disabled_for[]}], buy_list: [{wfmId, max_price}] }
  │  ├─ wtb: { volume_threshold, profit_threshold, avg_price_cap, trading_tax_cap, max_total_price_cap,
  │  │         price_shift_threshold, buy_quantity, min_wtb_profit_margin, quantity_per_trade,
  │  │         max_stock_quantity, max_price_drop, min_listings_below }
  │  └─ wts: { min_sma, min_profit, max_price_drop, min_listings_below }
  ├─ rivens
  │  ├─ general: { update_interval }
  │  └─ wts: { min_profit, threshold_percentage, max_results }
  └─ syndicate
     └─ wts: { syndicates[], max_rank_for_type[], volume_threshold, max_standing_cost, min_price,
                max_price_drop, min_listings_below }
  ```
