export type HelperRunReason =
  | "game-not-running"
  | "access-denied"
  | "ptrace-denied"
  | "not-logged-in"
  | "token-not-found"
  | "api-failed"
  | "error";

export interface HelperStatus {
  exeFound: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastRunOk: boolean | null;
  lastRunReason: HelperRunReason | null;
  inventoryLastModified: number | null;
  installerAutoInstallHelper: boolean | null;
}
