// Hover hints for the Live Scraper's row statuses. Riven rows read two statuses
// differently: their own comparable-listing rule, and a pause that takes the
// auction down.

import type { MessageKey } from "../i18n.js";
import type { StockEntryStatus } from "../../../config/shared/liveScraperStock.js";
import type { LiveScraperWtbListing } from "../../../config/shared/liveScraperEngine.js";

type RowStatus = StockEntryStatus | LiveScraperWtbListing["status"];

export function statusHintKey(status: RowStatus, riven = false): MessageKey {
  if (riven && (status === "noSellers" || status === "inactive")) {
    return `liveScraper.listings.statusHint.riven.${status}`;
  }
  return `liveScraper.listings.statusHint.${status}`;
}
