import type { RivenContractGrade } from "../types/ipc.js";

// The grader answers with whatever it has: while the community sheet is still
// loading, every attribute grade reads "?". Those answers are kept so the roll
// grade shows at once, but they are re-asked until the sheet has spoken.

interface ContractGradeMerge {
  /** Grades to store, keyed by contract id. */
  entries: [string, RivenContractGrade | null][];
  /** Ids whose attribute grade still waits for the sheet. */
  provisional: string[];
  /** Ids that are final and can leave the provisional set. */
  settled: string[];
}

/** Splits one grader answer into the writes the caller applies to its store. */
export function mergeContractGrades(
  ids: string[],
  grades: (RivenContractGrade | null)[],
  sheetReady: boolean,
): ContractGradeMerge {
  // A slot the grader did not answer stays ungraded rather than reading as a
  // weapon it does not know.
  const answered = ids.slice(0, grades.length);
  const entries = answered.map((id, index): [string, RivenContractGrade | null] => [
    id,
    grades[index],
  ]);
  // Only an unrated attribute grade can still change; a weapon the export does
  // not know answers null however the sheet turns out.
  const waits = (grade: RivenContractGrade | null): boolean =>
    !sheetReady && grade != null && grade.attributeGrade === "?";
  return {
    entries,
    provisional: entries.filter(([, grade]) => waits(grade)).map(([id]) => id),
    settled: entries.filter(([, grade]) => !waits(grade)).map(([id]) => id),
  };
}

/** The ids worth asking about: never graded, or graded without the sheet. */
export function contractIdsToGrade(
  ids: string[],
  graded: ReadonlyMap<string, RivenContractGrade | null>,
  provisional: ReadonlySet<string>,
  pending: ReadonlySet<string>,
): string[] {
  return ids.filter((id) => (!graded.has(id) || provisional.has(id)) && !pending.has(id));
}
