#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version, for the release workflow.
// Usage: node scripts/release-notes.mjs <version> [changelog path]
// Exits 1 when the version has no section or the section is empty, so a release
// can never go out without patch notes.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The body under `## v<version>` up to the next `## ` heading, trimmed. */
export function extractReleaseNotes(changelog, version) {
  const wanted = String(version).replace(/^v/, "");
  const lines = String(changelog).replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => {
    const match = /^##\s+v?(\S+)\s*$/.exec(line);
    return match !== null && match[1] === wanted;
  });
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s+/.test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body.length > 0 ? body : null;
}

function main() {
  const [version, file = "CHANGELOG.md"] = process.argv.slice(2);
  if (!version) {
    console.error("usage: release-notes.mjs <version> [changelog]");
    process.exit(1);
  }
  const notes = extractReleaseNotes(readFileSync(file, "utf8"), version);
  if (!notes) {
    console.error(`::error::${file} has no patch notes for v${version.replace(/^v/, "")}`);
    console.error(`Add a "## v${version.replace(/^v/, "")}" section with bullet points first.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
