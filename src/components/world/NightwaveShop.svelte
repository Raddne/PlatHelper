<script lang="ts">
  import { onMount } from "svelte";
  import { withUniqueKeys } from "../../lib/uniqueKeys.js";

  import type { NightwaveOfferingsDoc } from "../../../config/shared/nightwaveOfferings.js";
  import { NIGHTWAVE_PERMANENT_SHOP } from "../../../config/shared/nightwaveShop.js";
  import { activeWindow } from "../../lib/format.js";
  import { locale, tr } from "../../lib/i18n.js";
  import { send } from "../../lib/ipc.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { log } from "../../lib/log.js";
  import { clockStore } from "../../lib/timers.js";
  import { buildBaroOwnedSet } from "../../lib/world.js";
  import {
    buildItemNameIndex,
    loadNightwaveOfferings,
    resolveOfferingUniqueName,
  } from "../../lib/world/nightwaveOfferings.js";
  import { inventoryData, itemDb } from "../../stores/data.js";
  import { worldData } from "../../stores/world.js";
  import type { ItemDbEntry } from "../../types/inventory.js";
  import ItemImage from "../ItemImage.svelte";

  interface ShopTile {
    name: string;
    label: string;
    creds: number | null;
    always: boolean;
    quantity: number;
    uniqueName: string | null;
    imageUrl: string | null;
    owned: boolean;
  }

  interface ShopSection {
    name: string;
    creds: number | null;
    tiles: ShopTile[];
  }

  const { onOpenItem }: { onOpenItem: (uniqueName: string) => void } = $props();
  const reference = NIGHTWAVE_PERMANENT_SHOP;
  const WIKI_URL = "https://wiki.warframe.com/w/Nightwave/Offerings";
  const clock = clockStore(30_000);
  const season = $derived($worldData?.nightwave);
  let search = $state("");
  let doc = $state<NightwaveOfferingsDoc | null>(null);
  let activeTab = $state("");

  onMount(() => {
    let cancelled = false;
    void loadNightwaveOfferings()
      .then((loaded) => {
        if (!cancelled) doc = loaded;
      })
      .catch((e: unknown) => {
        log.warn("[NightwaveShop] offerings load failed:", e);
      });
    return () => {
      cancelled = true;
    };
  });

  const owned = $derived(buildBaroOwnedSet($inventoryData));
  const nameIndex = $derived(buildItemNameIndex($itemDb));

  function buildTile(
    offer: { name: string; creds: number | null; always: boolean; quantity: number },
    resolved: { uniqueName: string | null; imageOf?: string },
    db: Record<string, ItemDbEntry>,
    ownedSet: Set<string>,
  ): ShopTile {
    const entry = resolved.uniqueName ? db[resolved.uniqueName] : undefined;
    const stand = resolved.imageOf ? db[resolved.imageOf] : undefined;
    return {
      name: offer.name,
      label: itemLabel(entry) || offer.name.replace(/^[\d,]+\s*x\s+/i, ""),
      creds: offer.creds,
      always: offer.always,
      quantity: offer.quantity,
      uniqueName: entry ? (resolved.uniqueName ?? null) : null,
      imageUrl: entry?.imageUrl ?? stand?.imageUrl ?? null,
      owned: resolved.uniqueName ? ownedSet.has(resolved.uniqueName) : false,
    };
  }

  const tabs = $derived.by(() => {
    const loaded = doc;
    if (!loaded) return [];
    return loaded.tabs.map((tab) => ({
      name: tab.name,
      sections: tab.sections.map((section) => ({
        name: section.name,
        creds: section.creds,
        tiles: section.items.map((item) =>
          buildTile(item, resolveOfferingUniqueName(item.name, nameIndex), $itemDb, owned),
        ),
      })),
    }));
  });

  const fallbackSections = $derived<ShopSection[]>([
    {
      name: "",
      creds: null,
      tiles: reference.items.map((offer) =>
        buildTile(
          { name: offer.name, creds: offer.creds, always: false, quantity: offer.quantity },
          {
            uniqueName: offer.uniqueName,
            ...("imageOf" in offer ? { imageOf: offer.imageOf } : {}),
          },
          $itemDb,
          owned,
        ),
      ),
    },
  ]);

  const currentTab = $derived(tabs.find((tab) => tab.name === activeTab) ?? tabs[0] ?? null);
  const sections = $derived.by(() => {
    const active: ShopSection[] = currentTab ? currentTab.sections : fallbackSections;
    const needle = search.trim().toLocaleLowerCase($locale);
    if (!needle) return active;
    return active
      .map((section) => ({
        ...section,
        tiles: section.tiles.filter((tile) =>
          `${tile.name} ${tile.label}`.toLocaleLowerCase($locale).includes(needle),
        ),
      }))
      .filter((section) => section.tiles.length > 0);
  });

  const verified = $derived(
    season?.affiliationTag === reference.seasonAffiliationTag &&
      activeWindow(season?.activation, season?.expiry, $clock),
  );
  const checkedAt = $derived(new Date(doc ? doc.generatedAt : reference.updatedAt));
</script>

