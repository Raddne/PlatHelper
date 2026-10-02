// Reverses browse.wf/calamity RivenParser.js display values to roll floats before grading.
// The forward formulas are inverted in unparseBuff and unparseCurse.

import { withScope } from "./logger";
import * as rivenData from "./rivenData";
import {
  NUM_BUFFS_ATTEN,
  NUM_BUFFS_CURSE_ATTEN,
  SPECIFIC_FIT_ATTEN,
  BASE_DRAIN,
  NON_PERCENTAGE_TAGS,
} from "./rivenConstants";
import { clamp01 } from "./rewardScannerUtils";
import { lerp } from "../config/shared/numeric";
import {
  findSheetWeapon,
  rateRivenBySheet,
  rollCodeForTag,
  ROLL_STAT_LABELS,
  type RollStatCode,
  type SheetRating,
} from "../config/shared/rivenRollSheet";

const log = withScope("rivenGrading");

interface GradedStat {
  name: string;
  positive: boolean;
  displayPositive?: boolean;
  value: number | null;
  multiplier?: boolean;
  grade: string;
  rollFloat: number;
}

/** The scanned stats rated against the "Rolls & Resources" sheet. */
interface RivenSheetRating {
  /** Sheet name of the weapon; null when the sheet does not list it. */
  weapon: string | null;
  /** Null when the stats cannot be judged. */
  rating: SheetRating | null;
  /** Sheet row that produced the rating; null for "not-good". */
  sheetRow: number | null;
  /** Codes of the stats that have one, by sign, to mark them in the sheet rows. */
  positives: RollStatCode[];
  negatives: RollStatCode[];
}

export interface RivenGradeResult {
  stats: GradedStat[];
  overallGrade: string;
  sheet: RivenSheetRating;
}

/** One sheet row as the overlay shows it: the raw cells and their codes. */
interface SheetRollLine {
  sheetRow: number;
  positives: [string, string, string];
  negatives: string;
  note: string | null;
  slotCodes: [RollStatCode[], RollStatCode[], RollStatCode[]];
  negativeCodes: RollStatCode[];
}

interface SheetGoodRolls {
  /** Sheet name of the weapon. */
  weapon: string;
  rows: SheetRollLine[];
  /** Full stat names for the codes in the rows, for hover hints. */
  labels: Partial<Record<RollStatCode, string>>;
}

/** Default riven max rank. Most rivens are rank 8 (lvl 0..8). */
const DEFAULT_LVL = 8;

/** RivenParser.js thresholds map lerp(-10, 10, rollFloat) to letter grades. */
const GRADE_THRESHOLDS: { min: number; grade: string }[] = [
  { min: 9.5, grade: "S" },
  { min: 7.5, grade: "A+" },
  { min: 5.5, grade: "A" },
  { min: 3.5, grade: "A-" },
  { min: 1.5, grade: "B+" },
  { min: -1.5, grade: "B" },
  { min: -3.5, grade: "B-" },
  { min: -5.5, grade: "C+" },
  { min: -7.5, grade: "C" },
  { min: -9.5, grade: "C-" },
];

function inverseLerp(a: number, b: number, v: number): number {
  if (b === a) return 0;
  return (v - a) / (b - a);
}

/** Converts a roll float to a grade, inverting curses so lower magnitude grades higher. */
export function floatToGrade(rollFloat: number, isCurse: boolean): string {
  const f = isCurse ? 1 - rollFloat : rollFloat;
  const score = lerp(-10, 10, f);
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "F";
}

/** Inverts RivenParser.js's buff formula for percentage or raw special-stat values.
 * Forward: base * (1.5*disp*10) * 1.25^curses * lerp(0.9,1.1,roll) * buffsAtten * (lvl+1). */
export function unparseBuff(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  return clamp01(
    unparseBuffRaw(displayedValue, baseValue, disposition, numBuffs, numCurses, tag, lvl),
  );
}

