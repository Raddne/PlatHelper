import ctx from "./context";
import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";
import { isObject } from "./ipcValidators";
import { toNonEmptyString } from "../config/shared/stringValidation";
import * as liveScraperSettings from "../services/liveScraperSettings";
import * as liveScraperStock from "../services/liveScraperStock";
import * as liveScraperRivenStock from "../services/liveScraperRivenStock";
import * as liveScraperListingRemoval from "../services/liveScraperListingRemoval";
import * as liveScraperEngine from "../services/liveScraperEngine";
import * as liveScraperRiven from "../services/liveScraperRiven";
import * as liveScraperWfmVisibility from "../services/liveScraperWfmVisibility";
import { normalizeErrorMessage } from "../config/shared/errors";
import * as wfmSession from "../services/wfmSession";
import type {
  CreateStockItemInput,
  CreateWishlistItemInput,
} from "../config/shared/liveScraperStock";
import type { CreateStockRivenInput } from "../config/shared/liveScraperRivenStock";
import type { SubTypeLike } from "../config/shared/liveScraperSettings";
import type { VisibilitySelection } from "../config/shared/liveScraperWfmVisibility";
import {
  LIVE_SCRAPER_CHANGED,
  LIVE_SCRAPER_GET_SETTINGS,
  LIVE_SCRAPER_RESET_SETTINGS,
  LIVE_SCRAPER_RIVEN_STOCK_CREATE,
  LIVE_SCRAPER_RIVEN_STOCK_DELETE,
  LIVE_SCRAPER_RIVEN_STOCK_LIST,
  LIVE_SCRAPER_RIVEN_QUICK_LIST,
  LIVE_SCRAPER_RIVEN_QUOTE,
  LIVE_SCRAPER_RIVEN_SEARCH_URL,
  LIVE_SCRAPER_RIVEN_STOCK_UPDATE,
  LIVE_SCRAPER_SET_HIDDEN_ON_WFM,
  LIVE_SCRAPER_START,
  LIVE_SCRAPER_STATUS,
  LIVE_SCRAPER_STOCK_CREATE,
  LIVE_SCRAPER_STOCK_DELETE,
  LIVE_SCRAPER_STOCK_LIST,
  LIVE_SCRAPER_STOCK_UPDATE,
  LIVE_SCRAPER_STOP,
  LIVE_SCRAPER_UPDATE_SETTINGS,
  LIVE_SCRAPER_WISHLIST_CREATE,
  LIVE_SCRAPER_WISHLIST_DELETE,
  LIVE_SCRAPER_WISHLIST_LIST,
  LIVE_SCRAPER_WISHLIST_UPDATE,
} from "../config/shared/ipcChannels";

function pushLiveScraperChanged(): void {
  const window = ctx.mainWindow;
  if (!window || window.isDestroyed()) return;
  window.webContents.send(LIVE_SCRAPER_CHANGED);
}

function parseSubType(raw: unknown): SubTypeLike | undefined {
  if (!isObject(raw)) return undefined;
  const out: SubTypeLike = {};
  if (typeof raw.rank === "number" && Number.isFinite(raw.rank) && raw.rank >= 0) {
    out.rank = Math.floor(raw.rank);
  }
  const variant = toNonEmptyString(raw.variant, 64);
  if (variant) out.variant = variant;
  const subtype = toNonEmptyString(raw.subtype, 64);
  if (subtype) out.subtype = subtype;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseStockInput(payload: unknown): CreateStockItemInput | null {
  if (!isObject(payload)) return null;
  const wfmId = toNonEmptyString(payload.wfmId, 128);
  if (!wfmId) return null;
  const wfmUrl = toNonEmptyString(payload.wfmUrl, 128) ?? wfmId;
  const itemName = toNonEmptyString(payload.itemName, 200) ?? wfmId;
  const subType = parseSubType(payload.subType);
  const owned = typeof payload.owned === "number" && payload.owned > 0 ? payload.owned : 1;
  const bought = typeof payload.bought === "number" && payload.bought >= 0 ? payload.bought : 0;
  return { wfmId, wfmUrl, itemName, subType, owned, bought };
}

function parseWishlistInput(payload: unknown): CreateWishlistItemInput | null {
  if (!isObject(payload)) return null;
  const wfmId = toNonEmptyString(payload.wfmId, 128);
  if (!wfmId) return null;
  const wfmUrl = toNonEmptyString(payload.wfmUrl, 128) ?? wfmId;
  const itemName = toNonEmptyString(payload.itemName, 200) ?? wfmId;
  const subType = parseSubType(payload.subType);
  const quantity =
    typeof payload.quantity === "number" && payload.quantity > 0 ? payload.quantity : 1;
  const maxPrice =
    typeof payload.maxPrice === "number" && payload.maxPrice > 0 ? payload.maxPrice : undefined;
  return { wfmId, wfmUrl, itemName, subType, quantity, maxPrice };
}

function parseStockRivenStats(raw: unknown): CreateStockRivenInput["stats"] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const stats: CreateStockRivenInput["stats"] = [];
  for (const entry of raw) {
    if (!isObject(entry)) return null;
    const tag = toNonEmptyString(entry.tag, 64);
    if (!tag) return null;
    stats.push({
      tag,
      positive: entry.positive !== false,
      multiplier: entry.multiplier === true,
      value: typeof entry.value === "number" && Number.isFinite(entry.value) ? entry.value : 0,
    });
  }
  return stats;
}

