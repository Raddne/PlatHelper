import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import { DEFAULT_VISIBLE_VIEWS, TOGGLEABLE_VIEWS } from "../../../src/lib/viewRegistry.js";

const PRESETS_KEY = "wf_sidebar_presets_v1";
const MARKER_KEY = "wf_sidebar_defaults_v2";

let store = new Map<string, string>();

// The preset and tab stores read localStorage at import time, so every case
// needs a fresh module registry on top of the seeded storage.
async function loadModule(seed: Record<string, string> = {}) {
  store = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.resetModules();
  const presets = await import("../../../src/stores/sidebarPresets.js");
  const tabs = await import("../../../src/stores/sidebarTabs.js");
  return { ...presets, ...tabs };
}

function presetsFile(presets: unknown[], activePresetId: string): string {
  return JSON.stringify({ version: 1, presets, activePresetId });
}

function storedFile(): { presets: unknown[]; activePresetId: string } | null {
  const raw = store.get(PRESETS_KEY);
  return raw ? JSON.parse(raw) : null;
}

const HIDDEN_BY_DEFAULT = TOGGLEABLE_VIEWS.filter((view) => !DEFAULT_VISIBLE_VIEWS.includes(view));

const ALL_VISIBLE = Object.fromEntries(
  TOGGLEABLE_VIEWS.map((view) => [`wf_tab_visible_${view}`, "1"]),
);

const USER_PRESET = { id: "user-1", name: "Trading", order: ["market", "analytics", "wiki"] };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("built-in presets", () => {
  it("makes Default the reduced set and All functions every hideable view", async () => {
    const { findPreset, ALL_PRESET_ID, DEFAULT_PRESET_ID } = await loadModule();
    expect(findPreset(DEFAULT_PRESET_ID)?.order).toEqual(["dashboard", "liveScraper", "messages"]);
    expect(findPreset(ALL_PRESET_ID)?.order).toEqual([...TOGGLEABLE_VIEWS]);
  });

  it("starts on Default with no stored presets", async () => {
    const { activePresetId, presets } = await loadModule();
    expect(get(activePresetId)).toBe("default");
    expect(get(presets)).toEqual([]);
  });

  it("switches between All functions and Default without storing either", async () => {
    const { activePresetId, applyPreset, hiddenTabs, presets } = await loadModule();
    expect(applyPreset("all")).toBe(true);
    expect(get(hiddenTabs).size).toBe(0);
    expect(get(activePresetId)).toBe("all");
    expect(storedFile()).toEqual({ version: 1, presets: [], activePresetId: "all" });

    expect(applyPreset("default")).toBe(true);
    expect([...get(hiddenTabs)].sort()).toEqual([...HIDDEN_BY_DEFAULT].sort());
    expect(get(activePresetId)).toBe("default");
    expect(get(presets)).toEqual([]);
  });

  it("refuses to edit or delete either built-in", async () => {
    const { activePresetId, applyPreset, deletePreset, updatePreset } = await loadModule();
    applyPreset("all");
    expect(updatePreset("all", "Mine", ["market"])).toBe(false);
    expect(updatePreset("default", "Mine", ["market"])).toBe(false);
    deletePreset("all");
    deletePreset("default");
    expect(get(activePresetId)).toBe("all");
    expect(storedFile()?.presets).toEqual([]);
  });

  it("gives a created preset its own id and lists it after the built-ins", async () => {
    const { activePresetId, createPreset, presets } = await loadModule();
    const id = createPreset("Trading", ["market", "liveScraper"]);
    expect(id).toBeTruthy();
    expect(id).not.toBe("default");
    expect(id).not.toBe("all");
    expect(get(presets).map((preset) => preset.id)).toEqual([id]);
    expect(get(activePresetId)).toBe(id);
  });
});

describe("stored preset file", () => {
  it("drops stored presets that claim a built-in id", async () => {
    const { findPreset, presets } = await loadModule({
      [PRESETS_KEY]: presetsFile(
        [
          { id: "default", name: "Fake default", order: ["market"] },
          { id: "all", name: "Fake all", order: ["market"] },
          USER_PRESET,
        ],
        "user-1",
      ),
    });
    expect(get(presets).map((preset) => preset.id)).toEqual(["user-1"]);
    expect(findPreset("default")?.order).toEqual([...DEFAULT_VISIBLE_VIEWS]);
    expect(findPreset("all")?.order).toEqual([...TOGGLEABLE_VIEWS]);
  });

  it("keeps a built-in or a stored preset as the active id and falls back otherwise", async () => {
    const all = await loadModule({ [PRESETS_KEY]: presetsFile([], "all") });
    expect(get(all.activePresetId)).toBe("all");

    const user = await loadModule({ [PRESETS_KEY]: presetsFile([USER_PRESET], "user-1") });
    expect(get(user.activePresetId)).toBe("user-1");

    const gone = await loadModule({ [PRESETS_KEY]: presetsFile([], "user-1") });
    expect(get(gone.activePresetId)).toBe("default");
  });

  it("cleans names and orders and drops unnamed or repeated presets", async () => {
    const { presets } = await loadModule({
      [PRESETS_KEY]: presetsFile(
        [
          {
            id: "a",
            name: "  Trading  ",
            order: ["market", "market", "inventory", "nope", "wiki"],
          },
          { id: "a", name: "Duplicate", order: [] },
          { id: "b", name: "   ", order: ["market"] },
          { id: "", name: "No id", order: [] },
          "not a preset",
        ],
        "a",
      ),
    });
    expect(get(presets)).toEqual([{ id: "a", name: "Trading", order: ["market", "wiki"] }]);
  });

  it("falls back to an empty file on another version or unreadable JSON", async () => {
    const other = await loadModule({ [PRESETS_KEY]: JSON.stringify({ version: 2, presets: [] }) });
    expect(get(other.presets)).toEqual([]);
    expect(get(other.activePresetId)).toBe("default");

    const broken = await loadModule({ [PRESETS_KEY]: "{not json" });
    expect(get(broken.presets)).toEqual([]);
    expect(get(broken.activePresetId)).toBe("default");
  });
});

