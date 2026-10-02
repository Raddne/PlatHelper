// Riven good rolls from the community "Rolls & Resources" sheet: stat codes, the
// weapon lookup and the matcher. Pure, so the main process and the renderer share it.

import { RIVEN_ROLL_SHEET_WEAPONS } from "./rivenRollSheetTable";

export const ROLL_STAT_CODES = [
  "MS",
  "DMG",
  "CC",
  "CD",
  "SC",
  "SD",
  "FR",
  "RNG",
  "PT",
  "RLS",
  "CCC",
  "IC",
  "EFF",
  "FIN",
  "SLIDE",
  "TOX",
  "ELEC",
  "HEAT",
  "COLD",
  "IMP",
  "PUNC",
  "SL",
  "MAG",
  "AMMO",
  "PFS",
  "REC",
  "Z",
  "DTG",
  "DTC",
  "DTI",
  "COMBO",
] as const;

/** Sheet stat abbreviation. Attack Speed is FR, the same upgrade tag. */
export type RollStatCode = (typeof ROLL_STAT_CODES)[number];

/** The in-game English names of the stats: game terms, not translated text. */
export const ROLL_STAT_LABELS: Record<RollStatCode, string> = {
  MS: "Multishot",
  DMG: "Damage",
  CC: "Critical Chance",
  CD: "Critical Damage",
  SC: "Status Chance",
  SD: "Status Duration",
  FR: "Fire Rate / Attack Speed",
  RNG: "Range",
  PT: "Punch Through",
  RLS: "Reload Speed",
  CCC: "Additional Combo Count Chance",
  IC: "Initial Combo",
  EFF: "Heavy Attack Efficiency",
  FIN: "Finisher Damage",
  SLIDE: "Critical Chance for Slide Attack",
  TOX: "Toxin",
  ELEC: "Electricity",
  HEAT: "Heat",
  COLD: "Cold",
  IMP: "Impact",
  PUNC: "Puncture",
  SL: "Slash",
  MAG: "Magazine Capacity",
  AMMO: "Ammo Maximum",
  PFS: "Projectile Speed",
  REC: "Weapon Recoil",
  Z: "Zoom",
  DTG: "Damage to Grineer",
  DTC: "Damage to Corpus",
  DTI: "Damage to Infested",
  COMBO: "Combo Duration",
};

/** One positive column of a sheet row: any listed stat, or no stat when `none`.
 *  @public */
export interface RollSheetSlot {
  stats: RollStatCode[];
  none: boolean;
  any: boolean;
}

/** Accepted curses. `none` accepts a roll without one; `anyExcept` narrows `any`.
 *  @public */
export interface RollSheetNegatives {
  stats: RollStatCode[];
  none: boolean;
  any: boolean;
  anyExcept: RollStatCode[];
}

export interface RollSheetRow {
  sheetRow: number;
  slots: [RollSheetSlot, RollSheetSlot, RollSheetSlot];
  negatives: RollSheetNegatives;
  /** Whitespace-normalised cell texts, for display only. */
  raw: { positives: [string, string, string]; negatives: string; note: string | null };
}

export interface RollSheetWeapon {
  /** Sheet name without the brackets. */
  name: string;
  rows: RollSheetRow[];
}

export interface RivenNamePart {
  code: RollStatCode;
  prefix: string;
  suffix: string;
}

/** A read riven: 2 or 3 distinct positives and at most one negative. */
export interface RivenRoll {
  positives: RollStatCode[];
  negative: RollStatCode | null;
}

export type RollVerdictKind =
  | "good"
  | "positives-no-negative"
  | "positives-unlisted-negative"
  | "not-good";

/** @public */
export interface RollVerdict {
  kind: RollVerdictKind;
  row: RollSheetRow | null;
}

let weaponsByName: Map<string, RollSheetWeapon> | null = null;

function weaponIndex(): Map<string, RollSheetWeapon> {
  if (!weaponsByName) {
    weaponsByName = new Map(
      RIVEN_ROLL_SHEET_WEAPONS.map((entry) => [entry.name.toLowerCase(), entry]),
    );
  }
  return weaponsByName;
}

