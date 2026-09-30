<script lang="ts">
  import ModalShell from "../components/ModalShell.svelte";
  import { tr, type MessageKey } from "../lib/i18n.js";
  import { confirmWithDialog } from "../lib/ipc.js";
  import {
    activePresetId,
    applyPreset,
    deletePreset,
    presets,
    ALL_PRESET_ID,
    DEFAULT_PRESET_ID,
  } from "../stores/sidebarPresets.js";
  import PresetWizardModal from "./PresetWizardModal.svelte";

  let { onClose }: { onClose: () => void } = $props();

  // Listed above the user presets; they can be applied but not edited or deleted.
  const BUILT_IN_ROWS: ReadonlyArray<{ id: string; labelKey: MessageKey }> = [
    { id: DEFAULT_PRESET_ID, labelKey: "presets.manager.defaultName" },
    { id: ALL_PRESET_ID, labelKey: "presets.manager.allName" },
  ];

  let wizardOpen = $state(false);
  let editingId = $state<string | undefined>(undefined);

  function openCreate(): void {
    editingId = undefined;
    wizardOpen = true;
  }

  function openEdit(id: string): void {
    editingId = id;
    wizardOpen = true;
  }

  function closeWizard(): void {
    wizardOpen = false;
    editingId = undefined;
  }

  async function remove(id: string, name: string): Promise<void> {
    const confirmed = await confirmWithDialog($tr("presets.manager.deleteConfirm", { name }), $tr);
    if (confirmed) deletePreset(id);
  }
</script>

<ModalShell ariaLabel={$tr("presets.manager.title")} {onClose}>
  <section
    data-preset-manager
    class="relative z-[1] flex max-h-[80vh] w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-surface"
  >
    <header class="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
      <h2 class="m-0 font-display text-lg font-semibold text-text-primary">
        {$tr("presets.manager.title")}
      </h2>
      <button
        type="button"
        class="btn-secondary btn-sm"
        data-preset-manager-close
        onclick={onClose}
      >
        {$tr("common.close")}
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-5">
      <p class="m-0 mb-3 text-xs text-text-secondary">{$tr("presets.manager.description")}</p>

      <ul class="m-0 grid list-none gap-1.5 p-0">
        {#each BUILT_IN_ROWS as builtIn (builtIn.id)}
          <li
            class="flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-2 py-1.5"
            data-preset-row={builtIn.id}
          >
            <span class="min-w-0 flex-1 truncate text-sm text-text-primary">
              {$tr(builtIn.labelKey)}
            </span>
            {#if $activePresetId === builtIn.id}
              <span
                class="rounded border border-accent px-1.5 py-0.5 text-[0.65rem] text-accent"
                data-preset-active
              >
                {$tr("presets.manager.active")}
              </span>
            {/if}
            <button
              type="button"
              class="btn-secondary btn-sm"
              data-preset-apply={builtIn.id}
              disabled={$activePresetId === builtIn.id}
              onclick={() => applyPreset(builtIn.id)}
            >
              {$tr("presets.manager.apply")}
            </button>
          </li>
        {/each}

        {#each $presets as preset (preset.id)}
          <li
            class="flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-2 py-1.5"
            data-preset-row={preset.id}
          >
            <span class="min-w-0 flex-1 truncate text-sm text-text-primary" title={preset.name}>
              {preset.name}
            </span>
            {#if $activePresetId === preset.id}
              <span
                class="rounded border border-accent px-1.5 py-0.5 text-[0.65rem] text-accent"
                data-preset-active
              >
                {$tr("presets.manager.active")}
              </span>
            {/if}
            <button
              type="button"
              class="btn-secondary btn-sm"
              data-preset-apply={preset.id}
              disabled={$activePresetId === preset.id}
              onclick={() => applyPreset(preset.id)}
            >
              {$tr("presets.manager.apply")}
            </button>
            <button
              type="button"
              class="btn-secondary btn-sm"
              data-preset-edit={preset.id}
              onclick={() => openEdit(preset.id)}
            >
              {$tr("presets.manager.edit")}
            </button>
            <button
              type="button"
              class="btn-secondary btn-sm"
              data-preset-delete={preset.id}
              onclick={() => remove(preset.id, preset.name)}
            >
              {$tr("common.delete")}
            </button>
          </li>
        {:else}
          <li class="text-xs text-text-muted" data-preset-empty>{$tr("presets.manager.empty")}</li>
        {/each}
      </ul>
    </div>

    <footer class="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
      <button type="button" class="btn-primary btn-sm" data-preset-new onclick={openCreate}>
        {$tr("presets.manager.newPreset")}
      </button>
    </footer>
  </section>
</ModalShell>

{#if wizardOpen}
  <PresetWizardModal presetId={editingId} onClose={closeWizard} />
{/if}
