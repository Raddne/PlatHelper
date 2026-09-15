<script lang="ts">
  export let as: "div" | "label" = "div";
  export let density: "default" | "tight" = "default";

  $: padClass = density === "tight" ? "py-2 px-2" : "py-2 px-2.5";
  $: baseClass = `border border-[var(--ui-control-border)] rounded-[var(--radius-lg)] bg-[var(--ui-control-bg)] ${padClass}`;
</script>

{#if as === "label"}
  <!-- min-w-0: as a grid item the card would otherwise widen its column to the
       control row's own width instead of letting the row shrink. -->
  <label
    class="flex min-w-0 flex-wrap items-center justify-between gap-2.5 cursor-pointer {baseClass}"
  >
    <slot />
  </label>
{:else}
  <div class={baseClass}>
    <slot />
  </div>
{/if}

<style>
  /* The text column shrinks to a floor and the control then drops to its own
     line. Without the floor a raised font scale squeezes the label to a word
     per line and pushes the control out of the card. */
  label > :global(:first-child) {
    flex: 1 1 5rem;
  }
  /* The control column shrinks with the card: its own min-content would
     otherwise push the card past the column it sits in. */
  label > :global(:last-child) {
    min-width: 0;
  }
</style>