function parseStockRivenInput(payload: unknown): CreateStockRivenInput | null {
  if (!isObject(payload)) return null;
  const sourceItemId = toNonEmptyString(payload.sourceItemId, 128) ?? "";
  const weaponName = toNonEmptyString(payload.weaponName, 200);
  if (!weaponName) return null;
  const rivenName = toNonEmptyString(payload.rivenName, 200) ?? weaponName;
  const masteryReq =
    typeof payload.masteryReq === "number" && payload.masteryReq >= 0 ? payload.masteryReq : 0;
  const rerolls = typeof payload.rerolls === "number" && payload.rerolls >= 0 ? payload.rerolls : 0;
  const polarity = toNonEmptyString(payload.polarity, 32) ?? "madurai";
  const modRank = typeof payload.modRank === "number" && payload.modRank >= 0 ? payload.modRank : 8;
  const bought = typeof payload.bought === "number" && payload.bought >= 0 ? payload.bought : 0;
  const stats = parseStockRivenStats(payload.stats);
  if (!stats) return null;
  return {
    sourceItemId,
    weaponName,
    rivenName,
    masteryReq,
    rerolls,
    polarity,
    modRank,
    stats,
    bought,
  };
}

const MAX_SELECTED = 10_000;

function parseIdList(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SELECTED) return null;
  const ids: string[] = [];
  for (const entry of raw) {
    const id = toNonEmptyString(entry, 128);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

/** null = the whole tab; undefined = malformed. */
function parseVisibilitySelection(raw: unknown): VisibilitySelection | null | undefined {
  if (raw == null) return null;
  if (!isObject(raw)) return undefined;
  const rowIds = parseIdList(raw.rowIds);
  const scanIds = parseIdList(raw.scanIds);
  return rowIds && scanIds ? { rowIds, scanIds } : undefined;
}

function register(): void {
  liveScraperEngine.initLiveScraperEngine({
    onChanged: pushLiveScraperChanged,
    getOwnName: () => wfmSession.getInGameName(),
  });

  handleAuthorized(LIVE_SCRAPER_GET_SETTINGS, assertMainRendererSender, () =>
    liveScraperSettings.getLiveScraperSettings(),
  );

  handleAuthorized(
    LIVE_SCRAPER_UPDATE_SETTINGS,
    assertMainRendererSender,
    (_event, next: unknown) => {
      const saved = liveScraperSettings.setLiveScraperSettings(next);
      // Riven pricing runs on a long cooldown; a settings edit should show at once.
      liveScraperEngine.requestRivenPass();
      pushLiveScraperChanged();
      return saved;
    },
  );

  handleAuthorized(LIVE_SCRAPER_RESET_SETTINGS, assertMainRendererSender, () => {
    const saved = liveScraperSettings.resetLiveScraperSettings();
    pushLiveScraperChanged();
    return saved;
  });

  handleAuthorized(LIVE_SCRAPER_STOCK_LIST, assertMainRendererSender, () =>
    liveScraperStock.listStockItems(),
  );

  handleAuthorized(
    LIVE_SCRAPER_STOCK_CREATE,
    assertMainRendererSender,
    (_event, payload: unknown) => {
      const input = parseStockInput(payload);
      if (!input) return { ok: false as const, error: "invalid payload" };
      const item = liveScraperStock.createStockItem(input);
      pushLiveScraperChanged();
      return { ok: true as const, item };
    },
  );

  handleAuthorized(
    LIVE_SCRAPER_STOCK_UPDATE,
    assertMainRendererSender,
    (_event, id: unknown, patch: unknown) => {
      const stockId = toNonEmptyString(id, 64);
      if (!stockId || !isObject(patch)) return { ok: false as const, error: "invalid payload" };
      const item = liveScraperStock.updateStockItem(stockId, patch);
      if (!item) return { ok: false as const, error: "not found" };
      pushLiveScraperChanged();
      return { ok: true as const, item };
    },
  );

  handleAuthorized(
    LIVE_SCRAPER_STOCK_DELETE,
    assertMainRendererSender,
    async (_event, id: unknown) => {
      const stockId = toNonEmptyString(id, 64);
      if (!stockId) return { ok: false as const, error: "invalid payload" };
      const result = await liveScraperListingRemoval.removeStockItem(stockId);
      if (result.ok) pushLiveScraperChanged();
      return result;
    },
  );

  handleAuthorized(LIVE_SCRAPER_WISHLIST_LIST, assertMainRendererSender, () =>
    liveScraperStock.listWishlistItems(),
  );

  handleAuthorized(
    LIVE_SCRAPER_WISHLIST_CREATE,
    assertMainRendererSender,
    (_event, payload: unknown) => {
      const input = parseWishlistInput(payload);
      if (!input) return { ok: false as const, error: "invalid payload" };
      const item = liveScraperStock.createWishlistItem(input);
      pushLiveScraperChanged();
      return { ok: true as const, item };
    },
  );

  handleAuthorized(
    LIVE_SCRAPER_WISHLIST_UPDATE,
    assertMainRendererSender,
    (_event, id: unknown, patch: unknown) => {
      const wishlistId = toNonEmptyString(id, 64);
      if (!wishlistId || !isObject(patch)) return { ok: false as const, error: "invalid payload" };
      const item = liveScraperStock.updateWishlistItem(wishlistId, patch);
      if (!item) return { ok: false as const, error: "not found" };
      pushLiveScraperChanged();
      return { ok: true as const, item };
    },
  );

  handleAuthorized(
    LIVE_SCRAPER_WISHLIST_DELETE,
    assertMainRendererSender,
    async (_event, id: unknown) => {
      const wishlistId = toNonEmptyString(id, 64);
      if (!wishlistId) return { ok: false as const, error: "invalid payload" };
      const result = await liveScraperListingRemoval.removeWishlistItem(wishlistId);
      if (result.ok) pushLiveScraperChanged();
      return result;
    },
  );

  handleAuthorized(LIVE_SCRAPER_RIVEN_STOCK_LIST, assertMainRendererSender, () =>
    liveScraperRivenStock.listStockRivens(),
  );

  handleAuthorized(
    LIVE_SCRAPER_RIVEN_STOCK_CREATE,
    assertMainRendererSender,
    (_event, payload: unknown) => {
      const input = parseStockRivenInput(payload);
      if (!input) return { ok: false as const, error: "invalid payload" };
      const item = liveScraperRivenStock.createStockRiven(input);
      liveScraperEngine.requestRivenPass();
      pushLiveScraperChanged();
      return { ok: true as const, item };
    },
  );

  // Rivens tab context menu: the same search the engine prices from, as a link.
  handleAuthorized(LIVE_SCRAPER_RIVEN_SEARCH_URL, assertMainRendererSender, (_event, payload) => {
    const input = parseStockRivenInput(payload);
    const terms = input ? liveScraperRiven.rivenSearchTerms(input.weaponName, input.stats) : null;
    if (!terms) return null;
    const params = new URLSearchParams({ type: "riven", weapon_url_name: terms.weaponSlug });
    if (terms.positive.length > 0) params.set("positive_stats", terms.positive.join(","));
    if (terms.negative.length > 0) params.set("negative_stats", terms.negative.join(","));
    params.set("polarity", "any");
    params.set("sort_by", "price_asc");
    return `https://warframe.market/auctions/search?${params.toString()}`;
  });

  handleAuthorized(
    LIVE_SCRAPER_RIVEN_QUOTE,
    assertMainRendererSender,
    async (_event, payload: unknown, onlineOnly: unknown) => {
      const input = parseStockRivenInput(payload);
      if (!input) return { ok: false as const, error: "invalid payload" };
      try {
        return await liveScraperRiven.quoteLowestRivenPrice(
          input.weaponName,
          input.stats,
          wfmSession.getInGameName(),
          onlineOnly === true,
        );
      } catch (err) {
        return { ok: false as const, error: normalizeErrorMessage(err, "search failed") };
      }
    },
  );

  // Lists one owned riven at a price the user confirmed and files it as a stock
  // riven with its auction id, which is what makes the engine adopt it.
  handleAuthorized(
    LIVE_SCRAPER_RIVEN_QUICK_LIST,
    assertMainRendererSender,
    async (_event, payload: unknown, price: unknown) => {
      const input = parseStockRivenInput(payload);
      const platinum =
        typeof price === "number" && Number.isInteger(price) && price >= 1 && price <= 10_000_000
          ? price
          : null;
      if (!input || platinum == null) return { ok: false as const, error: "invalid payload" };
      if (!wfmSession.getInGameName()) return { ok: false as const, error: "not signed in" };
      const existing = input.sourceItemId
        ? liveScraperRivenStock
            .listStockRivens()
            .find((riven) => riven.sourceItemId === input.sourceItemId)
        : undefined;
      if (existing?.auctionId) return { ok: false as const, error: "already listed" };
      const row = existing ?? liveScraperRivenStock.createStockRiven(input);
      try {
        const result = await liveScraperRiven.listStockRivenAt(
          row,
          platinum,
          liveScraperSettings.getLiveScraperSettings().hiddenOnWfm.rivens,
        );
        if (!result.ok && !existing) liveScraperRivenStock.deleteStockRiven(row.id);
        pushLiveScraperChanged();
        return result.ok ? { ok: true as const, price: platinum } : result;
      } catch (err) {
        if (!existing) liveScraperRivenStock.deleteStockRiven(row.id);
        pushLiveScraperChanged();
        return { ok: false as const, error: normalizeErrorMessage(err, "listing failed") };
      }
    },
  );

  handleAuthorized(
    LIVE_SCRAPER_RIVEN_STOCK_UPDATE,
    assertMainRendererSender,
    (_event, id: unknown, patch: unknown) => {
      const rivenId = toNonEmptyString(id, 64);
      if (!rivenId || !isObject(patch)) return { ok: false as const, error: "invalid payload" };
      const item = liveScraperRivenStock.updateStockRiven(rivenId, patch);
      if (!item) return { ok: false as const, error: "not found" };
      liveScraperEngine.requestRivenPass();
      pushLiveScraperChanged();
      return { ok: true as const, item };
    },
  );

  handleAuthorized(
    LIVE_SCRAPER_RIVEN_STOCK_DELETE,
    assertMainRendererSender,
    async (_event, id: unknown) => {
      const rivenId = toNonEmptyString(id, 64);
      if (!rivenId) return { ok: false as const, error: "invalid payload" };
      const result = await liveScraperListingRemoval.removeStockRiven(rivenId);
      if (result.ok) pushLiveScraperChanged();
      return result;
    },
  );

  // Hides or shows the marked listings of one Listings tab, or all of them.
  handleAuthorized(
    LIVE_SCRAPER_SET_HIDDEN_ON_WFM,
    assertMainRendererSender,
    async (_event, tab: unknown, hidden: unknown, selection: unknown) => {
      const picked = parseVisibilitySelection(selection);
      if (
        (tab !== "wtb" && tab !== "wts" && tab !== "rivens") ||
        typeof hidden !== "boolean" ||
        picked === undefined
      ) {
        return { ok: false as const, error: "invalid payload" };
      }
      const result = await liveScraperWfmVisibility.setListingsHiddenOnWfm(
        tab,
        hidden,
        picked,
        pushLiveScraperChanged,
      );
      pushLiveScraperChanged();
      return result;
    },
  );

  handleAuthorized(LIVE_SCRAPER_START, assertMainRendererSender, () => {
    const status = liveScraperEngine.startLiveScraperEngine();
    pushLiveScraperChanged();
    return status;
  });

  handleAuthorized(LIVE_SCRAPER_STOP, assertMainRendererSender, () => {
    const status = liveScraperEngine.stopLiveScraperEngine();
    pushLiveScraperChanged();
    return status;
  });

  handleAuthorized(LIVE_SCRAPER_STATUS, assertMainRendererSender, () =>
    liveScraperEngine.getLiveScraperEngineStatus(),
  );
}

export { register };
