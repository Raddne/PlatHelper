<script lang="ts">
  // Warframe.market item search-and-select, extracted from the inline
  // pattern in modals/OrderModal.svelte so other forms (Live Scraper's
  // Stock/Wishlist add forms) get the same "search, not type a raw item id"
  // UX instead of a bare text field. Uses a small category glyph instead of
  // a per-item thumbnail image (no per-result image fetches, faster list).
  import { invoke } from "../lib/ipc.js";
  import { isIpcError } from "../lib/ipcGuards.js";
  import { tr } from "../lib/i18n.js";
  import ThemedInput from "./ThemedInput.svelte";
  import ItemCategoryIcon from "./ItemCategoryIcon.svelte";
  import { categorizeItem } from "../lib/itemCategory.js";
  import type { WfmSearchItem } from "../types/market.js";

  const SEARCH_MIN_CHARS = 2;
  const SEARCH_LIMIT = 15;
  const SEARCH_DEBOUNCE_MS = 250;

  let {
    onSelect,
    label = $tr("common.item"),
    placeholder = $tr("orderModal.searchItemsPlaceholder"),
    id = "item-picker-search",
  }: {
    onSelect: (item: WfmSearchItem) => void;
    label?: string;
    placeholder?: string;
    id?: string;
  } = $props();

  let query = $state("");
  let dropdown = $state<WfmSearchItem[]>([]);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchRequest = 0;
  let rootEl: HTMLDivElement | null = null;

  function onInput(): void {
    if (searchTimer) clearTimeout(searchTimer);
    const token = ++searchRequest;
    dropdown = [];
    if (query.length < SEARCH_MIN_CHARS) return;
    searchTimer = setTimeout(async () => {
      const q = query;
      try {
        const results = await invoke("wfmSearchItems", q, SEARCH_LIMIT);
        if (token !== searchRequest || q !== query) return;
        if (results && !isIpcError(results)) dropdown = results;
      } catch {
        if (token === searchRequest) dropdown = [];
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function pick(item: WfmSearchItem): void {
    query = "";
    dropdown = [];
    onSelect(item);
  }

  function onDocumentPointerDown(event: PointerEvent): void {
    if (dropdown.length === 0) return;
    if (rootEl && event.target instanceof Node && !rootEl.contains(event.target)) {
      dropdown = [];
    }
  }

  $effect(() => {
    if (dropdown.length === 0) return;
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  });
</script>

<div class="grid gap-1" bind:this={rootEl}>
  <label for={id} class="text-xs font-medium text-text-secondary">{label}</label>
  <div class="relative">
    <ThemedInput
      {id}
      type="text"
      bind:value={query}
      {onInput}
      {placeholder}
      autocomplete="off"
      className="w-full"
    />
    {#if dropdown.length > 0}
      <div
        class="absolute top-[calc(100%+4px)] left-0 right-0 z-20 max-h-[220px] overflow-y-auto rounded-lg border border-border-strong bg-bg-surface shadow-[var(--ui-panel-shadow)]"
      >
        {#each dropdown as item (item.id)}
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2.5 py-2 text-left text-sm text-text-primary hover:bg-bg-hover"
            onclick={() => pick(item)}
          >
            <span class="shrink-0 text-text-secondary">
              <ItemCategoryIcon category={categorizeItem(item)} size={18} />
            </span>
            <span>{item.item_name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
