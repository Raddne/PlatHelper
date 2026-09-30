<script lang="ts">
  import { tr as t, type MessageKey } from "../lib/i18n.js";
  import {
    ALL,
    MAX_POSITIVES,
    MR_LIMITS,
    NEGATIVE_NONE,
    NEGATIVE_SOME,
    STATUS_HIDDEN,
    STATUS_PAUSED,
    countStatuses,
    hasActiveFilters,
    keepPicked,
    resetTabFilters,
    rivenFilterOptions,
    rivenRowState,
    stockRowState,
    wtbRowState,
    type ListingFilters,
    type ListingStatus,
    type RivenFilters,
    type WtbFilterRow,
    type WtbFilters,
    type WtsFilters,
  } from "../lib/liveScraper/listingFilters.js";
  import { statTagToDisplayName } from "../../config/shared/rivenStatDisplayNames.js";
  import {
    WFM_ITEM_CATEGORIES,
    type WfmItemCategory,
  } from "../../config/shared/wfmItemCategory.js";
  import type { ListingsTab } from "../../config/shared/liveScraperSettings.js";
  import type { StockItem } from "../../config/shared/liveScraperStock.js";
  import type { StockRiven } from "../../config/shared/liveScraperRivenStock.js";

  interface Props {
    tab: ListingsTab;
    filters: ListingFilters;
    wtbRows: readonly WtbFilterRow[];
    stock: readonly StockItem[];
    stockRivens: readonly StockRiven[];
    /** The Status dropdown lists the statuses in this order. */
    statusOrder: readonly ListingStatus[];
    /** Rows on screen once filters, search and the row cap applied. */
    shown: number;
    total: number;
  }
  let {
    tab,
    filters = $bindable(),
    wtbRows,
    stock,
    stockRivens,
    statusOrder,
    shown,
    total,
  }: Props = $props();

  interface Option {
    value: string;
    label: string;
  }

  // Relic and Misc reuse the keys that already own the word.
  const TYPE_LABEL_KEYS: Record<WfmItemCategory, MessageKey> = {
    mod: "liveScraper.listings.filter.typeMod",
    arcane: "liveScraper.listings.filter.typeArcane",
    set: "liveScraper.listings.filter.typeSet",
    relic: "drops.relicSuffix",
    part: "liveScraper.listings.filter.typePart",
    misc: "inventory.tab.misc",
  };

  let active = $derived(hasActiveFilters(filters, tab));

  let typeOptions = $derived<Option[]>([
    { value: ALL, label: $t("common.all") },
    ...WFM_ITEM_CATEGORIES.map((category) => ({
      value: category,
      label: $t(TYPE_LABEL_KEYS[category]),
    })),
  ]);

  let statusOptions = $derived.by<Option[]>(() => {
    // Counted over every row of the tab, whatever the other filters leave.
    const counts = countStatuses(
      tab === "wtb"
        ? wtbRows.map(wtbRowState)
        : tab === "wts"
          ? stock.map(stockRowState)
          : stockRivens.map(rivenRowState),
    );
    const picked = filters[tab].status;
    const options: Option[] = [{ value: ALL, label: $t("common.all") }];
    for (const status of statusOrder) {
      const count = counts.byStatus.get(status) ?? 0;
      if (count === 0 && picked !== status) continue;
      options.push({
        value: status,
        label: `${$t(`liveScraper.listings.status.${status}`)} (${count})`,
      });
    }
    if (counts.hidden > 0 || picked === STATUS_HIDDEN) {
      options.push({
        value: STATUS_HIDDEN,
        label: `${$t("liveScraper.listings.statusHiddenOnWfm")} (${counts.hidden})`,
      });
    }
    if (counts.paused > 0 || picked === STATUS_PAUSED) {
      options.push({
        value: STATUS_PAUSED,
        label: `${$t("liveScraper.listings.filter.paused")} (${counts.paused})`,
      });
    }
    return options;
  });

  let rivenOptions = $derived(rivenFilterOptions(stockRivens));

  const statOptions = (tags: readonly string[]): Option[] =>
    tags.map((tag) => ({ value: tag, label: statTagToDisplayName(tag) }));

  const polarityName = (polarity: string): string =>
    polarity.charAt(0).toUpperCase() + polarity.slice(1);

  // ---- Positives checklist ---------------------------------------------------
  // Same shape as the row menu: fixed to the viewport, closed by an outside
  // click, Escape, a window blur or a resize.
  const POSITIVES_WIDTH = 224;
  let positivesOpen = $state(false);
  let positivesAt = $state({ x: 0, y: 0 });
  let positivesToggle = $state<HTMLButtonElement | null>(null);

  let positiveTags = $derived(keepPicked(rivenOptions.positives, filters.rivens.positives));
  let positivesFull = $derived(filters.rivens.positives.length >= MAX_POSITIVES);
  let positivesLabel = $derived(
    filters.rivens.positives.length === 0
      ? $t("liveScraper.listings.filter.positivesAny")
      : $t("liveScraper.listings.filter.positivesPicked", {
          stats: filters.rivens.positives.map((tag) => statTagToDisplayName(tag)).join(", "),
        }),
  );

  function togglePositivesList(): void {
    if (positivesOpen || !positivesToggle) {
      positivesOpen = false;
      return;
    }
    const rect = positivesToggle.getBoundingClientRect();
    positivesAt = {
      x: Math.max(8, Math.min(rect.left, window.innerWidth - POSITIVES_WIDTH - 8)),
      y: rect.bottom + 4,
    };
    positivesOpen = true;
  }

  function togglePositive(tag: string): void {
    const picked = filters.rivens.positives;
    if (picked.includes(tag)) {
      filters.rivens.positives = picked.filter((entry) => entry !== tag);
    } else if (picked.length < MAX_POSITIVES) {
      filters.rivens.positives = [...picked, tag];
    }
  }

  $effect(() => {
    if (tab !== "rivens") positivesOpen = false;
  });

  $effect(() => {
    if (!positivesOpen) return;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-ls-positives], [data-ls-filter='positives']")) return;
      positivesOpen = false;
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Only the list closes; the table would otherwise also drop its row selection.
      e.stopPropagation();
      positivesOpen = false;
    };
    const dismiss = (): void => {
      positivesOpen = false;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  });
