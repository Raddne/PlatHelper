import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  families: null as ReadonlySet<string> | null,
}));

vi.mock("../../ipc/ipcSecurity", () => ({
  assertMainRendererSender: vi.fn(),
  handleAuthorized: vi.fn(),
}));

vi.mock("../../ipc/context", () => ({ default: { currentInventoryData: null } }));

vi.mock("../../services/wfmRivenSearch", () => ({}));

vi.mock("../../services/rivenFingerprint", () => ({}));

vi.mock("../../services/wfmRivenItems", () => ({
  getRivenWeaponSlugs: async () => h.families,
}));

import { rivenMarketWeaponNames } from "../../ipc/rivensIpc";
import { getAllRivenWeaponNames, getRivenFamilySlug } from "../../services/rivenData";

const WFM: Array<{ slug: string; gameRef: string }> = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "riven", "wfm-riven-weapons.json"), "utf8"),
);

const FAMILIES: ReadonlySet<string> = new Set(WFM.map((entry) => entry.slug));

beforeEach(() => {
  h.families = FAMILIES;
});

describe("rivenMarketWeaponNames", () => {
  it("offers one option per warframe.market riven family", async () => {
    const names = await rivenMarketWeaponNames();

    const slugs = names.map((name) => getRivenFamilySlug(name));
    expect(new Set(slugs).size).toBe(names.length);
    for (const slug of slugs) expect(FAMILIES.has(slug)).toBe(true);
    expect(names.length).toBeLessThan(getAllRivenWeaponNames().length);
  });

  it("folds a variant onto its base weapon", async () => {
    const names = await rivenMarketWeaponNames();

    expect(names).toContain("Boar");
    expect(names).not.toContain("Boar Prime");
    expect(names).toContain("Marelok");
    expect(names).not.toContain("Vaykor Marelok");
    expect(names).not.toContain("MK1-Braton");
  });

  it("drops weapons that have a disposition but no riven market", async () => {
    const names = await rivenMarketWeaponNames();

    const all = getAllRivenWeaponNames();
    for (const dropped of ["Artemis Bow", "Iron Staff", "Whipclaw"]) {
      expect(all).toContain(dropped);
      expect(names).not.toContain(dropped);
    }
    expect(all.some((name) => name.includes("<ARCHWING>"))).toBe(true);
    expect(names.some((name) => name.includes("<ARCHWING>"))).toBe(false);
  });

  it("keeps a family whose base weapon was never made", async () => {
    const names = await rivenMarketWeaponNames();

    for (const kept of ["Kuva Bramma", "Tenet Livia", "Coda Motovore"]) {
      expect(names).toContain(kept);
      expect(FAMILIES.has(getRivenFamilySlug(kept))).toBe(true);
    }
  });

  it("returns the unfiltered list when the family list is unavailable", async () => {
    h.families = null;

    await expect(rivenMarketWeaponNames()).resolves.toEqual(getAllRivenWeaponNames());
  });
});
