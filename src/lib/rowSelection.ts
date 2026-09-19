// Click selection for a list of rows, the way file managers do it: a plain
// click selects one row, Ctrl/Cmd+click toggles a row, Shift+click selects the
// range from the last plainly or Ctrl-clicked row (the anchor). Pure, so the
// rules are testable without a DOM.

export interface RowSelection {
  selected: ReadonlySet<string>;
  /** Where a Shift+click range starts; null until something was clicked. */
  anchor: string | null;
}

export const EMPTY_ROW_SELECTION: RowSelection = { selected: new Set(), anchor: null };

interface ClickModifiers {
  ctrl: boolean;
  shift: boolean;
}

export function clickRow(
  order: readonly string[],
  current: RowSelection,
  key: string,
  modifiers: ClickModifiers,
): RowSelection {
  if (modifiers.shift && current.anchor != null) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(key);
    if (from !== -1 && to !== -1) {
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      // Ctrl+Shift adds the range; Shift alone replaces the selection with it.
      const base = modifiers.ctrl ? current.selected : [];
      return { selected: new Set([...base, ...range]), anchor: current.anchor };
    }
  }
  if (modifiers.ctrl) {
    const selected = new Set(current.selected);
    if (!selected.delete(key)) selected.add(key);
    return { selected, anchor: key };
  }
  // A plain click on the only selected row clears it again.
  if (current.selected.size === 1 && current.selected.has(key)) return EMPTY_ROW_SELECTION;
  return { selected: new Set([key]), anchor: key };
}

/** Drops keys whose rows are gone (removed, sold, filtered out). */
export function pruneSelection(order: readonly string[], current: RowSelection): RowSelection {
  if (current.selected.size === 0) return current;
  const live = new Set(order);
  const selected = new Set([...current.selected].filter((key) => live.has(key)));
  if (selected.size === current.selected.size) return current;
  return {
    selected,
    anchor: current.anchor != null && live.has(current.anchor) ? current.anchor : null,
  };
}