/** A lower-case weapon name without its variant words (Prime, Kuva, MK1-, ...). */
function stripSheetVariant(lc: string): string {
  return lc
    .replace(/\s+(prime|wraith|vandal)\b/gi, " ")
    .replace(/^(kuva|tenet|prisma)\s+/i, "")
    .replace(/^mk1[-\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact name first: the sheet lists Tenet Exec and Coda Motovore apart from any
 *  base weapon, so variant stripping is only a fallback. */
export function findSheetWeapon(name: string): RollSheetWeapon | null {
  const index = weaponIndex();
  const lc = name.toLowerCase().trim();
  const exact = index.get(lc);
  if (exact) return exact;
  const stripped = stripSheetVariant(lc);
  return stripped !== lc ? (index.get(stripped) ?? null) : null;
}

const weaponKey = (name: string): string => name.toLowerCase().trim().replace(/\s+/g, " ");

/** One weapon by name: the same name in any case, or the same once the variant words
 *  findSheetWeapon strips are gone ("Kuva Sobek" and "Sobek"). */
export function sameSheetWeapon(a: string, b: string): boolean {
  const left = weaponKey(a);
  const right = weaponKey(b);
  if (!left || !right) return false;
  return left === right || stripSheetVariant(left) === stripSheetVariant(right);
}

function slotAccepts(slot: RollSheetSlot, code: RollStatCode): boolean {
  return slot.any || slot.stats.includes(code);
}

// Injective: every positive needs its own slot, and an unused slot must allow NONE.
function positivesFit(slots: RollSheetSlot[], positives: RollStatCode[]): boolean {
  if (positives.length > slots.length) return false;
  const used = slots.map(() => false);
  const place = (index: number): boolean => {
    if (index === positives.length) return slots.every((slot, i) => used[i] || slot.none);
    for (let i = 0; i < slots.length; i++) {
      if (used[i] || !slotAccepts(slots[i], positives[index])) continue;
      used[i] = true;
      if (place(index + 1)) return true;
      used[i] = false;
    }
    return false;
  };
  return place(0);
}

function negativeFits(negatives: RollSheetNegatives, code: RollStatCode | null): boolean {
  if (code === null) return negatives.none;
  return negatives.stats.includes(code) || (negatives.any && !negatives.anyExcept.includes(code));
}

export function evaluateSheetRow(row: RollSheetRow, roll: RivenRoll): RollVerdictKind {
  if (!positivesFit(row.slots, roll.positives)) return "not-good";
  if (negativeFits(row.negatives, roll.negative)) return "good";
  return roll.negative === null ? "positives-no-negative" : "positives-unlisted-negative";
}

const VERDICT_PREFERENCE: RollVerdictKind[] = [
  "good",
  "positives-no-negative",
  "positives-unlisted-negative",
  "not-good",
];

/** Best verdict over the weapon's rows; ties keep the earlier, more usable row. */
export function evaluateSheetRoll(entry: RollSheetWeapon, roll: RivenRoll): RollVerdict {
  let best: RollVerdict = { kind: "not-good", row: null };
  for (const row of entry.rows) {
    const kind = evaluateSheetRow(row, roll);
    if (kind === "not-good") continue;
    if (
      best.row === null ||
      VERDICT_PREFERENCE.indexOf(kind) < VERDICT_PREFERENCE.indexOf(best.kind)
    ) {
      best = { kind, row };
    }
    if (kind === "good") break;
  }
  return best;
}

// DE upgrade tag -> sheet code, from STAT_NAME_TO_TAG in rivenData. Every tag it
// produces is mapped; none is left out on purpose.
const TAG_TO_CODE: Record<string, RollStatCode> = {
  WeaponFireIterationsMod: "MS",
  WeaponDamageAmountMod: "DMG",
  WeaponMeleeDamageMod: "DMG",
  WeaponCritChanceMod: "CC",
  WeaponCritDamageMod: "CD",
  WeaponStunChanceMod: "SC",
  WeaponProcTimeMod: "SD",
  WeaponFireRateMod: "FR",
  WeaponMeleeRangeIncMod: "RNG",
  WeaponPunctureDepthMod: "PT",
  WeaponReloadSpeedMod: "RLS",
  WeaponMeleeComboPointsOnHitMod: "CCC",
  WeaponMeleeComboBonusOnHitMod: "CCC",
  WeaponMeleeComboInitialBonusMod: "IC",
  WeaponMeleeComboEfficiencyMod: "EFF",
  WeaponMeleeFinisherDamageMod: "FIN",
  SlideAttackCritChanceMod: "SLIDE",
  WeaponToxinDamageMod: "TOX",
  WeaponElectricityDamageMod: "ELEC",
  WeaponFireDamageMod: "HEAT",
  WeaponFreezeDamageMod: "COLD",
  WeaponImpactDamageMod: "IMP",
  WeaponArmorPiercingDamageMod: "PUNC",
  WeaponSlashDamageMod: "SL",
  WeaponClipMaxMod: "MAG",
  WeaponAmmoMaxMod: "AMMO",
  WeaponProjectileSpeedMod: "PFS",
  WeaponRecoilReductionMod: "REC",
  WeaponZoomFovMod: "Z",
  WeaponFactionDamageGrineer: "DTG",
  WeaponFactionDamageCorpus: "DTC",
  WeaponFactionDamageInfested: "DTI",
  ComboDurationMod: "COMBO",
};

export function rollCodeForTag(tag: string): RollStatCode | null {
  return Object.prototype.hasOwnProperty.call(TAG_TO_CODE, tag) ? TAG_TO_CODE[tag] : null;
}

/** A riven stat as the sheet needs it: its upgrade tag and polarity. */
interface SheetStat {
  tag: string;
  positive: boolean;
}

/** Stats as a sheet roll; null when a tag has no code, or with other than 2-3 distinct
 *  positives, or more than one negative. */
function rollFromStats(stats: readonly SheetStat[]): RivenRoll | null {
  const positives: RollStatCode[] = [];
  const negatives: RollStatCode[] = [];
  for (const stat of stats) {
    const code = rollCodeForTag(stat.tag);
    if (!code) return null;
    (stat.positive ? positives : negatives).push(code);
  }
  if (positives.length < 2 || positives.length > 3) return null;
  if (new Set(positives).size !== positives.length) return null;
  if (negatives.length > 1) return null;
  return { positives, negative: negatives[0] ?? null };
}

export type SheetRating = "good" | "one-positive-off" | "unlisted-negative" | "not-good";

interface SheetRatingResult {
  /** Null when the sheet does not list the weapon. */
  weapon: RollSheetWeapon | null;
  /** Null when the weapon is unknown or the stats cannot be judged. */
  rating: SheetRating | null;
  /** The row that produced the rating; null for "not-good". */
  row: RollSheetRow | null;
}

const RATING_PREFERENCE: SheetRating[] = [
  "good",
  "one-positive-off",
  "unlisted-negative",
  "not-good",
];

// Three positives that miss the row, of which two sit in two distinct slots that take them.
function onePositiveOff(row: RollSheetRow, roll: RivenRoll): boolean {
  const [a, b, c] = roll.positives;
  if (roll.positives.length !== 3 || positivesFit(row.slots, roll.positives)) return false;
  const pairFits = (first: RollStatCode, second: RollStatCode): boolean =>
    row.slots.some(
      (slot, i) =>
        slotAccepts(slot, first) &&
        row.slots.some((other, j) => j !== i && slotAccepts(other, second)),
    );
  return pairFits(a, b) || pairFits(a, c) || pairFits(b, c);
}

function rateRow(row: RollSheetRow, roll: RivenRoll): SheetRating {
  const kind = evaluateSheetRow(row, roll);
  if (kind === "good") return "good";
  if (kind === "positives-unlisted-negative") return "unlisted-negative";
  // Matching positives without a negative the row allows are no use: not good.
  if (kind === "positives-no-negative") return "not-good";
  return onePositiveOff(row, roll) && negativeFits(row.negatives, roll.negative)
    ? "one-positive-off"
    : "not-good";
}

/** The overlay's rating: the best over the weapon's rows; ties keep the earlier row. */
export function rateRivenBySheet(
  weaponName: string,
  stats: readonly SheetStat[],
): SheetRatingResult {
  const weapon = findSheetWeapon(weaponName);
  const roll = weapon ? rollFromStats(stats) : null;
  if (!weapon || !roll) return { weapon, rating: null, row: null };
  let bestRating: SheetRating = "not-good";
  let bestRow: RollSheetRow | null = null;
  for (const row of weapon.rows) {
    const rating = rateRow(row, roll);
    if (rating === "not-good") continue;
    if (
      bestRow === null ||
      RATING_PREFERENCE.indexOf(rating) < RATING_PREFERENCE.indexOf(bestRating)
    ) {
      bestRating = rating;
      bestRow = row;
    }
    if (rating === "good") break;
  }
  return { weapon, rating: bestRating, row: bestRow };
}
