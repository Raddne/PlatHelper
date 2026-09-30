import { writable, type Readable } from "svelte/store";

import { invoke } from "../lib/ipc.js";
import type { WfmItemCategory } from "../../config/shared/wfmItemCategory.js";

// Slug -> item type for the Live Scraper listings filters, decided in the main
// process from the whole catalog record. The catalog does not change within a
// session, so one non-empty answer is kept for good.
const store = writable<Readonly<Record<string, WfmItemCategory>>>({});

export const liveScraperItemFacts: Readable<Readonly<Record<string, WfmItemCategory>>> = {
  subscribe: store.subscribe,
};

let loaded = false;
let loading: Promise<void> | null = null;

/** Asks the main process once. An empty answer means its catalog is not up
 *  yet, so it is not kept and the next call asks again. */
export function loadLiveScraperItemFacts(): void {
  if (loaded || loading) return;
  loading = invoke("liveScraperItemFacts")
    .then((categories) => {
      if (Object.keys(categories).length === 0) return;
      loaded = true;
      store.set(categories);
    })
    .catch(() => {
      // Retried on the next call; the filters decide from slug and name meanwhile.
    })
    .finally(() => {
      loading = null;
    });
}