</script>

{#snippet dropdown(
  id: string,
  label: string,
  value: string,
  options: readonly Option[],
  set: (value: string) => void,
)}
  <div class="shared-select-group">
    <span class="shared-chip-label">{label}</span>
    <select
      class="shared-filter-select"
      data-ls-filter={id}
      aria-label={label}
      {value}
      onchange={(e) => set(e.currentTarget.value)}
    >
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>
{/snippet}

<div class="ls-filters" data-ls-filter-row={tab}>
  {#if tab === "wtb"}
    {@render dropdown(
      "type",
      $t("common.type"),
      filters.wtb.type,
      typeOptions,
      (v) => (filters.wtb.type = v as WtbFilters["type"]),
    )}
    {@render dropdown(
      "source",
      $t("liveScraper.listings.col.source"),
      filters.wtb.source,
      [
        { value: ALL, label: $t("common.all") },
        { value: "wishlist", label: $t("liveScraper.listings.source.wishlist") },
        { value: "scan", label: $t("liveScraper.listings.source.scan") },
      ],
      (v) => (filters.wtb.source = v as WtbFilters["source"]),
    )}
    {@render dropdown(
      "owned",
      $t("liveScraper.listings.filter.owned"),
      filters.wtb.owned,
      [
        { value: ALL, label: $t("common.all") },
        { value: "yes", label: $t("filters.yes") },
        { value: "no", label: $t("filters.no") },
      ],
      (v) => (filters.wtb.owned = v as WtbFilters["owned"]),
    )}
  {:else if tab === "wts"}
    {@render dropdown(
      "type",
      $t("common.type"),
      filters.wts.type,
      typeOptions,
      (v) => (filters.wts.type = v as WtsFilters["type"]),
    )}
    {@render dropdown(
      "origin",
      $t("liveScraper.listings.filter.origin"),
      filters.wts.origin,
      [
        { value: ALL, label: $t("common.all") },
        { value: "trade", label: $t("liveScraper.listings.filter.originTrade") },
        { value: "manual", label: $t("liveScraper.listings.filter.originManual") },
        { value: "adopted", label: $t("liveScraper.listings.filter.originAdopted") },
      ],
      (v) => (filters.wts.origin = v as WtsFilters["origin"]),
    )}
  {:else}
    {@render dropdown(
      "weapon",
      $t("rivens.finder.weapon"),
      filters.rivens.weapon,
      [
        { value: ALL, label: $t("common.all") },
        ...keepPicked(rivenOptions.weapons, [filters.rivens.weapon]).map((weapon) => ({
          value: weapon,
          label: weapon,
        })),
      ],
      (v) => (filters.rivens.weapon = v),
    )}
    <div class="shared-select-group">
      <button
        bind:this={positivesToggle}
        id="ls-filter-positives"
        type="button"
        class="shared-filter-select ls-positives-toggle"
        data-ls-filter="positives"
        aria-haspopup="true"
        aria-expanded={positivesOpen}
        title={positivesLabel}
        onclick={togglePositivesList}
      >
        {positivesLabel}
        <svg class="ls-caret" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
    {@render dropdown(
      "negative",
      $t("marketAlerts.negative"),
      filters.rivens.negative,
      [
        { value: ALL, label: $t("filters.any") },
        { value: NEGATIVE_NONE, label: $t("common.none") },
        { value: NEGATIVE_SOME, label: $t("liveScraper.listings.filter.negativeSome") },
        ...statOptions(keepPicked(rivenOptions.negatives, [filters.rivens.negative])),
      ],
      (v) => (filters.rivens.negative = v),
    )}
    {@render dropdown(
      "polarity",
      $t("marketAlerts.polarity"),
      filters.rivens.polarity,
      [
        { value: ALL, label: $t("filters.any") },
        ...keepPicked(rivenOptions.polarities, [filters.rivens.polarity]).map((polarity) => ({
          value: polarity,
          label: polarityName(polarity),
        })),
      ],
      (v) => (filters.rivens.polarity = v),
    )}
    {@render dropdown(
      "rerolls",
      $t("liveScraper.listings.col.rerolls"),
      filters.rivens.rerolls,
      [
        { value: ALL, label: $t("filters.any") },
        { value: "unrolled", label: $t("liveScraper.listings.filter.rerollsUnrolled") },
        { value: "rolled", label: $t("liveScraper.listings.filter.rerollsRolled") },
      ],
      (v) => (filters.rivens.rerolls = v as RivenFilters["rerolls"]),
    )}
    {@render dropdown(
      "mr",
      $t("liveScraper.listings.col.mastery"),
      filters.rivens.mr,
      [
        { value: ALL, label: $t("filters.any") },
        ...MR_LIMITS.map((mr) => ({
          value: mr,
          label: $t("liveScraper.listings.filter.mrUpTo", { mr }),
        })),
      ],
      (v) => (filters.rivens.mr = v as RivenFilters["mr"]),
    )}
  {/if}
  {@render dropdown(
    "status",
    $t("liveScraper.listings.col.status"),
    filters[tab].status,
    statusOptions,
    (v) => (filters[tab].status = v),
  )}
  {#if active}
    <span class="ls-filter-tools">
      <span class="ls-filter-count" data-ls-filter-count>
        {$t("liveScraper.listings.filter.shownCount", { shown, total })}
      </span>
      <button
        type="button"
        class="filter-tab"
        data-ls-filter-reset
        onclick={() => resetTabFilters(filters, tab)}
      >
        {$t("filters.resetTitle")}
      </button>
    </span>
  {/if}
</div>

{#if positivesOpen}
  <div
    class="ls-positives"
    style="left: {positivesAt.x}px; top: {positivesAt.y}px"
    role="group"
    aria-labelledby="ls-filter-positives"
    data-ls-positives
  >
    {#each positiveTags as tag (tag)}
      {@const picked = filters.rivens.positives.includes(tag)}
      <label class="ls-positives-option" class:disabled={!picked && positivesFull}>
        <input
          type="checkbox"
          checked={picked}
          disabled={!picked && positivesFull}
          data-ls-positive={tag}
          onchange={() => togglePositive(tag)}
        />
        <span>{statTagToDisplayName(tag)}</span>
      </label>
    {/each}
  </div>
{/if}

<style>
  .ls-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 0 0.75rem 0.75rem;
  }
  .ls-filter-tools {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
  }
  .ls-filter-count {
    font-size: 0.75rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .ls-positives-toggle {
    position: relative;
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .ls-caret {
    position: absolute;
    top: 50%;
    right: 0.6rem;
    width: 0.8rem;
    height: 0.8rem;
    transform: translateY(-50%);
  }
  .ls-positives {
    position: fixed;
    z-index: 60;
    width: 14rem;
    max-height: 18rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-tooltip, var(--bg-deep));
    padding: 0.25rem 0;
    box-shadow: var(--ui-panel-shadow);
  }
  .ls-positives-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.75rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ls-positives-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .ls-positives-option.disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
