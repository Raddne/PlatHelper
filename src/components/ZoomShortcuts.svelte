<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "../../config/runtime/uiScale.js";
  import { loadUiScale, saveUiScale } from "../lib/uiScaleSetting.js";
  import { overlaySettings, overlaySettingsLoaded } from "../stores/overlaySettings.js";

  // Browser-style zoom on top of the existing App size setting: Ctrl+wheel and
  // Ctrl +/-/0 step the same persisted uiScale the settings slider edits, so
  // main re-zooms the window and the value survives a restart.
  let scale = 1;
  let badge: number | null = null;
  let badgeTimer: ReturnType<typeof setTimeout> | null = null;

  // The settings slider edits the same value; follow it so a step starts from there.
  $: if ($overlaySettingsLoaded) scale = clampStep($overlaySettings.uiScale);

  function clampStep(value: number): number {
    const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
    return Number((Math.round(clamped / UI_SCALE_STEP) * UI_SCALE_STEP).toFixed(2));
  }

  function setScale(next: number): void {
    const target = clampStep(next);
    badge = Math.round(target * 100);
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => (badge = null), 1200);
    if (target === scale) return;
    scale = target;
    void saveUiScale(target).catch(() => {});
  }

  function onWheel(e: WheelEvent): void {
    if (!e.ctrlKey || e.deltaY === 0) return;
    e.preventDefault();
    setScale(scale + (e.deltaY < 0 ? UI_SCALE_STEP : -UI_SCALE_STEP));
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "+" || e.key === "=") setScale(scale + UI_SCALE_STEP);
    else if (e.key === "-") setScale(scale - UI_SCALE_STEP);
    else if (e.key === "0") setScale(1);
    else return;
    e.preventDefault();
  }

  onMount(() => {
    void loadUiScale()
      .then((value) => (scale = clampStep(value)))
      .catch(() => {});
    // Non-passive, or preventDefault is ignored and the page scrolls as well.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      if (badgeTimer) clearTimeout(badgeTimer);
    };
  });
</script>

{#if badge != null}
  <div class="zoom-badge" data-zoom-badge transition:fade={{ duration: 120 }}>{badge}%</div>
{/if}

<style>
  .zoom-badge {
    position: fixed;
    top: 3rem;
    right: 1.25rem;
    z-index: 9999;
    pointer-events: none;
    border: 1px solid var(--border-strong);
    border-radius: 0.5rem;
    background: var(--bg-deep);
    padding: 0.35rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    box-shadow: var(--ui-panel-shadow);
  }
</style>
