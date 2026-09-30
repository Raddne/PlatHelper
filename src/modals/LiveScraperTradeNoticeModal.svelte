<script lang="ts">
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import ModalShell from "../components/ModalShell.svelte";
  // Aliased: a store named tr would make every <tr> below ambiguous.
  import { tr as t } from "../lib/i18n.js";
  import { invoke, on } from "../lib/ipc.js";
  import type { TradeSyncNotice } from "../../config/shared/liveScraperTradeSync.js";

  // The main process keeps every notice until it is acknowledged, so one raised
  // while this window was hidden, or before a restart, still shows here. Several
  // show one after the other, oldest first.
  let notices = $state<TradeSyncNotice[]>([]);
  let current = $derived(notices[0] ?? null);
  // A fetch that was already under way when "Got it" was pressed must not
  // bring that notice back.
  const acknowledged = new SvelteSet<string>();
  let gotItButton = $state<HTMLButtonElement | null>(null);

  async function load(): Promise<void> {
    try {
      const queued = await invoke("liveScraperTradeNotices");
      notices = queued.filter((notice) => !acknowledged.has(notice.id));
    } catch {
      // The next push or start-up fetch tries again.
    }
  }

  async function acknowledge(): Promise<void> {
    const notice = current;
    if (!notice) return;
    acknowledged.add(notice.id);
    notices = notices.filter((entry) => entry.id !== notice.id);
    try {
      await invoke("liveScraperTradeNoticeAck", notice.id);
    } catch {
      // Still queued in the main process, so it comes back after a restart.
    }
  }

  onMount(() => {
    void load();
    return on("live-scraper:trade-notice", () => void load());
  });
</script>

{#if current}
  {#key current.id}
    <ModalShell
      ariaLabel={$t("liveScraper.tradeNotice.title")}
      onClose={acknowledge}
      initialFocus={() => gotItButton}
    >
      <section
        data-live-scraper-trade-notice
        class="relative z-[1] flex max-h-[85vh] w-[480px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-surface"
      >
        <header class="border-b border-border px-5 py-4">
          <h2 class="m-0 font-display text-lg font-semibold text-text-primary">
            {$t("liveScraper.tradeNotice.title")}
          </h2>
        </header>

        <div class="grid min-h-0 flex-1 gap-3 overflow-y-auto p-5">
          <p class="m-0 text-sm text-text-secondary">
            {current.split === "market"
              ? $t("liveScraper.tradeNotice.splitMarket", { platinum: current.platinum })
              : $t("liveScraper.tradeNotice.splitEven", { platinum: current.platinum })}
          </p>
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="border-b border-border text-xs text-text-muted">
                <th class="py-1 pr-3 text-left font-medium">{$t("common.item")}</th>
                <th class="py-1 pr-3 text-right font-medium">{$t("common.quantity")}</th>
                <th class="py-1 text-right font-medium">
                  {$t("liveScraper.tradeNotice.boughtPerPiece")}
                </th>
              </tr>
            </thead>
            <tbody>
              {#each current.rows as row, index (index)}
                <tr class="border-b border-border text-text-primary">
                  <td class="py-1 pr-3">{row.name}</td>
                  <td class="py-1 pr-3 text-right tabular-nums">{row.quantity}</td>
                  <td class="py-1 text-right tabular-nums">{row.bought}p</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="m-0 text-xs text-text-muted">{$t("liveScraper.tradeNotice.correctHint")}</p>
        </div>

        <footer class="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            class="btn-primary btn-sm"
            data-live-scraper-trade-notice-ack
            bind:this={gotItButton}
            onclick={acknowledge}
          >
            {$t("liveScraper.tradeNotice.gotIt")}
          </button>
        </footer>
      </section>
    </ModalShell>
  {/key}
{/if}
