import { createJsonCache } from "./jsonCache";
import {
  defaultLiveScraperSettings,
  normalizeLiveScraperSettings,
  type LiveScraperSettings,
} from "../config/shared/liveScraperSettings";

const cache = createJsonCache<LiveScraperSettings>("live-scraper-settings.json", (parsed) =>
  normalizeLiveScraperSettings(parsed),
);

let current: LiveScraperSettings = cache.read() ?? defaultLiveScraperSettings();

export function getLiveScraperSettings(): LiveScraperSettings {
  return current;
}

/** Replaces the whole settings object. The caller (renderer) always sends its
 *  full local copy back, so there is no path-based patch protocol to keep in
 *  sync on both sides of the IPC boundary — see docs/live-scraper §9. */
export function setLiveScraperSettings(next: unknown): LiveScraperSettings {
  current = normalizeLiveScraperSettings(next);
  cache.write(current);
  return current;
}

export function resetLiveScraperSettings(): LiveScraperSettings {
  current = defaultLiveScraperSettings();
  cache.write(current);
  return current;
}
