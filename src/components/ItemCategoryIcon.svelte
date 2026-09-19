<script lang="ts">
  import type { ItemCategory } from "../lib/itemCategory.js";

  let { category, size = 20 }: { category: ItemCategory; size?: number } = $props();
</script>

{#if category === "arcane"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2 L12 8 L18 10 L12 12 L10 18 L8 12 L2 10 L8 8 Z" />
  </svg>
{:else if category === "mod"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2 L17 6 V14 L10 18 L3 14 V6 Z" />
    <circle cx="10" cy="10" r="2.2" />
  </svg>
{:else if category === "primePart"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2 L16 8 L10 18 L4 8 Z" />
    <path d="M4 8 H16" />
  </svg>
{:else if category === "weaponPart"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    aria-hidden="true"
  >
    <circle cx="10" cy="10" r="4.5" />
    <path
      d="M10 2 V5 M10 15 V18 M2 10 H5 M15 10 H18 M4.5 4.5 L6.6 6.6 M13.4 13.4 L15.5 15.5 M15.5 4.5 L13.4 6.6 M6.6 13.4 L4.5 15.5"
    />
  </svg>
{:else}
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2 L18 6 V14 L10 18 L2 14 V6 Z" />
    <path d="M2 6 L10 10 L18 6 M10 10 V18" />
  </svg>
{/if}
