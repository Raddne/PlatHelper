// Best-effort item category classification for warframe.market search
// results, used to pick a small glyph icon in ItemPicker instead of a
// per-item thumbnail image. wfmSearchItems/wfmCatalog does not carry WFM's
// own item tags today, so this classifies from the name/slug and maxRank
// only - a heuristic, not authoritative. Good enough for a picker icon;
// never used for pricing or matching logic.

import type { WfmSearchItem } from "../types/market.js";

export type ItemCategory = "arcane" | "mod" | "primePart" | "weaponPart" | "misc";

const WEAPON_PART_SUFFIXES = [
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

export function categorizeItem(item: Pick<WfmSearchItem, "item_name" | "maxRank">): ItemCategory {
  const name = (item.item_name || "").toLowerCase();
  const isRankable = typeof item.maxRank === "number" && item.maxRank > 0;

  if (isRankable) {
    return name.startsWith("arcane ") ? "arcane" : "mod";
  }
  if (name.includes("prime")) return "primePart";
  if (WEAPON_PART_SUFFIXES.some((suffix) => name.endsWith(suffix))) return "weaponPart";
  return "misc";
}
