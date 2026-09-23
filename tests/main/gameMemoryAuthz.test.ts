import { describe, it, expect } from "vitest";

import {
  bestAuthz,
  classifyMemOpenFailure,
  createAuthzScanDiagnostics,
  parseAuthzAt,
  scanBufferForAuthz,
  scannableRegionFromMapsLine,
} from "../../services/gameMemoryAuthz";

const ACC = "0123456789abcdef01234567"; // 24 hex
const VALID = `?accountId=${ACC}&nonce=1712345678901`;
const NEEDLE_AT = (buf: Buffer) => buf.indexOf("?accountId=");

describe("classifyMemOpenFailure", () => {
  const INIT_MAP = "         0          0 4294967295\n";
  const BWRAP_MAP = "      1000       1000          1\n";
  const HOST_NS = "user:[4026531837]";
  const GAME_NS = "user:[4026532711]";

  it("blames ptrace_scope when PlatHelper runs in the initial user namespace", () => {
    expect(classifyMemOpenFailure("EACCES", INIT_MAP, HOST_NS, GAME_NS)).toBe("mem-open-EACCES");
    expect(classifyMemOpenFailure("EACCES", INIT_MAP, HOST_NS, HOST_NS)).toBe("mem-open-EACCES");
  });

  it("reports a sandboxed PlatHelper that cannot reach the game's namespace", () => {
    expect(classifyMemOpenFailure("EACCES", BWRAP_MAP, HOST_NS, GAME_NS)).toBe("sandbox-EACCES");
    // The game's namespace link may itself be unreadable from inside the sandbox.
    expect(classifyMemOpenFailure("EPERM", BWRAP_MAP, HOST_NS, null)).toBe("sandbox-EPERM");
  });

  it("stays with ptrace_scope when both share one namespace or nothing is known", () => {
    expect(classifyMemOpenFailure("EACCES", BWRAP_MAP, GAME_NS, GAME_NS)).toBe("mem-open-EACCES");
    expect(classifyMemOpenFailure("EACCES", null, null, null)).toBe("mem-open-EACCES");
    expect(classifyMemOpenFailure("EACCES", BWRAP_MAP, null, GAME_NS)).toBe("mem-open-EACCES");
  });
});