describe("migrateSidebarDefaults", () => {
  it("only sets the marker on a fresh profile", async () => {
    const { activePresetId, hiddenTabs, migrateSidebarDefaults } = await loadModule();
    migrateSidebarDefaults();
    expect([...store.entries()]).toEqual([[MARKER_KEY, "1"]]);
    expect([...get(hiddenTabs)].sort()).toEqual([...HIDDEN_BY_DEFAULT].sort());
    expect(get(activePresetId)).toBe("default");
  });

  it("moves an older profile onto Default and leaves presets and layout alone", async () => {
    const layout = {
      wf_sidebar_order: JSON.stringify(["settings", "market", "inventory", "dashboard"]),
      wf_sidebar_labels_v1: JSON.stringify({ market: "Bazaar" }),
      wf_sidebar_width: "260",
      wf_sidebar_groups_v1: JSON.stringify({
        groups: { g1: { id: "g1", name: "Trade", collapsed: false } },
        assignment: { market: "g1", analytics: "g1" },
      }),
    };
    const { activePresetId, applyPreset, hiddenTabs, migrateSidebarDefaults, presets } =
      await loadModule({
        "setup-completed-v2": "1",
        ...ALL_VISIBLE,
        [PRESETS_KEY]: presetsFile([USER_PRESET], "user-1"),
        ...layout,
      });

    migrateSidebarDefaults();

    for (const view of TOGGLEABLE_VIEWS) {
      expect(store.get(`wf_tab_visible_${view}`)).toBe(
        DEFAULT_VISIBLE_VIEWS.includes(view) ? "1" : "0",
      );
    }
    expect([...get(hiddenTabs)].sort()).toEqual([...HIDDEN_BY_DEFAULT].sort());
    expect(get(activePresetId)).toBe("default");
    expect(storedFile()).toEqual({ version: 1, presets: [USER_PRESET], activePresetId: "default" });
    expect(get(presets)).toEqual([USER_PRESET]);
    for (const [key, value] of Object.entries(layout)) expect(store.get(key)).toBe(value);
    expect(store.get(MARKER_KEY)).toBe("1");

    // The user preset is still one click away.
    expect(applyPreset("user-1")).toBe(true);
    expect(get(hiddenTabs).has("market")).toBe(false);
    expect(get(activePresetId)).toBe("user-1");
  });

  it("treats a stored visibility switch as an older profile even without a finished setup", async () => {
    const { hiddenTabs, migrateSidebarDefaults } = await loadModule({
      wf_tab_visible_market: "1",
    });
    migrateSidebarDefaults();
    expect(get(hiddenTabs).has("market")).toBe(true);
    expect(store.get("wf_tab_visible_market")).toBe("0");
  });

  it("does not write a preset file for an older profile that never had one", async () => {
    const { activePresetId, migrateSidebarDefaults } = await loadModule({
      "setup-completed-v2": "1",
    });
    migrateSidebarDefaults();
    expect(store.has(PRESETS_KEY)).toBe(false);
    expect(get(activePresetId)).toBe("default");
    expect(store.get("wf_tab_visible_dashboard")).toBe("1");
    expect(store.get("wf_tab_visible_market")).toBe("0");
  });

  it("changes nothing on a profile that already carries the marker", async () => {
    const seed = {
      [MARKER_KEY]: "1",
      "setup-completed-v2": "1",
      ...ALL_VISIBLE,
      [PRESETS_KEY]: presetsFile([USER_PRESET], "user-1"),
    };
    const { activePresetId, hiddenTabs, migrateSidebarDefaults } = await loadModule(seed);
    migrateSidebarDefaults();
    expect(Object.fromEntries(store)).toEqual(seed);
    expect(get(hiddenTabs).size).toBe(0);
    expect(get(activePresetId)).toBe("user-1");
  });

  it("runs once: a second start keeps whatever the user picked after it", async () => {
    const first = await loadModule({
      "setup-completed-v2": "1",
      ...ALL_VISIBLE,
      [PRESETS_KEY]: presetsFile([USER_PRESET], "user-1"),
    });
    first.migrateSidebarDefaults();
    first.applyPreset("all");
    const afterPick = Object.fromEntries(store);

    vi.resetModules();
    const second = await import("../../../src/stores/sidebarPresets.js");
    const secondTabs = await import("../../../src/stores/sidebarTabs.js");
    second.migrateSidebarDefaults();
    expect(Object.fromEntries(store)).toEqual(afterPick);
    expect(get(second.activePresetId)).toBe("all");
    expect(get(secondTabs.hiddenTabs).size).toBe(0);
  });
});
