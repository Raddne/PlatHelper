import { get, writable, type Readable } from "svelte/store";

import { invoke, on } from "../lib/ipc.js";
import {
  defaultLiveScraperSettings,
  type ItemGeneralSettings,
  type ItemWtbSettings,
  type ItemWtsSettings,
  type LiveScraperGeneralSettings,
  type LiveScraperSettings,
  type RivenGeneralSettings,
  type RivenWtsSettings,
  type SyndicateWtsSettings,
} from "../../config/shared/liveScraperSettings.js";

export type { TradeMode } from "../../config/shared/liveScraperSettings.js";

// Main process is authoritative (services/liveScraperSettings.ts, persisted via
// jsonCache) since the engine itself reads these settings; this store is a thin
// IPC-backed mirror, not its own source of truth. See docs/live-scraper §9.
const store = writable<LiveScraperSettings>(defaultLiveScraperSettings());

export const liveScraperSettings: Readable<LiveScraperSettings> = { subscribe: store.subscribe };

let hydrating: Promise<void> | null = null;

function hydrate(): Promise<void> {
  if (!hydrating) {
    hydrating = invoke("liveScraperGetSettings")
      .then((settings) => {
        store.set(settings);
      })
      .catch(() => {
        // Keep the in-memory defaults; the next successful update or push
        // reconciles the store once the main process is reachable again.
      });
  }
  return hydrating;
}
void hydrate();

on("live-scraper:changed", () => {
  hydrating = null;
  void hydrate();
});

async function persist(next: LiveScraperSettings): Promise<void> {
  store.set(next); // optimistic, so the form feels immediate
  try {
    const saved = await invoke("liveScraperUpdateSettings", next);
    store.set(saved);
  } catch {
    // Best effort: the optimistic value stays until the next successful
    // update or a "changed" push reconciles it.
  }
}

export function updateGeneralSettings(
  fn: (current: LiveScraperGeneralSettings) => LiveScraperGeneralSettings,
): void {
  const current = get(store);
  void persist({ ...current, general: fn(current.general) });
}

export function updateItemGeneralSettings(
  fn: (current: ItemGeneralSettings) => ItemGeneralSettings,
): void {
  const current = get(store);
  void persist({ ...current, items: { ...current.items, general: fn(current.items.general) } });
}

export function updateItemWtbSettings(fn: (current: ItemWtbSettings) => ItemWtbSettings): void {
  const current = get(store);
  void persist({ ...current, items: { ...current.items, wtb: fn(current.items.wtb) } });
}

export function updateItemWtsSettings(fn: (current: ItemWtsSettings) => ItemWtsSettings): void {
  const current = get(store);
  void persist({ ...current, items: { ...current.items, wts: fn(current.items.wts) } });
}

export function updateRivenGeneralSettings(
  fn: (current: RivenGeneralSettings) => RivenGeneralSettings,
): void {
  const current = get(store);
  void persist({ ...current, rivens: { ...current.rivens, general: fn(current.rivens.general) } });
}

export function updateRivenWtsSettings(fn: (current: RivenWtsSettings) => RivenWtsSettings): void {
  const current = get(store);
  void persist({ ...current, rivens: { ...current.rivens, wts: fn(current.rivens.wts) } });
}

export function updateSyndicateWtsSettings(
  fn: (current: SyndicateWtsSettings) => SyndicateWtsSettings,
): void {
  const current = get(store);
  void persist({ ...current, syndicate: { wts: fn(current.syndicate.wts) } });
}
