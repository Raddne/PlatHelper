import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain .mjs release script without type declarations
import { extractReleaseNotes as extractUntyped } from "../../scripts/release-notes.mjs";

const extractReleaseNotes = extractUntyped as (changelog: string, version: string) => string | null;

const SAMPLE = [
  "# Changelog",
  "",
  "## v0.2.0",
  "",
  "- second",
  "  wrapped line",
  "",
  "## v0.1.0",
  "",
  "- first",
  "",
  "## v0.0.9",
  "",
].join("\r\n");

describe("release notes", () => {
  it("returns exactly one version's section, with or without the v", () => {
    expect(extractReleaseNotes(SAMPLE, "0.2.0")).toBe("- second\n  wrapped line");
    expect(extractReleaseNotes(SAMPLE, "v0.1.0")).toBe("- first");
  });

  it("treats a missing or empty section as no notes", () => {
    expect(extractReleaseNotes(SAMPLE, "0.3.0")).toBeNull();
    expect(extractReleaseNotes(SAMPLE, "0.0.9")).toBeNull();
    // 0.1 must not match 0.1.0.
    expect(extractReleaseNotes(SAMPLE, "0.1")).toBeNull();
  });

  it("has patch notes for the version in package.json", () => {
    const root = path.resolve(__dirname, "../..");
    const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      version: string;
    };
    const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    expect(extractReleaseNotes(changelog, version)).not.toBeNull();
  });
});