/** Same as unparseBuff but unclamped - out-of-range floats reveal a dispo misfit. */
function unparseBuffRaw(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  const buffsAtten = NUM_BUFFS_ATTEN[Math.min(numBuffs, NUM_BUFFS_ATTEN.length - 1)];
  const curseAtten = Math.pow(1.25, numCurses);
  const attenuation = SPECIFIC_FIT_ATTEN * disposition * BASE_DRAIN;

  // Convert displayed value to raw multiplier
  let value: number;
  if (tag && NON_PERCENTAGE_TAGS.has(tag)) {
    value = displayedValue;
  } else {
    value = displayedValue / 100;
  }

  if (baseValue === 0 || attenuation === 0 || buffsAtten === 0 || curseAtten === 0) return 0.5;

  value /= lvl + 1;
  value /= buffsAtten;
  value /= curseAtten;
  value /= attenuation;
  // OCR values are unsigned; abs(baseValue) handles negative-base stats such as recoil.
  value /= Math.abs(baseValue);

  // value is now lerp(0.9, 1.1, rollFloat) -> invert
  return (value - 0.9) / 0.2;
}

/** Inverts RivenParser.js's curse formula after OCR has removed the displayed sign.
 * Forward: -base * (1.5*disp*10) * lerp(0.9,1.1,roll) * curseAtten * buffsAtten * (lvl+1). */
export function unparseCurse(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  return clamp01(
    unparseCurseRaw(displayedValue, baseValue, disposition, numBuffs, numCurses, tag, lvl),
  );
}

/** Same as unparseCurse but unclamped - out-of-range floats reveal a dispo misfit. */
function unparseCurseRaw(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = DEFAULT_LVL,
): number {
  const attenuation = SPECIFIC_FIT_ATTEN * disposition * BASE_DRAIN;
  // Note the swapped indexing: buffs table by curse count, curse table by buff count
  const cursesInBuffTable = NUM_BUFFS_ATTEN[Math.min(numCurses, NUM_BUFFS_ATTEN.length - 1)];
  const buffsInCurseTable =
    NUM_BUFFS_CURSE_ATTEN[Math.min(numBuffs, NUM_BUFFS_CURSE_ATTEN.length - 1)];

  // Convert displayed value to raw multiplier (absolute value)
  let value: number;
  if (tag && NON_PERCENTAGE_TAGS.has(tag)) {
    value = Math.abs(displayedValue);
  } else {
    value = Math.abs(displayedValue) / 100;
  }

  if (baseValue === 0 || attenuation === 0 || cursesInBuffTable === 0 || buffsInCurseTable === 0)
    return 0.5;

  value /= lvl + 1;
  value /= cursesInBuffTable;
  value /= buffsInCurseTable;
  value /= attenuation;
  value /= Math.abs(baseValue);
  // OCR is already absolute, so abs(baseValue) replaces division by baseValue then -1.

  return (value - 0.9) / 0.2;
}

interface ScannedStat {
  name: string;
  positive: boolean;
  displayPositive?: boolean;
  value: number | null;
  multiplier?: boolean;
}

// Sibling tags an OCR-garbled stat name can actually be ("+190.2% Critical
// Damage" on a melee is really Melee Damage). Checked by value plausibility.
const STAT_CONFUSION_SIBLINGS: Record<string, string[]> = {
  WeaponDamageAmountMod: ["WeaponMeleeDamageMod", "WeaponCritDamageMod"],
  WeaponMeleeDamageMod: ["WeaponDamageAmountMod", "WeaponCritDamageMod"],
  WeaponCritDamageMod: ["WeaponMeleeDamageMod", "WeaponDamageAmountMod"],
  WeaponCritChanceMod: ["SlideAttackCritChanceMod", "WeaponStunChanceMod"],
  SlideAttackCritChanceMod: ["WeaponCritChanceMod"],
  WeaponStunChanceMod: ["WeaponCritChanceMod"],
};

