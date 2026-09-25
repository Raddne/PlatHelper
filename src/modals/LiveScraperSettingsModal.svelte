<script lang="ts">
  import ModalShell from "../components/ModalShell.svelte";
  import { tr, type MessageKey } from "../lib/i18n.js";
  import {
    liveScraperSettings,
    updateGeneralSettings,
    updateItemGeneralSettings,
    updateItemWtbSettings,
    updateItemWtsSettings,
    updateRivenGeneralSettings,
    updateRivenWtsSettings,
    updateSyndicateWtsSettings,
    withTradeMode,
    type TradeMode,
  } from "../stores/liveScraperSettings.js";

  let { onClose }: { onClose: () => void } = $props();

  type Tab = "general" | "item" | "riven" | "syndicate";
  let tab = $state<Tab>("general");

  const TABS: { id: Tab; labelKey: MessageKey }[] = [
    { id: "general", labelKey: "liveScraper.settings.tabs.general" },
    { id: "item", labelKey: "liveScraper.settings.tabs.item" },
    { id: "riven", labelKey: "liveScraper.settings.tabs.riven" },
    { id: "syndicate", labelKey: "liveScraper.settings.tabs.syndicate" },
  ];

  const TRADE_MODE_OPTIONS: { id: TradeMode; labelKey: MessageKey }[] = [
    { id: "buy", labelKey: "liveScraper.settings.general.tradeModeBuy" },
    { id: "sell", labelKey: "liveScraper.settings.general.tradeModeSell" },
    { id: "wishlist", labelKey: "liveScraper.settings.general.tradeModeWishlist" },
    { id: "riven", labelKey: "liveScraper.settings.tabs.riven" },
  ];
  // The blacklist holds items, so it never offers the riven switch.
  type ItemTradeMode = Exclude<TradeMode, "riven">;
  const ITEM_MODE_OPTIONS = TRADE_MODE_OPTIONS.filter(
    (m): m is { id: ItemTradeMode; labelKey: MessageKey } => m.id !== "riven",
  );

  // Draft rows for the two add-by-id editors (no item picker widget yet, so a
  // wfm id is typed by hand). Cleared after a successful add.
  let blacklistDraftId = $state("");
  let blacklistDraftModes = $state<Record<ItemTradeMode, boolean>>({
    buy: false,
    sell: false,
    wishlist: false,
  });
  let buyListDraftId = $state("");
  let buyListDraftPrice = $state(0);
  let syndicateDraftId = $state("");

  function addBlacklistEntry(): void {
    const wfmId = blacklistDraftId.trim();
    const disabledFor = (Object.keys(blacklistDraftModes) as ItemTradeMode[]).filter(
      (m) => blacklistDraftModes[m],
    );
    if (!wfmId || disabledFor.length === 0) return;
    updateItemGeneralSettings((g) => ({
      ...g,
      blacklist: [...g.blacklist, { wfmId, disabledFor }],
    }));
    blacklistDraftId = "";
    blacklistDraftModes = { buy: false, sell: false, wishlist: false };
  }

  function removeBlacklistEntry(index: number): void {
    updateItemGeneralSettings((g) => ({
      ...g,
      blacklist: g.blacklist.filter((_, i) => i !== index),
    }));
  }

  function addBuyListEntry(): void {
    const wfmId = buyListDraftId.trim();
    if (!wfmId || buyListDraftPrice <= 0) return;
    updateItemGeneralSettings((g) => ({
      ...g,
      buyList: [...g.buyList, { wfmId, maxPrice: buyListDraftPrice }],
    }));
    buyListDraftId = "";
    buyListDraftPrice = 0;
  }

  function removeBuyListEntry(index: number): void {
    updateItemGeneralSettings((g) => ({ ...g, buyList: g.buyList.filter((_, i) => i !== index) }));
  }

  function addSyndicate(): void {
    const id = syndicateDraftId.trim();
    if (!id) return;
    updateSyndicateWtsSettings((s) =>
      s.syndicates.includes(id) ? s : { ...s, syndicates: [...s.syndicates, id] },
    );
    syndicateDraftId = "";
  }

  function removeSyndicate(id: string): void {
    updateSyndicateWtsSettings((s) => ({
      ...s,
      syndicates: s.syndicates.filter((entry) => entry !== id),
    }));
  }