describe("parseAuthzAt", () => {
  it("extracts a well-formed auth string", () => {
    const buf = Buffer.from(`noise\x00\x01${VALID}\x00tail`, "latin1");
    expect(parseAuthzAt(buf, NEEDLE_AT(buf))).toBe(VALID);
  });

  it("stops the nonce at the first non-digit", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=42&extra=x`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBe(`?accountId=${ACC}&nonce=42`);
  });

  it("accepts accountId after another query parameter", () => {
    const buf = Buffer.from(`?platform=pc&accountId=${ACC}&nonce=42`, "latin1");
    expect(parseAuthzAt(buf, buf.indexOf("&accountId="))).toBe(`?accountId=${ACC}&nonce=42`);
  });

  it("normalizes uppercase account ids", () => {
    const uppercase = ACC.toUpperCase();
    const buf = Buffer.from(`?accountId=${uppercase}&nonce=42`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBe(`?accountId=${ACC}&nonce=42`);
  });

  it("rejects a non-hex account id", () => {
    const buf = Buffer.from(`?accountId=zzz456789abcdef01234567&nonce=42`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("rejects a short account id", () => {
    const buf = Buffer.from(`?accountId=abc&nonce=42`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("rejects a missing &nonce= separator", () => {
    const buf = Buffer.from(`?accountId=${ACC}?nonce=42`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("rejects an empty nonce", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=x`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("accepts a nonce at the 24-digit limit", () => {
    const nonce = "123456789012345678901234";
    const buf = Buffer.from(`?accountId=${ACC}&nonce=${nonce}\x00`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBe(`?accountId=${ACC}&nonce=${nonce}`);
  });

  it("rejects a nonce above the 24-digit limit", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=1234567890123456789012345\x00`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("returns null when the match runs off the buffer end", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });
});

describe("scannableRegionFromMapsLine", () => {
  const ANON = "7f1e40000000-7f1e40021000 rw-p 00000000 00:00 0 ";
  const NVIDIA = "7f1e30000000-7f1e30010000 rw-p 00000000 00:06 1234    /dev/nvidia0";
  const RENDERD = "7f1e31000000-7f1e31010000 rw-p 00000000 00:06 1235    /dev/dri/renderD128";
  const MEMFD = "7f1e2c000000-7f1e2c400000 rw-p 00000000 00:01 99   /memfd:wine-shm (deleted)";

  it("accepts a private anonymous writable region", () => {
    expect(scannableRegionFromMapsLine(ANON)).toEqual({
      start: 0x7f1e40000000,
      end: 0x7f1e40021000,
    });
  });

  it("accepts an anonymous region with no trailing pathname column", () => {
    expect(scannableRegionFromMapsLine("1000-2000 rw-p 00000000 00:00 0")).toEqual({
      start: 0x1000,
      end: 0x2000,
    });
  });

  it("rejects GPU device mappings", () => {
    expect(scannableRegionFromMapsLine(NVIDIA)).toBeNull();
    expect(scannableRegionFromMapsLine(RENDERD)).toBeNull();
  });

  it("rejects file-backed executable mappings", () => {
    const line = "55a1b2c00000-55a1b2c21000 r-xp 00000000 08:02 12345    /usr/bin/wine64";
    expect(scannableRegionFromMapsLine(line)).toBeNull();
  });

  it("rejects kernel special regions", () => {
    expect(
      scannableRegionFromMapsLine("7ffd8b1f9000-7ffd8b1fd000 rw-p 00000000 00:00 0   [vvar]"),
    ).toBeNull();
    expect(
      scannableRegionFromMapsLine("7ffd8b1fd000-7ffd8b1ff000 rw-p 00000000 00:00 0   [vdso]"),
    ).toBeNull();
    expect(
      scannableRegionFromMapsLine(
        "ffffffffff600000-ffffffffff601000 rw-p 00000000 00:00 0   [vsyscall]",
      ),
    ).toBeNull();
  });

  it("rejects read-only and shared anonymous regions", () => {
    expect(scannableRegionFromMapsLine("1000-2000 r--p 00000000 00:00 0 ")).toBeNull();
    expect(scannableRegionFromMapsLine("1000-2000 rw-s 00000000 00:00 0 ")).toBeNull();
    expect(scannableRegionFromMapsLine("1000-2000 ---p 00000000 00:00 0 ")).toBeNull();
  });

  it("rejects implausibly large reserves and empty ranges", () => {
    expect(scannableRegionFromMapsLine("100000000-500000001000 rw-p 00000000 00:00 0 ")).toBeNull();
    expect(scannableRegionFromMapsLine("2000-2000 rw-p 00000000 00:00 0 ")).toBeNull();
  });

  it("rejects garbage lines", () => {
    expect(scannableRegionFromMapsLine("")).toBeNull();
    expect(scannableRegionFromMapsLine("not a maps line")).toBeNull();
  });

  it("widens to private file-backed regions in the fallback pass", () => {
    expect(scannableRegionFromMapsLine(MEMFD)).toBeNull();
    expect(scannableRegionFromMapsLine(MEMFD, true)).toEqual({
      start: 0x7f1e2c000000,
      end: 0x7f1e2c400000,
    });
    expect(scannableRegionFromMapsLine(ANON, true)).not.toBeNull();
  });

  it("still excludes devices and special regions in the fallback pass", () => {
    expect(scannableRegionFromMapsLine(NVIDIA, true)).toBeNull();
    expect(scannableRegionFromMapsLine(RENDERD, true)).toBeNull();
    expect(
      scannableRegionFromMapsLine("7ffd8b1f9000-7ffd8b1fd000 rw-p 00000000 00:00 0   [vvar]", true),
    ).toBeNull();
    expect(
      scannableRegionFromMapsLine(
        "55a1b2c00000-55a1b2c21000 r-xp 00000000 08:02 12345    /usr/bin/wine64",
        true,
      ),
    ).toBeNull();
  });
});

describe("scanBufferForAuthz + bestAuthz", () => {
  it("accepts one well-formed match", () => {
    expect(bestAuthz(new Map([[VALID, 1]]))).toEqual({
      authz: VALID,
      hits: 1,
      ambiguous: false,
    });
  });

  it("counts repeated matches and picks the most frequent", () => {
    const other = `?accountId=ffffffffffffffffffffffff&nonce=99`;
    const buf = Buffer.from(`${VALID} junk ${VALID} \x00 ${other} ${VALID}`, "latin1");
    const counts = new Map<string, number>();
    scanBufferForAuthz(buf, counts);
    expect(counts.get(VALID)).toBe(3);
    expect(counts.get(other)).toBe(1);
    expect(bestAuthz(counts)).toEqual({ authz: VALID, hits: 3, ambiguous: false });
  });

  it("ignores malformed candidates while counting valid ones", () => {
    const buf = Buffer.from(`?accountId=bad&nonce=1 ${VALID}`, "latin1");
    const counts = new Map<string, number>();
    expect(scanBufferForAuthz(buf, counts)).toBe(2);
    expect(counts.size).toBe(1);
    expect(counts.get(VALID)).toBe(1);
  });

  it("reports rejection reasons without candidate contents", () => {
    const invalidId = "z".repeat(24);
    const tooLong = "1".repeat(25);
    const buf = Buffer.from(
      [
        `?accountId=${invalidId}&nonce=1`,
        `?accountId=${ACC}?nonce=1`,
        `?accountId=${ACC}&nonce=x`,
        `?accountId=${ACC}&nonce=${tooLong}`,
        `?accountId=${ACC}&nonce=`,
      ].join(" "),
      "latin1",
    );
    const diagnostics = createAuthzScanDiagnostics();

    expect(scanBufferForAuthz(buf, new Map(), diagnostics)).toBe(5);
    expect(diagnostics).toEqual({
      truncated: 1,
      invalidAccountId: 1,
      missingNonce: 1,
      emptyNonce: 1,
      nonceTooLong: 1,
    });
  });

  it("bestAuthz returns null on an empty tally", () => {
    expect(bestAuthz(new Map())).toEqual({ authz: null, hits: 0, ambiguous: false });
  });

  it("rejects distinct candidates tied for the highest count", () => {
    const other = `?accountId=ffffffffffffffffffffffff&nonce=99`;
    expect(
      bestAuthz(
        new Map([
          [VALID, 2],
          [other, 2],
        ]),
      ),
    ).toEqual({ authz: null, hits: 2, ambiguous: true });
  });

  it("accepts a unique leader after a lower-count tie", () => {
    const other = `?accountId=ffffffffffffffffffffffff&nonce=99`;
    const leader = `?accountId=aaaaaaaaaaaaaaaaaaaaaaaa&nonce=7`;
    expect(
      bestAuthz(
        new Map([
          [VALID, 2],
          [other, 2],
          [leader, 3],
        ]),
      ),
    ).toEqual({ authz: leader, hits: 3, ambiguous: false });
  });
});
