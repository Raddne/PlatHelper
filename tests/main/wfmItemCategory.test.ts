import { afterEach, describe, expect, it, vi } from "vitest";

import { wfmItemCategory } from "../../config/shared/wfmItemCategory";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

type Item = Parameters<typeof wfmItemCategory>[0];

// Records copied from the live /v2/items catalog.
const ITEMS: Record<string, Item> = {
  frost_prime_set: {
    tags: ["set", "prime", "warframe"],
    slug: "frost_prime_set",
    gameRef: "/Lotus/Powersuits/Frost/FrostPrime",
    name: "Frost Prime Set",
    maxRank: null,
  },
  axi_h3_relic: {
    tags: ["relic", "axi"],
    slug: "axi_h3_relic",
    gameRef: "/Lotus/Types/Game/Projections/T4VoidProjectionZephyrPrimeC",
    name: "Axi H3 Relic",
    maxRank: null,
  },
  virtuos_strike: {
    tags: ["operator", "uncommon", "arcane_enhancement"],
    slug: "virtuos_strike",
    gameRef:
      "/Lotus/Upgrades/CosmeticEnhancers/OperatorAmps/IncreasedCriticalDamageOnCriticalStrike",
    name: "Virtuos Strike",
    maxRank: 3,
  },
  peculiar_growth: {
    tags: ["mod", "peculiar", "arcane_enhancement", "warframe"],
    slug: "peculiar_growth",
    gameRef: "/Lotus/Upgrades/CosmeticEnhancers/Peculiars/InflationMod",
    name: "Peculiar Growth",
    maxRank: 5,
  },
  runtime: {
    tags: ["mod", "rare", "parazon"],
    slug: "runtime",
    gameRef: "/Lotus/Upgrades/Mods/DataSpike/Cipher/OnHackSprintSpeedMod",
    name: "Runtime",
    maxRank: null,
  },
  purging_slash: {
    tags: ["mod", "warframe", "excalibur", "augment", "rare"],
    slug: "purging_slash",
    gameRef: "/Lotus/Powersuits/Excalibur/SlashDashPvPAugmentCard",
    name: "Purging Slash",
    maxRank: 3,
  },
  zephyr_prime_chassis_blueprint: {
    tags: ["component", "prime", "warframe", "blueprint"],
    slug: "zephyr_prime_chassis_blueprint",
    gameRef: "/Lotus/Types/Recipes/WarframeRecipes/ZephyrPrimeChassisBlueprint",
    name: "Zephyr Prime Chassis Blueprint",
    maxRank: null,
  },
  akbronco_prime_link: {
    tags: ["component", "weapon", "prime"],
    slug: "akbronco_prime_link",
    gameRef: "/Lotus/Types/Recipes/Weapons/WeaponParts/AkbroncoPrimeLink",
    name: "Akbronco Prime Link",
    maxRank: null,
  },
  kaszas_blade: {
    tags: ["component", "weapon", "archwing"],
    slug: "kaszas_blade",
    gameRef: "/Lotus/Types/Recipes/Weapons/WeaponParts/ArchScytheBlade",
    name: "Kaszas Blade",
    maxRank: null,
  },
  secura_dual_cestra: {
    tags: ["syndicate", "weapon", "secondary"],
    slug: "secura_dual_cestra",
    gameRef: "/Lotus/Weapons/Syndicates/PerrinSequence/Pistols/PSDualCestra",
    name: "Secura Dual Cestra",
    maxRank: null,
  },
  meridian_armor_set: {
    tags: ["skin"],
    slug: "meridian_armor_set",
    gameRef: "",
    name: "Meridian Armor Set",
    maxRank: null,
  },
  melee_influence: {
    tags: ["rare", "arcane_enhancement"],
    slug: "melee_influence",
    gameRef: "",
    name: "Melee Influence",
    maxRank: 5,
  },
};

const withoutTags = (slug: string): Item => ({ ...ITEMS[slug], tags: undefined });