</script>

{#snippet numberField(
  label: string,
  description: string,
  value: number,
  min: number,
  onchange: (next: number) => void,
  max?: number,
)}
  <label class="grid gap-1">
    <span class="text-sm text-text-primary">{label}</span>
    <span class="text-xs text-text-muted">{description}</span>
    <input
      type="number"
      class="w-full rounded-md border border-border bg-bg-deep px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
      {value}
      {min}
      {max}
      onchange={(e) => onchange(Number(e.currentTarget.value))}
    />
  </label>
{/snippet}

{#snippet checkboxField(label: string, checked: boolean, onchange: (next: boolean) => void)}
  <label class="flex items-center gap-2 text-sm text-text-primary">
    <input type="checkbox" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
    {label}
  </label>
{/snippet}

<ModalShell ariaLabel={$tr("liveScraper.settings.title")} {onClose}>
  <section
    data-live-scraper-settings
    class="relative z-[1] flex max-h-[85vh] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-surface"
  >
    <header class="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
      <h2 class="m-0 font-display text-lg font-semibold text-text-primary">
        {$tr("liveScraper.settings.title")}
      </h2>
      <button
        type="button"
        class="btn-secondary btn-sm"
        data-live-scraper-settings-close
        onclick={onClose}
      >
        {$tr("common.close")}
      </button>
    </header>

    <div class="tab-bar px-5 pt-3">
      {#each TABS as entry (entry.id)}
        <button
          type="button"
          class="tab-item"
          class:active={tab === entry.id}
          data-live-scraper-settings-tab={entry.id}
          onclick={() => (tab = entry.id)}
        >
          <span>{$tr(entry.labelKey)}</span>
        </button>
      {/each}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-5">
      {#if tab === "general"}
        <p class="m-0 mb-3 text-xs text-text-secondary">
          {$tr("liveScraper.settings.general.description")}
        </p>
        <div class="grid gap-3">
          {@render checkboxField(
            $tr("liveScraper.settings.general.reportToWfm"),
            $liveScraperSettings.general.reportToWfm,
            (v) => updateGeneralSettings((g) => ({ ...g, reportToWfm: v })),
          )}
          {@render checkboxField(
            $tr("liveScraper.settings.general.autoDelete"),
            $liveScraperSettings.general.autoDelete,
            (v) => updateGeneralSettings((g) => ({ ...g, autoDelete: v })),
          )}
          {@render checkboxField(
            $tr("liveScraper.settings.general.deleteConflictingOrders"),
            $liveScraperSettings.general.deleteConflictingOrders,
            (v) => updateGeneralSettings((g) => ({ ...g, deleteConflictingOrders: v })),
          )}

          <div class="mt-2 border-t border-border pt-3">
            <p class="m-0 mb-1 text-sm font-medium text-text-primary">
              {$tr("liveScraper.settings.general.tradeModesTitle")}
            </p>
            <p class="m-0 mb-2 text-xs text-text-muted">
              {$tr("liveScraper.settings.general.tradeModesHint")}
            </p>
            <div class="flex flex-wrap gap-4" data-live-scraper-trade-modes>
              {#each TRADE_MODE_OPTIONS as mode (mode.id)}
                {@render checkboxField(
                  $tr(mode.labelKey),
                  $liveScraperSettings.general.tradeModes.includes(mode.id),
                  (checked) => updateGeneralSettings((g) => withTradeMode(g, mode.id, checked)),
                )}
              {/each}
            </div>
          </div>
        </div>
      {:else if tab === "item"}
        <div class="grid gap-5">
          <section class="grid gap-2">
            <h3 class="m-0 text-sm font-semibold text-text-primary">
              {$tr("liveScraper.settings.item.blacklistTitle")}
            </h3>
            <p class="m-0 text-xs text-text-muted">
              {$tr("liveScraper.settings.item.blacklistDescription")}
            </p>
            {#if $liveScraperSettings.items.general.blacklist.length > 0}
              <ul class="m-0 grid gap-1 p-0">
                {#each $liveScraperSettings.items.general.blacklist as entry, index (index)}
                  <li
                    class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                  >
                    <span class="min-w-0 flex-1 truncate text-text-primary">{entry.wfmId}</span>
                    <span class="text-text-muted">{entry.disabledFor.join(", ")}</span>
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      onclick={() => removeBlacklistEntry(index)}
                    >
                      {$tr("common.delete")}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder={$tr("liveScraper.settings.item.wfmIdPlaceholder")}
                class="min-w-0 flex-1 rounded-md border border-border bg-bg-deep px-2 py-1 text-sm text-text-primary"
                bind:value={blacklistDraftId}
              />
              {#each ITEM_MODE_OPTIONS as mode (mode.id)}
                <label class="flex items-center gap-1 text-xs text-text-secondary">
                  <input type="checkbox" bind:checked={blacklistDraftModes[mode.id]} />
                  {$tr(mode.labelKey)}
                </label>
              {/each}
              <button type="button" class="btn-primary btn-sm" onclick={addBlacklistEntry}>
                {$tr("common.add")}
              </button>
            </div>
          </section>

          <section class="grid gap-2 border-t border-border pt-3">
            <h3 class="m-0 text-sm font-semibold text-text-primary">
              {$tr("liveScraper.settings.item.buyListTitle")}
            </h3>
            <p class="m-0 text-xs text-text-muted">
              {$tr("liveScraper.settings.item.buyListDescription")}
            </p>
            {#if $liveScraperSettings.items.general.buyList.length > 0}
              <ul class="m-0 grid gap-1 p-0">
                {#each $liveScraperSettings.items.general.buyList as entry, index (index)}
                  <li
                    class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                  >
                    <span class="min-w-0 flex-1 truncate text-text-primary">{entry.wfmId}</span>
                    <span class="text-text-muted">{entry.maxPrice}p</span>
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      onclick={() => removeBuyListEntry(index)}
                    >
                      {$tr("common.delete")}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder={$tr("liveScraper.settings.item.wfmIdPlaceholder")}
                class="min-w-0 flex-1 rounded-md border border-border bg-bg-deep px-2 py-1 text-sm text-text-primary"
                bind:value={buyListDraftId}
              />
              <input
                type="number"
                min="1"
                placeholder="p"
                class="w-24 rounded-md border border-border bg-bg-deep px-2 py-1 text-sm text-text-primary"
                bind:value={buyListDraftPrice}
              />
              <button type="button" class="btn-primary btn-sm" onclick={addBuyListEntry}>
                {$tr("common.add")}
              </button>
            </div>
          </section>

          <section class="grid gap-3 border-t border-border pt-3">
            <h3 class="m-0 text-sm font-semibold text-text-primary">
              {$tr("liveScraper.settings.item.wtbTitle")}
            </h3>
            {@render numberField(
              $tr("liveScraper.settings.item.volumeThreshold"),
              $tr("liveScraper.settings.item.volumeThresholdDesc"),
              $liveScraperSettings.items.wtb.volumeThreshold,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, volumeThreshold: v })),
              999,
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.profitThreshold"),
              $tr("liveScraper.settings.item.profitThresholdDesc"),
              $liveScraperSettings.items.wtb.profitThreshold,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, profitThreshold: v })),
              999,
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.avgPriceCap"),
              $tr("liveScraper.settings.item.avgPriceCapDesc"),
              $liveScraperSettings.items.wtb.avgPriceCap,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, avgPriceCap: v })),
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.maxTotalPriceCap"),
              $tr("liveScraper.settings.item.maxTotalPriceCapDesc"),
              $liveScraperSettings.items.wtb.maxTotalPriceCap,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, maxTotalPriceCap: v })),
              150000,
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.priceShiftThreshold"),
              $tr("liveScraper.settings.item.priceShiftThresholdDesc"),
              $liveScraperSettings.items.wtb.priceShiftThreshold,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, priceShiftThreshold: v })),
              100,
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.minWtbProfitMargin"),
              $tr("liveScraper.settings.item.minWtbProfitMarginDesc"),
              $liveScraperSettings.items.wtb.minWtbProfitMargin,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, minWtbProfitMargin: v })),
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.tradingTaxCap"),
              $tr("liveScraper.settings.item.tradingTaxCapDesc"),
              $liveScraperSettings.items.wtb.tradingTaxCap,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, tradingTaxCap: v })),
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.buyQuantity"),
              $tr("liveScraper.settings.item.buyQuantityDesc"),
              $liveScraperSettings.items.wtb.buyQuantity,
              1,
              (v) => updateItemWtbSettings((s) => ({ ...s, buyQuantity: v })),
              6,
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.maxStockQuantity"),
              $tr("liveScraper.settings.item.maxStockQuantityDesc"),
              $liveScraperSettings.items.wtb.maxStockQuantity,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, maxStockQuantity: v })),
              999,
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.wtbMaxPriceIncrease"),
              $tr("liveScraper.settings.item.wtbMaxPriceIncreaseDesc"),
              $liveScraperSettings.items.wtb.maxPriceDrop,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, maxPriceDrop: v })),
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.wtbMinBuyersAbove"),
              $tr("liveScraper.settings.item.wtbMinBuyersAboveDesc"),
              $liveScraperSettings.items.wtb.minListingsBelow,
              -1,
              (v) => updateItemWtbSettings((s) => ({ ...s, minListingsBelow: v })),
            )}
          </section>

          <section class="grid gap-3 border-t border-border pt-3">
            <h3 class="m-0 text-sm font-semibold text-text-primary">
              {$tr("liveScraper.settings.item.wtsTitle")}
            </h3>
            {@render numberField(
              $tr("liveScraper.settings.item.aboveLowest"),
              $tr("liveScraper.settings.item.aboveLowestDesc"),
              $liveScraperSettings.items.wts.aboveLowest,
              0,
              (v) => updateItemWtsSettings((s) => ({ ...s, aboveLowest: v })),
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.minProfit"),
              $tr("liveScraper.settings.item.minProfitDesc"),
              $liveScraperSettings.items.wts.minProfit,
              -1,
              (v) => updateItemWtsSettings((s) => ({ ...s, minProfit: v })),
              999,
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.minSma"),
              $tr("liveScraper.settings.item.minSmaDesc"),
              $liveScraperSettings.items.wts.minSma,
              -1,
              (v) => updateItemWtsSettings((s) => ({ ...s, minSma: v })),
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.wtsMaxPriceDrop"),
              $tr("liveScraper.settings.item.wtsMaxPriceDropDesc"),
              $liveScraperSettings.items.wts.maxPriceDrop,
              -1,
              (v) => updateItemWtsSettings((s) => ({ ...s, maxPriceDrop: v })),
            )}
            {@render numberField(
              $tr("liveScraper.settings.item.wtsMinListingsBelow"),
              $tr("liveScraper.settings.item.wtsMinListingsBelowDesc"),
              $liveScraperSettings.items.wts.minListingsBelow,
              -1,
              (v) => updateItemWtsSettings((s) => ({ ...s, minListingsBelow: v })),
            )}
          </section>
        </div>
      {:else if tab === "riven"}
        <div class="grid gap-3">
          <p class="m-0 text-xs text-text-secondary">
            {$tr("liveScraper.settings.riven.description")}
          </p>
          {@render numberField(
            $tr("liveScraper.settings.riven.updateInterval"),
            $tr("liveScraper.settings.riven.updateIntervalDesc"),
            $liveScraperSettings.rivens.general.updateInterval,
            -1,
            (v) => updateRivenGeneralSettings((s) => ({ ...s, updateInterval: v })),
          )}
          {@render numberField(
            $tr("liveScraper.settings.riven.minProfit"),
            $tr("liveScraper.settings.riven.minProfitDesc"),
            $liveScraperSettings.rivens.wts.minProfit,
            -1,
            (v) => updateRivenWtsSettings((s) => ({ ...s, minProfit: v })),
          )}
          {@render numberField(
            $tr("liveScraper.settings.riven.thresholdPercentage"),
            $tr("liveScraper.settings.riven.thresholdPercentageDesc"),
            $liveScraperSettings.rivens.wts.thresholdPercentage,
            -1,
            (v) => updateRivenWtsSettings((s) => ({ ...s, thresholdPercentage: v })),
          )}
          {@render numberField(
            $tr("liveScraper.settings.riven.maxResults"),
            $tr("liveScraper.settings.riven.maxResultsDesc"),
            $liveScraperSettings.rivens.wts.maxResults,
            -1,
            (v) => updateRivenWtsSettings((s) => ({ ...s, maxResults: v })),
          )}
        </div>
      {:else if tab === "syndicate"}
        <div class="grid gap-3">
          <p class="m-0 text-xs text-text-secondary">
            {$tr("liveScraper.settings.syndicate.description")}
          </p>
          {@render numberField(
            $tr("liveScraper.settings.syndicate.maxStandingCost"),
            $tr("liveScraper.settings.syndicate.maxStandingCostDesc"),
            $liveScraperSettings.syndicate.wts.maxStandingCost,
            -1,
            (v) => updateSyndicateWtsSettings((s) => ({ ...s, maxStandingCost: v })),
          )}
          {@render numberField(
            $tr("liveScraper.settings.syndicate.volumeThreshold"),
            $tr("liveScraper.settings.syndicate.volumeThresholdDesc"),
            $liveScraperSettings.syndicate.wts.volumeThreshold,
            -1,
            (v) => updateSyndicateWtsSettings((s) => ({ ...s, volumeThreshold: v })),
          )}
          {@render numberField(
            $tr("liveScraper.settings.syndicate.minPrice"),
            $tr("liveScraper.settings.syndicate.minPriceDesc"),
            $liveScraperSettings.syndicate.wts.minPrice,
            -1,
            (v) => updateSyndicateWtsSettings((s) => ({ ...s, minPrice: v })),
          )}
          {@render numberField(
            $tr("liveScraper.settings.syndicate.maxPriceIncrease"),
            $tr("liveScraper.settings.syndicate.maxPriceIncreaseDesc"),
            $liveScraperSettings.syndicate.wts.maxPriceDrop,
            -1,
            (v) => updateSyndicateWtsSettings((s) => ({ ...s, maxPriceDrop: v })),
          )}
          {@render numberField(
            $tr("liveScraper.settings.syndicate.minBuyersAbove"),
            $tr("liveScraper.settings.syndicate.minBuyersAboveDesc"),
            $liveScraperSettings.syndicate.wts.minListingsBelow,
            -1,
            (v) => updateSyndicateWtsSettings((s) => ({ ...s, minListingsBelow: v })),
          )}

          <div class="border-t border-border pt-3">
            <p class="m-0 mb-1 text-sm text-text-primary">
              {$tr("liveScraper.settings.syndicate.rankTypeTitle")}
            </p>
            <div class="flex gap-4">
              {#each ["mod", "arcane"] as rankType (rankType)}
                {@render checkboxField(
                  rankType === "mod"
                    ? $tr("liveScraper.settings.syndicate.rankTypeMod")
                    : $tr("liveScraper.settings.syndicate.rankTypeArcane"),
                  $liveScraperSettings.syndicate.wts.maxRankForType.includes(rankType),
                  (checked) =>
                    updateSyndicateWtsSettings((s) => ({
                      ...s,
                      maxRankForType: checked
                        ? [...s.maxRankForType, rankType]
                        : s.maxRankForType.filter((r) => r !== rankType),
                    })),
                )}
              {/each}
            </div>
          </div>

          <div class="border-t border-border pt-3">
            <p class="m-0 mb-1 text-sm text-text-primary">
              {$tr("liveScraper.settings.syndicate.syndicatesTitle")}
            </p>
            {#if $liveScraperSettings.syndicate.wts.syndicates.length > 0}
              <ul class="m-0 mb-2 grid gap-1 p-0">
                {#each $liveScraperSettings.syndicate.wts.syndicates as id (id)}
                  <li
                    class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                  >
                    <span class="min-w-0 flex-1 truncate text-text-primary">{id}</span>
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      onclick={() => removeSyndicate(id)}
                    >
                      {$tr("common.delete")}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="flex items-center gap-2">
              <input
                type="text"
                placeholder={$tr("liveScraper.settings.syndicate.syndicateIdPlaceholder")}
                class="min-w-0 flex-1 rounded-md border border-border bg-bg-deep px-2 py-1 text-sm text-text-primary"
                bind:value={syndicateDraftId}
              />
              <button type="button" class="btn-primary btn-sm" onclick={addSyndicate}>
                {$tr("common.add")}
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </section>
</ModalShell>
