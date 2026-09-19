// Pure drop planning for the sidebar's drag-and-drop. Nothing moves while a row
// is being dragged: the pointer only picks an intent (an insertion line or a
// group highlight), and the one resulting change is applied on release. Layout
// therefore stays still under the pointer, which is what keeps hit-testing exact.

export type DropZone = "before" | "center" | "after";

export type SidebarRow<V extends string> =
  | { kind: "view"; view: V; groupId: string | null; fixed: boolean }
  | { kind: "group"; id: string; collapsed: boolean };

export type DragSubject<V extends string> =
  | { kind: "view"; view: V }
  | { kind: "group"; id: string };

export interface DropPlan<V extends string> {
  order: V[];
  /** View subject only: the group it ends up in (null = top level). */
  joinGroup?: string | null;
  /** View subject only: found a new group together with this view. */
  createGroupWith?: V;
}

type Assignment<V extends string> = Partial<Record<V, string>>;

/** Edge share of a row that means "insert"; the middle means "group". */
const EDGE_BAND_RATIO = 0.3;

/** Group members contiguous, at the position of their first member. */
export function normalizeOrder<V extends string>(
  order: readonly V[],
  assignment: Assignment<V>,
): V[] {
  const out: V[] = [];
  const seen = new Set<string>();
  for (const view of order) {
    const groupId = assignment[view];
    if (!groupId) out.push(view);
    else if (!seen.has(groupId)) {
      seen.add(groupId);
      out.push(...order.filter((v) => assignment[v] === groupId));
    }
  }
  return out;
}

/** Whether dropping `subject` on the middle of `target` can group them. */
export function canGroupOnto<V extends string>(
  subject: DragSubject<V>,
  target: SidebarRow<V>,
  assignment: Assignment<V>,
): boolean {
  if (subject.kind !== "view") return false;
  if (target.kind === "group") return assignment[subject.view] !== target.id;
  // A member row already joins its group through its edges, so it has no middle.
  return !target.fixed && target.groupId === null && target.view !== subject.view;
}

export function zoneAt(relativeY: number, allowCenter: boolean): DropZone {
  if (!allowCenter) return relativeY < 0.5 ? "before" : "after";
  if (relativeY < EDGE_BAND_RATIO) return "before";
  if (relativeY > 1 - EDGE_BAND_RATIO) return "after";
  return "center";
}

function place<V extends string>(
  order: readonly V[],
  moving: readonly V[],
  anchor: V,
  side: "before" | "after",
): V[] | null {
  const movingSet = new Set(moving);
  if (moving.length === 0 || movingSet.has(anchor)) return null;
  const rest = order.filter((v) => !movingSet.has(v));
  const index = rest.indexOf(anchor);
  if (index < 0) return null;
  const at = side === "before" ? index : index + 1;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** The change a drop makes, or null when it would change nothing. */
export function planDrop<V extends string>(
  rawOrder: readonly V[],
  assignment: Assignment<V>,
  subject: DragSubject<V>,
  target: SidebarRow<V>,
  zone: DropZone,
): DropPlan<V> | null {
  const order = normalizeOrder(rawOrder, assignment);
  const members = (groupId: string): V[] => order.filter((v) => assignment[v] === groupId);

  if (subject.kind === "group") {
    const moving = members(subject.id);
    const targetGroup = target.kind === "group" ? target.id : target.groupId;
    if (targetGroup === subject.id) return null;
    const side = zone === "before" ? "before" : "after";
    // A group never lands inside another one: it goes around the whole block.
    const block = targetGroup ? members(targetGroup) : [(target as { view: V }).view];
    const anchor = side === "before" ? block[0] : block[block.length - 1];
    const next = anchor ? place(order, moving, anchor, side) : null;
    return next && changed(next, rawOrder) ? { order: next } : null;
  }

  const view = subject.view;
  const currentGroup = assignment[view] ?? null;

  if (zone === "center") {
    if (!canGroupOnto(subject, target, assignment)) return null;
    if (target.kind === "group") {
      const block = members(target.id);
      const last = block[block.length - 1];
      const next = last ? place(order, [view], last, "after") : null;
      return next ? { order: next, joinGroup: target.id } : null;
    }
    const next = place(order, [view], target.view, "after");
    return next ? { order: next, createGroupWith: target.view } : null;
  }

  let anchor: V | undefined;
  let side: "before" | "after" = zone;
  let joinGroup: string | null;
  if (target.kind === "view") {
    if (target.view === view) return null;
    anchor = target.view;
    joinGroup = target.groupId;
  } else {
    const block = members(target.id);
    if (zone === "after" && !target.collapsed) {
      // Just under an open header is the group's first slot.
      anchor = block[0];
      side = "before";
      joinGroup = target.id;
      if (anchor === view) return currentGroup === target.id ? null : { order, joinGroup };
    } else {
      anchor = zone === "before" ? block[0] : block[block.length - 1];
      joinGroup = null;
      if (anchor === view) {
        // Its own block's edge: the row stays put and only leaves the group.
        return currentGroup === null ? null : { order, joinGroup: null };
      }
    }
  }

  const next = anchor ? place(order, [view], anchor, side) : null;
  if (!next) return null;
  if (!changed(next, rawOrder) && joinGroup === currentGroup) return null;
  return { order: next, joinGroup };
}

function changed<V>(next: readonly V[], previous: readonly V[]): boolean {
  return next.length !== previous.length || next.some((v, i) => v !== previous[i]);
}
