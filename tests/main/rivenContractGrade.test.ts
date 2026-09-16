import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { IpcMainInvokeEvent } from "electron";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));

vi.mock("../../ipc/ipcSecurity", () => ({
  assertMainRendererSender: vi.fn(),
  handleAuthorized: (channel: string, _guard: unknown, handler: Handler) => {
    h.handlers.set(channel, handler);
  },
}));

vi.mock("../../ipc/context", () => ({ default: { currentInventoryData: null } }));
vi.mock("../../services/wfmRivenSearch", () => ({}));
vi.mock("../../services/rivenFingerprint", () => ({}));
vi.mock("../../services/wfmRivenItems", () => ({ getRivenWeaponSlugs: async () => null }));

// Only the sheet's availability is faked; the injected rows below still reach
// the grader through the real module state.
vi.mock("../../services/rivenBestAttributes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/rivenBestAttributes")>();
  return {
    ...actual,
    hasRivenGoodRolls: vi.fn(() => true),
    ensureRivenGoodRollsLoaded: vi.fn(async () => {}),
  };
});

import { register } from "../../ipc/rivensIpc";
import {
  ensureRivenGoodRollsLoaded,
  hasRivenGoodRolls,
  setRivenGoodRollsForTest,
} from "../../services/rivenBestAttributes";
import { RIVENS_GRADE_CONTRACTS } from "../../config/shared/ipcChannels";

interface ContractGrade {
  overallGrade: string;
  attributeGrade: string;
  stats: { grade: string; rollFloat: number }[];
}

interface ContractGradesResult {
  grades: (ContractGrade | null)[];
  sheetReady: boolean;
}

const EVENT = {} as IpcMainInvokeEvent;

async function gradeAll(payload: unknown): Promise<ContractGradesResult> {
  const handler = h.handlers.get(RIVENS_GRADE_CONTRACTS);
  if (!handler) throw new Error("grade-riven-contracts was not registered");
  return (await handler(EVENT, payload)) as ContractGradesResult;
}

async function grade(payload: unknown): Promise<(ContractGrade | null)[]> {
  return (await gradeAll(payload)).grades;
}

function contract(weaponName: string, stats: unknown, modRank?: unknown): unknown {
  return modRank === undefined ? { weaponName, stats } : { weaponName, stats, modRank };
}

const SHEET = {
  akstiletto: {
    goodAttrs: [{ mandatory: ["WeaponCritDamageMod"], optional: ["WeaponFireIterationsMod"] }],
    acceptedBadAttrs: ["WeaponZoomFovMod"],
  },
};

beforeAll(() => {
  register();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasRivenGoodRolls).mockReturnValue(true);
  vi.mocked(ensureRivenGoodRollsLoaded).mockResolvedValue(undefined);
  // A null timestamp keeps the loader from refetching the sheet during tests.
  setRivenGoodRollsForTest(SHEET, null);
});

