// Proton often keeps fewer than Sainan's three copies, so accept a unique leading match.
import fs from "node:fs";

import { withScope } from "./logger";

const log = withScope("gameMemory");

const ACCOUNT_ID_MARKERS = [Buffer.from("?accountId="), Buffer.from("&accountId=")] as const;
const CHUNK = 16 * 1024 * 1024;
// An auth string is <70 bytes; overlap chunks so a match can't split across them.
const OVERLAP = 256;
const ACCOUNT_ID_LEN = 24; // DE account ids are 24-hex Mongo ObjectIds
const NONCE_SEP = "&nonce=";
const MAX_NONCE_DIGITS = 24;
// start-end perms offset dev inode [pathname]
const MAPS_LINE = /^([0-9a-f]+)-([0-9a-f]+) (\S{4}) \S+ \S+ +\S+(?:\s+(.*))?$/;
const MAX_REGION_BYTES = 4 * 1024 * 1024 * 1024; // reserve guard, never a real heap
// The initial user namespace maps every uid onto itself.
const INIT_UID_MAP = /^\s*0\s+0\s+4294967295\s*$/;

interface AuthzScanDiagnostics {
  truncated: number;
  invalidAccountId: number;
  missingNonce: number;
  emptyNonce: number;
  nonceTooLong: number;
}

type AuthzParseResult =
  | { authz: string; rejection: null }
  | { authz: null; rejection: keyof AuthzScanDiagnostics };

export function createAuthzScanDiagnostics(): AuthzScanDiagnostics {
  return {
    truncated: 0,
    invalidAccountId: 0,
    missingNonce: 0,
    emptyNonce: 0,
    nonceTooLong: 0,
  };
}

function parseAuthzCandidate(view: Buffer, at: number, markerLength: number): AuthzParseResult {
  const idStart = at + markerLength;
  const idEnd = idStart + ACCOUNT_ID_LEN;
  if (idEnd > view.length) return { authz: null, rejection: "truncated" };
  const accountId = view.toString("latin1", idStart, idEnd);
  if (!/^[0-9a-f]{24}$/i.test(accountId)) {
    return { authz: null, rejection: "invalidAccountId" };
  }
  if (idEnd + NONCE_SEP.length > view.length) {
    return { authz: null, rejection: "truncated" };
  }
  if (view.toString("latin1", idEnd, idEnd + NONCE_SEP.length) !== NONCE_SEP) {
    return { authz: null, rejection: "missingNonce" };
  }
  let p = idEnd + NONCE_SEP.length;
  let nonce = "";
  while (p < view.length && nonce.length < MAX_NONCE_DIGITS) {
    const c = view[p];
    if (c < 0x30 || c > 0x39) break; // not a digit
    nonce += String.fromCharCode(c);
    p++;
  }
  if (nonce.length === 0) {
    return { authz: null, rejection: p === view.length ? "truncated" : "emptyNonce" };
  }
  if (p < view.length && view[p] >= 0x30 && view[p] <= 0x39) {
    return { authz: null, rejection: "nonceTooLong" };
  }
  return { authz: `?accountId=${accountId.toLowerCase()}&nonce=${nonce}`, rejection: null };
}

function tally(
  result: AuthzParseResult,
  diagnostics: AuthzScanDiagnostics | undefined,
): string | null {
  if (result.rejection && diagnostics) diagnostics[result.rejection] += 1;
  return result.authz;
}

/** Parse the auth string at a marker hit, or null when the offset is not one. */
export function parseAuthzAt(
  view: Buffer,
  at: number,
  diagnostics?: AuthzScanDiagnostics,
): string | null {
  const marker = ACCOUNT_ID_MARKERS.find((candidate) =>
    view.subarray(at, at + candidate.length).equals(candidate),
  );
  if (!marker) return null;
  return tally(parseAuthzCandidate(view, at, marker.length), diagnostics);
}

export function scanBufferForAuthz(
  view: Buffer,
  counts: Map<string, number>,
  diagnostics?: AuthzScanDiagnostics,
): number {
  let markerHits = 0;
  for (const marker of ACCOUNT_ID_MARKERS) {
    let idx = 0;
    while ((idx = view.indexOf(marker, idx)) !== -1) {
      markerHits += 1;
      // parseAuthzAt re-derives the marker; the loop already knows it, and this
      // runs once per hit across every readable page of a multi-GB process.
      const authz = tally(parseAuthzCandidate(view, idx, marker.length), diagnostics);
      if (authz !== null) counts.set(authz, (counts.get(authz) ?? 0) + 1);
      idx += marker.length;
    }
  }
  return markerHits;
}

// Pick a unique most-frequent match; equal leaders are not safe to use.
export function bestAuthz(counts: Map<string, number>): {
  authz: string | null;
  hits: number;
  ambiguous: boolean;
} {
  let authz: string | null = null;
  let hits = 0;
  let ambiguous = false;
  for (const [k, v] of counts) {
    if (v > hits) {
      authz = k;
      hits = v;
      ambiguous = false;
    } else if (v === hits && v > 0) {
      ambiguous = true;
    }
  }
  return { authz: ambiguous ? null : authz, hits, ambiguous };
}

interface ScannableRegion {
  start: number;
  end: number;
}

