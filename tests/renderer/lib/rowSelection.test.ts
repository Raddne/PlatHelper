import { describe, expect, it } from "vitest";

import {
  clickRow,
  EMPTY_ROW_SELECTION,
  pruneSelection,
  type RowSelection,
} from "../../../src/lib/rowSelection";

const ORDER = ["a", "b", "c", "d", "e"];
const PLAIN = { ctrl: false, shift: false };
const CTRL = { ctrl: true, shift: false };
const SHIFT = { ctrl: false, shift: true };

const keys = (s: RowSelection): string[] => [...s.selected].sort();

describe("row selection", () => {
  it("a plain click selects one row and clears it on a second click", () => {
    const one = clickRow(ORDER, EMPTY_ROW_SELECTION, "b", PLAIN);
    expect(keys(one)).toEqual(["b"]);
    expect(keys(clickRow(ORDER, one, "c", PLAIN))).toEqual(["c"]);
    expect(keys(clickRow(ORDER, one, "b", PLAIN))).toEqual([]);
  });

  it("ctrl+click toggles rows without touching the others", () => {
    let s = clickRow(ORDER, EMPTY_ROW_SELECTION, "a", PLAIN);
    s = clickRow(ORDER, s, "c", CTRL);
    s = clickRow(ORDER, s, "e", CTRL);
    expect(keys(s)).toEqual(["a", "c", "e"]);
    expect(keys(clickRow(ORDER, s, "c", CTRL))).toEqual(["a", "e"]);
  });

  it("shift+click selects the range from the anchor, in either direction", () => {
    const anchor = clickRow(ORDER, EMPTY_ROW_SELECTION, "c", PLAIN);
    expect(keys(clickRow(ORDER, anchor, "e", SHIFT))).toEqual(["c", "d", "e"]);
    const up = clickRow(ORDER, anchor, "a", SHIFT);
    expect(keys(up)).toEqual(["a", "b", "c"]);
    // The anchor stays, so a second shift+click re-ranges instead of growing.
    expect(keys(clickRow(ORDER, up, "d", SHIFT))).toEqual(["c", "d"]);
  });

  it("ctrl+shift adds the range to what is already selected", () => {
    let s = clickRow(ORDER, EMPTY_ROW_SELECTION, "a", PLAIN);
    s = clickRow(ORDER, s, "d", CTRL);
    expect(keys(clickRow(ORDER, s, "e", { ctrl: true, shift: true }))).toEqual(["a", "d", "e"]);
  });

  it("shift+click without an anchor behaves like a plain click", () => {
    expect(keys(clickRow(ORDER, EMPTY_ROW_SELECTION, "d", SHIFT))).toEqual(["d"]);
  });

  it("forgets rows that no longer exist", () => {
    let s = clickRow(ORDER, EMPTY_ROW_SELECTION, "b", PLAIN);
    s = clickRow(ORDER, s, "d", SHIFT);
    const pruned = pruneSelection(["a", "c", "d"], s);
    expect(keys(pruned)).toEqual(["c", "d"]);
    expect(pruned.anchor).toBeNull();
    expect(pruneSelection(ORDER, s)).toBe(s);
  });
});