describe("wfmItemCategory with tags", () => {
  it.each([
    ["frost_prime_set", "set"],
    ["axi_h3_relic", "relic"],
    ["virtuos_strike", "arcane"],
    ["runtime", "mod"],
    ["zephyr_prime_chassis_blueprint", "part"],
    ["kaszas_blade", "part"],
    ["secura_dual_cestra", "misc"],
  ])("classifies %s", (slug, category) => {
    expect(wfmItemCategory(ITEMS[slug])).toBe(category);
  });

  it("files the Peculiar mods, tagged mod and arcane, as arcanes like their game path", () => {
    expect(wfmItemCategory(ITEMS.peculiar_growth)).toBe("arcane");
  });

  it("lets the tags overrule the slug", () => {
    // A syndicate armor set is a skin bundle, not an item set.
    expect(wfmItemCategory(ITEMS.meridian_armor_set)).toBe("misc");
  });
});

describe("wfmItemCategory without tags", () => {
  it("reads sets and relics off the slug", () => {
    expect(wfmItemCategory(withoutTags("frost_prime_set"))).toBe("set");
    expect(wfmItemCategory(withoutTags("axi_h3_relic"))).toBe("relic");
    expect(wfmItemCategory(withoutTags("meridian_armor_set"))).toBe("set");
  });

  it("reads arcanes and mods off the game path, whatever the name or rank", () => {
    expect(wfmItemCategory(withoutTags("virtuos_strike"))).toBe("arcane");
    expect(wfmItemCategory(withoutTags("peculiar_growth"))).toBe("arcane");
    // A Parazon mod has no rank in the catalog; only its path says mod.
    expect(wfmItemCategory(withoutTags("runtime"))).toBe("mod");
    expect(wfmItemCategory({ ...withoutTags("runtime"), gameRef: "/lotus/upgrades/mods/x" })).toBe(
      "mod",
    );
  });

  it("takes a ranked item outside both trees as a mod, or an arcane by name", () => {
    expect(wfmItemCategory(withoutTags("purging_slash"))).toBe("mod");
    expect(wfmItemCategory({ slug: "arcane_x", gameRef: null, name: "Arcane X", maxRank: 5 })).toBe(
      "arcane",
    );
    // The Melee arcanes carry no game path, so without tags they read as mods.
    expect(wfmItemCategory(withoutTags("melee_influence"))).toBe("mod");
  });

  it("reads parts off prime and component names, and leaves the rest misc", () => {
    expect(wfmItemCategory(withoutTags("zephyr_prime_chassis_blueprint"))).toBe("part");
    expect(wfmItemCategory(withoutTags("akbronco_prime_link"))).toBe("part");
    expect(wfmItemCategory(withoutTags("kaszas_blade"))).toBe("part");
    expect(wfmItemCategory(withoutTags("secura_dual_cestra"))).toBe("misc");
  });

  it("treats an empty tag list as no tags", () => {
    expect(wfmItemCategory({ ...ITEMS.axi_h3_relic, tags: [] })).toBe("relic");
  });
});

describe("wfmCatalog item tags", () => {
  it("keeps the tags the direct warframe.market listing carries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const wfmClient = await import("../../services/wfmClient");
    vi.spyOn(wfmClient, "requestV2").mockResolvedValue({
      data: [
        {
          id: "a",
          slug: "axi_h3_relic",
          tags: ["relic", "axi", 3],
          i18n: { en: { name: "Axi H3 Relic" } },
        },
        { id: "b", slug: "forma", i18n: { en: { name: "Forma" } } },
      ],
    });
    const wfmCatalog = await import("../../services/wfmCatalog");

    const items = await wfmCatalog.listAllItems();
    expect(items.find((item) => item.url_name === "axi_h3_relic")?.tags).toEqual(["relic", "axi"]);
    expect(items.find((item) => item.url_name === "forma")).not.toHaveProperty("tags");
  });

  it("has none from the worker catalog, whose projection drops them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          items: [
            {
              id: "a",
              slug: "axi_h3_relic",
              name: "Axi H3 Relic",
              thumb: null,
              icon: null,
              maxRank: null,
              gameRef: null,
            },
          ],
        }),
      }),
    );
    const wfmCatalog = await import("../../services/wfmCatalog");

    const [item] = await wfmCatalog.listAllItems();
    expect(item).toMatchObject({ url_name: "axi_h3_relic" });
    expect(item).not.toHaveProperty("tags");
  });
});
