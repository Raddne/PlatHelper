// Text of the riven stat chips: the picker's full chips and the compact ones in
// the Live Scraper's riven lists.

import { statTagToDisplayName } from "../../../config/shared/rivenStatDisplayNames.js";
import { RIVEN_STAT_CODES } from "./rivenStatCodes.js";

export interface ChipStat {
  tag: string;
  positive: boolean;
  multiplier: boolean;
  value: number;
  /** Display name; the tag's own name when absent. */
  name?: string;
}

/** Positives first, then negatives, each kept in order. */
export function orderedChipStats<T extends ChipStat>(stats: readonly T[]): T[] {
  return [...stats.filter((s) => s.positive), ...stats.filter((s) => !s.positive)];
}

/** "x1.25" for a multiplier, else a signed percentage: "+12.3%", "-5%". */
export function chipValue(stat: ChipStat): string {
  return stat.multiplier ? `x${stat.value}` : `${stat.value >= 0 ? "+" : ""}${stat.value}%`;
}

export function chipName(stat: ChipStat): string {
  return stat.name ?? statTagToDisplayName(stat.tag);
}

/** Upper-case trader code (CD, MS, ZOOM); the full name for a tag without one. */
export function chipCode(stat: ChipStat): string {
  return RIVEN_STAT_CODES[stat.tag]?.[0]?.toUpperCase() ?? chipName(stat);
}

/** "+12.3% Critical Chance, -5% Zoom", for a hover hint. */
export function chipStatsTitle(stats: readonly ChipStat[]): string {
  return orderedChipStats(stats)
    .map((stat) => `${chipValue(stat)} ${chipName(stat)}`)
    .join(", ");
}
