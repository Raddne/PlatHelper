import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

/** A fresh copy of the store over a seeded localStorage. */
async function loadWithStorage(seed: Record<string, string> = {}) {
  const mem = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
  });
  vi.resetModules();
  return { store: await import("../../../src/stores/savedSearches.js"), mem };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saved searches", () => {
  it("reads a stored list that repeats a search once per search", async () => {
    const { store } = await loadWithStorage({
      "savedSearches.wiki:drops": JSON.stringify(["forma", "orokin cell", "forma"]),
    });
    expect(get(store.savedSearches("wiki:drops"))).toEqual(["forma", "orokin cell"]);
  });

  it("writes the list without the repeat and still skips a case-only duplicate", async () => {
    const { store, mem } = await loadWithStorage({
      "savedSearches.market": JSON.stringify(["forma", "forma"]),
    });
    store.addSavedSearch("market", "FORMA");
    store.addSavedSearch("market", "kuva");
    expect(get(store.savedSearches("market"))).toEqual(["forma", "kuva"]);
    expect(JSON.parse(mem.get("savedSearches.market") ?? "[]")).toEqual(["forma", "kuva"]);
  });

  it("removes a search", async () => {
    const { store } = await loadWithStorage({
      "savedSearches.market": JSON.stringify(["forma", "kuva"]),
    });
    store.removeSavedSearch("market", "forma");
    expect(get(store.savedSearches("market"))).toEqual(["kuva"]);
  });
});
