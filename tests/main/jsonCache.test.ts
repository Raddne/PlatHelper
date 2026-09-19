import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../services/userDataPath", () => ({
  userDataPath: (...segments: string[]) => path.join(mocks.directory, ...segments),
}));

import { createJsonCache } from "../../services/jsonCache";

interface Payload {
  items: string[];
}

const revive = (parsed: unknown): Payload | null =>
  parsed && typeof parsed === "object" && Array.isArray((parsed as Payload).items)
    ? (parsed as Payload)
    : null;

const copies = (): string[] =>
  fs.readdirSync(mocks.directory).filter((name) => name.endsWith(".bak"));

describe("json cache", () => {
  beforeEach(() => {
    mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "json-cache-"));
  });

  afterEach(() => {
    fs.rmSync(mocks.directory, { recursive: true, force: true });
  });

  it("round-trips a payload and keeps no copy of a readable file", () => {
    const cache = createJsonCache("data.json", revive, { keepUnreadable: true });
    expect(cache.read()).toBeNull();
    cache.write({ items: ["a"] });
    expect(cache.read()).toEqual({ items: ["a"] });
    expect(copies()).toEqual([]);
  });

  it("keeps a copy of user data it cannot read before the default overwrites it", () => {
    const file = path.join(mocks.directory, "data.json");
    fs.writeFileSync(file, '{"version":99,"rows":["from a newer version"]}');
    const cache = createJsonCache("data.json", revive, { keepUnreadable: true });

    expect(cache.read()).toBeNull();
    cache.write({ items: [] });

    expect(copies()).toHaveLength(1);
    expect(fs.readFileSync(path.join(mocks.directory, copies()[0]!), "utf8")).toContain(
      "from a newer version",
    );
  });

  it("does not copy plain caches", () => {
    fs.writeFileSync(path.join(mocks.directory, "data.json"), "not json");
    expect(createJsonCache("data.json", revive).read()).toBeNull();
    expect(copies()).toEqual([]);
  });
});