describe("grade-riven-contracts payload validation", () => {
  it("refuses anything that is not a list", async () => {
    await expect(grade(null)).resolves.toEqual([]);
    await expect(grade({ weaponName: "Akstiletto", stats: [] })).resolves.toEqual([]);
    await expect(grade("Akstiletto")).resolves.toEqual([]);
  });

  it("refuses a list longer than the cap", async () => {
    const one = contract("Akstiletto", [{ name: "critical_damage", positive: true, value: 120.5 }]);
    await expect(grade(Array.from({ length: 100 }, () => one))).resolves.toHaveLength(100);
    await expect(grade(Array.from({ length: 101 }, () => one))).resolves.toEqual([]);
  });

  it("answers null in the slot of a malformed entry and still grades its neighbours", async () => {
    const good = contract("Akstiletto", [
      { name: "critical_damage", positive: true, value: 120.5 },
    ]);
    const results = await grade([
      good,
      null,
      { stats: [] },
      contract("Akstiletto", "critical_damage"),
      contract("Akstiletto", [{ name: "critical_damage", positive: "yes", value: 1 }]),
      contract("Akstiletto", [{ name: "critical_damage", positive: true, value: "very high" }]),
      contract(
        "Akstiletto",
        Array.from({ length: 9 }, () => ({ name: "zoom", positive: true, value: 1 })),
      ),
      good,
    ]);

    expect(results).toHaveLength(8);
    expect(results.slice(1, 7)).toEqual([null, null, null, null, null, null]);
    expect(results[0]?.overallGrade).toMatch(/^[SABCF][+-]?$/);
    expect(results[7]?.overallGrade).toBe(results[0]?.overallGrade);
  });

  it("converts a value the payload spelled as a string or a boxed number", async () => {
    const [plain] = await grade([
      contract("Akstiletto", [{ name: "critical_damage", positive: true, value: 120.5 }]),
    ]);
    const [text] = await grade([
      contract("Akstiletto", [{ name: "critical_damage", positive: true, value: "120.5" }]),
    ]);
    const [boxed] = await grade([
      contract("Akstiletto", [
        { name: "critical_damage", positive: true, value: { $numberDouble: "120.5" } },
      ]),
    ]);

    expect(plain?.stats[0].grade).toMatch(/^[SABCF][+-]?$/);
    expect(text).toEqual(plain);
    expect(boxed).toEqual(plain);
  });

  it("leaves a stat listed without a value ungraded instead of scoring it a zero roll", async () => {
    const [result] = await grade([
      contract("Akstiletto", [
        { name: "critical_damage", positive: true, value: null },
        { name: "multishot", positive: true, value: 88.2 },
      ]),
    ]);

    expect(result?.stats[0].grade).toBe("?");
    expect(result?.stats[0].rollFloat).toBe(0.5);
    expect(result?.stats[1].grade).toMatch(/^[SABCF][+-]?$/);
  });

  it("answers null for a weapon the export does not know", async () => {
    await expect(
      grade([contract("Not A Weapon", [{ name: "critical_damage", positive: true, value: 10 }])]),
    ).resolves.toEqual([null]);
  });

  it("refuses a rank no riven can be at", async () => {
    const stats = [{ name: "critical_damage", positive: true, value: 120.5 }];
    await expect(grade([contract("Akstiletto", stats, 9)])).resolves.toEqual([null]);
    await expect(grade([contract("Akstiletto", stats, -1)])).resolves.toEqual([null]);
    await expect(grade([contract("Akstiletto", stats, 1.5)])).resolves.toEqual([null]);
    // Converted like the stat values, so a rank the payload spelled survives.
    const [text] = await grade([contract("Akstiletto", stats, "8")]);
    const [plain] = await grade([contract("Akstiletto", stats, 8)]);
    expect(text).toEqual(plain);
  });
});

describe("grade-riven-contracts rank", () => {
  // The same roll as warframe.market lists it at rank 0 and at rank 8; every
  // displayed value scales with the rank the listing states.
  const RANK_0 = [
    { name: "critical_damage", positive: true, value: 10 },
    { name: "multishot", positive: true, value: 13 },
    { name: "zoom", positive: false, value: -3.5 },
  ];
  const RANK_8 = RANK_0.map((stat) => ({ ...stat, value: stat.value * 9 }));

  it("reads a rank-0 listing like its rank-8 twin", async () => {
    const [unranked] = await grade([contract("Akstiletto", RANK_0, 0)]);
    const [maxRank] = await grade([contract("Akstiletto", RANK_8, 8)]);

    // Rolls inside their ranges, so this is not two cards clamped to the floor.
    expect(unranked?.stats.every((s) => s.rollFloat > 0 && s.rollFloat < 1)).toBe(true);
    expect(unranked?.stats.map((s) => s.grade)).toEqual(maxRank?.stats.map((s) => s.grade));
    expect(unranked?.overallGrade).toBe(maxRank?.overallGrade);
  });

  it("forwards the stated rank instead of guessing it", async () => {
    // One value fits several ranks, so the search stays at rank 8 and only the
    // listing's own rank can place it.
    const oneStat = RANK_0.slice(0, 1);
    const [stated] = await grade([contract("Akstiletto", oneStat, 0)]);
    const [guessed] = await grade([contract("Akstiletto", oneStat)]);

    expect(stated?.stats[0].rollFloat).toBeGreaterThan(0);
    expect(stated?.stats[0].rollFloat).toBeLessThan(1);
    expect(guessed?.stats[0].rollFloat).toBe(0);
  });

  it("does not pin a rank the listed values contradict", async () => {
    // Sellers relist max-rank rolls as rank 0; grading those at rank 0 would
    // clamp every buff to a fabricated S.
    const [stated] = await grade([contract("Akstiletto", RANK_8, 0)]);
    const [searched] = await grade([contract("Akstiletto", RANK_8)]);

    expect(stated?.stats.map((s) => s.grade)).toEqual(searched?.stats.map((s) => s.grade));
    expect(stated?.overallGrade).toBe(searched?.overallGrade);
  });
});