// The auth string is built at runtime, so it only ever lives in private writable
// memory. Reading /dev/ or special mappings faults the driver and stalls the game.
export function scannableRegionFromMapsLine(line: string, widen = false): ScannableRegion | null {
  const m = line.match(MAPS_LINE);
  if (!m) return null;
  const perms = m[3];
  if (perms[0] !== "r" || perms[1] !== "w" || perms[3] !== "p") return null;
  const path = (m[4] ?? "").trim();
  if (path.startsWith("/dev/")) return null;
  if (path.startsWith("[vvar") || path === "[vdso]" || path === "[vsyscall]") return null;
  if (!widen && path !== "") return null;
  const start = parseInt(m[1], 16);
  const end = parseInt(m[2], 16);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return null;
  if (end - start > MAX_REGION_BYTES) return null;
  return { start, end };
}

function findWarframePid(): number | null {
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      // comm truncates to 15 chars, but still contains "warframe".
      if (fs.readFileSync(`/proc/${e}/comm`, "utf8").toLowerCase().includes("warframe")) {
        return Number(e);
      }
    } catch {
      // process exited between readdir and read
    }
  }
  return null;
}

/** Yama lets the owner of a user namespace read processes inside it, which is
 *  how a plain install reads a game in Steam's container. A PlatHelper that is
 *  itself sandboxed (bubblewrap: appimage-run, steam-run, Flatpak) sits in a
 *  sibling namespace with no rights over the game's, so the open fails even at
 *  the default ptrace_scope; that case gets its own advice. */
export function classifyMemOpenFailure(
  code: string,
  selfUidMap: string | null,
  selfUserNs: string | null,
  gameUserNs: string | null,
): string {
  const inInitNs = selfUidMap === null || INIT_UID_MAP.test(selfUidMap);
  if (!inInitNs && selfUserNs !== null && selfUserNs !== gameUserNs) return `sandbox-${code}`;
  return `mem-open-${code}`;
}

function readTextOrNull(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readlinkOrNull(path: string): string | null {
  try {
    return fs.readlinkSync(path);
  } catch {
    return null;
  }
}

interface AuthzResult {
  authz: string | null;
  // "ok-Nx", "process-not-found", "mem-open-EACCES", "sandbox-EACCES", "crumbs-not-found"
  reason: string;
}

// Scan the running game's memory and return its ?accountId=...&nonce=... query.
// Async + chunked so the ~GBs of committed memory never block the main thread.
export async function readGameAuthz(): Promise<AuthzResult> {
  const pid = findWarframePid();
  if (!pid) return { authz: null, reason: "process-not-found" };

  let fh: fs.promises.FileHandle;
  try {
    fh = await fs.promises.open(`/proc/${pid}/mem`, "r");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unknown";
    const reason = classifyMemOpenFailure(
      code,
      readTextOrNull("/proc/self/uid_map"),
      readlinkOrNull("/proc/self/ns/user"),
      readlinkOrNull(`/proc/${pid}/ns/user`),
    );
    return { authz: null, reason };
  }

  const counts = new Map<string, number>();
  const diagnostics = createAuthzScanDiagnostics();
  const buf = Buffer.allocUnsafe(CHUNK);
  let chunkNo = 0;
  let markerHits = 0;
  let regions = 0;
  let bytes = 0;

  const scanPass = async (lines: string[], widen: boolean) => {
    for (const line of lines) {
      const region = scannableRegionFromMapsLine(line, widen);
      if (!region) continue;
      regions += 1;
      for (let addr = region.start; addr < region.end; addr += CHUNK - OVERLAP) {
        const len = Math.min(CHUNK, region.end - addr);
        let n: number;
        try {
          ({ bytesRead: n } = await fh.read(buf, 0, len, addr));
        } catch {
          continue; // uncommitted / guard page
        }
        if (!n) continue;
        bytes += n;
        markerHits += scanBufferForAuthz(buf.subarray(0, n), counts, diagnostics);
        if (++chunkNo % 8 === 0) await new Promise((r) => setImmediate(r));
      }
    }
  };

  try {
    const maps = (await fs.promises.readFile(`/proc/${pid}/maps`, "utf8")).split("\n");
    await scanPass(maps, false);
    if (counts.size === 0) {
      log.info("No match in anonymous memory - widening to private file-backed regions");
      await scanPass(maps, true);
    }
  } finally {
    await fh.close();
  }

  const scanned = `${regions} regions, ${Math.round(bytes / (1024 * 1024))} MB`;
  if (counts.size === 0) {
    // Same breakdown the Windows scan reports: markers with no usable string
    // means the shape changed, no markers at all means we looked in the wrong place.
    log.warn(
      `No auth crumbs found: markers=${markerHits}, scanned=${scanned}, ` +
        `rejects=${JSON.stringify(diagnostics)}`,
    );
    return { authz: null, reason: "crumbs-not-found" };
  }
  const { authz, hits, ambiguous } = bestAuthz(counts);
  if (ambiguous) {
    log.warn(`Multiple auth matches share the highest frequency (${hits}) - refusing all`);
    return { authz: null, reason: "crumbs-ambiguous" };
  }
  if (counts.size > 1)
    log.warn(`Multiple distinct auth matches (${counts.size}) - using the most frequent`);
  log.info(`Auth match found ${hits}x (scanned ${scanned})`);
  return { authz, reason: `ok-${hits}x` };
}
