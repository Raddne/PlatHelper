// Dropdown filters for the Live Scraper listings table. Like the search box they
// only change what is shown: the tab counters keep counting everything tracked,
// and the row cap applies to what is left.

import { ownedCountForAlertItem } from "../marketAlerts/ownedCount.js";
import { statTagToDisplayName } from "../../../config/shared/rivenStatDisplayNames.js";
import { wfmItemCategory, type WfmItemCategory } from "../../../config/shared/wfmItemCategory.js";
import type { LiveScraperWtbListing } from "../../../config/shared/liveScraperEngine.js";
import type { ListingsTab } from "../../../config/shared/liveScraperSettings.js";
import type { StockEntryStatus, StockItem } from "../../../config/shared/liveScraperStock.js";
import type { StockRiven, StockRivenStat } from "../../../config/shared/liveScraperRivenStock.js";
import type { ParsedItem } from "../../types/inventory.js";
import type { WfmItemsLookup } from "../../types/ipc.js";

/** The value of every dropdown's "All" / "Any" entry. */
export const ALL = "all";

/** Status dropdown entries that are not a status of their own. */
export const STATUS_HIDDEN = "hiddenOnWfm";
export const STATUS_PAUSED = "paused";

export const NEGATIVE_NONE = "none";
export const NEGATIVE_SOME = "some";

export const MAX_POSITIVES = 3;
export const MR_LIMITS = ["8", "12", "16"] as const;

export type ListingStatus = StockEntryStatus | LiveScraperWtbListing["status"];
type ListingOrigin = "trade" | "manual" | "adopted";

export interface WtbFilters {
  type: typeof ALL | WfmItemCategory;
  source: typeof ALL | "wishlist" | "scan";
  owned: typeof ALL | "yes" | "no";
  status: string;
}

export interface WtsFilters {
  type: typeof ALL | WfmItemCategory;
  origin: typeof ALL | ListingOrigin;
  status: string;
}

export interface RivenFilters {
  weapon: string;
  /** Stat tags; a riven has to carry every one of them as a positive. */
  positives: string[];
  /** ALL, NEGATIVE_NONE, NEGATIVE_SOME, or one stat tag. */
  negative: string;
  polarity: string;
  rerolls: typeof ALL | "unrolled" | "rolled";
  /** Highest mastery rank requirement, as the dropdown's value. */
  mr: typeof ALL | (typeof MR_LIMITS)[number];
  status: string;
}

export interface ListingFilters {
  wtb: WtbFilters;
  wts: WtsFilters;
  rivens: RivenFilters;
}

export function defaultListingFilters(): ListingFilters {
  return {
    wtb: { type: ALL, source: ALL, owned: ALL, status: ALL },
    wts: { type: ALL, origin: ALL, status: ALL },
    rivens: {
      weapon: ALL,
      positives: [],
      negative: ALL,
      polarity: ALL,
      rerolls: ALL,
      mr: ALL,
      status: ALL,
    },
  };
}

export function resetTabFilters(filters: ListingFilters, tab: ListingsTab): void {
  const fresh = defaultListingFilters();
  if (tab === "wtb") filters.wtb = fresh.wtb;
  else if (tab === "wts") filters.wts = fresh.wts;
  else filters.rivens = fresh.rivens;
}

export function hasActiveFilters(filters: ListingFilters, tab: ListingsTab): boolean {
  if (tab === "wtb") {
    const f = filters.wtb;
    return f.type !== ALL || f.source !== ALL || f.owned !== ALL || f.status !== ALL;
  }
  if (tab === "wts") {
    const f = filters.wts;
    return f.type !== ALL || f.origin !== ALL || f.status !== ALL;
  }
  const f = filters.rivens;
  return (
    f.positives.length > 0 ||
    [f.weapon, f.negative, f.polarity, f.rerolls, f.mr, f.status].some((value) => value !== ALL)
  );
}

/** The WTB table row fields the filters read. */
export interface WtbFilterRow {
  wfmUrl: string | null;
  itemName: string;
  source: "wishlist" | "scan";
  status: ListingStatus;
  listPrice: number | null;
  /** Hidden on warframe.market; undefined while unknown. */
  hidden: boolean | undefined;
  /** Paused by the user (a wishlist row's isHidden); scan rows never are. */
  paused: boolean;
}

/** What a row's Status cell shows: `hidden` is the condition the hidden-on-WFM
 *  badge is drawn on, so the Status filter and the column always agree. */
interface RowState {
  status: ListingStatus;
  hidden: boolean;
  paused: boolean;
}

export function wtbRowState(row: WtbFilterRow): RowState {
  return {
    status: row.status,
    hidden: row.listPrice != null && row.hidden === true,
    paused: row.paused,
  };
}

export function stockRowState(item: StockItem): RowState {
  return {
    status: item.status,
    hidden: item.listPrice != null && item.wfmHidden === true,
    paused: item.isHidden,
  };
}

export function rivenRowState(riven: StockRiven): RowState {
  return {
    status: riven.status,
    hidden: riven.auctionId != null && riven.wfmHidden === true,
    paused: riven.isHidden,
  };
}

interface StatusCounts {
  byStatus: Map<ListingStatus, number>;
  hidden: number;
  paused: number;
}

export function countStatuses(states: readonly RowState[]): StatusCounts {
  const counts: StatusCounts = { byStatus: new Map(), hidden: 0, paused: 0 };
  for (const state of states) {
    counts.byStatus.set(state.status, (counts.byStatus.get(state.status) ?? 0) + 1);
    if (state.hidden) counts.hidden += 1;
    if (state.paused) counts.paused += 1;
  }
  return counts;
}

