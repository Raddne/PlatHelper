<script lang="ts">
  // Owned-riven search for the Live Scraper's Rivens panel: a combobox whose
  // entries show each riven's stats, so a roll is recognisable before it is
  // picked. Already tracked rivens stay listed, last and not pickable.
  import { tick } from "svelte";
  import { tr } from "../lib/i18n.js";
  import { rivenNameSuffix } from "../lib/marketContract.js";
  import { rivenMatchesPickerQuery } from "../lib/liveScraper/rivenSearch.js";
  import type { ChipStat } from "../lib/liveScraper/rivenStatChips.js";
  import ThemedInput from "./ThemedInput.svelte";
  import RivenPolarityIcon from "./RivenPolarityIcon.svelte";
  import RivenStatChips from "./RivenStatChips.svelte";
  import type { DecodedRiven } from "../../config/shared/rivenTypes.js";

  interface Props {
    rivens: DecodedRiven[];
    /** itemIds of the rivens the Live Scraper already sells. */
    trackedIds: Set<string>;
    /** Picked itemId; "" while nothing is picked. */
    value: string;
    id?: string;
  }

  let { rivens, trackedIds, value = $bindable(""), id = "riven-picker" }: Props = $props();

  let query = $state("");
  let open = $state(false);
  let activeId = $state<string | null>(null);
  let rootEl: HTMLDivElement | null = null;
  let inputEl = $state<HTMLInputElement | null>(null);

  let listId = $derived(`${id}-list`);
  let selected = $derived(value ? rivens.find((riven) => riven.itemId === value) : undefined);
  let sorted = $derived(
    [...rivens].sort(
      (a, b) =>
        Number(trackedIds.has(a.itemId)) - Number(trackedIds.has(b.itemId)) ||
        a.weaponName.localeCompare(b.weaponName) ||
        a.rivenName.localeCompare(b.rivenName),
    ),
  );
  let shown = $derived(sorted.filter((riven) => rivenMatchesPickerQuery(riven, query)));
  let pickable = $derived(shown.filter((riven) => !trackedIds.has(riven.itemId)));

  const optionId = (itemId: string): string => `${id}-option-${itemId}`;

  function chipStats(riven: DecodedRiven): ChipStat[] {
    return riven.stats.map((stat) => ({
      tag: stat.tag,
      positive: stat.positive,
      multiplier: stat.multiplier,
      value: stat.displayValue,
      name: stat.name,
    }));
  }

  function pick(riven: DecodedRiven): void {
    if (trackedIds.has(riven.itemId)) return;
    value = riven.itemId;
    query = "";
    open = false;
    activeId = null;
  }

  async function clear(): Promise<void> {
    value = "";
    await tick();
    inputEl?.focus();
  }

  async function moveActive(step: 1 | -1): Promise<void> {
    open = true;
    if (pickable.length === 0) return;
    const at = pickable.findIndex((riven) => riven.itemId === activeId);
    const next =
      at === -1
        ? step === 1
          ? 0
          : pickable.length - 1
        : Math.max(0, Math.min(at + step, pickable.length - 1));
    activeId = pickable[next]?.itemId ?? null;
    await tick();
    if (activeId) document.getElementById(optionId(activeId))?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && open) {
      const active = pickable.find((riven) => riven.itemId === activeId);
      if (!active) return;
      event.preventDefault();
      pick(active);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      open = false;
      activeId = null;
    }
  }

  // ThemedInput takes no ARIA attributes or key handler of its own, so the
  // combobox wiring goes onto its element directly.
  $effect(() => {
    const input = inputEl;
    if (!input) return;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", listId);
    input.setAttribute("data-riven-picker-input", "");
    input.addEventListener("keydown", onKeyDown);
    return () => input.removeEventListener("keydown", onKeyDown);
  });

  $effect(() => {
    if (!inputEl) return;
    inputEl.setAttribute("aria-expanded", String(open));
    if (activeId) inputEl.setAttribute("aria-activedescendant", optionId(activeId));
    else inputEl.removeAttribute("aria-activedescendant");
  });

  // An inventory refresh can drop the picked riven; the input comes back then.
  $effect(() => {
    if (value && !selected) value = "";
  });

  $effect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootEl && event.target instanceof Node && !rootEl.contains(event.target)) {
        open = false;
        activeId = null;
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  });
</script>

