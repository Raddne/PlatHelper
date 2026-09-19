<script lang="ts">
  import { untrack } from "svelte";
  import { get } from "svelte/store";

  import ModalShell from "../components/ModalShell.svelte";
  import { tr } from "../lib/i18n.js";
  import { createListDrag } from "../lib/listDrag.js";
  import { moveIndex } from "../lib/listOrder.js";
  import { TOGGLEABLE_VIEWS, VIEW_LABEL_KEYS } from "../lib/viewRegistry.js";
  import type { ToggleableView } from "../types/views.js";
  import {
    createPreset,
    findPreset,
    updatePreset,
    PRESET_NAME_MAX,
    type SidebarPreset,
  } from "../stores/sidebarPresets.js";

  let { presetId, onClose }: { presetId?: string | undefined; onClose: () => void } = $props();

  // Deliberately a one-time read: the wizard seeds its own editable draft from
  // whatever preset it opened with and never gets a different presetId mid-life
  // (editing a different preset mounts a fresh instance instead). untrack keeps
  // that intent explicit instead of tripping the "looks stale" lint warning.
  const editing: SidebarPreset | null = untrack(() => (presetId ? findPreset(presetId) : null));

  let step = $state<1 | 2 | 3>(1);
  let checked = $state<Record<ToggleableView, boolean>>(
    Object.fromEntries(
      TOGGLEABLE_VIEWS.map((view) => [view, (editing?.order ?? TOGGLEABLE_VIEWS).includes(view)]),
    ) as Record<ToggleableView, boolean>,
  );
  let order = $state<ToggleableView[]>([...(editing?.order ?? TOGGLEABLE_VIEWS)]);
  let name = $state(editing?.name ?? "");

  const canSave = $derived(name.trim().length > 0);

  // Kept functions stay put; a function checked for the first time this pass
  // (never part of the incoming order) is appended, alphabetically among
  // itself, so it lands under every already-placed row - and under Settings,
  // the fixed last row the order list never shows as draggable.
  function goToOrder(): void {
    const translate = get(tr);
    const stillChecked = TOGGLEABLE_VIEWS.filter((view) => checked[view]);
    const kept = order.filter((view) => checked[view]);
    const added = stillChecked
      .filter((view) => !kept.includes(view))
      .sort((a, b) => translate(VIEW_LABEL_KEYS[a]).localeCompare(translate(VIEW_LABEL_KEYS[b])));
    order = [...kept, ...added];
    step = 2;
  }

  const orderDrag = createListDrag({
    rowSelector: "[data-preset-order-row]",
    indexKey: "presetOrderIndex",
    move(from, to) {
      order = moveIndex(order, from, to);
    },
  });

  function save(): void {
    if (!canSave) return;
    if (editing) updatePreset(editing.id, name, order);
    else createPreset(name, order);
    onClose();
  }
</script>

<ModalShell
  ariaLabel={$tr(editing ? "presets.wizard.editTitle" : "presets.wizard.createTitle")}
  {onClose}
