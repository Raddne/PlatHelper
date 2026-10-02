import { rivenDissolveEndo } from "../../../config/shared/rivenEndo.js";
import type { SheetRating } from "../../../config/shared/rivenRollSheet.js";

/** Rerolls past this make a mediocre roll worth more as endo than as a trade. */
const DISSOLVE_REROLL_HINT = 5;
/** A maxed card is worth this much on rank alone, so rank counts as well. */
const DISSOLVE_ENDO_HINT = 3000;

interface DissolveCandidate {
  sheetRating: SheetRating | null;
  masteryReq: number;
  currentRank: number;
  rerolls: number;
}

/** Endo the riven dissolves for, but only when the roll sheet calls it not a good
 *  roll and dissolving is worth suggesting. Null means show nothing. */
export function rivenDissolveHint(riven: DissolveCandidate): number | null {
  if (riven.sheetRating !== "not-good") return null;
  const endo = rivenDissolveEndo(riven.masteryReq, riven.currentRank, riven.rerolls);
  if (riven.rerolls < DISSOLVE_REROLL_HINT && endo < DISSOLVE_ENDO_HINT) return null;
  return endo;
}
