<script lang="ts">
  import { tr } from "../lib/i18n.js";
  import { send } from "../lib/ipc.js";
  import type { ViewName } from "../types/views.js";

  let { page }: { page?: Extract<ViewName, "setup" | "inventory"> } = $props();

  const url = $derived(
    `https://github.com/Raddne/PlatHelper/blob/main/docs/features/${
      page === "setup" ? "getting-started" : (page ?? "README")
    }.md`,
  );
  const label = $derived(
    page
      ? $tr("common.pageHelp", {
          page: $tr(page === "inventory" ? "common.inventory" : "nav.setup"),
        })
      : $tr("common.documentation"),
  );
</script>

<button
  type="button"
  class={page
    ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-text-muted hover:border-border-strong hover:text-text-primary"
    : "cursor-pointer text-sm text-accent hover:underline"}
  data-docs-link={page ?? "overview"}
  title={label}
  aria-label={label}
  onclick={() => send("open-external", url)}
>
  {#if page}<span aria-hidden="true">?</span>{:else}{label}{/if}
</button>
