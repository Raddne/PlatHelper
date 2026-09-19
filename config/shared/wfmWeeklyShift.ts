// WFHelper-custom approximation of Quantframe's `week_price_shift` stat
// (docs/live-scraper/quantframe-reference.md §B.2). Quantframe's own figure
// comes from its proprietary backend cache and cannot be reproduced client-
// side (see the Phase 6 investigation note in that doc) - this instead reads
// the 90-day daily rows already exposed by WFM's public v1 statistics
// endpoint (the same one config/shared/wfmStats.ts reads for the 48h closed
// average) and reports the percent change in sell-side average price between
// the latest day and the closest day at or before 7 days earlier.

import { normalizeRank, toFiniteNumber } from "./numeric";
import { asRecord } from "./objectValidation";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function extractWeekPriceShiftPercent(
  jsonPayload: unknown,
  options?: { rank?: unknown; now?: number },
): number | null {
  const payload = asRecord(asRecord(jsonPayload)?.payload);
  const closed = asRecord(payload?.statistics_closed);
  const rows = closed?.["90days"] ?? closed?.["90_days"];
  if (!Array.isArray(rows)) return null;

  const rank = normalizeRank(options?.rank);
  if (options?.rank != null && rank == null) return null;
  const now = options?.now ?? Date.now();

  const points: { time: number; avg: number }[] = [];
  for (const value of rows) {
    const row = asRecord(value);
    if (!row || (row.order_type != null && row.order_type !== "sell")) continue;
    const rawRank = row.mod_rank ?? row.rank;
    const rowRank = normalizeRank(rawRank);
    if (rawRank != null && (toFiniteNumber(rawRank) == null || rowRank == null)) continue;
    if (rank != null ? rowRank !== rank : rowRank != null && rowRank !== 0) continue;

    const time = typeof row.datetime === "string" ? Date.parse(row.datetime) : NaN;
    const avg = toFiniteNumber(row.avg_price ?? row.moving_avg);
    if (!Number.isFinite(time) || time > now || avg == null || avg <= 0) continue;
    points.push({ time, avg });
  }
  if (points.length < 2) return null;

  points.sort((a, b) => a.time - b.time);
  const latest = points[points.length - 1];

  let weekAgo = points[0];
  for (const point of points) {
    if (point.time <= latest.time - WEEK_MS) weekAgo = point;
    else break;
  }
  if (weekAgo === latest || weekAgo.avg <= 0) return null;

  return ((latest.avg - weekAgo.avg) / weekAgo.avg) * 100;
}