// Riven type data lists both damage tags with identical bases, but cards use one by class.
// Normalize to the card's form before checking its numeric range.
function weaponDamageTag(tag: string, isMelee: boolean): string {
  if (isMelee && tag === "WeaponDamageAmountMod") return "WeaponMeleeDamageMod";
  if (!isMelee && tag === "WeaponMeleeDamageMod") return "WeaponDamageAmountMod";
  return tag;
}

// Display values round to 0.1%, so a legitimate min/max roll can sit a hair
// outside [0,1]. Shared by the OCR correction pass and the dispo/rank refit.
const FIT_TOLERANCE = 0.02;
// Only rename when the parsed stat is clearly impossible, not merely marginal.
const CORRECTION_MISFIT_THRESHOLD = 0.1;

// A riven card carries at most three buffs and one curse.
const MAX_RIVEN_BUFFS = 3;
const MAX_RIVEN_CURSES = 1;

// Both counts scale every displayed value, so an OCR line the scan dropped
// pushes the whole card out of range. Treat the scanned counts as a lower
// bound and accept any name that fits a card this scan could be a subset of.
function plausibleStatCounts(numBuffs: number, numCurses: number): [number, number][] {
  const counts: [number, number][] = [];
  for (let buffs = numBuffs; buffs <= Math.max(numBuffs, MAX_RIVEN_BUFFS); buffs++) {
    for (let curses = numCurses; curses <= Math.max(numCurses, MAX_RIVEN_CURSES); curses++) {
      counts.push([buffs, curses]);
    }
  }
  return counts;
}

