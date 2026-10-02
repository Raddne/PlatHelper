// The roll sheet's rows as stat groups: the stats a good roll must have, the ones
// that may complete it, and the curses the row accepts. Riven pricing, the alert
// prefill and the riven views read the sheet through these. Pure.

import type { KeyStatGroup } from "./liveScraperRivenPricing";
import {
  findSheetWeapon,
  rollCodeForTag,
  ROLL_STAT_LABELS,
  type RollSheetRow,
  type RollStatCode,
} from "./rivenRollSheet";
import { statTagToDisplayName } from "./rivenStatDisplayNames";
import { TAG_TO_WFM_URL_NAME, tagToWfmUrlName } from "./wfmRivenVocabulary";

/** One sheet row as stat codes. */
interface SheetRowStats {
  /** The stat of every slot that names exactly one stat and may not stay empty. */
  mandatory: RollStatCode[];
  /** Every stat of the other slots; an ANY slot names none. */
  optional: RollStatCode[];
  /** The curses the row lists; ANY and NONE name none. */
  negatives: RollStatCode[];
}

function sheetRowStats(row: RollSheetRow): SheetRowStats {
  const mandatory: RollStatCode[] = [];
  const optional: RollStatCode[] = [];
  for (const slot of row.slots) {
    if (slot.any) continue;
    const target = !slot.none && slot.stats.length === 1 ? mandatory : optional;
    for (const code of slot.stats) if (!target.includes(code)) target.push(code);
  }
  return {
    mandatory,
    optional: optional.filter((code) => !mandatory.includes(code)),
    negatives: [...row.negatives.stats],
  };
}

// Every upgrade tag warframe.market knows, by sheet code: DMG is the ranged and
// the melee damage tag, CCC both combo count tags.
const TAGS_BY_CODE = new Map<RollStatCode, string[]>();
for (const tag of Object.keys(TAG_TO_WFM_URL_NAME)) {
  const code = rollCodeForTag(tag);
  if (code) TAGS_BY_CODE.set(code, [...(TAGS_BY_CODE.get(code) ?? []), tag]);
}

/** The WFM attributes a code stands for, without repeats. */
function rollCodeUrlNames(code: RollStatCode): string[] {
  const out: string[] = [];
  for (const tag of TAGS_BY_CODE.get(code) ?? []) {
    const name = tagToWfmUrlName(tag);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The weapon's sheet rows as WFM url names, one group per row. A row whose
 *  mandatory stat has no single WFM attribute is dropped rather than loosened. */
export function sheetKeyStatGroups(weaponName: string): KeyStatGroup[] {
  const weapon = findSheetWeapon(weaponName);
  if (!weapon) return [];
  const groups: KeyStatGroup[] = [];
  for (const row of weapon.rows) {
    const { mandatory, optional } = sheetRowStats(row);
    const required = mandatory.map(rollCodeUrlNames);
    if (required.some((names) => names.length !== 1)) continue;
    const must = required.map((names) => names[0]!);
    const may: string[] = [];
    for (const name of optional.flatMap(rollCodeUrlNames)) {
      if (!must.includes(name) && !may.includes(name)) may.push(name);
    }
    groups.push({ mandatory: must, optional: may });
  }
  return groups;
}

/** One sheet stat in every vocabulary a caller needs: the upgrade tag it is shown
 *  as, the WFM url_name alerts speak, and the label the UI shows. */
export interface RivenGoodRollAttribute {
  tag: string;
  /** null when warframe.market has no auction attribute for this tag. */
  wfmUrlName: string | null;
  displayName: string;
}

/** One sheet row, resolved for display and for alert prefill. */
export interface RivenGoodRollGroup {
  mandatory: RivenGoodRollAttribute[];
  optional: RivenGoodRollAttribute[];
  /** The curses this row accepts. */
  negatives: RivenGoodRollAttribute[];
}

export interface RivenGoodRoll {
  groups: RivenGoodRollGroup[];
  /** Every row's accepted curses together, for a weapon-level list. */
  acceptedNegatives: RivenGoodRollAttribute[];
}

// The melee form of a stat on a melee weapon (Melee Damage), and the tag whose
// label is the sheet's where a code has several (Additional Combo Count Chance).
function displayTag(code: RollStatCode, isMelee: boolean): string | null {
  const tags = TAGS_BY_CODE.get(code) ?? [];
  const sided = tags.filter((tag) => tag.includes("Melee") === isMelee);
  const pool = sided.length > 0 ? sided : tags;
  return (
    pool.find((tag) => statTagToDisplayName(tag) === ROLL_STAT_LABELS[code]) ?? pool[0] ?? null
  );
}

function attribute(code: RollStatCode, isMelee: boolean): RivenGoodRollAttribute {
  const tag = displayTag(code, isMelee);
  if (!tag) return { tag: code, wfmUrlName: null, displayName: ROLL_STAT_LABELS[code] };
  return {
    tag,
    wfmUrlName: tagToWfmUrlName(tag),
    displayName: statTagToDisplayName(tag, isMelee),
  };
}

function union(lists: RollStatCode[][]): RollStatCode[] {
  const out: RollStatCode[] = [];
  for (const code of lists.flat()) if (!out.includes(code)) out.push(code);
  return out;
}

/** The weapon's sheet rows as groups, for the alert prefill. Null when the sheet
 *  does not list the weapon. */
export function sheetGoodRollDetail(weaponName: string, isMelee = false): RivenGoodRoll | null {
  const weapon = findSheetWeapon(weaponName);
  if (!weapon) return null;
  const rows = weapon.rows.map(sheetRowStats);
  const resolve = (codes: RollStatCode[]) => codes.map((code) => attribute(code, isMelee));
  return {
    groups: rows.map((row) => ({
      mandatory: resolve(row.mandatory),
      optional: resolve(row.optional),
      negatives: resolve(row.negatives),
    })),
    acceptedNegatives: resolve(union(rows.map((row) => row.negatives))),
  };
}

/** Every stat the weapon's rows want, the required ones first, and every curse
 *  they accept, as labels. Null when the sheet does not list the weapon. */
export function sheetBestAttributes(
  weaponName: string,
  isMelee = false,
): { positives: string[]; negatives: string[] } | null {
  const weapon = findSheetWeapon(weaponName);
  if (!weapon) return null;
  const rows = weapon.rows.map(sheetRowStats);
  const label = (code: RollStatCode) => attribute(code, isMelee).displayName;
  return {
    positives: union([...rows.map((row) => row.mandatory), ...rows.map((row) => row.optional)]).map(
      label,
    ),
    negatives: union(rows.map((row) => row.negatives)).map(label),
  };
}
