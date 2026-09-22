import { describe, expect, it } from "vitest";
import { isAllowedExternalHost } from "../../config/runtime/security";

// Every host the About card links to; a miss here means a silently dead button.
const ABOUT_CARD_HOSTS = [
  "warframe.market",
  "github.com",
  "browse.wf",
  "svesk.github.io",
  "arbi.guide",
];

describe("open-external allowlist", () => {
  it("allows every About-card link host", () => {
    const blocked = ABOUT_CARD_HOSTS.filter((host) => !isAllowedExternalHost(host));
    expect(blocked).toEqual([]);
  });

  it("is case-insensitive and trims", () => {
    expect(isAllowedExternalHost(" WWW.Warframe.Market ")).toBe(true);
  });

  it("rejects unknown and lookalike hosts", () => {
    expect(isAllowedExternalHost("www.warframe.com")).toBe(true);
    expect(isAllowedExternalHost("www.warframe.com.evil.com")).toBe(false);
    expect(isAllowedExternalHost("evil.com")).toBe(false);
    expect(isAllowedExternalHost("patreon.com")).toBe(false);
    expect(isAllowedExternalHost("wfhelper.com")).toBe(false);
    expect(isAllowedExternalHost("")).toBe(false);
  });
});
