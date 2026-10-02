import { describe, expect, it } from "vitest";

import { withUniqueKeys } from "../../../src/lib/uniqueKeys";

const ids = (...values: string[]) => values.map((id) => ({ id }));

describe("withUniqueKeys", () => {
  it("keeps each key as it is while none repeats", () => {
    expect(withUniqueKeys(ids("a", "b", "c"), (row) => row.id).map((row) => row.key)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps every row and gives a repeat a key of its own, the first keeps its id", () => {
    const rows = ids("a", "b", "a", "a");
    const keyed = withUniqueKeys(rows, (row) => row.id);
    expect(keyed.map((row) => row.item)).toEqual(rows);
    expect(keyed[0]!.key).toBe("a");
    expect(keyed[1]!.key).toBe("b");
    expect(new Set(keyed.map((row) => row.key)).size).toBe(4);
  });

  it("never meets a stored id that looks like a counted key", () => {
    const keyed = withUniqueKeys(ids("a", "a", "a\u00002"), (row) => row.id);
    expect(new Set(keyed.map((row) => row.key)).size).toBe(3);
  });

  it("separates rows whose key is empty or missing", () => {
    const rows = [{ id: "" }, { id: "" }, {}, {}] as { id: string }[];
    const keyed = withUniqueKeys(rows, (row) => row.id);
    expect(keyed).toHaveLength(4);
    expect(new Set(keyed.map((row) => row.key)).size).toBe(4);
  });
});