describe("grade-riven-contracts sheet availability", () => {
  const CARD = [{ name: "critical_damage", positive: true, value: 120.6 }];

  it("answers the roll grade while the sheet is still loading", async () => {
    setRivenGoodRollsForTest({}, null);
    vi.mocked(hasRivenGoodRolls).mockReturnValue(false);
    // A load that never settles: awaiting it would hang this test instead.
    vi.mocked(ensureRivenGoodRollsLoaded).mockReturnValue(new Promise<void>(() => {}));

    const result = await gradeAll([contract("Akstiletto", CARD, 8)]);

    expect(result.sheetReady).toBe(false);
    expect(result.grades[0]?.overallGrade).toMatch(/^[SABCF][+-]?$/);
    expect(result.grades[0]?.attributeGrade).toBe("?");
    // The answer still starts the load the next call needs.
    expect(ensureRivenGoodRollsLoaded).toHaveBeenCalledTimes(1);
  });

  it("reports the sheet ready once it holds rows", async () => {
    const result = await gradeAll([contract("Akstiletto", CARD, 8)]);

    expect(result.sheetReady).toBe(true);
    expect(result.grades[0]?.attributeGrade).not.toBe("?");
  });

  it("reports the sheet state even for a payload it refuses", async () => {
    vi.mocked(hasRivenGoodRolls).mockReturnValue(false);

    await expect(gradeAll("not a list")).resolves.toEqual({ grades: [], sheetReady: false });
  });
});

describe("grade-riven-contracts grading", () => {
  it("grades a contract-shaped payload of WFM url_names", async () => {
    const [result] = await grade([
      contract("Akstiletto", [
        { name: "critical_damage", positive: true, value: 120.5 },
        { name: "multishot", positive: true, value: 88.2 },
        { name: "zoom", positive: false, value: -31.4 },
      ]),
    ]);

    expect(result).not.toBeNull();
    expect(result?.overallGrade).toMatch(/^[SABCF][+-]?$/);
    // The sheet's whole good roll is present and Zoom is an accepted negative.
    expect(result?.attributeGrade).toBe("Great");
    expect(result?.stats).toHaveLength(3);
    for (const stat of result?.stats ?? []) {
      expect(stat.grade).toMatch(/^[SABCF][+-]?$/);
      expect(stat.rollFloat).toBeGreaterThanOrEqual(0);
      expect(stat.rollFloat).toBeLessThanOrEqual(1);
    }
  });

  it("resolves a weapon that only exists under its warframe.market family slug", async () => {
    const [result] = await grade([
      contract("Silva And Aegis", [{ name: "range", positive: true, value: 1.4 }]),
    ]);

    expect(result).not.toBeNull();
    // The sheet has no Silva & Aegis row, so only the roll grade is available.
    expect(result?.attributeGrade).toBe("?");
    expect(result?.stats[0].grade).toMatch(/^[SABCF][+-]?$/);
  });

  it("reads faction damage as the listed multiplier, not as a percentage", async () => {
    const [result] = await grade([
      contract("Akstiletto", [{ name: "damage_vs_corpus", positive: true, value: 1.45 }]),
    ]);

    expect(result).not.toBeNull();
    // Read as a raw fraction the 1.45 overshoots the stat's range and clamps to
    // a perfect roll; read as the x1.45 the card shows it lands mid-range.
    expect(result?.stats[0].rollFloat).toBeGreaterThan(0);
    expect(result?.stats[0].rollFloat).toBeLessThan(1);
  });
});
