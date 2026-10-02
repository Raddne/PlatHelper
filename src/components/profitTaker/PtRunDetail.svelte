<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { withUniqueKeys } from "../../lib/uniqueKeys.js";

  // Aliased: a store named `tr` makes svelte-check flag every <tr> row as a lowercase component.
  import { tr as t, type MessageKey, type Translator } from "../../lib/i18n.js";
  import { confirmWithDialog, invoke } from "../../lib/ipc.js";
  import { log } from "../../lib/log.js";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedPanel from "../ThemedPanel.svelte";
  import PtMetricCards from "./PtMetricCards.svelte";
  import { persistedString } from "../../lib/persistence.js";
  import type { PtLeg } from "../../../config/shared/profitTakerTypes.js";
  import type { PtRunRecord } from "../../types/ipc.js";
  import { deletePtRun, updatePtNotes, updatePtTags } from "../../stores/ptRuns.js";
  import { formatRunDate } from "../../lib/arbi/arbiChartData.js";
  import {
    formatPtTime,
    formatPtSeconds,
    ptPhaseRows,
    ptEligibleRuns,
    ptSquadSize,
    ptComparisonExclusionReason,
    PT_EXCLUSION_KEYS,
    ptComparison,
    PT_METRIC_KEYS,
    ptMetricValue,
    ptPersonalBest,
    PT_METRICS,
    type PtMetric,
  } from "../../lib/profitTakerStats.js";

  interface Props {
    run: PtRunRecord;
    onBack: () => void;
    /** Runs in the list's current filter order; drives previous/next. */
    orderedRuns?: PtRunRecord[];
    /** Every known run, for the personal-best pool. */
    allRuns?: PtRunRecord[];
    onNavigate?: (id: string) => void;
  }

  const { run, onBack, orderedRuns = [], allRuns = [], onNavigate = () => {} }: Props = $props();

  const ELEMENT_KEYS: Record<string, MessageKey | undefined> = {
    impact: "pt.element.impact",
    puncture: "pt.element.puncture",
    slash: "pt.element.slash",
    cold: "pt.element.cold",
    heat: "pt.element.heat",
    toxin: "pt.element.toxin",
    electric: "pt.element.electric",
    gas: "pt.element.gas",
    viral: "pt.element.viral",
    magnetic: "pt.element.magnetic",
    radiation: "pt.element.radiation",
    corrosive: "pt.element.corrosive",
    blast: "pt.element.blast",
  };

  const LEG_KEYS: Record<PtLeg, MessageKey> = {
    frontLeft: "pt.leg.frontLeft",
    frontRight: "pt.leg.frontRight",
    backLeft: "pt.leg.backLeft",
    backRight: "pt.leg.backRight",
  };

  const runIndex = $derived(orderedRuns.findIndex((entry) => entry.id === run.id));
  const prevRun = $derived(runIndex > 0 ? orderedRuns[runIndex - 1] : null);
  const nextRun = $derived(
    runIndex >= 0 && runIndex < orderedRuns.length - 1 ? orderedRuns[runIndex + 1] : null,
  );

  const pbRows = $derived(ptPersonalBest(run, allRuns));
  const totalPb = $derived(pbRows.find((row) => row.metric === "total") ?? null);
  const tags = $derived(run.tags ?? []);
  const players = $derived(
    (Array.isArray(run.players) ? run.players : []).filter(
      (name): name is string => typeof name === "string" && !!name.trim(),
    ),
  );
  const squadSize = $derived(ptSquadSize(run));
  const exclusion = $derived(ptComparisonExclusionReason(run));
  const phases = $derived(ptPhaseRows(run));
  const baselines = $derived(
    ptEligibleRuns(allRuns).filter(
      (entry) => entry.id !== run.id && ptSquadSize(entry) === squadSize,
    ),
  );
  let baselineId = $state("");
  const baseline = $derived(baselines.find((entry) => entry.id === baselineId) ?? null);
  const comparison = $derived(baseline ? ptComparison(run, baseline) : []);
  const phaseMetrics = ["shield", "leg", "body", "pylon"] as const;
  const phaseView = persistedString("pt-phase-view", ["cards", "table"] as const, "cards");
  $effect(() => {
    if (baselineId && !baselines.some((entry) => entry.id === baselineId)) baselineId = "";
  });

  function deltaLabel(pct: number): string {
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }

  /** PB chip under a stat card: better-than-second when it leads, else the gap. */
  function pbSubtext(t: Translator, metric: PtMetric): { text: string; good: boolean } | null {
    const row = pbRows.find((entry) => entry.metric === metric);
    if (!row || row.poolSize < 2) return null;
    if (row.isPb) {
      return {
        text:
          row.vsSecondPct !== null
            ? t("arbi.pb.vsSecond", { delta: deltaLabel(row.vsSecondPct) })
            : t("arbi.pb.badge"),
        good: true,
      };
    }
    if (row.vsBestPct === null) return null;
    return { text: t("arbi.pb.vsBest", { delta: deltaLabel(row.vsBestPct) }), good: false };
  }

  function elementLabel(t: Translator, element: string): string {
    // An unmapped DT_ token has no key; show the raw name rather than the key.
    const key = ELEMENT_KEYS[element];
    return key ? t(key) : element;
  }

  async function exportLog(): Promise<void> {
    await invoke("exportPtRunLog", run.id);
  }

  async function showInFolder(): Promise<void> {
    await invoke("showPtRunLogInFolder", run.id);
  }

  async function onDelete(): Promise<void> {
    if (!(await confirmWithDialog($t("arbi.confirmDeleteRun"), $t))) return;
    await deletePtRun(run.id);
    onBack();
  }

  let tagDraft = $state("");
  let notesDraft = $state(untrack(() => run.notes ?? ""));
  let notesRunId = $state(untrack(() => run.id));
  let notesTimer: ReturnType<typeof setTimeout> | null = null;

  // Previous/next swaps the run in place, so the draft has to follow it.
  $effect(() => {
    if (run.id === notesRunId) return;
    notesRunId = run.id;
    notesDraft = run.notes ?? "";
    if (notesTimer) {
      clearTimeout(notesTimer);
      notesTimer = null;
    }
  });

  function saveNotes(): void {
    void updatePtNotes(notesRunId, notesDraft).catch((err) =>
      log.warn("[PT] notes save failed", String(err)),
    );
  }

  function onNotesInput(): void {
    if (notesTimer) clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      notesTimer = null;
      saveNotes();
    }, 600);
  }

  /** Navigating or unmounting inside the debounce window would drop the edit. */
  function flushNotes(): void {
    if (!notesTimer) return;
    clearTimeout(notesTimer);
    notesTimer = null;
    saveNotes();
  }

  onDestroy(flushNotes);

  function navigate(target: PtRunRecord | null): void {
    if (!target) return;
    flushNotes();
    onNavigate(target.id);
  }

  async function addTag(): Promise<void> {
    const value = tagDraft.trim();
    if (!value) return;
    tagDraft = "";
    // normalizeRunTags (main side) dedupes case-insensitively and caps the list.
    await updatePtTags(run.id, [...tags, value]);
  }

  async function removeTag(tag: string): Promise<void> {
    await updatePtTags(
      run.id,
      tags.filter((entry) => entry !== tag),
    );
  }

  function onTagKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void addTag();
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-3">
      <span data-pt-detail-back
        ><ThemedButton onClick={onBack}>{$t("arbi.back")}</ThemedButton></span
      >
      <div class="flex items-center gap-1">
        <button
          type="button"
          data-pt-prev
          class="cursor-pointer rounded border border-border px-2 py-1 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!prevRun}
          title={$t("arbi.nav.previous")}
          aria-label={$t("arbi.nav.previous")}
          onclick={() => navigate(prevRun)}>‹</button
        >
        <button
          type="button"
          data-pt-next
          class="cursor-pointer rounded border border-border px-2 py-1 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!nextRun}
          title={$t("arbi.nav.next")}
          aria-label={$t("arbi.nav.next")}
          onclick={() => navigate(nextRun)}>›</button
        >
      </div>
      <div class="flex flex-col">
        <span class="font-mono text-lg font-bold leading-tight text-text-primary"
          >{formatPtTime(run.durationSec)}</span
        >
        <span class="text-xs text-text-muted">
          {formatRunDate(run.startedAt)}
          {#if run.source === "imported"}· {$t("common.imported")}{/if}
          {#if players.length > 0}· {players.join(", ")}{/if}
        </span>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if run.logFile}
        <ThemedButton onClick={exportLog}>{$t("arbi.exportLog")}</ThemedButton>
        <ThemedButton onClick={showInFolder}>{$t("arbi.showInFolder")}</ThemedButton>
      {/if}
      <ThemedButton onClick={onDelete} className="hover:!border-danger hover:!text-danger">
        {$t("arbi.deleteRun")}
      </ThemedButton>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
    <span class="rounded border border-border px-1.5 py-0.5 text-text-muted"
      >{squadSize === null
        ? $t("pt.unknownSquad")
        : squadSize === 1
          ? $t("pt.recordedPlayer")
          : $t("pt.squadSize", { count: squadSize })}</span
    >
    {#if run.aborted}
      <span class="rounded border border-danger/40 px-1.5 py-0.5 text-danger"
        >{$t("arbi.end.aborted")}</span
      >
    {:else if run.complete}
      <span class="rounded border border-success/40 px-1.5 py-0.5 text-success"
        >{$t("pt.badge.complete")}</span
      >
    {:else}
      <span
        class="rounded border border-warning/40 px-1.5 py-0.5 text-warning"
        title={$t("arbi.incompleteHint")}>{$t("arbi.incomplete")}</span
      >
    {/if}
    {#if run.bugged}
      <span
        class="rounded border border-warning/40 px-1.5 py-0.5 text-warning"
        title={$t("pt.badge.buggedHint")}>{$t("pt.badge.bugged")}</span
      >
    {/if}
    {#if run.hostMigration}
      <span
        class="rounded border border-warning/40 px-1.5 py-0.5 text-warning"
        title={$t("pt.badge.migrationHint")}>{$t("pt.badge.migration")}</span
      >
    {/if}
    {#if run.flightUnreliable}
      <span
        class="rounded border border-border px-1.5 py-0.5 text-text-muted"
        title={$t("pt.badge.flightEstimateHint")}>{$t("pt.badge.flightEstimate")}</span
      >
    {/if}
  </div>

  <p data-pt-recorded-roster class="m-0 text-xs text-text-muted">{$t("pt.recordedRosterHint")}</p>
  {#if exclusion}
    <p
      data-pt-exclusion={exclusion}
      class="m-0 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      {$t("pt.excluded")}: {$t(PT_EXCLUSION_KEYS[exclusion])}
    </p>
  {:else}
    <label class="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
      {$t("pt.baseline")}
      <select
        data-pt-baseline
        bind:value={baselineId}
        class="max-w-full rounded border border-border bg-bg-raised px-3 py-1.5 text-text-primary"
      >
        <option value="">{$t("common.none")}</option>
        {#each withUniqueKeys(baselines, (entry) => entry.id) as { key: viewKey, item: candidate } (viewKey)}<option
            value={candidate.id}
            >{formatRunDate(candidate.startedAt)} | {formatPtSeconds(
              candidate.durationSec,
            )}s</option
          >{/each}
      </select>
      <span class="text-xs text-text-muted">{$t("pt.baseline.hint")}</span>
    </label>
  {/if}

  <PtMetricCards
    rows={PT_METRICS.map((metric) => ({
      metric,
      value: metric === "pylon" && run.bugged ? null : ptMetricValue(run, metric),
      detail: pbSubtext($t, metric),
      delta: comparison.find((row) => row.metric === metric) ?? null,
    }))}
  />

  <div class="flex items-center justify-between gap-3">
    <h3 class="m-0 text-base font-semibold text-text-primary">{$t("pt.phases")}</h3>
    <div class="flex gap-1">
      {#each ["cards", "table"] as view}
        <button
          type="button"
          data-pt-phase-view={view}
          aria-pressed={$phaseView === view}
          class="rounded border px-3 py-1.5 text-xs {$phaseView === view
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border text-text-muted'}"
          onclick={() => phaseView.set(view === "table" ? "table" : "cards")}
          >{$t(view === "cards" ? "pt.phase.cards" : "pt.phase.table")}</button
        >
      {/each}
    </div>
  </div>
  {#if $phaseView === "cards"}
    <div class="grid gap-3 xl:grid-cols-2" data-pt-phases>
      {#each phases as row (row.index)}
        <section
          data-pt-phase={row.index}
          class="min-w-0 rounded-xl border border-border bg-bg-surface p-4"
        >
          <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h4 class="m-0 font-display text-lg font-semibold text-text-primary">
              {$t("pt.col.phase")}
              {row.index}
            </h4>
            <div class="flex gap-6 text-right">
              <div>
                <span class="block text-[10px] uppercase tracking-wide text-text-muted"
                  >{$t("pt.phase.duration")}</span
                ><strong class="font-mono text-lg text-text-primary"
                  ><span data-pt-phase-duration>{formatPtSeconds(row.phase?.totalSec ?? null)}</span
                  >s</strong
                >
              </div>
              <div>
                <span class="block text-[10px] uppercase tracking-wide text-text-muted"
                  >{$t("pt.phase.elapsed")}</span
                ><strong class="font-mono text-lg text-accent"
                  ><span data-pt-phase-elapsed>{formatPtSeconds(row.elapsed)}</span>s</strong
                >
              </div>
            </div>
          </header>
          {#if row.phase}
            <div class="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
              <dl class="m-0 space-y-2 border-r border-border pr-4 text-sm">
                {#each phaseMetrics as metric}
                  <div class="flex justify-between gap-2">
                    <dt class="text-text-secondary">{$t(PT_METRIC_KEYS[metric])}</dt>
                    <dd
                      data-pt-phase-pylon={metric === "pylon" ? "" : undefined}
                      class="m-0 font-mono text-text-primary"
                    >
                      {formatPtSeconds(
                        metric === "pylon" && run.bugged && row.index === 3
                          ? null
                          : row.phase[`${metric}Sec`],
                      )}
                    </dd>
                  </div>
                {/each}
              </dl>
              <div class="min-w-0 space-y-3">
                {#if row.phase.shields.length}
                  <div>
                    <h5
                      class="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted"
                    >
                      {$t("pt.phase.shieldOrder")}
                    </h5>
                    <ol class="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {#each row.phase.shields as shield, i (i)}
                        <li
                          class="flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-xs"
                        >
                          <span class="text-accent">{i + 1}</span><span class="text-text-secondary"
                            >{elementLabel($t, shield.element)}</span
                          ><span class="font-mono text-text-primary"
                            >{formatPtSeconds(shield.seconds)}s</span
                          >
                        </li>
                      {/each}
                    </ol>
                  </div>
                {/if}
                <div>
                  <h5
                    class="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted"
                  >
                    {$t("pt.phase.legOrder")}
                  </h5>
                  <ol class="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                    {#each row.phase.legs as leg, i (i)}
                      <li
                        class="flex items-center gap-2 rounded-md bg-success/10 px-2 py-1 text-xs"
                      >
                        <span class="text-success">{i + 1}</span><span
                          class="flex-1 text-text-secondary">{$t(LEG_KEYS[leg.leg])}</span
                        ><span class="font-mono text-text-primary"
                          >{formatPtSeconds(leg.seconds)}s</span
                        >
                      </li>
                    {/each}
                  </ol>
                </div>
              </div>
            </div>
          {:else}<p class="m-0 py-5 text-sm text-text-muted">{$t("pt.phase.missing")}</p>{/if}
        </section>
      {/each}
    </div>
  {:else}
    <ThemedPanel className="overflow-x-auto p-3">
      <table class="w-full border-collapse text-sm" data-pt-phases>
        <thead
          ><tr class="border-b border-border text-left text-xs uppercase text-text-muted"
            ><th class="p-2">{$t("pt.col.phase")}</th><th class="p-2 text-right"
              >{$t("pt.phase.duration")}</th
            ><th class="p-2 text-right">{$t("pt.phase.elapsed")}</th
            >{#each phaseMetrics as metric}<th class="p-2 text-right"
                >{$t(PT_METRIC_KEYS[metric])}</th
              >{/each}</tr
          ></thead
        >
        <tbody
          >{#each phases as row (row.index)}<tr
              data-pt-phase={row.index}
              class="border-b border-border/50"
              ><th class="p-2 text-left">{row.index}</th><td
                class="p-2 text-right font-mono"
                data-pt-phase-duration>{formatPtSeconds(row.phase?.totalSec ?? null)}</td
              ><td class="p-2 text-right font-mono" data-pt-phase-elapsed
                >{formatPtSeconds(row.elapsed)}</td
              >{#each phaseMetrics as metric}<td class="p-2 text-right font-mono"
                  >{formatPtSeconds(
                    metric === "pylon" && run.bugged && row.index === 3
                      ? null
                      : (row.phase?.[`${metric}Sec`] ?? null),
                  )}</td
                >{/each}</tr
            >{/each}</tbody
        >
      </table>
    </ThemedPanel>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
      >{$t("common.tags")}</span
    >
    {#each tags as tag (tag)}
      <span
        class="inline-flex items-center gap-1 rounded border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-semibold text-info"
      >
        {tag}
        <button
          type="button"
          class="cursor-pointer leading-none text-info/70 hover:text-info"
          title={$t("arbi.tags.remove")}
          aria-label={$t("arbi.tags.remove")}
          onclick={() => removeTag(tag)}>×</button
        >
      </span>
    {/each}
    <input
      class="w-40 rounded border border-border bg-bg-raised px-2 py-0.5 text-xs text-text-primary outline-none focus:border-info"
      type="text"
      maxlength="32"
      placeholder={$t("arbi.tags.add")}
      bind:value={tagDraft}
      onkeydown={onTagKeydown}
      onblur={addTag}
    />
  </div>

  {#if totalPb && totalPb.poolSize > 1}
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-border/60 bg-bg-raised/40 px-3 py-2 text-xs"
    >
      <span class="uppercase tracking-wide text-text-muted">{$t("arbi.pb.title")}</span>
      <span class="text-text-muted">{$t("pt.pb.pool")}</span>
      <span class="text-text-secondary"
        >{$t("arbi.pb.rank", {
          rank: String(totalPb.rank),
          count: String(totalPb.poolSize),
        })}</span
      >
    </div>
  {/if}

  <label class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wide text-text-muted"
      >{$t("arbi.notes.label")}</span
    >
    <textarea
      data-pt-notes
      class="min-h-[4.5rem] w-full resize-y rounded border border-border bg-bg-raised px-2 py-1.5 text-sm text-text-primary outline-none focus:border-info"
      maxlength="2000"
      placeholder={$t("arbi.notes.placeholder")}
      bind:value={notesDraft}
      oninput={onNotesInput}
      onblur={flushNotes}></textarea>
  </label>
</div>
