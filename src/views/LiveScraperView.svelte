<script lang="ts">
  import { tr } from "../lib/i18n.js";
  import { confirmWithDialog, invoke, on } from "../lib/ipc.js";
  import { liveScraperSettings } from "../stores/liveScraperSettings.js";
  import { marketSession, marketSessionLoaded } from "../stores/market.js";
  import LiveScraperSettingsModal from "../modals/LiveScraperSettingsModal.svelte";
  import LiveScraperListings from "../components/LiveScraperListings.svelte";
  import WfmSignInCard from "../components/market/WfmSignInCard.svelte";
  import ItemPicker from "../components/ItemPicker.svelte";
  import ItemCategoryIcon from "../components/ItemCategoryIcon.svelte";
  import ThemedInput from "../components/ThemedInput.svelte";
  import SearchBox from "../components/SearchBox.svelte";
  import RivenPicker from "../components/RivenPicker.svelte";
  import RivenStatChips from "../components/RivenStatChips.svelte";
  import { categorizeItem } from "../lib/itemCategory.js";
  import { rivenMatchesQuery } from "../lib/liveScraper/rivenSearch.js";
  import { statusHintKey } from "../lib/liveScraper/statusHints.js";
  import { rivenNameSuffix } from "../lib/marketContract.js";
  import type { StockItem, WishlistItem } from "../../config/shared/liveScraperStock.js";
  import type { StockRiven } from "../../config/shared/liveScraperRivenStock.js";
  import type { DecodedRiven } from "../../config/shared/rivenTypes.js";
  import type { LiveScraperEngineStatus } from "../../config/shared/liveScraperEngine.js";
  import type { WfmSearchItem } from "../types/market.js";

  let settingsOpen = $state(false);
  let status = $state<LiveScraperEngineStatus | null>(null);
  let stock = $state<StockItem[]>([]);
  let wishlist = $state<WishlistItem[]>([]);
  let stockRivens = $state<StockRiven[]>([]);
  let ownedRivens = $state<DecodedRiven[]>([]);
  let busy = $state(false);

  let rivenDraftItemId = $state("");
  let rivenDraftBought = $state(0);

  let stockDraftItem = $state<WfmSearchItem | null>(null);
  let stockDraftRank = $state(0);
  let stockDraftOwned = $state(1);
  let stockDraftBought = $state(0);
  let wishlistDraftItem = $state<WfmSearchItem | null>(null);
  let wishlistDraftRank = $state(0);
  let wishlistDraftQuantity = $state(1);
  let wishlistDraftMaxPrice = $state(0);

  function hasRank(item: WfmSearchItem | null): boolean {
    return typeof item?.maxRank === "number" && item.maxRank > 0;
  }

  async function refresh(): Promise<void> {
    const [nextStatus, nextStock, nextWishlist, nextStockRivens, rivenResult] = await Promise.all([
      invoke("liveScraperStatus"),
      invoke("liveScraperStockList"),
      invoke("liveScraperWishlistList"),
      invoke("liveScraperRivenStockList"),
      invoke("getRivens"),
    ]);
    status = nextStatus;
    stock = nextStock;
    wishlist = nextWishlist;
    stockRivens = nextStockRivens;
    ownedRivens = rivenResult.unveiled;
  }

  async function toggleEngine(): Promise<void> {
    if (!status?.running && $liveScraperSettings.general.autoDelete) {
      // Mirrors Quantframe's own start-confirm modal (docs §B.1): autoDelete
      // means tick #1 wipes every non-blacklisted WFM order, so this asks
      // before that destructive pass can fire.
      if (!(await confirmWithDialog($tr("liveScraper.confirmStartAutoDelete"), $tr))) return;
    }
    busy = true;
    try {
      status = status?.running ? await invoke("liveScraperStop") : await invoke("liveScraperStart");
    } finally {
      busy = false;
    }
  }

  async function addStockItem(): Promise<void> {
    if (!stockDraftItem?.url_name) return;
    const result = await invoke("liveScraperStockCreate", {
      wfmId: stockDraftItem.url_name,
      wfmUrl: stockDraftItem.url_name,
      itemName: stockDraftItem.item_name,
      subType: hasRank(stockDraftItem) ? { rank: stockDraftRank } : undefined,
      owned: stockDraftOwned,
      bought: stockDraftBought,
    });
    if (result.ok) {
      stockDraftItem = null;
      stockDraftRank = 0;
      stockDraftOwned = 1;
      stockDraftBought = 0;
      await refresh();
    }
  }

  type RemovableKind = "stock" | "wishlist" | "riven";
  let removeError = $state<string | null>(null);

  async function removeEntry(kind: RemovableKind, id: string, name: string): Promise<void> {
    if (!(await confirmWithDialog($tr("liveScraper.confirmRemove", { name }), $tr))) return;
    const result =
      kind === "stock"
        ? await invoke("liveScraperStockDelete", id)
        : kind === "wishlist"
          ? await invoke("liveScraperWishlistDelete", id)
          : await invoke("liveScraperRivenStockDelete", id);
    removeError = result.ok ? null : $tr("liveScraper.removeFailed", { name, error: result.error });
    await refresh();
  }

  async function removeEntries(
    entries: { kind: RemovableKind; id: string; name: string }[],
  ): Promise<void> {
    const count = entries.length;
    if (!(await confirmWithDialog($tr("liveScraper.confirmRemoveMany", { count }), $tr))) return;
    let failed = 0;
    for (const entry of entries) {
      const result =
        entry.kind === "stock"
          ? await invoke("liveScraperStockDelete", entry.id)
          : entry.kind === "wishlist"
            ? await invoke("liveScraperWishlistDelete", entry.id)
            : await invoke("liveScraperRivenStockDelete", entry.id);
      if (!result.ok) failed += 1;
    }
    removeError = failed > 0 ? $tr("liveScraper.removeManyFailed", { failed, count }) : null;
    await refresh();
  }

  async function addWishlistItem(): Promise<void> {
    if (!wishlistDraftItem?.url_name) return;
    const result = await invoke("liveScraperWishlistCreate", {
      wfmId: wishlistDraftItem.url_name,
      wfmUrl: wishlistDraftItem.url_name,
      itemName: wishlistDraftItem.item_name,
      subType: hasRank(wishlistDraftItem) ? { rank: wishlistDraftRank } : undefined,
      quantity: wishlistDraftQuantity,
      maxPrice: wishlistDraftMaxPrice > 0 ? wishlistDraftMaxPrice : undefined,
    });
    if (result.ok) {
      wishlistDraftItem = null;
      wishlistDraftRank = 0;
      wishlistDraftQuantity = 1;
      wishlistDraftMaxPrice = 0;
      await refresh();
    }
  }

  let trackedRivenIds = $derived(new Set(stockRivens.map((r) => r.sourceItemId)));

  // Narrows the tracked list only; the picker below has a search of its own.
  let rivenQuery = $state("");
  let rivenSearchActive = $derived(rivenQuery.trim() !== "");
  let shownStockRivens = $derived(stockRivens.filter((r) => rivenMatchesQuery(r, rivenQuery)));

  async function addStockRiven(): Promise<void> {
    const riven = ownedRivens.find((r) => r.itemId === rivenDraftItemId);
    if (!riven) return;
    const result = await invoke("liveScraperRivenStockCreate", {
      sourceItemId: riven.itemId,
      weaponName: riven.weaponName,
      rivenName: riven.rivenName,
      masteryReq: riven.masteryReq,
      rerolls: riven.rerolls,
      polarity: riven.polarity,
      // Auto-sold rivens are listed at max rank, mirroring the manual listing
      // form's default (RivenDetailModal.svelte) - an unranked riven still
      // sells for what it would be worth maxed.
      modRank: riven.maxRank,
      stats: riven.stats.map((s) => ({
        tag: s.tag,
        positive: s.positive,
        multiplier: s.multiplier,
        value: s.maxRankValue,
      })),
      bought: rivenDraftBought,
    });
    if (result.ok) {
      rivenDraftItemId = "";
      rivenDraftBought = 0;
      await refresh();
    }
  }

  $effect(() => {
    void refresh();
    const off = on("live-scraper:changed", () => void refresh());
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      off();
      clearInterval(timer);
    };
  });
