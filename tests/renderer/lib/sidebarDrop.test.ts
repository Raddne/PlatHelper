import { describe, expect, it } from "vitest";

import {
  canGroupOnto,
  normalizeOrder,
  planDrop,
  zoneAt,
  type SidebarRow,
} from "../../../src/lib/sidebarDrop";

type V = "inv" | "a" | "b" | "c" | "d" | "set";
const ORDER: V[] = ["inv", "a", "b", "c", "d", "set"];
const view = (v: V, groupId: string | null = null): SidebarRow<V> => ({
  kind: "view",
  view: v,
  groupId,
  fixed: v === "inv" || v === "set",
});
const group = (id: string, collapsed = false): SidebarRow<V> => ({ kind: "group", id, collapsed });

describe("zoneAt", () => {
  it("splits a groupable row into edge bands and a middle", () => {
    expect(zoneAt(0.1, true)).toBe("before");
    expect(zoneAt(0.5, true)).toBe("center");
    expect(zoneAt(0.9, true)).toBe("after");
  });

  it("leaves no dead middle when grouping is impossible", () => {
    expect(zoneAt(0.49, false)).toBe("before");
    expect(zoneAt(0.51, false)).toBe("after");
  });
});

describe("normalizeOrder", () => {
  it("pulls scattered group members together at the first member", () => {
    expect(normalizeOrder(ORDER, { a: "g", d: "g" })).toEqual(["inv", "a", "d", "b", "c", "set"]);
  });
});

describe("planDrop with a view in hand", () => {
  it("inserts before and after a plain row", () => {
    expect(planDrop(ORDER, {}, { kind: "view", view: "d" }, view("a"), "before")?.order).toEqual([
      "inv",
      "d",
      "a",
      "b",
      "c",
      "set",
    ]);
    expect(planDrop(ORDER, {}, { kind: "view", view: "a" }, view("c"), "after")?.order).toEqual([
      "inv",
      "b",
      "c",
      "a",
      "d",
      "set",
    ]);
  });

  it("is a no-op where the row already sits", () => {
    expect(planDrop(ORDER, {}, { kind: "view", view: "b" }, view("a"), "after")).toBeNull();
    expect(planDrop(ORDER, {}, { kind: "view", view: "b" }, view("c"), "before")).toBeNull();
    expect(planDrop(ORDER, {}, { kind: "view", view: "b" }, view("b"), "before")).toBeNull();
  });

  it("founds a group on the middle of a plain row, never on a fixed one", () => {
    const plan = planDrop(ORDER, {}, { kind: "view", view: "d" }, view("a"), "center");
    expect(plan).toEqual({ order: ["inv", "a", "d", "b", "c", "set"], createGroupWith: "a" });
    expect(canGroupOnto({ kind: "view", view: "d" }, view("inv"), {})).toBe(false);
    expect(planDrop(ORDER, {}, { kind: "view", view: "d" }, view("inv"), "center")).toBeNull();
  });

  it("joins a group through a member's edge or the header's middle", () => {
    const assignment = { a: "g", b: "g" } as const;
    expect(
      planDrop(ORDER, assignment, { kind: "view", view: "d" }, view("a", "g"), "after"),
    ).toEqual({
      order: ["inv", "a", "d", "b", "c", "set"],
      joinGroup: "g",
    });
    expect(planDrop(ORDER, assignment, { kind: "view", view: "d" }, group("g"), "center")).toEqual({
      order: ["inv", "a", "b", "d", "c", "set"],
      joinGroup: "g",
    });
  });

  it("treats the space under an open header as the first slot, under a closed one as past the block", () => {
    const assignment = { a: "g", b: "g" } as const;
    expect(planDrop(ORDER, assignment, { kind: "view", view: "d" }, group("g"), "after")).toEqual({
      order: ["inv", "d", "a", "b", "c", "set"],
      joinGroup: "g",
    });
    expect(
      planDrop(ORDER, assignment, { kind: "view", view: "d" }, group("g", true), "after"),
    ).toEqual({
      order: ["inv", "a", "b", "d", "c", "set"],
      joinGroup: null,
    });
  });

  it("leaves its group when dropped next to a plain row", () => {
    const assignment = { a: "g", b: "g" } as const;
    expect(planDrop(ORDER, assignment, { kind: "view", view: "b" }, view("c"), "before")).toEqual({
      order: ORDER,
      joinGroup: null,
    });
    expect(planDrop(ORDER, assignment, { kind: "view", view: "a" }, group("g"), "before")).toEqual({
      order: ORDER,
      joinGroup: null,
    });
  });

  it("reorders inside its own group", () => {
    const assignment = { a: "g", b: "g", c: "g" } as const;
    expect(
      planDrop(ORDER, assignment, { kind: "view", view: "c" }, view("a", "g"), "before"),
    ).toEqual({
      order: ["inv", "c", "a", "b", "d", "set"],
      joinGroup: "g",
    });
  });
});

describe("planDrop with a group in hand", () => {
  const assignment = { a: "g", b: "g", c: "h", d: "h" } as const;

  it("moves the whole block and goes around another group", () => {
    expect(
      planDrop(ORDER, assignment, { kind: "group", id: "g" }, view("d", "h"), "after")?.order,
    ).toEqual(["inv", "c", "d", "a", "b", "set"]);
    expect(
      planDrop(ORDER, assignment, { kind: "group", id: "h" }, group("g"), "before")?.order,
    ).toEqual(["inv", "c", "d", "a", "b", "set"]);
  });

  it("ignores its own rows and never groups", () => {
    expect(
      planDrop(ORDER, assignment, { kind: "group", id: "g" }, view("a", "g"), "after"),
    ).toBeNull();
    expect(canGroupOnto({ kind: "group", id: "g" }, view("c"), assignment)).toBe(false);
  });
});
