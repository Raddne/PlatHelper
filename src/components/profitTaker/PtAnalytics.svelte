<script lang="ts">
  import { locale, tr } from "../../lib/i18n.js";
  import { withUniqueKeys } from "../../lib/uniqueKeys.js";
  import {
    formatPtLength,
    ptMetricSummary,
    ptMetricValue,
    ptSquadSize,
    PT_METRICS,
    PT_METRIC_KEYS,
    type PtMetric,
  } from "../../lib/profitTakerStats.js";
  import type { PtRunRecord } from "../../types/ipc.js";
  import PtMetricCards from "./PtMetricCards.svelte";

  let { runs, onSelect }: { runs: PtRunRecord[]; onSelect: (id: string) => void } = $props();
  const summary = $derived(ptMetricSummary(runs));
  let enabled = $state<PtMetric[]>([...PT_METRICS]);
  let selectedId = $state("");
  let width = $state(900);
  const selected = $derived(summary.eligible.find((run) => run.id === selectedId) ?? null);
  const mixed = $derived(
    new Set(summary.eligible.map(ptSquadSize).filter((size) => size !== null)).size > 1,
  );
  const unknownSquad = $derived(summary.eligible.some((run) => ptSquadSize(run) === null));
  const colors: Record<PtMetric, string> = {
    total: "var(--info)",
    flight: "var(--warning)",
    shield: "var(--accent)",
    leg: "var(--success)",
    body: "var(--danger)",
    pylon: "var(--text-secondary)",
  };
  const height = 280;
  const chart = $derived.by(() => {
    const plotWidth = Math.max(300, width);
    const first = summary.eligible[0]?.startedAt ?? 0;
    const last = summary.eligible[summary.eligible.length - 1]?.startedAt ?? first;
    const max =
      summary.eligible.reduce(
        (highest, run) =>
          enabled.reduce((value, metric) => Math.max(value, ptMetricValue(run, metric)), highest),
        1,
      ) * 1.1;
    const x = (run: PtRunRecord) =>
      last > first
        ? 48 + ((run.startedAt - first) / (last - first)) * (plotWidth - 70)
        : plotWidth / 2;
    const y = (value: number) => height - 36 - (value / max) * (height - 60);
    return { width: plotWidth, max, x, y };
  });
  function dateLabel(time: number, language: string): string {
    return new Date(time).toLocaleString(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  function toggle(metric: PtMetric): void {
    enabled = enabled.includes(metric)
      ? enabled.filter((entry) => entry !== metric)
      : PT_METRICS.filter((entry) => entry === metric || enabled.includes(entry));
  }
  function selectKey(event: KeyboardEvent, run: PtRunRecord): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(run.id);
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4" data-pt-analytics>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p
      data-pt-analytics-scope
      data-pt-eligible-count={summary.eligible.length}
      data-pt-excluded-count={summary.excluded}
      class="m-0 text-sm text-text-secondary"
    >
      {$tr("pt.analytics.scope", { eligible: summary.eligible.length, excluded: summary.excluded })}
    </p>
    {#if mixed}<span
        data-pt-mixed-squads
        class="rounded border border-warning/40 px-2 py-1 text-xs text-warning"
        >{$tr("pt.combinedSquads")}</span
      >{/if}
    {#if unknownSquad}<span
        data-pt-unknown-squad
        class="rounded border border-warning/40 px-2 py-1 text-xs text-warning"
        >{$tr("pt.unknownSquad")}</span
      >{/if}
  </div>
  <p data-pt-recorded-roster class="m-0 text-xs text-text-muted">{$tr("pt.recordedRosterHint")}</p>
  {#if summary.eligible.length === 0}
    <p
      data-pt-analytics-empty
      class="m-0 rounded-xl border border-border bg-bg-surface p-10 text-center text-sm text-text-muted"
    >
      {$tr("pt.analytics.empty")}
    </p>
  {:else}
    <h3 class="m-0 text-sm font-semibold text-text-secondary">
      {$tr("arbi.vitus.scenario.average")}
    </h3>
    <PtMetricCards
      mode="mean"
      rows={summary.metrics.map((row) => ({
        metric: row.metric,
        value: row.mean,
        detail: {
          text: `${$tr("common.median")}: ${formatPtLength(row.median)} | ${$tr("pt.analytics.fastestFiltered")}: ${formatPtLength(row.best)}`,
          good: false,
        },
      }))}
    />
    <section class="min-w-0 rounded-xl border border-border bg-bg-surface p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 class="m-0 font-display text-lg font-semibold text-text-primary">
          {$tr("pt.analytics.trend")}
        </h3>
        <div class="flex flex-wrap gap-1.5">
          {#each PT_METRICS as metric}<button
              type="button"
              data-pt-chart-metric={metric}
              aria-pressed={enabled.includes(metric)}
              class="flex items-center gap-1.5 rounded border px-2 py-1 text-xs {enabled.includes(
                metric,
              )
                ? 'border-border-strong text-text-primary'
                : 'border-border text-text-muted opacity-60'}"
              onclick={() => toggle(metric)}
              ><span class="h-2 w-2 rounded-full" style:background={colors[metric]}></span>{$tr(
                PT_METRIC_KEYS[metric],
              )}</button
            >{/each}
        </div>
      </div>
      <span class="text-[10px] uppercase tracking-wide text-text-muted"
        >{$tr("pt.analytics.seconds")}</span
      >
      <div bind:clientWidth={width} class="min-w-0 overflow-x-auto">
        <svg
          viewBox="0 0 {chart.width} {height}"
          class="block min-w-[300px] w-full"
          role="group"
          aria-label={$tr("pt.analytics.trend")}
        >
          {#each [0, 1, 2, 3, 4] as tick}
            {@const value = (chart.max * tick) / 4}
            <line
              x1="48"
              x2={chart.width - 22}
              y1={chart.y(value)}
              y2={chart.y(value)}
              stroke="var(--border)"
              stroke-width="1"
            />
            <text
              x="42"
              y={chart.y(value) + 3}
              text-anchor="end"
              fill="var(--text-muted)"
              font-size="10">{value.toFixed(value < 10 ? 1 : 0)}</text
            >
          {/each}
          {#each enabled as metric (metric)}
            <polyline
              data-pt-chart-series={metric}
              points={summary.eligible
                .map((run) => `${chart.x(run)},${chart.y(ptMetricValue(run, metric))}`)
                .join(" ")}
              fill="none"
              stroke={colors[metric]}
              stroke-width="1.8"
            />
          {/each}
          {#each withUniqueKeys(summary.eligible, (entry) => entry.id) as { key: viewKey, item: run } (viewKey)}
            <g
              data-pt-chart-run={run.id}
              role="button"
              tabindex={enabled.length ? 0 : -1}
              aria-label={`${dateLabel(run.startedAt, $locale)}: ${formatPtLength(run.durationSec)}`}
              class="cursor-pointer outline-none"
              onfocus={() => (selectedId = run.id)}
              onmouseenter={() => (selectedId = run.id)}
              onclick={() => onSelect(run.id)}
              onkeydown={(event) => selectKey(event, run)}
            >
              {#each enabled as metric (metric)}
                <circle
                  data-pt-chart-point={metric}
                  cx={chart.x(run)}
                  cy={chart.y(ptMetricValue(run, metric))}
                  r={selectedId === run.id ? 4.5 : 3}
                  fill={colors[metric]}
                  stroke={selectedId === run.id ? "var(--text-primary)" : "var(--bg-surface)"}
                  stroke-width="1.5"
                  ><title
                    >{$tr(PT_METRIC_KEYS[metric])}: {formatPtLength(
                      ptMetricValue(run, metric),
                    )}</title
                  ></circle
                >
              {/each}
            </g>
          {/each}
          {#if summary.eligible[0]}<text
              x="48"
              y={height - 10}
              fill="var(--text-muted)"
              font-size="10">{dateLabel(summary.eligible[0].startedAt, $locale)}</text
            >{/if}
          {#if summary.eligible.length > 1}<text
              x={chart.width - 22}
              y={height - 10}
              text-anchor="end"
              fill="var(--text-muted)"
              font-size="10"
              >{dateLabel(summary.eligible[summary.eligible.length - 1].startedAt, $locale)}</text
            >{/if}
        </svg>
      </div>
      {#if selected}
        <div
          class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs"
        >
          <span class="font-semibold text-text-primary"
            >{dateLabel(selected.startedAt, $locale)}</span
          >
          {#each enabled as metric}<span class="text-text-muted"
              >{$tr(PT_METRIC_KEYS[metric])}
              <strong class="font-mono text-text-secondary"
                >{formatPtLength(ptMetricValue(selected, metric))}</strong
              ></span
            >{/each}
          <button
            type="button"
            class="ml-auto rounded border border-accent px-2 py-1 text-accent"
            onclick={() => onSelect(selected.id)}>{$tr("pt.analytics.openRun")}</button
          >
        </div>
      {:else}<p class="mb-0 mt-3 text-xs text-text-muted">{$tr("pt.analytics.selectRun")}</p>{/if}
    </section>
  {/if}
</div>
