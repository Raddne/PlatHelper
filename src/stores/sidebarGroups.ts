// Sidebar folder groups, created by dragging one nav row onto another and
// dwelling there (Sidebar.svelte). Deliberately independent of sidebarOrder/
// sidebarPresets (src/stores/sidebarTabs.ts, src/stores/sidebarPresets.ts) -
// like sidebarLabels, this is a personalization layer a preset does not
// capture or restore; sidebarOrder alone still governs the actual linear
// order every view lives at. A group is purely a rendering fold: Sidebar.svelte
// renders a group's header wherever its first (visible) member would have
// appeared, and its members do not need to be contiguous in sidebarOrder for
// that to work.

import { derived, writable, type Readable } from "svelte/store";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { TOGGLEABLE_VIEWS, type SidebarViewName } from "../lib/viewRegistry.js";

interface SidebarGroupMeta {
  id: string;
  name: string;
  collapsed: boolean;
}

type SidebarGroupAssignment = Partial<Record<SidebarViewName, string>>;

interface SidebarGroupsState {
  groups: Record<string, SidebarGroupMeta>;
  assignment: SidebarGroupAssignment;
}

const STORAGE_KEY = "wf_sidebar_groups_v1";
const KNOWN_VIEWS = new Set<string>(TOGGLEABLE_VIEWS);
export const SIDEBAR_GROUP_NAME_MAX = 40;

function emptyState(): SidebarGroupsState {
  return { groups: {}, assignment: {} };
}

/** A hand-edited or stale file could carry a "group" with fewer than two
 *  members (a merge always creates one with two, and every removal dissolves
 *  it below that) - such an entry is corrupt state, not a real group. */
