<script lang="ts">
  // A riven's stats as chips, positives first: full chips name the stat; compact
  // ones show its trader code in one unwrapped line, the full name on hover.
  import {
    chipCode,
    chipName,
    chipValue,
    orderedChipStats,
    type ChipStat,
  } from "../lib/liveScraper/rivenStatChips.js";

  interface Props {
    stats: readonly ChipStat[];
    compact?: boolean;
  }

  let { stats, compact = false }: Props = $props();
</script>

<!-- Unkeyed: a stored riven can repeat a tag, and a repeated key throws. -->
{#if compact}
  <div class="flex min-w-0 flex-nowrap gap-1 overflow-hidden">
    {#each orderedChipStats(stats) as stat}
      <span
        class="inline-flex shrink-0 items-baseline gap-1 rounded bg-bg-raised px-1 text-xs leading-4 whitespace-nowrap"
        title={chipName(stat)}
        data-riven-stat={stat.positive ? "positive" : "negative"}
      >
        <span class="font-bold {stat.positive ? 'text-success' : 'text-danger'}"
          >{chipValue(stat)}</span
        >
        <span class="text-text-primary">{chipCode(stat)}</span>
      </span>
    {/each}
  </div>
{:else}
  <div class="flex flex-wrap gap-1.5">
    {#each orderedChipStats(stats) as stat}
      <span
        class="inline-flex items-baseline gap-1 rounded bg-bg-raised px-1.5 py-0.5 text-xs"
        data-riven-stat={stat.positive ? "positive" : "negative"}
      >
        <span class="font-bold {stat.positive ? 'text-success' : 'text-danger'}"
          >{chipValue(stat)}</span
        >
        <span class="text-text-primary">{chipName(stat)}</span>
      </span>
    {/each}
  </div>
{/if}
