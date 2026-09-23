import { createJsonCache } from "./jsonCache";
import {
  defaultLiveScraperSettings,
  normalizeLiveScraperSettings,
  type ListingsTab,
  type LiveScraperSettings,
} from "../config/shared/liveScraperSettings";

const cache = createJsonCache<LiveScraperSettings>(
  "live-scraper-settings.json",
  (parsed) => normalizeLiveScraperSettings(parsed),
  { keepUnreadable: true },
);

let current: LiveScraperSettings = cache.read() ?? defaultLiveScraperSettings();

export function getLiveScraperSettings(): LiveScraperSettings {
  return current;
}

/** Replaces the whole settings object. The caller (renderer) always sends its
 *  full local copy back, so there is no path-based patch protocol to keep in
 *  sync on both sides of the IPC boundary — see docs/live-scraper §9. */
export function setLiveScraperSettings(next: unknown): LiveScraperSettings {
  // hiddenOnWfm follows what is live on warframe.market; a stale renderer copy
  // must not flip it back.
  current = { ...normalizeLiveScraperSettings(next), hiddenOnWfm: current.hiddenOnWfm };
  cache.write(current);
  return current;
}

/** Resetting the preferences does not make hidden listings visible again. */
export function resetLiveScraperSettings(): LiveScraperSettings {
  current = { ...defaultLiveScraperSettings(), hiddenOnWfm: current.hiddenOnWfm };
  cache.write(current);
  return current;
}

export function setHiddenOnWfm(tab: ListingsTab, hidden: boolean): LiveScraperSettings {
  current = { ...current, hiddenOnWfm: { ...current.hiddenOnWfm, [tab]: hidden } };
  cache.write(current);
  return current;
}
