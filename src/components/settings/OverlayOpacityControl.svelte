<script lang="ts">
  import { themeSettings } from "../../stores/theme.js";
  import { tr } from "../../lib/i18n.js";
  import { OVERLAY_OPACITY_MAX, OVERLAY_OPACITY_MIN } from "../../config/themeDefaults.js";
  import {
    getOverlayDescriptor,
    OVERLAY_LAYOUT_KINDS,
  } from "../../../config/shared/overlayLayout.js";

  const opacityPercent = $derived(Math.round($themeSettings.effects.overlayOpacity * 100));
</script>

<label
  class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5"
  data-overlay-opacity-control
>
  <span class="min-w-0 flex-[1_1_5rem] text-text-secondary text-xs font-medium">
    {$tr("appearance.overlayOpacity")}
    <span class="block text-xs text-text-muted font-normal mt-0.5"
      >{$tr("appearance.overlayOpacityHint")}</span
    >
  </span>
  <span class="flex min-w-0 flex-[1_1_8rem] items-center gap-2">
    <input
      type="range"
      min={OVERLAY_OPACITY_MIN * 100}
      max={OVERLAY_OPACITY_MAX * 100}
      step="1"
      class="w-full accent-accent"
      aria-label={$tr("appearance.overlayOpacity")}
      value={opacityPercent}
      oninput={(event) =>
        themeSettings.setEffects({ overlayOpacity: event.currentTarget.valueAsNumber / 100 })}
    />
    <span class="w-10 shrink-0 text-right text-xs text-text-primary tabular-nums"
      >{opacityPercent}%</span
    >
  </span>
</label>

<details class="mt-2 text-xs" data-overlay-opacity-overrides>
  <summary class="cursor-pointer text-text-secondary"
    >{$tr("appearance.overlayOpacityCustomize")}</summary
  >
  <div class="mt-2 space-y-3">
    {#each OVERLAY_LAYOUT_KINDS as kind (kind)}
      {@const override = $themeSettings.effects.overlayOpacityOverrides?.[kind]}
      {@const percent = Math.round((override ?? $themeSettings.effects.overlayOpacity) * 100)}
      <div data-overlay-opacity-kind={kind} class="space-y-1">
        <div class="flex flex-wrap items-center justify-between gap-1">
          <label for={`overlay-opacity-${kind}`} class="text-text-secondary">
            {$tr(getOverlayDescriptor(kind).titleKey)}
          </label>
          <button
            type="button"
            class="text-text-muted hover:text-text-primary disabled:cursor-default disabled:hover:text-text-muted"
            disabled={override === undefined}
            onclick={() => themeSettings.setOverlayOpacity(kind, null)}
            >{$tr(
              override === undefined
                ? "appearance.overlayOpacityInherited"
                : "appearance.overlayOpacityUseGlobal",
            )}</button
          >
        </div>
        <div class="flex items-center gap-2">
          <input
            id={`overlay-opacity-${kind}`}
            type="range"
            min={OVERLAY_OPACITY_MIN * 100}
            max={OVERLAY_OPACITY_MAX * 100}
            step="1"
            class="min-w-0 w-full accent-accent"
            value={percent}
            oninput={(event) =>
              themeSettings.setOverlayOpacity(kind, event.currentTarget.valueAsNumber / 100)}
          />
          <span class="w-10 shrink-0 text-right text-text-primary tabular-nums">{percent}%</span>
        </div>
      </div>
    {/each}
  </div>
</details>
