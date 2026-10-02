import { derived, type Writable } from "svelte/store";
import { persistedStringList } from "../lib/persistence.js";

const stores = new Map<string, Writable<string[]>>();

function unique(list: readonly string[]): string[] {
  return [...new Set(list)];
}

// A hand-edited list can repeat a search, which throws each_key_duplicate in
// the keyed chip row. Dedupe on read, like masteryPins, and on every write.
function dedupedList(key: string): Writable<string[]> {
  const list = persistedStringList(key);
  const deduped = derived(list, unique);
  return {
    subscribe: deduped.subscribe,
    set(value: string[]): void {
      list.set(unique(value));
    },
    update(fn: (value: string[]) => string[]): void {
      list.update((current) => unique(fn(unique(current))));
    },
  };
}

export function savedSearches(scope: string): Writable<string[]> {
  let store = stores.get(scope);
  if (!store) {
    store = dedupedList(`savedSearches.${scope}`);
    stores.set(scope, store);
  }
  return store;
}

export function addSavedSearch(scope: string, text: string): void {
  const query = text.trim();
  if (!query) return;
  savedSearches(scope).update((list) =>
    list.some((s) => s.toLowerCase() === query.toLowerCase()) ? list : [...list, query],
  );
}

export function removeSavedSearch(scope: string, text: string): void {
  savedSearches(scope).update((list) => list.filter((s) => s !== text));
}