{#snippet headline(riven: DecodedRiven, tracked: boolean, meta: boolean)}
  <div class="flex min-w-0 items-center gap-2">
    <span class="min-w-0 flex-1 truncate text-sm">
      <span class="font-semibold text-text-primary">{riven.weaponName}</span>
      <span class="text-text-muted">{rivenNameSuffix(riven.rivenName, riven.weaponName)}</span>
    </span>
    {#if tracked}
      <span
        class="shrink-0 rounded border border-border-strong px-1.5 text-[0.625rem] text-text-secondary"
        data-riven-picker-tracked-badge>{$tr("liveScraper.rivenPicker.tracked")}</span
      >
    {/if}
    {#if meta}
      <span class="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text-muted">
        <span>{$tr("rivens.mr", { level: riven.masteryReq })}</span>
        <RivenPolarityIcon
          polarity={riven.polarity}
          size={12}
          className="inline-flex min-w-3 object-contain"
        />
        <span>{$tr("rivens.rerollCount", { count: riven.rerolls })}</span>
        {#if riven.sheetRating === "good"}
          <span
            class="rounded border border-accent-dim bg-accent-glow px-1.5 text-[0.625rem] font-semibold text-accent"
            data-riven-good-roll>{$tr("liveScraper.rivenPicker.goodRoll")}</span
          >
        {/if}
      </span>
    {/if}
  </div>
{/snippet}

{#snippet statChips(riven: DecodedRiven)}
  <RivenStatChips stats={chipStats(riven)} />
{/snippet}

<div class="relative" bind:this={rootEl}>
  {#if selected}
    <div
      class="flex min-w-0 items-start gap-2 rounded-md border border-accent-dim bg-accent-glow px-3 py-2"
      data-riven-picker-selected={selected.itemId}
    >
      <div class="grid min-w-0 flex-1 gap-2">
        {@render headline(selected, false, true)}
        {@render statChips(selected)}
      </div>
      <button
        type="button"
        aria-label={$tr("orderModal.clearItem")}
        class="border-0 bg-transparent text-base leading-none text-text-muted hover:text-text-primary"
        onclick={() => void clear()}>&times;</button
      >
    </div>
  {:else}
    <ThemedInput
      {id}
      type="text"
      bind:value={query}
      bind:el={inputEl}
      onInput={() => {
        open = true;
        activeId = null;
      }}
      onFocus={() => (open = true)}
      placeholder={$tr("liveScraper.rivenPicker.placeholder")}
      autocomplete="off"
      className="w-full"
    />
    {#if open}
      <div
        id={listId}
        role="listbox"
        class="absolute top-[calc(100%+4px)] left-0 right-0 z-20 max-h-[min(26rem,60vh)] overflow-y-auto rounded-lg border border-border-strong bg-bg-surface shadow-[var(--ui-panel-shadow)]"
        data-riven-picker-list
      >
        <div
          class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-bg-surface px-4 py-2 text-xs"
          data-riven-picker-count
        >
          <span class="text-text-secondary"
            >{$tr("liveScraper.rivenPicker.count", {
              shown: shown.length,
              total: rivens.length,
            })}</span
          >
          <span class="text-text-muted">{$tr("liveScraper.rivenPicker.hint")}</span>
        </div>
        {#if shown.length === 0}
          <p class="m-0 px-4 py-3 text-xs text-text-muted" data-riven-picker-no-matches>
            {$tr("liveScraper.rivenPicker.noMatches", { query: query.trim() })}
          </p>
        {:else}
          {#each shown as riven (riven.itemId)}
            {@const tracked = trackedIds.has(riven.itemId)}
            <button
              type="button"
              id={optionId(riven.itemId)}
              role="option"
              tabindex="-1"
              aria-selected={activeId === riven.itemId}
              aria-disabled={tracked}
              class="grid w-full scroll-mt-9 gap-2 border-x-0 border-t-0 border-b border-solid border-border bg-transparent px-4 py-3 text-left last:border-b-0 {tracked
                ? 'cursor-default opacity-50'
                : 'cursor-pointer hover:bg-bg-hover'} {activeId === riven.itemId
                ? 'bg-bg-hover'
                : ''}"
              data-riven-picker-option={riven.itemId}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => pick(riven)}
            >
              {@render headline(riven, tracked, true)}
              {@render statChips(riven)}
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</div>
