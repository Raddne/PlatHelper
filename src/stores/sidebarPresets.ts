import { get, writable, type Readable } from "svelte/store";

import { readStoredJson, writeStorage } from "../lib/persistence.js";
import { TOGGLEABLE_VIEWS } from "../lib/viewRegistry.js";
import type { ToggleableView } from "../types/views.js";
import { sidebarOrder, tabVisibility } from "./sidebarTabs.js";

const STORAGE_KEY = "wf_sidebar_presets_v1";
const MAX_PRESETS = 20;
export const PRESET_NAME_MAX = 60;

/** Sentinel id for the built-in, non-deletable "every function" preset. It is
 *  never written to storage; the file only ever holds user-created presets. */
export const DEFAULT_PRESET_ID = "default";

export interface SidebarPreset {
  id: string;
  name: string;
  /** Checked functions, in the user's chosen order. Anything in
   *  TOGGLEABLE_VIEWS not listed here is hidden. Inventory and settings are
   *  permanent bookends and never appear in this list. */
  order: ToggleableView[];
}

interface PresetsFile {
  version: 1;
  presets: SidebarPreset[];
  activePresetId: string;
}

function emptyFile(): PresetsFile {
  return { version: 1, presets: [], activePresetId: DEFAULT_PRESET_ID };
}

/** The always-available "everything" preset. Kept out of the stored list so a
 *  cleared/corrupted file can never lose the safe fallback. */
function defaultPreset(): SidebarPreset {
  return { id: DEFAULT_PRESET_ID, name: "", order: [...TOGGLEABLE_VIEWS] };
}

function normalizeOrder(raw: unknown): ToggleableView[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(TOGGLEABLE_VIEWS);
  const seen = new Set<ToggleableView>();
  const out: ToggleableView[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !allowed.has(entry)) continue;
    const view = entry as ToggleableView;
    if (seen.has(view)) continue;
    seen.add(view);
    out.push(view);
  }
  return out;
}

function normalizePreset(raw: unknown): SidebarPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || entry.id === "" || entry.id === DEFAULT_PRESET_ID)
    return null;
  const name = typeof entry.name === "string" ? entry.name.trim().slice(0, PRESET_NAME_MAX) : "";
  if (!name) return null;
  return { id: entry.id, name, order: normalizeOrder(entry.order) };
}

function normalizeFile(raw: unknown): PresetsFile {
  if (!raw || typeof raw !== "object") return emptyFile();
  const entry = raw as Record<string, unknown>;
  if (entry.version !== 1) return emptyFile();
  const list = Array.isArray(entry.presets) ? entry.presets : [];
  const presets: SidebarPreset[] = [];
  const ids = new Set<string>();
  for (const value of list) {
    if (presets.length >= MAX_PRESETS) break;
    const preset = normalizePreset(value);
    if (!preset || ids.has(preset.id)) continue;
    ids.add(preset.id);
    presets.push(preset);
  }
  const activePresetId =
    typeof entry.activePresetId === "string" &&
    (entry.activePresetId === DEFAULT_PRESET_ID || ids.has(entry.activePresetId))
      ? entry.activePresetId
      : DEFAULT_PRESET_ID;
  return { version: 1, presets, activePresetId };
}

function load(): PresetsFile {
  return readStoredJson(STORAGE_KEY, normalizeFile, emptyFile);
}

const file = writable<PresetsFile>(load());

/** Saved presets, newest addition last. The default preset is not part of this
 *  list; callers that need "everything the user can pick" should prepend it. */
export const presets: Readable<SidebarPreset[]> = {
  subscribe(run) {
    return file.subscribe((value) => run(value.presets));
  },
};

export const activePresetId: Readable<string> = {
  subscribe(run) {
    return file.subscribe((value) => run(value.activePresetId));
  },
};

function commit(next: PresetsFile): void {
  const normalized = normalizeFile(next);
  writeStorage(STORAGE_KEY, JSON.stringify(normalized));
  file.set(normalized);
}

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `preset-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function findPreset(id: string): SidebarPreset | null {
  if (id === DEFAULT_PRESET_ID) return defaultPreset();
  return get(file).presets.find((preset) => preset.id === id) ?? null;
}

/** Creates a new preset and applies it immediately, matching the wizard's
 *  "finish creating" affordance. Returns the new id, or null on a blank name. */
export function createPreset(name: string, order: readonly ToggleableView[]): string | null {
  const trimmed = name.trim().slice(0, PRESET_NAME_MAX);
  if (!trimmed) return null;
  const current = get(file);
  const preset: SidebarPreset = { id: newId(), name: trimmed, order: normalizeOrder(order) };
  // At the cap the oldest entry makes room, so saving never silently no-ops.
  const kept = current.presets.slice(Math.max(0, current.presets.length - MAX_PRESETS + 1));
  commit({ ...current, presets: [...kept, preset] });
  applyPreset(preset.id);
  return preset.id;
}

export function updatePreset(id: string, name: string, order: readonly ToggleableView[]): boolean {
  const trimmed = name.trim().slice(0, PRESET_NAME_MAX);
  if (!trimmed || id === DEFAULT_PRESET_ID) return false;
  const current = get(file);
  if (!current.presets.some((preset) => preset.id === id)) return false;
  commit({
    ...current,
    presets: current.presets.map((preset) =>
      preset.id === id ? { ...preset, name: trimmed, order: normalizeOrder(order) } : preset,
    ),
  });
  if (current.activePresetId === id) applyPreset(id);
  return true;
}

export function deletePreset(id: string): void {
  if (id === DEFAULT_PRESET_ID) return;
  const current = get(file);
  commit({
    ...current,
    presets: current.presets.filter((preset) => preset.id !== id),
    activePresetId: current.activePresetId === id ? DEFAULT_PRESET_ID : current.activePresetId,
  });
}

/** Pushes a preset's function set and order onto the live sidebar. The order
 *  store re-inserts inventory, settings and any hidden view at their default
 *  slot, so only the checked views need listing here. */
export function applyPreset(id: string): boolean {
  const preset = findPreset(id);
  if (!preset) return false;
  const visible = new Set(preset.order);
  for (const view of TOGGLEABLE_VIEWS) tabVisibility[view].set(visible.has(view));
  sidebarOrder.set([...preset.order]);
  const current = get(file);
  if (current.activePresetId !== id) commit({ ...current, activePresetId: id });
  return true;
}