</script>

<section class="view active">
  <div class="mx-auto flex w-full max-w-[1280px] flex-col gap-4 py-4">
    <header class="view-header mb-0 items-center justify-between">
      <h2>{$tr("nav.liveScraper")}</h2>
      <div class="flex gap-2">
        <button
          type="button"
          class={status?.running ? "btn-secondary btn-sm" : "btn-primary btn-sm"}
          data-live-scraper-toggle
          disabled={busy}
          onclick={toggleEngine}
        >
          {status?.running ? $tr("liveScraper.stop") : $tr("liveScraper.start")}
        </button>
        <button
          type="button"
          class="btn-secondary btn-sm"
          data-live-scraper-open-settings
          title={$tr("liveScraper.settings.title")}
          aria-label={$tr("liveScraper.settings.title")}
          onclick={() => (settingsOpen = true)}
        >
          {$tr("liveScraper.settings.title")}
        </button>
      </div>
    </header>

    <!-- Market may be hidden, and every listing the scraper places needs the account.
         Held back until main has answered for the session, so it never flashes. -->
    {#if $marketSessionLoaded && !$marketSession.loggedIn}
      <div class="grid gap-2" data-live-scraper-sign-in>
        <p class="m-0 text-sm text-text-secondary">{$tr("liveScraper.signInPrompt")}</p>
        <WfmSignInCard />
      </div>
    {/if}

    <div class="rounded-lg border border-border bg-bg-deep p-3 text-sm" data-live-scraper-status>
      <p class="m-0 text-text-primary">
        {status?.running ? $tr("liveScraper.statusRunning") : $tr("liveScraper.statusStopped")}
      </p>
      {#if status?.lastMessage}
        <p class="m-0 mt-1 text-xs text-text-secondary">{status.lastMessage}</p>
      {/if}
      {#if removeError}
        <p class="m-0 mt-1 text-xs text-danger" role="alert" data-live-scraper-remove-error>
          {removeError}
        </p>
      {/if}
      {#if status?.lastError}
        <p class="m-0 mt-1 text-xs text-danger" role="alert">{status.lastError}</p>
      {/if}
      {#if status && status.scheduler.state !== "ok"}
        <p class="m-0 mt-1 text-xs text-text-muted">
          {$tr("liveScraper.schedulerState", { state: status.scheduler.state })}
        </p>
      {/if}
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <section class="grid gap-2 rounded-lg border border-border p-3">
        <h3 class="m-0 text-sm font-semibold text-text-primary">{$tr("liveScraper.stockTitle")}</h3>
        <div class="flex flex-wrap items-end gap-2">
          {#if stockDraftItem}
            <div class="grid min-w-0 flex-1 gap-1">
              <span class="text-xs font-medium text-text-secondary">{$tr("common.item")}</span>
              <div
                class="flex min-w-0 items-center gap-2 rounded-md border border-accent-dim bg-accent-glow px-2 py-1.5 text-sm"
              >
                <span class="shrink-0 text-text-secondary">
                  <ItemCategoryIcon category={categorizeItem(stockDraftItem)} size={18} />
                </span>
                <span class="min-w-0 flex-1 truncate">{stockDraftItem.item_name}</span>
                <button
                  type="button"
                  aria-label={$tr("orderModal.clearItem")}
                  class="ml-auto border-0 bg-transparent text-base leading-none text-text-muted hover:text-text-primary"
                  onclick={() => (stockDraftItem = null)}>&times;</button
                >
              </div>
            </div>
          {:else}
            <div class="min-w-0 flex-1">
              <ItemPicker onSelect={(item) => (stockDraftItem = item)} />
            </div>
          {/if}
          {#if hasRank(stockDraftItem)}
            <div class="grid gap-1">
              <label for="stock-rank" class="text-xs font-medium text-text-secondary"
                >{$tr("common.rank")}</label
              >
              <ThemedInput
                id="stock-rank"
                type="number"
                min="0"
                max={stockDraftItem?.maxRank ?? 0}
                clampToRange
                clampOnBlur
                className="w-16"
                bind:value={stockDraftRank}
              />
            </div>
          {/if}
          <div class="grid gap-1">
            <label for="stock-owned" class="text-xs font-medium text-text-secondary"
              >{$tr("liveScraper.ownedLabel")}</label
            >
            <ThemedInput
              id="stock-owned"
              type="number"
              min="1"
              clampToRange
              clampOnBlur
              className="w-16"
              bind:value={stockDraftOwned}
            />
          </div>
          <div class="grid gap-1">
            <label for="stock-bought" class="text-xs font-medium text-text-secondary"
              >{$tr("liveScraper.boughtLabel")}</label
            >
            <ThemedInput
              id="stock-bought"
              type="number"
              min="0"
              clampToRange
              clampOnBlur
              className="w-20"
              bind:value={stockDraftBought}
            />
          </div>
          <button
            type="button"
            class="btn-primary btn-sm"
            disabled={!stockDraftItem}
            onclick={addStockItem}
          >
            {$tr("common.add")}
          </button>
        </div>
      </section>

      <section class="grid gap-2 rounded-lg border border-border p-3">
        <h3 class="m-0 text-sm font-semibold text-text-primary">
          {$tr("liveScraper.wishlistTitle")}
        </h3>
        <div class="flex flex-wrap items-end gap-2">
          {#if wishlistDraftItem}
            <div class="grid min-w-0 flex-1 gap-1">
              <span class="text-xs font-medium text-text-secondary">{$tr("common.item")}</span>
              <div
                class="flex min-w-0 items-center gap-2 rounded-md border border-accent-dim bg-accent-glow px-2 py-1.5 text-sm"
              >
                <span class="shrink-0 text-text-secondary">
                  <ItemCategoryIcon category={categorizeItem(wishlistDraftItem)} size={18} />
                </span>
                <span class="min-w-0 flex-1 truncate">{wishlistDraftItem.item_name}</span>
                <button
                  type="button"
                  aria-label={$tr("orderModal.clearItem")}
                  class="ml-auto border-0 bg-transparent text-base leading-none text-text-muted hover:text-text-primary"
                  onclick={() => (wishlistDraftItem = null)}>&times;</button
                >
              </div>
            </div>
          {:else}
            <div class="min-w-0 flex-1">
              <ItemPicker onSelect={(item) => (wishlistDraftItem = item)} />
            </div>
          {/if}
          {#if hasRank(wishlistDraftItem)}
            <div class="grid gap-1">
              <label for="wishlist-rank" class="text-xs font-medium text-text-secondary"
                >{$tr("common.rank")}</label
              >
              <ThemedInput
                id="wishlist-rank"
                type="number"
                min="0"
                max={wishlistDraftItem?.maxRank ?? 0}
                clampToRange
                clampOnBlur
                className="w-16"
                bind:value={wishlistDraftRank}
              />
            </div>
          {/if}
          <div class="grid gap-1">
            <label for="wishlist-quantity" class="text-xs font-medium text-text-secondary"
              >{$tr("liveScraper.quantityLabel")}</label
            >
            <ThemedInput
              id="wishlist-quantity"
              type="number"
              min="1"
              clampToRange
              clampOnBlur
              className="w-16"
              bind:value={wishlistDraftQuantity}
            />
          </div>
          <div class="grid gap-1">
            <label for="wishlist-maxprice" class="text-xs font-medium text-text-secondary"
              >{$tr("liveScraper.maxPriceLabel")}</label
            >
            <ThemedInput
              id="wishlist-maxprice"
              type="number"
              min="0"
              clampToRange
              clampOnBlur
              className="w-20"
              bind:value={wishlistDraftMaxPrice}
            />
          </div>
          <button
            type="button"
            class="btn-primary btn-sm"
            disabled={!wishlistDraftItem}
            onclick={addWishlistItem}
          >
            {$tr("common.add")}
          </button>
        </div>
      </section>
    </div>

    <section class="grid gap-2 rounded-lg border border-border p-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="m-0 text-sm font-semibold text-text-primary">{$tr("liveScraper.rivenTitle")}</h3>
        {#if stockRivens.length > 0}
          <span class="text-xs text-text-muted" data-live-scraper-riven-count>
            {rivenSearchActive
              ? $tr("liveScraper.rivenCount", {
                  shown: shownStockRivens.length,
                  total: stockRivens.length,
                })
              : stockRivens.length}
          </span>
        {/if}
      </div>
      {#if stockRivens.length > 0}
        <div data-live-scraper-riven-search>
          <SearchBox
            class="w-full"
            bind:value={rivenQuery}
            placeholder={$tr("liveScraper.rivenSearchPlaceholder")}
          />
        </div>
      {/if}
      {#if stockRivens.length === 0}
        <p class="m-0 text-xs text-text-muted">{$tr("liveScraper.rivenEmpty")}</p>
      {:else if shownStockRivens.length === 0}
        <p class="m-0 text-xs text-text-muted" data-live-scraper-riven-no-matches>
          {$tr("liveScraper.rivenNoMatches", { query: rivenQuery.trim() })}
        </p>
      {:else}
        <!-- Five rows and half of a sixth, so a long list scrolls instead of
             pushing the listings table down. -->
        <div class="max-h-[15rem] overflow-y-auto" data-live-scraper-riven-list>
          <ul class="m-0 grid gap-1 p-0">
            {#each shownStockRivens as riven (riven.id)}
              <li
                class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                data-live-scraper-riven-row={riven.id}
              >
                <span class="min-w-24 flex-1 truncate text-text-primary"
                  >{riven.weaponName}
                  <span class="text-text-muted"
                    >{rivenNameSuffix(riven.rivenName, riven.weaponName)}</span
                  ></span
                >
                <!-- Fixed widths on the right keep chips, status and buttons in line. -->
                <div class="min-w-0 overflow-hidden" data-live-scraper-riven-stats>
                  <RivenStatChips stats={riven.stats} compact />
                </div>
                {#if riven.listPrice != null}
                  <span
                    class="w-24 shrink-0 truncate text-right text-text-muted"
                    title={$tr("liveScraper.rivenListPriceHint")}
                    data-live-scraper-riven-status>{riven.listPrice}p</span
                  >
                {:else}
                  <span
                    class="w-24 shrink-0 truncate text-right text-text-muted"
                    title={$tr(statusHintKey(riven.status, true))}
                    data-live-scraper-riven-status
                    >{$tr(`liveScraper.listings.status.${riven.status}`)}</span
                  >
                {/if}
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  onclick={() => removeEntry("riven", riven.id, riven.rivenName)}
                >
                  {$tr("common.delete")}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <div class="flex flex-wrap items-end gap-2">
        <div class="grid min-w-0 flex-1 gap-1">
          <label for="riven-picker" class="text-xs font-medium text-text-secondary"
            >{$tr("liveScraper.rivenPickerLabel")}</label
          >
          {#if ownedRivens.length > 0}
            <RivenPicker
              rivens={ownedRivens}
              trackedIds={trackedRivenIds}
              bind:value={rivenDraftItemId}
            />
          {:else}
            <p class="m-0 text-xs text-text-muted">{$tr("liveScraper.rivenNoneOwned")}</p>
          {/if}
        </div>
        <div class="grid gap-1">
          <label for="riven-bought" class="text-xs font-medium text-text-secondary"
            >{$tr("liveScraper.boughtLabel")}</label
          >
          <ThemedInput
            id="riven-bought"
            type="number"
            min="0"
            clampToRange
            clampOnBlur
            className="w-20"
            bind:value={rivenDraftBought}
          />
        </div>
        <button
          type="button"
          class="btn-primary btn-sm"
          disabled={!rivenDraftItemId}
          onclick={addStockRiven}
        >
          {$tr("common.add")}
        </button>
      </div>
    </section>

    <LiveScraperListings
      {stock}
      {wishlist}
      {stockRivens}
      wtbListings={status?.wtbListings ?? []}
      onRemove={removeEntry}
      onRemoveMany={removeEntries}
    />
  </div>
</section>

{#if settingsOpen}
  <LiveScraperSettingsModal onClose={() => (settingsOpen = false)} />
{/if}
