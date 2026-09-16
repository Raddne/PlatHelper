<script lang="ts">
  import { themeSettings } from "../../stores/theme.js";
  import { tr } from "../../lib/i18n.js";
  import { OVERLAY_OPACITY_MAX, OVERLAY_OPACITY_MIN } from "../../config/themeDefaults.js";

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