>
  <section
    data-preset-wizard
    class="relative z-[1] flex max-h-[85vh] w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-surface"
  >
    <header class="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <h2 class="m-0 font-display text-lg font-semibold text-text-primary">
          {$tr(editing ? "presets.wizard.editTitle" : "presets.wizard.createTitle")}
        </h2>
        <p class="m-0 mt-0.5 text-xs text-text-muted">
          {$tr("presets.wizard.stepIndicator", {
            current: step,
            total: 3,
            label: $tr(
              step === 1
                ? "presets.wizard.stepFunctions"
                : step === 2
                  ? "presets.wizard.stepOrder"
                  : "presets.wizard.stepName",
            ),
          })}
        </p>
      </div>
      <button type="button" class="btn-secondary btn-sm" data-preset-wizard-close onclick={onClose}>
        {$tr("common.close")}
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-5">
      {#if step === 1}
        <p class="m-0 mb-3 text-xs text-text-secondary">{$tr("presets.wizard.functionsHint")}</p>
        <div class="grid gap-1" data-preset-functions-list>
          {#each TOGGLEABLE_VIEWS as view (view)}
            <label
              class="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-text-primary hover:bg-bg-hover"
            >
              <input type="checkbox" data-preset-function={view} bind:checked={checked[view]} />
              {$tr(VIEW_LABEL_KEYS[view])}
            </label>
          {/each}
        </div>
      {:else if step === 2}
        <p class="m-0 mb-3 text-xs text-text-secondary">{$tr("presets.wizard.orderHint")}</p>
        <div class="grid gap-1" data-preset-order-list>
          <div class="preset-order-row preset-order-pinned">
            <span class="preset-order-label">{$tr(VIEW_LABEL_KEYS.inventory)}</span>
          </div>
          {#each order as view, index (view)}
            <div
              class="preset-order-row"
              data-preset-order-row={view}
              data-preset-order-index={index}
            >
              <button
                type="button"
                class="preset-order-handle"
                data-preset-order-handle={view}
                aria-label={$tr("settings.tabOrderHandle", { tab: $tr(VIEW_LABEL_KEYS[view]) })}
                onpointerdown={(e) => orderDrag.onPointerDown(index, e)}
                onkeydown={(e) => orderDrag.onKeyDown(index, e)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
              <span class="preset-order-label truncate">{$tr(VIEW_LABEL_KEYS[view])}</span>
            </div>
          {/each}
          <div class="preset-order-row preset-order-pinned">
            <span class="preset-order-label">{$tr(VIEW_LABEL_KEYS.settings)}</span>
          </div>
        </div>
      {:else}
        <label class="grid gap-1.5" for="preset-name">
          <span class="text-sm text-text-secondary">{$tr("presets.wizard.nameLabel")}</span>
          <input
            id="preset-name"
            type="text"
            data-preset-name
            class="w-full rounded-md border border-border bg-bg-deep px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            maxlength={PRESET_NAME_MAX}
            bind:value={name}
            placeholder={$tr("presets.wizard.namePlaceholder")}
          />
        </label>
      {/if}
    </div>

    <footer class="flex items-center justify-between gap-2 border-t border-border px-5 py-4">
      <button
        type="button"
        class="btn-secondary btn-sm"
        data-preset-wizard-cancel
        onclick={onClose}
      >
        {$tr("common.cancel")}
      </button>
      <div class="flex gap-2">
        {#if step > 1}
          <button
            type="button"
            class="btn-secondary btn-sm"
            data-preset-wizard-back
            onclick={() => (step = (step - 1) as 1 | 2)}
          >
            {$tr("presets.wizard.back")}
          </button>
        {/if}
        {#if step === 1}
          <button
            type="button"
            class="btn-primary btn-sm"
            data-preset-wizard-next
            onclick={goToOrder}
          >
            {$tr("presets.wizard.next")}
          </button>
        {:else if step === 2}
          <button
            type="button"
            class="btn-primary btn-sm"
            data-preset-wizard-next
            onclick={() => (step = 3)}
          >
            {$tr("presets.wizard.next")}
          </button>
        {:else}
          <button
            type="button"
            class="btn-primary btn-sm"
            data-preset-wizard-save
            disabled={!canSave}
            onclick={save}
          >
            {$tr("common.save")}
          </button>
        {/if}
      </div>
    </footer>
  </section>
</ModalShell>

<style>
  .preset-order-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    border-radius: var(--radius-md);
    padding: 0.24rem 0.45rem;
    margin: 0 -0.45rem;
  }
  .preset-order-row:not(.preset-order-pinned):hover {
    background: var(--bg-hover);
  }
  .preset-order-pinned {
    color: var(--text-muted);
    font-style: italic;
  }
  .preset-order-label {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
  }
  .preset-order-pinned .preset-order-label {
    color: inherit;
    font-weight: 400;
  }
  .preset-order-handle {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .preset-order-handle:hover,
  .preset-order-handle:focus-visible {
    color: var(--accent);
  }
  .preset-order-handle:active {
    cursor: grabbing;
  }
  .preset-order-handle svg {
    width: 1rem;
    height: 1rem;
    fill: none;
  }
</style>