// Rename an impossible OCR stat only when exactly one confusion sibling fits.
// Keep and log uncorrectable misfits.
export function correctScannedStats(
  weaponName: string,
  stats: ScannedStat[],
): { stats: ScannedStat[]; corrections: number } {
  const baseDisposition = rivenData.getWeaponDisposition(weaponName);
  const rivenTypeKey = rivenData.resolveRivenType(weaponName);
  if (baseDisposition == null || !rivenTypeKey || stats.length === 0) {
    return { stats, corrections: 0 };
  }

  const isMelee = rivenData.isMeleeWeapon(weaponName);
  const statCounts = plausibleStatCounts(
    stats.filter((s) => s.positive).length,
    stats.filter((s) => !s.positive).length,
  );
  const dispositions = [
    baseDisposition,
    ...rivenData.getFamilyVariants(weaponName).map((v) => v.disposition),
  ];

  // Best-case violation across family variants; null when the tag cannot roll
  // on this weapon at all (absent from the riven type or wrong polarity).
  const violationFor = (tag: string, stat: ScannedStat, displayedValue: number): number | null => {
    const entry = rivenData.findUpgradeEntry(rivenTypeKey, tag);
    if (!entry) return null;
    if (stat.positive ? !entry.canBeBuff : !entry.canBeCurse) return null;
    let best = Infinity;
    for (const disp of dispositions) {
      for (const [numBuffs, numCurses] of statCounts) {
        // Every rank, not just max: a chat-linked card shows its values at the
        // mod's own rank, and a partly ranked stat is not a misread label.
        for (let lvl = 0; lvl <= DEFAULT_LVL; lvl++) {
          const f = stat.positive
            ? unparseBuffRaw(displayedValue, entry.baseValue, disp, numBuffs, numCurses, tag, lvl)
            : unparseCurseRaw(displayedValue, entry.baseValue, disp, numBuffs, numCurses, tag, lvl);
          best = Math.min(best, Math.max(0, f - 1) + Math.max(0, -f));
        }
      }
    }
    return best;
  };

  let corrections = 0;

  // Categorical renames run first: they are label rules, not value checks, and
  // the normalized tag is what the range check measures. They stay provisional
  // until the card is accepted, because they encode the detected weapon's class.
  const measured = stats.map((original) => {
    const scannedTag = rivenData.statNameToTag(original.name);
    let stat = original;
    let tag = scannedTag;
    let renamedFrom: string | null = null;
    if (tag) {
      const normalizedTag = weaponDamageTag(tag, isMelee);
      if (normalizedTag !== tag) {
        renamedFrom = stat.name;
        stat = { ...stat, name: rivenData.getStatDisplayName(normalizedTag, isMelee) };
        tag = normalizedTag;
      }
    }

    const value = stat.value;
    if (tag == null || value == null || !Number.isFinite(value) || stat.multiplier) {
      return { original, stat, renamedFrom, tag, value: null, violation: null, misfits: false };
    }
    const violation = violationFor(tag, stat, value);
    return {
      original,
      stat,
      renamedFrom,
      tag,
      value,
      violation,
      misfits: violation == null || violation > CORRECTION_MISFIT_THRESHOLD,
    };
  });

  // A misread name is one outlier on a card that otherwise fits. Several stats
  // out of range at once means the weapon or its disposition is wrong, and
  // renaming one of them would only bake that in.
  const misfitting = measured.filter((m) => m.misfits);
  if (misfitting.length > 1) {
    const detail = misfitting
      .map(
        (m) =>
          `"${m.original.name}" ${m.violation == null ? "cannot roll" : m.violation.toFixed(3)}`,
      )
      .join(", ");
    log.warn(
      `[RivenGrade] ${misfitting.length} of ${measured.length} stats are out of range for ` +
        `"${weaponName}" (${detail}) - weapon or disposition is wrong, keeping the scanned names`,
    );
    return { stats: measured.map((m) => m.original), corrections };
  }

  for (const m of measured) {
    if (!m.renamedFrom) continue;
    log.info(
      `[RivenGrade] "${m.renamedFrom}" cannot roll on "${weaponName}" - renamed "${m.stat.name}"`,
    );
    corrections++;
  }

  const corrected = measured.map(({ stat, tag, value, violation, misfits }) => {
    if (!misfits || tag == null || value == null) return stat;

    const siblings = STAT_CONFUSION_SIBLINGS[tag] ?? [];
    const fitTags = [
      ...new Set(siblings.map((sibling) => weaponDamageTag(sibling, isMelee))),
    ].filter((sibling) => {
      if (sibling === tag) return false;
      const v = violationFor(sibling, stat, value);
      return v != null && v <= FIT_TOLERANCE;
    });

    if (fitTags.length === 1) {
      const newName = rivenData.getStatDisplayName(fitTags[0], isMelee);
      log.info(
        `[RivenGrade] "${stat.name}" ${stat.positive ? "+" : "-"}${value} misfits ` +
          `"${weaponName}" - corrected to "${newName}"`,
      );
      corrections++;
      return { ...stat, name: newName };
    }

    if (violation != null) {
      log.info(
        `[RivenGrade] "${stat.name}" ${stat.positive ? "+" : "-"}${value} is out of ` +
          `range for "${weaponName}" (violation ${violation.toFixed(3)}) - kept as scanned`,
      );
    }
    return stat;
  });

  return { stats: corrected, corrections };
}

/** A weapon's sheet rows for the overlay's "Good rolls" block; null when the sheet
 *  does not list the weapon. */
export function sheetGoodRolls(weaponName: string): SheetGoodRolls | null {
  const weapon = findSheetWeapon(weaponName);
  if (!weapon) return null;
  const labels: Partial<Record<RollStatCode, string>> = {};
  const rows = weapon.rows.map((row): SheetRollLine => {
    const [first, second, third] = row.slots;
    const slotCodes: SheetRollLine["slotCodes"] = [
      [...first.stats],
      [...second.stats],
      [...third.stats],
    ];
    const negativeCodes = [...row.negatives.stats];
    for (const code of [...slotCodes.flat(), ...negativeCodes]) {
      labels[code] = ROLL_STAT_LABELS[code];
    }
    return {
      sheetRow: row.sheetRow,
      positives: [...row.raw.positives],
      negatives: row.raw.negatives,
      note: row.raw.note,
      slotCodes,
      negativeCodes,
    };
  });
  return { weapon: weapon.name, rows, labels };
}

