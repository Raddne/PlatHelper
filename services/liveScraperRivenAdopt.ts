// Applies config/shared/liveScraperRivenAdopt.ts's plan to the riven stock.

import { withScope } from "./logger";
import * as rivenData from "./rivenData";
import { getMyContracts } from "./wfmContracts";
import {
  createStockRiven,
  deleteStockRiven,
  listStockRivens,
  updateStockRiven,
} from "./liveScraperRivenStock";
import { planRivenAdoption } from "../config/shared/liveScraperRivenAdopt";
import { titleFromSlug } from "../config/shared/wfm";
import type { WfmContract } from "../config/shared/wfmContracts";

const log = withScope("liveScraperRivenAdopt");

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

async function fetchAllMyAuctions(): Promise<WfmContract[]> {
  const all: WfmContract[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await getMyContracts({ page, limit: PAGE_LIMIT });
    all.push(...result.contracts);
    if (!result.hasMore || result.contracts.length === 0) break;
  }
  return all;
}

/** The display name whose family slug is `slug`: the base weapon when the game
 *  data knows it, else a title-cased slug - which slugs back to the same value,
 *  and that round trip is all the riven pass needs from the name. */
function weaponNameForSlug(slug: string): string {
  const matches = rivenData
    .getAllRivenWeaponNames()
    .filter((name) => rivenData.getRivenFamilySlug(name) === slug);
  matches.sort((a, b) => a.length - b.length);
  return matches[0] ?? titleFromSlug(slug);
}

/** Throws when the auctions cannot be fetched, so a failed fetch never looks
 *  like "no auctions left" and drops every adopted row. */
export async function syncAdoptedRivenAuctions(): Promise<void> {
  const auctions = await fetchAllMyAuctions();
  const plan = planRivenAdoption(listStockRivens(), auctions, rivenData.getRivenFamilySlug);

  for (const entry of plan.create) {
    const created = createStockRiven({
      sourceItemId: "",
      weaponName: weaponNameForSlug(entry.weaponSlug),
      rivenName: entry.rivenName,
      masteryReq: entry.masteryReq,
      rerolls: entry.rerolls,
      polarity: entry.polarity,
      modRank: entry.modRank,
      stats: entry.stats,
      bought: 0,
    });
    // Same rule as adopted sell orders: the price the user asked is the floor.
    updateStockRiven(created.id, {
      adopted: true,
      auctionId: entry.auctionId,
      listPrice: entry.listPrice,
      minPrice: entry.listPrice,
      status: "live",
    });
    log.info(
      `[Adopt] now managing existing riven auction: ${entry.rivenName} @ ${entry.listPrice}p`,
    );
  }
  for (const entry of plan.link) {
    updateStockRiven(entry.id, { auctionId: entry.auctionId, listPrice: entry.listPrice });
    log.info(`[Adopt] linked stock riven ${entry.id} to its live auction ${entry.auctionId}`);
  }
  for (const id of plan.remove) {
    deleteStockRiven(id);
    log.info(`[Adopt] riven auction gone (sold or closed) - dropped stock row ${id}`);
  }
}
