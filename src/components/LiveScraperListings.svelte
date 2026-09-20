<script lang="ts">
  import { tr as t } from "../lib/i18n.js";
  import { persistedString } from "../lib/persistence.js";
  import { invoke, send } from "../lib/ipc.js";
  import {
    clickRow,
    EMPTY_ROW_SELECTION,
    pruneSelection,
    type RowSelection,
  } from "../lib/rowSelection.js";
  import MarketStatsModal from "./market/MarketStatsModal.svelte";
  import { liveScraperSettings, updateItemGeneralSettings } from "../stores/liveScraperSettings.js";
  import type {
    StockItem,
    WishlistItem,
    StockEntryStatus,
  } from "../../config/shared/liveScraperStock.js";
  import type { StockRiven } from "../../config/shared/liveScraperRivenStock.js";
  import type { LiveScraperWtbListing } from "../../config/shared/liveScraperEngine.js";

  interface Props {
    stock: StockItem[];
    wishlist: WishlistItem[];
    stockRivens: StockRiven[];
    wtbListings: LiveScraperWtbListing[];
    onRemove: (kind: "stock" | "wishlist" | "riven", id: string, name: string) => void;
    onRemoveMany: (entries: RemovableEntry[]) => void;
  }
  let { stock, wishlist, stockRivens, wtbListings, onRemove, onRemoveMany }: Props = $props();

  interface RemovableEntry {
    kind: "stock" | "wishlist" | "riven";
    id: string;
    name: string;
  }

  type Tab = "wtb" | "wts" | "rivens";
  const TABS: readonly Tab[] = ["wtb", "wts", "rivens"];
  const tab = persistedString<Tab>("wf_live_scraper_listings_tab", TABS, "wtb");

  type Tone = "good" | "warn" | "bad" | "muted";
  type AnyStatus = StockEntryStatus | LiveScraperWtbListing["status"];

  const TONES: Record<AnyStatus, Tone> = {
    live: "good",
    pending: "muted",
    inactive: "muted",
    toLowProfit: "warn",
    smaLimit: "warn",
    maxPriceDrop: "warn",
    noSellers: "warn",
    noBuyers: "warn",
    overpriced: "bad",
    underpriced: "bad",
    aboveAvgPrice: "bad",
    stockLimit: "muted",
    budget: "warn",
    orderLimit: "bad",
    error: "bad",
  };

  interface WtbRow {
    key: string;
    /** Wishlist row id; null for scan candidates, which have no persisted row to edit. */
    wishlistId: string | null;
    /** Catalog id for scan candidates (their max price lives in the buy list); null for wishlist rows. */
    scanWfmId: string | null;
    wfmUrl: string | null;
    itemName: string;
    rank: number | null;
    source: "wishlist" | "scan";
    quantity: number;
    maxPrice: number | null;
    listPrice: number | null;
    potentialProfit: number | null;
    status: AnyStatus;
    updatedAt: number;
  }

  let buyListMax = $derived(
    new Map(
      $liveScraperSettings.items.general.buyList
        .filter((e) => e.maxPrice > 0)
        .map((e) => [e.wfmId, e.maxPrice]),
    ),
  );

  let wtbRows = $derived<WtbRow[]>([
    ...wishlist.map((w) => ({
      key: `w:${w.id}`,
      wishlistId: w.id,
      scanWfmId: null,
      wfmUrl: w.wfmUrl,
      itemName: w.itemName,
      rank: typeof w.subType?.rank === "number" ? w.subType.rank : null,
      source: "wishlist" as const,
      quantity: w.quantity,
      maxPrice: w.maxPrice,
      listPrice: w.listPrice,
      potentialProfit: null,
      status: w.status,
      updatedAt: w.updatedAt,
    })),
    ...wtbListings
      .map((l) => ({
        key: `s:${l.wfmUrl}`,
        wishlistId: null,
        scanWfmId: l.wfmId,
        wfmUrl: l.wfmUrl,
        itemName: l.itemName,
        rank: null,
        source: "scan" as const,
        quantity: l.quantity,
        maxPrice: buyListMax.get(l.wfmId) ?? null,
        listPrice: l.listPrice,
        potentialProfit: l.potentialProfit,
        status: l.status,
        updatedAt: l.updatedAt,
      }))
      .sort(
        (a, b) =>
          Number(b.listPrice != null) - Number(a.listPrice != null) ||
          a.itemName.localeCompare(b.itemName),
      ),
  ]);

  let counts = $derived<Record<Tab, number>>({
    wtb: wtbRows.length,
    wts: stock.length,
    rivens: stockRivens.length,
  });

  // ---- Search ---------------------------------------------------------------
  // Filters what is shown; the tab counters keep counting everything tracked.
  let query = $state("");
  let needle = $derived(query.trim().toLowerCase());
  const matches = (...texts: string[]): boolean =>
    needle === "" || texts.some((text) => text.toLowerCase().includes(needle));

  // Several thousand rows with five buttons each would freeze the view, so the
  // table stops at MAX_ROWS and points at the search box for the rest.
  const MAX_ROWS = 300;
  let matchedWtb = $derived(wtbRows.filter((row) => matches(row.itemName)));
  let matchedStock = $derived(stock.filter((item) => matches(item.itemName)));
  let matchedRivens = $derived(
    stockRivens.filter((riven) => matches(riven.weaponName, riven.rivenName)),
  );
  let shownWtb = $derived(matchedWtb.slice(0, MAX_ROWS));
  let shownStock = $derived(matchedStock.slice(0, MAX_ROWS));
  let shownRivens = $derived(matchedRivens.slice(0, MAX_ROWS));
  let hiddenRows = $derived(
    Math.max(
      0,
      ($tab === "wtb"
        ? matchedWtb.length
        : $tab === "wts"
          ? matchedStock.length
          : matchedRivens.length) - MAX_ROWS,
    ),
  );

  // ---- Row selection (click, Ctrl+click, Shift+click) ----------------------
  let rowOrder = $derived<string[]>(
    $tab === "wtb"
      ? shownWtb.map((row) => row.key)
      : $tab === "wts"
        ? shownStock.map((item) => item.id)
        : shownRivens.map((riven) => riven.id),
  );
  let selection = $state<RowSelection>(EMPTY_ROW_SELECTION);
  let selectionTab: Tab | null = null;

  $effect(() => {
    // A selection never spans tabs, and never outlives its rows.
    // Read up front: an early return must not drop rowOrder as a dependency.
    const order = rowOrder;
    if (selectionTab !== $tab) {
      selectionTab = $tab;
      selection = EMPTY_ROW_SELECTION;
      return;
    }
    selection = pruneSelection(order, selection);
  });

  function onRowClick(event: MouseEvent, key: string): void {
    if ((event.target as HTMLElement | null)?.closest("button, input, a")) return;
    selection = clickRow(rowOrder, selection, key, {
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
    });
  }

  // Shift+click would otherwise drag a text selection across the table.
  function onRowMouseDown(event: MouseEvent): void {
    if (event.shiftKey && !(event.target as HTMLElement | null)?.closest("input")) {
      event.preventDefault();
    }
  }

  function plat(value: number | null): string {
    return value == null ? "–" : `${value}p`;
  }

  function profit(listPrice: number | null, bought: number): number | null {
    return listPrice == null ? null : listPrice - bought;
  }

  function timeOf(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  const PRICE_STEPS = [-10, -5, 5, 10] as const;
  type PriceCommit = (value: number | null) => Promise<unknown>;

  let editingKey = $state<string | null>(null);
  // bind:value on a number input yields a number (or null when empty), never a string.
  let draft = $state<number | null>(null);

  function startEdit(key: string, value: number | null): void {
    editingKey = key;
    draft = value;
  }

  // Empty or 0 clears the override, matching Quantframe's "N/A" state.
  function commitEdit(commit: PriceCommit): void {
    if (editingKey == null) return;
    editingKey = null;
    const parsed = typeof draft === "number" ? Math.floor(draft) : NaN;
    void commit(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }

  function step(value: number | null, delta: number, commit: PriceCommit): void {
    const next = (value ?? 0) + delta;
    if (next < 0) return;
    void commit(next > 0 ? next : null);
  }

  function focusSelect(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  const setStockMinPrice = (id: string) => (minPrice: number | null) =>
    invoke("liveScraperStockUpdate", id, { minPrice });
  const setWishlistMaxPrice = (id: string) => (maxPrice: number | null) =>
    invoke("liveScraperWishlistUpdate", id, { maxPrice });
  const setScanMaxPrice = (wfmId: string) => async (maxPrice: number | null) => {
    updateItemGeneralSettings((current) => {
      const buyList = current.buyList.filter((e) => e.wfmId !== wfmId);
      if (maxPrice != null) buyList.push({ wfmId, maxPrice });
      return { ...current, buyList };
    });
  };
  const setRivenMinPrice = (id: string) => (minPrice: number | null) =>
    invoke("liveScraperRivenStockUpdate", id, { minPrice });

  // ---- Row context menu + value popup ------------------------------------
  type MenuTarget =
    | { kind: "stock"; item: StockItem }
    | { kind: "wishlist"; item: WishlistItem }
    | { kind: "scan"; row: WtbRow }
    | { kind: "riven"; riven: StockRiven }
    | { kind: "bulk" };

  interface MenuItem {
    id: string;
    label: string;
    run: () => void;
    danger?: boolean;
    separated?: boolean;
  }

  interface ValueEditor {
    x: number;
    y: number;
    title: string;
    label: string;
    min: number;
    /** Empty input clears the value (price overrides); otherwise it falls back to `min`. */
    clearable: boolean;
    commit: PriceCommit;
  }

  const MENU_WIDTH = 240;
  const MENU_HEIGHT = 300;
  const EDITOR_WIDTH = 260;
  const EDITOR_HEIGHT = 170;

  let menu = $state<{ x: number; y: number; target: MenuTarget } | null>(null);
  let editor = $state<ValueEditor | null>(null);
  let editorDraft = $state<number | null>(null);
  let statsFor = $state<{ slug: string; title: string } | null>(null);

  function openMenu(event: MouseEvent, key: string, rowTarget: MenuTarget): void {
    event.preventDefault();
    editor = null;
    // Right-click inside a multi-selection acts on all of it; anywhere else it
    // moves the selection to that row first, like a file manager.
    if (!selection.selected.has(key)) selection = { selected: new Set([key]), anchor: key };
    const target: MenuTarget = selection.selected.size > 1 ? { kind: "bulk" } : rowTarget;
    menu = {
      target,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - MENU_WIDTH)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_HEIGHT)),
    };
  }

  function editValue(
    title: string,
    label: string,
    current: number | null,
    options: { min: number; clearable: boolean },
    commit: PriceCommit,
  ): void {
    if (!menu) return;
    editorDraft = current;
    editor = {
      title,
      label,
      min: options.min,
      clearable: options.clearable,
      commit,
      x: Math.max(8, Math.min(menu.x, window.innerWidth - EDITOR_WIDTH)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - EDITOR_HEIGHT)),
    };
  }

  function confirmEditor(): void {
    if (!editor) return;
    const current = editor;
    editor = null;
    const parsed =
      typeof editorDraft === "number" && Number.isFinite(editorDraft)
        ? Math.floor(editorDraft)
        : null;
    if (parsed == null || parsed < current.min || (current.clearable && parsed === 0)) {
      void current.commit(current.clearable ? null : current.min);
    } else {
      void current.commit(parsed);
    }
  }

  function clearEditor(): void {
    if (!editor) return;
    const current = editor;
    editor = null;
    void current.commit(null);
  }

  async function copyName(name: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // Clipboard can be unavailable; nothing else depends on it.
    }
  }

  const PRICE = { min: 0, clearable: true };

  function marketItems(slug: string, name: string): MenuItem[] {
    return [
      {
        id: "open-wfm",
        label: $t("liveScraper.listings.menu.openWfm"),
        separated: true,
        run: () => send("open-external", `https://warframe.market/items/${slug}`),
      },
      {
        id: "statistics",
        label: $t("liveScraper.listings.menu.statistics"),
        run: () => (statsFor = { slug, title: name }),
      },
      {
        id: "copy-name",
        label: $t("liveScraper.listings.menu.copyName"),
        run: () => void copyName(name),
      },
    ];
  }

  function bulkMenuItems(): MenuItem[] {
    const picked = selection.selected;
    const count = picked.size;
    const items: MenuItem[] = [];
    const prices: PriceCommit[] = [];
    const pausers: ((isHidden: boolean) => unknown)[] = [];
    const removable: RemovableEntry[] = [];

    if ($tab === "wts") {
      for (const item of stock.filter((entry) => picked.has(entry.id))) {
        prices.push(setStockMinPrice(item.id));
        if (!item.adopted) {
          pausers.push((isHidden) => invoke("liveScraperStockUpdate", item.id, { isHidden }));
        }
        removable.push({ kind: "stock", id: item.id, name: item.itemName });
      }
    } else if ($tab === "rivens") {
      for (const riven of stockRivens.filter((entry) => picked.has(entry.id))) {
        prices.push(setRivenMinPrice(riven.id));
        pausers.push((isHidden) => invoke("liveScraperRivenStockUpdate", riven.id, { isHidden }));
        removable.push({ kind: "riven", id: riven.id, name: riven.rivenName });
      }
    } else {
      for (const row of wtbRows.filter((entry) => picked.has(entry.key))) {
        if (row.wishlistId) {
          const id = row.wishlistId;
          prices.push(setWishlistMaxPrice(id));
          pausers.push((isHidden) => invoke("liveScraperWishlistUpdate", id, { isHidden }));
          removable.push({ kind: "wishlist", id, name: row.itemName });
        } else if (row.scanWfmId) {
          prices.push(setScanMaxPrice(row.scanWfmId));
        }
      }
    }

    if (prices.length > 0) {
      const isBuy = $tab === "wtb";
      items.push({
        id: "bulk-price",
        label: isBuy
          ? $t("liveScraper.listings.menu.bulkMaxPrice", { count: prices.length })
          : $t("liveScraper.listings.menu.bulkMinPrice", { count: prices.length }),
        run: () =>
          editValue(
            $t("liveScraper.listings.selectedCount", { count }),
            isBuy
              ? $t("liveScraper.listings.col.maxPrice")
              : $t("liveScraper.listings.col.minPrice"),
            null,
            PRICE,
            async (value) => {
              for (const commit of prices) await commit(value);
            },
          ),
      });
    }
    if (pausers.length > 0) {
      items.push({
        id: "bulk-pause",
        label: $t("liveScraper.listings.menu.bulkPause", { count: pausers.length }),
        run: () => {
          for (const pause of pausers) void pause(true);
        },
      });
      items.push({
        id: "bulk-resume",
        label: $t("liveScraper.listings.menu.bulkResume", { count: pausers.length }),
        run: () => {
          for (const pause of pausers) void pause(false);
        },
      });
    }
    items.push({
      id: "clear-selection",
      label: $t("liveScraper.listings.menu.clearSelection"),
      separated: items.length > 0,
      run: () => (selection = EMPTY_ROW_SELECTION),
    });
    if (removable.length > 0) {
      items.push({
        id: "bulk-remove",
        label: $t("liveScraper.listings.menu.bulkRemove", { count: removable.length }),
        danger: true,
        separated: true,
        run: () => onRemoveMany(removable),
      });
    }
    return items;
  }

  function menuItemsFor(target: MenuTarget): MenuItem[] {
    if (target.kind === "bulk") return bulkMenuItems();
    type MenuKey =
      | "editMinPrice"
      | "editMaxPrice"
      | "editBought"
      | "editOwned"
      | "editQuantity"
      | "pause"
      | "resume"
      | "openWfm"
      | "copyName"
      | "remove";
    const m = (key: MenuKey) => $t(`liveScraper.listings.menu.${key}`);
    if (target.kind === "stock") {
      const item = target.item;
      return [
        {
          id: "edit-min-price",
          label: m("editMinPrice"),
          run: () =>
            editValue(
              item.itemName,
              $t("liveScraper.listings.col.minPrice"),
              item.minPrice,
              PRICE,
              setStockMinPrice(item.id),
            ),
        },
        {
          id: "edit-bought",
          label: m("editBought"),
          run: () =>
            editValue(
              item.itemName,
              $t("liveScraper.listings.col.bought"),
              item.bought,
              { min: 0, clearable: false },
              (v) => invoke("liveScraperStockUpdate", item.id, { bought: v ?? 0 }),
            ),
        },
        {
          id: "edit-owned",
          label: m("editOwned"),
          run: () =>
            editValue(
              item.itemName,
              $t("liveScraper.listings.col.owned"),
              item.owned,
              { min: 1, clearable: false },
              (v) => invoke("liveScraperStockUpdate", item.id, { owned: v ?? 1 }),
            ),
        },
        ...(item.adopted
          ? []
          : [
              {
                id: "toggle-hidden",
                label: item.isHidden ? m("resume") : m("pause"),
                run: () =>
                  void invoke("liveScraperStockUpdate", item.id, { isHidden: !item.isHidden }),
              },
            ]),
        ...marketItems(item.wfmUrl, item.itemName),
        {
          id: "remove",
          label: m("remove"),
          danger: true,
          separated: true,
          run: () => onRemove("stock", item.id, item.itemName),
        },
      ];
    }
    if (target.kind === "wishlist") {
      const item = target.item;
      return [
        {
          id: "edit-max-price",
          label: m("editMaxPrice"),
          run: () =>
            editValue(
              item.itemName,
              $t("liveScraper.listings.col.maxPrice"),
              item.maxPrice,
              PRICE,
              setWishlistMaxPrice(item.id),
            ),
        },
        {
          id: "edit-quantity",
          label: m("editQuantity"),
          run: () =>
            editValue(
              item.itemName,
              $t("common.quantity"),
              item.quantity,
              { min: 1, clearable: false },
              (v) => invoke("liveScraperWishlistUpdate", item.id, { quantity: v ?? 1 }),
            ),
        },
        {
          id: "toggle-hidden",
          label: item.isHidden ? m("resume") : m("pause"),
          run: () =>
            void invoke("liveScraperWishlistUpdate", item.id, { isHidden: !item.isHidden }),
        },
        ...marketItems(item.wfmUrl, item.itemName),
        {
          id: "remove",
          label: m("remove"),
          danger: true,
          separated: true,
          run: () => onRemove("wishlist", item.id, item.itemName),
        },
      ];
    }
    if (target.kind === "scan") {
      const row = target.row;
      const wfmId = row.scanWfmId;
      return [
        ...(wfmId
          ? [
              {
                id: "edit-max-price",
                label: m("editMaxPrice"),
                run: () =>
                  editValue(
                    row.itemName,
                    $t("liveScraper.listings.col.maxPrice"),
                    row.maxPrice,
                    PRICE,
                    setScanMaxPrice(wfmId),
                  ),
              },
            ]
          : []),
        ...(row.wfmUrl ? marketItems(row.wfmUrl, row.itemName) : []),
      ];
    }
    const riven = target.riven;
    const name = `${riven.weaponName} ${riven.rivenName}`;
    return [
      {
        id: "edit-min-price",
        label: m("editMinPrice"),
        run: () =>
          editValue(
            name,
            $t("liveScraper.listings.col.minPrice"),
            riven.minPrice,
            PRICE,
            setRivenMinPrice(riven.id),
          ),
      },
      {
        id: "edit-bought",
        label: m("editBought"),
        run: () =>
          editValue(
            name,
            $t("liveScraper.listings.col.bought"),
            riven.bought,
            { min: 0, clearable: false },
            (v) => invoke("liveScraperRivenStockUpdate", riven.id, { bought: v ?? 0 }),
          ),
      },
      {
        id: "toggle-hidden",
        label: riven.isHidden ? m("resume") : m("pause"),
        run: () =>
          void invoke("liveScraperRivenStockUpdate", riven.id, { isHidden: !riven.isHidden }),
      },
      ...(riven.auctionId
        ? [
            {
              id: "open-wfm",
              label: m("openWfm"),
              separated: true,
              run: () =>
                send("open-external", `https://warframe.market/auction/${riven.auctionId}`),
            },
          ]
        : []),
      {
        id: "copy-name",
        label: m("copyName"),
        separated: !riven.auctionId,
        run: () => void copyName(name),
      },
      {
        id: "remove",
        label: m("remove"),
        danger: true,
        separated: true,
        run: () => onRemove("riven", riven.id, riven.rivenName),
      },
    ];
  }

  function runItem(item: MenuItem): void {
    item.run();
    menu = null;
  }

  $effect(() => {
    if (!menu && !editor) return;
    const onPointerDown = (e: PointerEvent): void => {
      if ((e.target as HTMLElement | null)?.closest("[data-ls-menu], [data-ls-editor]")) return;
      menu = null;
      editor = null;
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      menu = null;
      editor = null;
    };
    const dismissMenu = (): void => {
      menu = null;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", dismissMenu);
    window.addEventListener("resize", dismissMenu);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", dismissMenu);
      window.removeEventListener("resize", dismissMenu);
    };
  });

  $effect(() => {
    if (selection.selected.size === 0 || menu || editor) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      // Escape inside a price input cancels that edit, nothing more.
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest("input")) return;
      selection = EMPTY_ROW_SELECTION;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function statSummary(riven: StockRiven): string {
    return riven.stats.map((s) => `${s.positive ? "+" : "−"}${s.tag}`).join(", ");
  }
</script>

{#snippet priceCell(key: string, value: number | null, commit: PriceCommit)}
  <div class="ls-price">
    {#if editingKey === key}
      <input
        class="ls-price-input"
        type="number"
        min="0"
        step="1"
        bind:value={draft}
        use:focusSelect
        onblur={() => commitEdit(commit)}
        onkeydown={(e) => {
          if (e.key === "Enter") commitEdit(commit);
          else if (e.key === "Escape") editingKey = null;
        }}
      />
    {:else}
      <button
        type="button"
        class="ls-price-value"
        title={$t("liveScraper.listings.editPrice")}
        onclick={() => startEdit(key, value)}
      >
        {plat(value)}
      </button>
    {/if}
    <span class="ls-steps">
      {#each PRICE_STEPS as delta (delta)}
        <button
          type="button"
          class="ls-step"
          class:down={delta < 0}
          disabled={(value ?? 0) + delta < 0}
          onclick={() => step(value, delta, commit)}
        >
          {delta > 0 ? "+" : "−"}{Math.abs(delta)}
        </button>
      {/each}
    </span>
  </div>
{/snippet}

{#snippet removeButton(kind: "stock" | "wishlist" | "riven", id: string, name: string)}
  <button
    type="button"
    class="ls-remove"
    title={$t("liveScraper.listings.removeHint")}
    aria-label={$t("liveScraper.listings.removeHint")}
    onclick={() => onRemove(kind, id, name)}>&times;</button
  >
{/snippet}

{#snippet noMatches()}
  <p class="ls-empty" data-ls-no-matches>
    {$t("liveScraper.listings.noMatches", { query: query.trim() })}
  </p>
{/snippet}

{#snippet statusBadge(status: AnyStatus)}
  <span class="ls-status" data-tone={TONES[status]}
    >{$t(`liveScraper.listings.status.${status}`)}</span
  >
{/snippet}

<section
  class="overflow-hidden rounded-lg border border-border bg-bg-deep"
  data-live-scraper-listings
>
  <div class="tab-bar px-3 pt-2">
    {#each TABS as entry (entry)}
      <button
        type="button"
        class="tab-item"
        class:active={$tab === entry}
        data-live-scraper-listings-tab={entry}
        onclick={() => tab.set(entry)}
      >
        {$t(`liveScraper.listings.tabs.${entry}`)} ({counts[entry]})
      </button>
    {/each}
    <span class="ls-tools">
      {#if selection.selected.size > 0}
        <span class="ls-selected-count" data-ls-selected-count>
          {$t("liveScraper.listings.selectedCount", { count: selection.selected.size })}
        </span>
      {/if}
      <input
        type="search"
        class="ls-search"
        data-ls-search
        placeholder={$t("liveScraper.listings.searchPlaceholder")}
        aria-label={$t("liveScraper.listings.searchPlaceholder")}
        bind:value={query}
      />
    </span>
  </div>

  <div class="ls-scroll">
    {#if $tab === "wtb"}
      {#if wtbRows.length === 0}
        <p class="ls-empty">{$t("liveScraper.listings.emptyWtb")}</p>
      {:else if shownWtb.length === 0}
        {@render noMatches()}
      {:else}
        <table class="ls-table">
          <thead>
            <tr>
              <th>{$t("common.item")}</th>
              <th>{$t("liveScraper.listings.col.source")}</th>
              <th class="num">{$t("common.quantity")}</th>
              <th class="num">{$t("liveScraper.listings.col.maxPrice")}</th>
              <th class="num">{$t("liveScraper.listings.col.listPrice")}</th>
              <th class="num">{$t("liveScraper.listings.col.potentialProfit")}</th>
              <th>{$t("liveScraper.listings.col.status")}</th>
              <th class="num">{$t("liveScraper.listings.col.updated")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each shownWtb as row (row.key)}
              {@const wish = row.wishlistId
                ? wishlist.find((w) => w.id === row.wishlistId)
                : undefined}
              <tr
                data-tone={TONES[row.status]}
                data-ls-row={row.key}
                class:selected={selection.selected.has(row.key)}
                aria-selected={selection.selected.has(row.key)}
                onclick={(e) => onRowClick(e, row.key)}
                onmousedown={onRowMouseDown}
                oncontextmenu={(e) =>
                  openMenu(
                    e,
                    row.key,
                    wish ? { kind: "wishlist", item: wish } : { kind: "scan", row },
                  )}
              >
                <td class="name">
                  {row.itemName}{#if row.rank != null}<span class="ls-sub"> R{row.rank}</span>{/if}
                </td>
                <td class="ls-sub">{$t(`liveScraper.listings.source.${row.source}`)}</td>
                <td class="num">{row.quantity}</td>
                <td class="num">
                  {#if row.wishlistId}
                    {@render priceCell(row.key, row.maxPrice, setWishlistMaxPrice(row.wishlistId))}
                  {:else if row.scanWfmId}
                    {@render priceCell(row.key, row.maxPrice, setScanMaxPrice(row.scanWfmId))}
                  {/if}
                </td>
                <td class="num strong">{plat(row.listPrice)}</td>
                <td
                  class="num"
                  class:pos={(row.potentialProfit ?? 0) > 0}
                  class:neg={(row.potentialProfit ?? 0) < 0}
                >
                  {plat(row.potentialProfit)}
                </td>
                <td>{@render statusBadge(row.status)}</td>
                <td class="num ls-sub">{timeOf(row.updatedAt)}</td>
                <td class="num">
                  {#if row.wishlistId}{@render removeButton(
                      "wishlist",
                      row.wishlistId,
                      row.itemName,
                    )}{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if $tab === "wts"}
      {#if stock.length === 0}
        <p class="ls-empty">{$t("liveScraper.listings.emptyWts")}</p>
      {:else if shownStock.length === 0}
        {@render noMatches()}
      {:else}
        <table class="ls-table">
          <thead>
            <tr>
              <th>{$t("common.item")}</th>
              <th class="num">{$t("liveScraper.listings.col.bought")}</th>
              <th class="num">{$t("liveScraper.listings.col.minPrice")}</th>
              <th class="num">{$t("liveScraper.listings.col.listPrice")}</th>
              <th class="num">{$t("liveScraper.listings.col.profit")}</th>
              <th class="num">{$t("liveScraper.listings.col.owned")}</th>
              <th>{$t("liveScraper.listings.col.status")}</th>
              <th class="num">{$t("liveScraper.listings.col.updated")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each shownStock as item (item.id)}
              {@const p = profit(item.listPrice, item.bought)}
              <tr
                data-tone={TONES[item.status]}
                data-ls-row={item.id}
                class:selected={selection.selected.has(item.id)}
                aria-selected={selection.selected.has(item.id)}
                onclick={(e) => onRowClick(e, item.id)}
                onmousedown={onRowMouseDown}
                oncontextmenu={(e) => openMenu(e, item.id, { kind: "stock", item })}
              >
                <td class="name">
                  {item.itemName}{#if typeof item.subType?.rank === "number"}<span class="ls-sub">
                      R{item.subType.rank}</span
                    >{/if}
                  {#if item.adopted}
                    <span class="ls-adopted" title={$t("liveScraper.listings.adoptedHint")}
                      >{$t("liveScraper.listings.adopted")}</span
                    >
                  {/if}
                </td>
                <td class="num">{plat(item.bought)}</td>
                <td class="num"
                  >{@render priceCell(`i:${item.id}`, item.minPrice, setStockMinPrice(item.id))}</td
                >
                <td class="num strong">{plat(item.listPrice)}</td>
                <td class="num" class:pos={(p ?? 0) > 0} class:neg={(p ?? 0) < 0}>{plat(p)}</td>
                <td class="num">{item.owned}</td>
                <td>{@render statusBadge(item.status)}</td>
                <td class="num ls-sub">{timeOf(item.updatedAt)}</td>
                <td class="num">{@render removeButton("stock", item.id, item.itemName)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if stockRivens.length === 0}
      <p class="ls-empty">{$t("liveScraper.listings.emptyRivens")}</p>
    {:else if shownRivens.length === 0}
      {@render noMatches()}
    {:else}
      <table class="ls-table">
        <thead>
          <tr>
            <th>{$t("liveScraper.listings.col.riven")}</th>
            <th>{$t("liveScraper.listings.col.attributes")}</th>
            <th class="num">{$t("liveScraper.listings.col.mastery")}</th>
            <th class="num">{$t("liveScraper.listings.col.rerolls")}</th>
            <th class="num">{$t("liveScraper.listings.col.bought")}</th>
            <th class="num">{$t("liveScraper.listings.col.minPrice")}</th>
            <th class="num">{$t("liveScraper.listings.col.listPrice")}</th>
            <th class="num">{$t("liveScraper.listings.col.profit")}</th>
            <th>{$t("liveScraper.listings.col.status")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each shownRivens as riven (riven.id)}
            {@const p = profit(riven.listPrice, riven.bought)}
            <tr
              data-tone={TONES[riven.status]}
              data-ls-row={riven.id}
              class:selected={selection.selected.has(riven.id)}
              aria-selected={selection.selected.has(riven.id)}
              onclick={(e) => onRowClick(e, riven.id)}
              onmousedown={onRowMouseDown}
              oncontextmenu={(e) => openMenu(e, riven.id, { kind: "riven", riven })}
            >
              <td class="name">
                {riven.weaponName} <span class="ls-sub">{riven.rivenName}</span>
                {#if riven.adopted}
                  <span class="ls-adopted" title={$t("liveScraper.listings.adoptedHint")}
                    >{$t("liveScraper.listings.adopted")}</span
                  >
                {/if}
              </td>
              <td class="ls-sub attrs" title={statSummary(riven)}>{statSummary(riven)}</td>
              <td class="num">{riven.masteryReq}</td>
              <td class="num">{riven.rerolls}</td>
              <td class="num">{plat(riven.bought)}</td>
              <td class="num"
                >{@render priceCell(
                  `r:${riven.id}`,
                  riven.minPrice,
                  setRivenMinPrice(riven.id),
                )}</td
              >
              <td class="num strong">{plat(riven.listPrice)}</td>
              <td class="num" class:pos={(p ?? 0) > 0} class:neg={(p ?? 0) < 0}>{plat(p)}</td>
              <td>{@render statusBadge(riven.status)}</td>
              <td class="num">{@render removeButton("riven", riven.id, riven.rivenName)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if hiddenRows > 0}
      <p class="ls-more" data-ls-more-rows>
        {$t("liveScraper.listings.moreRows", { count: hiddenRows })}
      </p>
    {/if}
  </div>
</section>

{#if menu}
  <div
    class="ls-menu"
    style="left: {menu.x}px; top: {menu.y}px"
    role="menu"
    tabindex="-1"
    data-ls-menu
  >
    {#each menuItemsFor(menu.target) as item (item.id)}
      <button
        type="button"
        class="ls-menu-item"
        class:danger={item.danger}
        class:separated={item.separated}
        role="menuitem"
        data-ls-menu-item={item.id}
        onclick={() => runItem(item)}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}

{#if editor}
  <form
    class="ls-editor"
    style="left: {editor.x}px; top: {editor.y}px"
    data-ls-editor
    novalidate
    onsubmit={(e) => {
      e.preventDefault();
      confirmEditor();
    }}
  >
    <div class="ls-editor-title">{editor.title}</div>
    <label class="ls-editor-label" for="ls-editor-input">{editor.label}</label>
    <input
      id="ls-editor-input"
      class="ls-editor-input"
      type="number"
      min={editor.min}
      step="1"
      bind:value={editorDraft}
      use:focusSelect
    />
    <div class="ls-editor-actions">
      {#if editor.clearable}
        <button
          type="button"
          class="btn-secondary btn-sm"
          data-ls-editor-clear
          onclick={clearEditor}
        >
          {$t("liveScraper.listings.menu.clearValue")}
        </button>
      {/if}
      <span class="flex-1"></span>
      <button type="button" class="btn-secondary btn-sm" onclick={() => (editor = null)}>
        {$t("common.cancel")}
      </button>
      <button type="submit" class="btn-primary btn-sm" data-ls-editor-ok
        >{$t("common.confirm")}</button
      >
    </div>
  </form>
{/if}

{#if statsFor}
  <MarketStatsModal slug={statsFor.slug} title={statsFor.title} onClose={() => (statsFor = null)} />
{/if}

<style>
  .ls-scroll {
    max-height: 26rem;
    min-height: 9rem;
    overflow: auto;
  }
  .ls-more {
    margin: 0;
    padding: 0.6rem 1rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .ls-empty {
    margin: 0;
    padding: 3rem 1rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .ls-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
  }
  .ls-table th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-deep);
    padding: 0.5rem 0.75rem;
    text-align: left;
    font-weight: 600;
    white-space: nowrap;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border);
  }
  .ls-table td {
    padding: 0.4rem 0.75rem;
    white-space: nowrap;
    color: var(--text-primary);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .ls-table tbody tr {
    box-shadow: inset 3px 0 0 var(--ls-tone, transparent);
    transition: background-color 0.12s ease;
  }
  .ls-table tbody tr:hover {
    background: var(--bg-hover);
  }
  .ls-table tbody tr.selected {
    background: var(--accent-glow);
    box-shadow:
      inset 3px 0 0 var(--ls-tone, transparent),
      inset 0 0 0 1px var(--accent-dim);
  }
  .ls-tools {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 0.35rem;
  }
  .ls-selected-count {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .ls-search {
    width: 14rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: transparent;
    padding: 0.3rem 0.5rem;
    font-size: 0.75rem;
    color: var(--text-primary);
  }
  .ls-search:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  .ls-table .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .ls-table .strong {
    font-weight: 600;
  }
  .ls-table .name {
    max-width: 22rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ls-table .attrs {
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ls-table .ls-sub,
  .ls-sub {
    color: var(--text-muted);
  }
  .pos {
    color: var(--success);
  }
  .neg {
    color: var(--danger);
  }
  [data-tone="good"] {
    --ls-tone: var(--success);
  }
  [data-tone="warn"] {
    --ls-tone: var(--warning);
  }
  [data-tone="bad"] {
    --ls-tone: var(--danger);
  }
  [data-tone="muted"] {
    --ls-tone: var(--text-muted);
  }
  .ls-price {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .ls-price-value {
    min-width: 2.75rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    background: transparent;
    padding: 0.1rem 0.35rem;
    text-align: right;
    font: inherit;
    font-variant-numeric: tabular-nums;
    color: inherit;
    cursor: text;
    transition: border-color 0.12s ease;
  }
  .ls-price-value:hover {
    border-color: var(--border-strong);
  }
  .ls-price-input {
    width: 4rem;
    border: 1px solid var(--view-accent, var(--border-strong));
    border-radius: 0.25rem;
    background: var(--bg-deep);
    padding: 0.1rem 0.35rem;
    text-align: right;
    font: inherit;
    color: var(--text-primary);
    outline: none;
  }
  .ls-steps {
    display: inline-flex;
    gap: 0.15rem;
    opacity: 0.7;
    transition: opacity 0.12s ease;
  }
  tr:hover .ls-steps,
  .ls-steps:focus-within {
    opacity: 1;
  }
  .ls-step {
    border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
    border-radius: 0.25rem;
    background: transparent;
    padding: 0 0.3rem;
    font-size: 0.6875rem;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
    color: var(--success);
    transition: background-color 0.12s ease;
  }
  .ls-step.down {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    color: var(--danger);
  }
  .ls-step:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 15%, transparent);
  }
  .ls-step:disabled {
    opacity: 0.3;
  }
  .ls-menu {
    position: fixed;
    z-index: 60;
    min-width: 13rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-tooltip, var(--bg-deep));
    padding: 0.25rem 0;
    box-shadow: var(--ui-panel-shadow);
  }
  .ls-menu-item {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    padding: 0.375rem 0.75rem;
    text-align: left;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .ls-menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .ls-menu-item.separated {
    margin-top: 0.25rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .ls-menu-item.danger {
    color: var(--danger);
  }
  .ls-editor {
    position: fixed;
    z-index: 61;
    width: 16.25rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    background: var(--surface-tooltip, var(--bg-deep));
    padding: 0.75rem;
    box-shadow: var(--ui-panel-shadow);
  }
  .ls-editor-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .ls-editor-label {
    display: block;
    margin: 0.5rem 0 0.25rem;
    font-size: 0.6875rem;
    color: var(--text-secondary);
  }
  .ls-editor-input {
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: 0.375rem;
    background: var(--bg-deep);
    padding: 0.35rem 0.5rem;
    font: inherit;
    font-size: 0.875rem;
    color: var(--text-primary);
    outline: none;
  }
  .ls-editor-input:focus {
    border-color: var(--view-accent, var(--accent));
  }
  .ls-editor-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.625rem;
  }
  .ls-remove {
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    padding: 0 0.4rem;
    font-size: 1rem;
    line-height: 1.2;
    color: var(--text-muted);
    transition:
      color 0.12s ease,
      background-color 0.12s ease;
  }
  .ls-remove:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .ls-adopted {
    margin-left: 0.35rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.25rem;
    padding: 0 0.3rem;
    font-size: 0.625rem;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }
  .ls-status {
    display: inline-block;
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    font-size: 0.6875rem;
    color: var(--ls-tone);
    background: color-mix(in srgb, var(--ls-tone) 14%, transparent);
  }
</style>
