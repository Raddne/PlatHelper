// Item type for the Live Scraper listings filter. Checked against the live
// /v2/items catalog (2026-09-30, 3892 items). warframe.market's own tags decide
// where the catalog has them; the worker's /v1/wfm-items projection drops them,
// so without tags the slug, the game path and the name decide instead.

export type WfmItemCategory = "mod" | "arcane" | "set" | "relic" | "part" | "misc";

/** Dropdown order. */
export const WFM_ITEM_CATEGORIES: readonly WfmItemCategory[] = [
  "mod",
  "arcane",
  "set",
  "relic",
  "part",
  "misc",
];

/** The catalog fields the decision reads. */
interface WfmItemTraits {
  tags?: readonly string[] | null | undefined;
  slug: string;
  /** The game's uniqueName; the worker keeps it where it drops the tags. */
  gameRef: string | null | undefined;
  name: string;
  maxRank: number | null | undefined;
}

// First match wins. Only four items carry two of these tags: the Peculiar mods,
// tagged "mod" and "arcane_enhancement", whose game path is the arcane one.
const TAG_CATEGORIES: ReadonlyArray<[string, WfmItemCategory]> = [
  ["set", "set"],
  ["relic", "relic"],
  ["arcane_enhancement", "arcane"],
  ["mod", "mod"],
  ["component", "part"],
  ["blueprint", "part"],
];

// Each tree holds its class alone: 164 arcanes, 974 mods. Augments, stances,
// companion precepts and the like are mods kept elsewhere, but they rank, so
// the rank rule below takes them.
const ARCANE_TREE = "/lotus/upgrades/cosmeticenhancers/";
const MOD_TREE = "/lotus/upgrades/mods/";

// The item picker's name rules (src/lib/itemCategory.ts), which stays as it is
// for its icon.
const PART_SUFFIXES = [
  "blueprint",
  "barrel",
  "receiver",
  "stock",
  "blade",
  "handle",
  "hilt",
  "chassis",
  "systems",
  "neuroptics",
  "grip",
  "string",
  "guard",
  "gauntlet",
  "pouch",
  "ornament",
  "link",
  "disc",
  "head",
  "limb",
  "prong",
  "lower limb",
  "upper limb",
];

function categoryFromTags(tags: readonly string[]): WfmItemCategory {
  for (const [tag, category] of TAG_CATEGORIES) {
    if (tags.includes(tag)) return category;
  }
  // Scenes, skins, keys, fish, whole weapons.
  return "misc";
}

function categoryWithoutTags(item: WfmItemTraits): WfmItemCategory {
  if (item.slug.endsWith("_set")) return "set";
  if (item.slug.endsWith("_relic")) return "relic";
  const path = (item.gameRef ?? "").toLowerCase();
  if (path.startsWith(ARCANE_TREE)) return "arcane";
  if (path.startsWith(MOD_TREE)) return "mod";
  const name = item.name.toLowerCase();
  if (typeof item.maxRank === "number" && item.maxRank > 0) {
    return name.startsWith("arcane ") ? "arcane" : "mod";
  }
  if (name.includes("prime")) return "part";
  if (PART_SUFFIXES.some((suffix) => name.endsWith(suffix))) return "part";
  return "misc";
}

export function wfmItemCategory(item: WfmItemTraits): WfmItemCategory {
  return item.tags && item.tags.length > 0
    ? categoryFromTags(item.tags)
    : categoryWithoutTags(item);
}
