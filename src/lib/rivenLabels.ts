import type { MessageKey } from "./i18n.js";

// services/rivenFingerprint.ts hands back raw English labels; map them here so
// every view that shows a riven type resolves the same translation.
export const RIVEN_TYPE_KEYS: Record<string, MessageKey> = {
  Rifle: "rivens.type.rifle",
  Shotgun: "rivens.type.shotgun",
  Pistol: "rivens.type.pistol",
  Melee: "rivens.type.melee",
  Archgun: "rivens.type.archgun",
  Kitgun: "rivens.type.kitgun",
  Zaw: "rivens.type.zaw",
  Riven: "rivens.type.riven",
};
