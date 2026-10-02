// Search rules of the Live Scraper's Rivens panel: the search box over the
// tracked rivens, and the owned-riven picker, which also searches stats.

import { RIVEN_STAT_CODES } from "./rivenStatCodes.js";

interface NamedRiven {
  weaponName: string;
  rivenName: string;
}

interface SearchableStat {
  tag: string;
  name: string;
  positive: boolean;
}

interface SearchableRiven extends NamedRiven {
  stats: readonly SearchableStat[];
}

/** Case-insensitive substring match against the weapon name, the riven name, or
 *  both as "weapon riven" ("rubico crita"). An empty query matches every riven. */
export function rivenMatchesQuery(riven: NamedRiven, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const weapon = riven.weaponName.toLowerCase();
  const name = riven.rivenName.toLowerCase();
  return weapon.includes(needle) || name.includes(needle) || `${weapon} ${name}`.includes(needle);
}

// The typographic minus (U+2212) counts as "-".
const SIGNS: Readonly<Record<string, boolean>> = { "+": true, "-": false, "\u2212": false };

/** A stat matches a lowercase word by a substring of its name or by one of its
 *  codes, which must be typed whole ("c" is not "cc"). */
function statMatches(stat: SearchableStat, word: string): boolean {
  return (
    stat.name.toLowerCase().includes(word) || (RIVEN_STAT_CODES[stat.tag] ?? []).includes(word)
  );
}

function wordMatches(riven: SearchableRiven, word: string): boolean {
  const positive = SIGNS[word.charAt(0)];
  if (positive !== undefined) {
    const rest = word.slice(1);
    return (
      rest === "" ||
      riven.stats.some((stat) => stat.positive === positive && statMatches(stat, rest))
    );
  }
  return (
    riven.weaponName.toLowerCase().includes(word) ||
    riven.rivenName.toLowerCase().includes(word) ||
    riven.stats.some((stat) => statMatches(stat, word))
  );
}

/** The picker's rule: every whitespace-separated word must match. A word looks at
 *  the weapon, the riven name and the stats; "+word" / "-word" only at the
 *  riven's positive / negative stats. An empty query matches every riven. */
export function rivenMatchesPickerQuery(riven: SearchableRiven, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => wordMatches(riven, word));
}