function dropUndersizedGroups(state: SidebarGroupsState): SidebarGroupsState {
  const counts = new Map<string, number>();
  for (const groupId of Object.values(state.assignment)) {
    if (groupId) counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  const groups: Record<string, SidebarGroupMeta> = {};
  for (const [id, meta] of Object.entries(state.groups)) {
    if ((counts.get(id) ?? 0) >= 2) groups[id] = meta;
  }
  const assignment: SidebarGroupAssignment = {};
  for (const [view, groupId] of Object.entries(state.assignment)) {
    if (groupId && groups[groupId]) assignment[view as SidebarViewName] = groupId;
  }
  return { groups, assignment };
}

function sanitize(raw: unknown): SidebarGroupsState {
  if (!raw || typeof raw !== "object") return emptyState();
  const e = raw as Record<string, unknown>;
  const groups: Record<string, SidebarGroupMeta> = {};
  if (e.groups && typeof e.groups === "object" && !Array.isArray(e.groups)) {
    for (const [id, value] of Object.entries(e.groups as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      if (typeof v.name !== "string" || !v.name.trim()) continue;
      groups[id] = {
        id,
        name: v.name.trim().slice(0, SIDEBAR_GROUP_NAME_MAX),
        collapsed: v.collapsed === true,
      };
    }
  }
  const assignment: SidebarGroupAssignment = {};
  if (e.assignment && typeof e.assignment === "object" && !Array.isArray(e.assignment)) {
    for (const [view, groupId] of Object.entries(e.assignment as Record<string, unknown>)) {
      if (!KNOWN_VIEWS.has(view) || typeof groupId !== "string" || !groups[groupId]) continue;
      assignment[view as SidebarViewName] = groupId;
    }
  }
  return dropUndersizedGroups({ groups, assignment });
}

function load(): SidebarGroupsState {
  try {
    return sanitize(JSON.parse(readStorage(STORAGE_KEY) ?? "null"));
  } catch {
    return emptyState();
  }
}

function createStore(): {
  subscribe: Readable<SidebarGroupsState>["subscribe"];
  update(fn: (value: SidebarGroupsState) => SidebarGroupsState): void;
} {
  const store = writable<SidebarGroupsState>(load());
  const commit = (value: SidebarGroupsState): SidebarGroupsState => {
    const next = dropUndersizedGroups(value);
    writeStorage(STORAGE_KEY, JSON.stringify(next));
    return next;
  };
  return {
    subscribe: store.subscribe,
    update(fn: (value: SidebarGroupsState) => SidebarGroupsState): void {
      store.update((current) => commit(fn(current)));
    },
  };
}

const state = createStore();

export const sidebarGroupAssignment: Readable<SidebarGroupAssignment> = derived(
  state,
  (s) => s.assignment,
);
export const sidebarGroupMeta: Readable<Record<string, SidebarGroupMeta>> = derived(
  state,
  (s) => s.groups,
);

function newGroupId(): string {
  return `sbg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Merges `draggedView` with `targetView`. If `targetView` already belongs to
 *  a group, `draggedView` simply joins it; otherwise a brand-new group is
 *  created holding both. Returns the resulting group's id. A view already in
 *  the target group is a no-op (dwelling on your own group does nothing). */
export function groupViews(
  draggedView: SidebarViewName,
  targetView: SidebarViewName,
  defaultName: string,
): string {
  let resultId = "";
  state.update((current) => {
    if (draggedView === targetView) {
      resultId = current.assignment[draggedView] ?? "";
      return current;
    }
    const targetGroupId = current.assignment[targetView];
    if (targetGroupId && current.groups[targetGroupId]) {
      if (current.assignment[draggedView] === targetGroupId) {
        resultId = targetGroupId;
        return current;
      }
      resultId = targetGroupId;
      return {
        groups: current.groups,
        assignment: { ...current.assignment, [draggedView]: targetGroupId },
      };
    }
    const id = newGroupId();
    resultId = id;
    return {
      groups: { ...current.groups, [id]: { id, name: defaultName, collapsed: false } },
      assignment: { ...current.assignment, [draggedView]: id, [targetView]: id },
    };
  });
  return resultId;
}

/** Adds `view` into an existing group (dwelling on a group's header rather
 *  than one of its members). A no-op if it is already a member. */
export function addToGroup(view: SidebarViewName, groupId: string): void {
  state.update((current) => {
    if (!current.groups[groupId] || current.assignment[view] === groupId) return current;
    return { groups: current.groups, assignment: { ...current.assignment, [view]: groupId } };
  });
}

/** Removes one view from its group. A group left with fewer than two members
 *  dissolves entirely, matching the everyday "folder with one icon" rule. */
export function removeFromGroup(view: SidebarViewName): void {
  state.update((current) => {
    const groupId = current.assignment[view];
    if (!groupId) return current;
    const assignment = { ...current.assignment };
    delete assignment[view];
    return { groups: current.groups, assignment };
  });
}

export function renameGroup(groupId: string, rawName: string): void {
  state.update((current) => {
    const existing = current.groups[groupId];
    if (!existing) return current;
    const name = rawName.trim().slice(0, SIDEBAR_GROUP_NAME_MAX);
    if (!name) return current;
    return {
      groups: { ...current.groups, [groupId]: { ...existing, name } },
      assignment: current.assignment,
    };
  });
}

export function toggleGroupCollapsed(groupId: string): void {
  state.update((current) => {
    const existing = current.groups[groupId];
    if (!existing) return current;
    return {
      groups: { ...current.groups, [groupId]: { ...existing, collapsed: !existing.collapsed } },
      assignment: current.assignment,
    };
  });
}

/** Dissolves a group outright, freeing every member back to a standalone row. */
export function ungroupAll(groupId: string): void {
  state.update((current) => {
    if (!current.groups[groupId]) return current;
    const assignment = { ...current.assignment };
    for (const view of Object.keys(assignment) as SidebarViewName[]) {
      if (assignment[view] === groupId) delete assignment[view];
    }
    const groups = { ...current.groups };
    delete groups[groupId];
    return { groups, assignment };
  });
}