function matchesStatus(filter: string, state: RowState): boolean {
  if (filter === ALL) return true;
  if (filter === STATUS_HIDDEN) return state.hidden;
  if (filter === STATUS_PAUSED) return state.paused;
  return state.status === filter;
}

/** Answers for one item, by slug with the display name as the fallback key. */
type ItemLookup<T> = (slug: string | null, name: string) => T;

function memoized<T>(resolve: ItemLookup<T>): ItemLookup<T> {
  const memo = new Map<string, T>();
  return (slug, name) => {
    // A slug never holds a NUL, so a name key cannot collide with one.
    const key = slug ?? `\u0000${name}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const value = resolve(slug, name);
    memo.set(key, value);
    return value;
  };
}

/** The main process's answer from the full catalog record. Until that is in (or
 *  for a slug it does not know) the same shared rules run on slug and name alone,
 *  which cannot see the game path or the max rank. */
export function categoryLookup(
  categories: Readonly<Record<string, WfmItemCategory>>,
): ItemLookup<WfmItemCategory> {
  return memoized(
    (slug, name) =>
      (slug ? categories[slug] : undefined) ??
      wfmItemCategory({ slug: slug ?? "", gameRef: null, name, maxRank: null }),
  );
}

/** At least one in the loaded game inventory, joined the way market alerts count
 *  owned items (name, slug, then the catalog gameRef). With no inventory loaded,
 *  a WTS stock row that still holds one counts instead. */
export function ownedLookup(
  parsedItems: ParsedItem[],
  wfmItems: WfmItemsLookup,
  stock: readonly StockItem[],
): ItemLookup<boolean> {
  if (parsedItems.length === 0) {
    const held = new Set(stock.filter((item) => item.owned > 0).map((item) => item.wfmUrl));
    return (slug) => slug != null && held.has(slug);
  }
  return memoized(
    (slug, name) => ownedCountForAlertItem(slug ?? "", name, parsedItems, wfmItems) > 0,
  );
}

export function wtbFilter(
  filters: WtbFilters,
  categoryOf: ItemLookup<WfmItemCategory>,
  ownedOf: ItemLookup<boolean>,
): (row: WtbFilterRow) => boolean {
  const { type, source, owned, status } = filters;
  return (row) =>
    (source === ALL || row.source === source) &&
    matchesStatus(status, wtbRowState(row)) &&
    (type === ALL || categoryOf(row.wfmUrl, row.itemName) === type) &&
    (owned === ALL || ownedOf(row.wfmUrl, row.itemName) === (owned === "yes"));
}

/** A row taken over from warframe.market counts as that even once a trade topped it up. */
function listingOrigin(item: StockItem): ListingOrigin {
  if (item.adopted === true) return "adopted";
  return item.origin === "trade" ? "trade" : "manual";
}

export function wtsFilter(
  filters: WtsFilters,
  categoryOf: ItemLookup<WfmItemCategory>,
): (item: StockItem) => boolean {
  const { type, origin, status } = filters;
  return (item) =>
    (origin === ALL || listingOrigin(item) === origin) &&
    matchesStatus(status, stockRowState(item)) &&
    (type === ALL || categoryOf(item.wfmUrl, item.itemName) === type);
}

function matchesNegative(filter: string, stats: readonly StockRivenStat[]): boolean {
  if (filter === ALL) return true;
  const negatives = stats.filter((stat) => !stat.positive);
  if (filter === NEGATIVE_NONE) return negatives.length === 0;
  if (filter === NEGATIVE_SOME) return negatives.length > 0;
  return negatives.some((stat) => stat.tag === filter);
}

export function rivenFilter(filters: RivenFilters): (riven: StockRiven) => boolean {
  const { weapon, positives, negative, polarity, rerolls, mr, status } = filters;
  const maxMr = mr === ALL ? Infinity : Number(mr);
  return (riven) =>
    (weapon === ALL || riven.weaponName === weapon) &&
    positives.every((tag) => riven.stats.some((stat) => stat.positive && stat.tag === tag)) &&
    matchesNegative(negative, riven.stats) &&
    (polarity === ALL || riven.polarity === polarity) &&
    (rerolls === ALL || (rerolls === "unrolled" ? riven.rerolls === 0 : riven.rerolls >= 1)) &&
    riven.masteryReq <= maxMr &&
    matchesStatus(status, rivenRowState(riven));
}

interface RivenFilterOptions {
  weapons: string[];
  positives: string[];
  negatives: string[];
  polarities: string[];
}

/** What the Rivens dropdowns offer: only values some tracked riven has. */
export function rivenFilterOptions(rivens: readonly StockRiven[]): RivenFilterOptions {
  const weapons = new Set<string>();
  const positives = new Set<string>();
  const negatives = new Set<string>();
  const polarities = new Set<string>();
  for (const riven of rivens) {
    weapons.add(riven.weaponName);
    polarities.add(riven.polarity);
    for (const stat of riven.stats) (stat.positive ? positives : negatives).add(stat.tag);
  }
  const byText = (a: string, b: string): number => a.localeCompare(b);
  const byStatName = (a: string, b: string): number =>
    statTagToDisplayName(a).localeCompare(statTagToDisplayName(b));
  return {
    weapons: [...weapons].sort(byText),
    positives: [...positives].sort(byStatName),
    negatives: [...negatives].sort(byStatName),
    polarities: [...polarities].sort(byText),
  };
}

const NOT_AN_OPTION = new Set<string>([ALL, NEGATIVE_NONE, NEGATIVE_SOME]);

/** A picked value whose last row went away stays listed, so the dropdown still
 *  shows what filters the table and it can be switched off. */
export function keepPicked(options: readonly string[], picked: readonly string[]): string[] {
  const missing = picked.filter((value) => !NOT_AN_OPTION.has(value) && !options.includes(value));
  return [...options, ...missing];
}
