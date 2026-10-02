<script lang="ts">
  // A riven's rating against the roll sheet; nothing for an unrated riven.
  import { tr } from "../lib/i18n.js";
  import { SHEET_RATING_KEYS, SHEET_RATING_TONES } from "../lib/rivens/sheetRating.js";
  import type { SheetRating } from "../../config/shared/rivenRollSheet.js";

  interface Props {
    rating: SheetRating | null;
    class?: string;
  }

  let { rating, class: className = "" }: Props = $props();
</script>

{#if rating}
  <span
    class="{className} {SHEET_RATING_TONES[rating]}"
    title={$tr("rivens.sheetRating.label")}
    data-riven-sheet-rating={rating}>{$tr(SHEET_RATING_KEYS[rating])}</span
  >
{/if}