<section data-nightwave-shop data-nightwave-season-verified={verified}>
  {#if verified}
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <p class="m-0 text-xs font-bold tracking-[0.06em] text-text-secondary uppercase">
        {reference.seasonName}{doc ? "" : ` · ${$tr("world.nightwavePermanent")}`}
      </p>
      <input
        type="search"
        bind:value={search}
        data-nightwave-search
        aria-label={$tr("common.searchPlaceholder")}
        placeholder={$tr("common.searchPlaceholder")}
        class="w-56 max-w-full rounded-lg border border-border bg-bg-secondary px-2.5 py-1 text-xs text-text-primary"
      />
    </div>
    {#if tabs.length > 0}
      <div class="mb-2 flex flex-wrap gap-1">
        {#each withUniqueKeys(tabs, (entry) => entry.name) as { key: viewKey, item: tab } (viewKey)}
          <button
            type="button"
            data-nightwave-tab={tab.name}
            aria-pressed={tab.name === currentTab?.name}
            class="cursor-pointer rounded-[var(--radius-md)] border border-[var(--ui-control-border)] px-2 py-1 text-xs transition-colors {tab.name ===
            currentTab?.name
              ? 'bg-accent font-semibold text-bg-base'
              : 'bg-bg-surface text-text-secondary hover:text-text-primary'}"
            onclick={() => (activeTab = tab.name)}>{tab.name}</button
          >
        {/each}
      </div>
    {/if}
    <div class="flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
      {#each sections as section, sectionIndex (`${section.name}#${sectionIndex}`)}
        {#if section.name}
          <p
            class="m-0 flex flex-wrap items-center gap-2 text-[0.7rem] font-bold tracking-[0.06em] text-text-muted uppercase"
            data-nightwave-section={section.name}
          >
            {section.name}
            {#if section.creds !== null}
              <span
                class="rounded border border-accent/30 bg-accent/10 px-1 py-px text-[0.65rem] font-semibold tracking-normal text-accent normal-case"
                >{$tr("world.nightwaveSectionEach", { count: section.creds })}</span
              >
            {/if}
          </p>
        {/if}
        <div class="flex flex-wrap gap-2.5">
          {#each section.tiles as tile, tileIndex (`${tile.name}#${tileIndex}`)}
            {@const cost =
              tile.creds === null
                ? $tr("world.nightwaveUnknownCost")
                : $tr("world.nightwaveCredCost", { count: tile.creds })}
            {@const quantity =
              tile.quantity > 1 ? ` × ${tile.quantity.toLocaleString($locale)}` : ""}
            {@const tip = tile.always
              ? `${tile.label}${quantity} · ${cost} · ${$tr("world.nightwaveAlways")}`
              : `${tile.label}${quantity} · ${cost}`}
            <button
              type="button"
              class="group flex shrink-0 flex-col items-center gap-0.5 border-0 bg-transparent p-0 text-inherit transition-transform duration-100 enabled:cursor-pointer enabled:hover:z-[1] enabled:hover:scale-105 disabled:cursor-default disabled:opacity-85"
              data-nightwave-offer={tile.name}
              data-nightwave-cost-verified={tile.creds !== null}
              data-nightwave-always={tile.always ? "true" : null}
              disabled={!tile.uniqueName}
              title={tip}
              onclick={() => tile.uniqueName && onOpenItem(tile.uniqueName)}
            >
              <div
                class="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border-[1.5px] bg-surface-card {tile.owned
                  ? 'border-success/50'
                  : 'border-border'}"
              >
                <ItemImage
                  src={tile.imageUrl}
                  alt={tile.label}
                  cls="h-full w-full object-contain"
                />
                <span
                  class="pointer-events-none absolute top-[3px] left-[3px] rounded bg-bg-deep/80 px-[5px] py-[1px] text-sm leading-[1.2] font-bold {tile.creds ===
                  null
                    ? 'text-text-muted'
                    : 'text-accent'}"
                  data-nightwave-cost
                >
                  {tile.creds === null ? "?" : tile.creds}
                </span>
                {#if quantity}
                  <span
                    data-nightwave-quantity={tile.quantity}
                    class="pointer-events-none absolute right-[3px] bottom-[3px] rounded bg-bg-deep/80 px-[4px] py-[1px] text-xs leading-[1.2] text-text-secondary"
                    >{quantity.trim()}</span
                  >
                {/if}
              </div>
              <span
                class="max-w-20 overflow-hidden text-center text-xs text-ellipsis whitespace-nowrap text-text-secondary {tile.always
                  ? 'font-bold text-text-primary'
                  : ''}">{tile.label}</span
              >
            </button>
          {/each}
        </div>
      {/each}
    </div>
    <p class="mt-3 mb-1 text-xs text-text-secondary" data-nightwave-rotation-unavailable>
      {$tr("world.nightwaveRotatingUnavailable")}
    </p>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
      <span
        >{doc
          ? $tr("world.nightwaveFromWiki", { date: checkedAt.toLocaleDateString($locale) })
          : $tr("world.nightwaveVerifiedAt", { date: checkedAt.toLocaleDateString($locale) })}</span
      >
      <button
        type="button"
        class="border-0 bg-transparent p-0 text-accent hover:underline"
        onclick={() => send("open-external", doc ? WIKI_URL : reference.sources[0])}
      >
        {$tr("common.source")}
      </button>
    </div>
  {:else}
    <p class="text-sm text-text-secondary" data-nightwave-shop-unavailable>
      {$tr("world.nightwaveShopUnavailable")}
    </p>
  {/if}
</section>