function sheetRating(
  weaponName: string,
  stats: { name: string; positive: boolean }[],
): RivenSheetRating {
  const tagged = stats.map((s) => ({
    tag: rivenData.statNameToTag(s.name) ?? "",
    positive: s.positive,
  }));
  const { weapon, rating, row } = rateRivenBySheet(weaponName, tagged);
  const codes = (positive: boolean): RollStatCode[] =>
    tagged
      .filter((s) => s.positive === positive)
      .map((s) => rollCodeForTag(s.tag))
      .filter((code): code is RollStatCode => code !== null);
  return {
    weapon: weapon?.name ?? null,
    rating,
    sheetRow: row?.sheetRow ?? null,
    positives: codes(true),
    negatives: codes(false),
  };
}

/** Grades OCR stats, or returns null when the weapon or riven type is unknown. */
export function gradeRiven(
  weaponName: string,
  stats: {
    name: string;
    positive: boolean;
    displayPositive?: boolean;
    value: number | null;
    multiplier?: boolean;
  }[],
): RivenGradeResult | null {
  if (!stats || stats.length === 0) return null;

  const baseDisposition = rivenData.getWeaponDisposition(weaponName);
  if (baseDisposition == null) {
    log.warn(`[RivenGrade] Weapon not found: "${weaponName}"`);
    return null;
  }

  const rivenTypeKey = rivenData.resolveRivenType(weaponName);
  if (!rivenTypeKey) {
    log.warn(`[RivenGrade] No riven type for weapon: "${weaponName}"`);
    return null;
  }

  // Count buffs and curses
  const numBuffs = stats.filter((s) => s.positive).length;
  const numCurses = stats.filter((s) => !s.positive).length;
  let assumedLevel = DEFAULT_LVL;
  // Both counts scale every displayed value, so a line the scan lost reads the
  // survivors high. The scanned counts are a lower bound, as in correctScannedStats.
  let assumedBuffs = numBuffs;
  let assumedCurses = numCurses;

  // Reject impossible shapes before invalid values are clamped into valid grades.
  if (numBuffs > 3 || numCurses > 1) {
    log.warn(
      `[RivenGrade] impossible stat shape (${numBuffs} buffs / ${numCurses} curses) - skipping grade`,
    );
    return null;
  }

  // Precomputed once per stat; the dispo and rank search below re-reads it
  // for every candidate combination.
  const prepared = stats.map((stat) => {
    const tag = rivenData.statNameToTag(stat.name);
    const entry = tag ? rivenData.findUpgradeEntry(rivenTypeKey, tag) : null;
    const isFraction = !!tag && NON_PERCENTAGE_TAGS.has(tag);
    let displayedValue: number | null = null;
    // Half a display step, in the same units as displayedValue - the card shows
    // one decimal, or two for an x-multiplier.
    let halfStep = 0.05;
    if (stat.value != null && Number.isFinite(stat.value)) {
      if (stat.multiplier) {
        // "x1.05" is a +0.05 multiplier, and faction damage is a non-percentage
        // tag whose displayed value IS that fraction (browse.wf: "0.05 to 0.06
        // Damage to Corpus"). Scaling it by 100 here counted the scale twice and
        // pinned every scanned faction roll to the top or bottom of its range.
        const fraction = stat.positive ? stat.value - 1 : 1 - stat.value;
        displayedValue = isFraction ? fraction : fraction * 100;
        halfStep = isFraction ? 0.005 : 0.5;
      } else {
        displayedValue = stat.value;
      }
    }
    return { stat, tag, entry, displayedValue, halfStep };
  });

  type Prepared = (typeof prepared)[number];
  const rawFloatAt = (
    p: Prepared,
    disp: number,
    lvl: number,
    buffs: number,
    curses: number,
    value: number = p.displayedValue!,
  ): number =>
    p.stat.positive
      ? unparseBuffRaw(value, p.entry!.baseValue, disp, buffs, curses, p.tag!, lvl)
      : unparseCurseRaw(value, p.entry!.baseValue, disp, buffs, curses, p.tag!, lvl);

  // On a wide stat the card's rounding is noise, but Wolf Sledge Range spans
  // 0.2 to 0.3 metres at rank 0, so half a step is half the roll. Ask whether
  // the rounding interval can reach [0,1] rather than whether one nominal value
  // lands inside it.
  const fitsAt = (
    p: Prepared,
    disp: number,
    lvl: number,
    buffs: number,
    curses: number,
  ): boolean => {
    const a = rawFloatAt(p, disp, lvl, buffs, curses, p.displayedValue! - p.halfStep);
    const b = rawFloatAt(p, disp, lvl, buffs, curses, p.displayedValue! + p.halfStep);
    return Math.min(a, b) <= 1 + FIT_TOLERANCE && Math.max(a, b) >= -FIT_TOLERANCE;
  };

  // Two things the card does not tell us: the roll screen names the family but
  // uses the linked variant's disposition, and a chat-linked mod shows its values
  // at its own rank. An unranked card reads 1/9 of max, so grading it at rank 8
  // scores every stat F. Search rank and disposition together before grading.
  let disposition = baseDisposition;
  const gradeable = prepared.filter((p) => p.tag && p.entry && p.displayedValue != null);
  if (gradeable.length > 0) {
    // Sum of how far out of [0,1] the card sits, for ranking near-misses when
    // nothing fits outright.
    const violationAt = (disp: number, lvl: number, buffs: number, curses: number): number =>
      gradeable.reduce((sum, p) => {
        const f = rawFloatAt(p, disp, lvl, buffs, curses);
        return sum + Math.max(0, f - 1) + Math.max(0, -f);
      }, 0);
    const allFitAt = (disp: number, lvl: number, buffs: number, curses: number): boolean =>
      gradeable.every((p) => fitsAt(p, disp, lvl, buffs, curses));

    if (!allFitAt(disposition, assumedLevel, assumedBuffs, assumedCurses)) {
      const candidates = [
        { name: weaponName, disposition: baseDisposition },
        ...rivenData.getFamilyVariants(weaponName),
      ];

      // Highest rank first, so a card that fits at max rank is never demoted
      // just because a lower rank happens to fit as well. Needs two stats to
      // pin a rank - a lone value fits several, and picking one is a guess.
      const maxRefitLvl = gradeable.length >= 2 ? DEFAULT_LVL : -1;
      type Refit = {
        name: string;
        disposition: number;
        lvl: number;
        buffs: number;
        curses: number;
      };
      const refitAt = (buffs: number, curses: number): Refit | null => {
        for (let lvl = maxRefitLvl; lvl >= 0; lvl--) {
          let best: Refit | null = null;
          for (const candidate of candidates) {
            if (!allFitAt(candidate.disposition, lvl, buffs, curses)) continue;
            const closer =
              !best ||
              Math.abs(candidate.disposition - baseDisposition) <
                Math.abs(best.disposition - baseDisposition);
            if (closer) best = { ...candidate, lvl, buffs, curses };
          }
          if (best) return best;
        }
        return null;
      };

      // The scanned counts come first, so a card that fits as read is never
      // re-read as one the scan took a line off.
      let refit: Refit | null = null;
      for (const [buffs, curses] of plausibleStatCounts(numBuffs, numCurses)) {
        refit = refitAt(buffs, curses);
        if (refit) break;
      }

      if (refit) {
        if (refit.disposition !== disposition) {
          log.info(
            `[RivenGrade] "${weaponName}" dispo misfits the rolled values - grading as "${refit.name}"`,
          );
          disposition = refit.disposition;
        }
        if (refit.lvl !== assumedLevel) {
          log.info(
            `[RivenGrade] "${weaponName}" values match rank ${refit.lvl} - grading at that rank`,
          );
          assumedLevel = refit.lvl;
        }
        if (refit.buffs !== assumedBuffs || refit.curses !== assumedCurses) {
          log.info(
            `[RivenGrade] "${weaponName}" values match ${refit.buffs} buffs / ${refit.curses} ` +
              `curses - grading as a card the scan read short`,
          );
          assumedBuffs = refit.buffs;
          assumedCurses = refit.curses;
        }
      } else {
        // Nothing fits exactly - keep max rank and settle for the least violating
        // dispo and stat counts. Scanned counts come first, so widening has to
        // strictly improve the fit before it is taken.
        let best = {
          name: weaponName,
          disposition,
          buffs: assumedBuffs,
          curses: assumedCurses,
          violation: violationAt(disposition, assumedLevel, assumedBuffs, assumedCurses),
        };
        for (const [buffs, curses] of plausibleStatCounts(numBuffs, numCurses)) {
          for (const variant of candidates) {
            const violation = violationAt(variant.disposition, assumedLevel, buffs, curses);
            const closer =
              Math.abs(variant.disposition - baseDisposition) <
              Math.abs(best.disposition - baseDisposition);
            if (
              violation < best.violation - 1e-9 ||
              (violation < best.violation + 1e-9 && closer)
            ) {
              best = {
                name: variant.name,
                disposition: variant.disposition,
                buffs,
                curses,
                violation,
              };
            }
          }
        }
        if (best.disposition !== disposition) {
          log.info(
            `[RivenGrade] "${weaponName}" dispo misfits the rolled values - grading as "${best.name}"`,
          );
          disposition = best.disposition;
        }
        if (best.buffs !== assumedBuffs || best.curses !== assumedCurses) {
          log.info(
            `[RivenGrade] "${weaponName}" sits closest to ${best.buffs} buffs / ${best.curses} ` +
              `curses - grading as a card the scan read short`,
          );
          assumedBuffs = best.buffs;
          assumedCurses = best.curses;
        }
      }
    }
  }

  const gradedStats: GradedStat[] = [];
  let scoreSum = 0;
  let scoredCount = 0;

  for (const p of prepared) {
    const { stat, tag, entry } = p;
    if (!tag || !entry) {
      if (!tag) log.debug(`[RivenGrade] Unknown stat: "${stat.name}" - assigning B grade`);
      else
        log.debug(`[RivenGrade] Tag "${tag}" not in riven type ${rivenTypeKey.split("/").pop()}`);
      gradedStats.push({
        ...stat,
        grade: "B",
        rollFloat: 0.5,
      });
      scoreSum += 0; // lerp(-10, 10, 0.5) = 0
      scoredCount++;
      continue;
    }

    if (p.displayedValue != null) {
      const rollFloat = clamp01(
        rawFloatAt(p, disposition, assumedLevel, assumedBuffs, assumedCurses),
      );
      const grade = floatToGrade(rollFloat, !stat.positive);
      const score = lerp(-10, 10, !stat.positive ? 1 - rollFloat : rollFloat);

      gradedStats.push({
        ...stat,
        grade,
        rollFloat,
      });
      scoreSum += score;
      scoredCount++;
    } else {
      // No value - can't grade, assign mid-range
      gradedStats.push({
        ...stat,
        grade: "?",
        rollFloat: 0.5,
      });
    }
  }

  // Overall grade = average of all stat scores
  let overallGrade = "?";
  if (scoredCount > 0) {
    const avgScore = scoreSum / scoredCount;
    const avgFloat = inverseLerp(-10, 10, avgScore);
    overallGrade = floatToGrade(avgFloat, false);
  }

  return { stats: gradedStats, overallGrade, sheet: sheetRating(weaponName, stats) };
}
