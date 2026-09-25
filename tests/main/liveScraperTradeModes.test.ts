import { describe, expect, it } from "vitest";

import {
  defaultLiveScraperSettings,
  normalizeLiveScraperSettings,
  withTradeMode,
} from "../../config/shared/liveScraperSettings";

function general(raw: Record<string, unknown>) {
  return normalizeLiveScraperSettings({ version: 1, general: raw }).general;
}

describe("live scraper trade modes", () => {
  it("sells rivens by default, next to the three item modes", () => {
    const { tradeModes, stockMode } = defaultLiveScraperSettings().general;
    expect(tradeModes).toEqual(["buy", "sell", "wishlist", "riven"]);
    expect(stockMode).toBe("all");
  });

  it("reads the old engine-mode switch as the riven checkbox", () => {
    expect(general({ stockMode: "all", tradeModes: ["sell", "buy"] }).tradeModes).toEqual([
      "sell",
      "buy",
      "riven",
    ]);
    expect(general({ stockMode: "item", tradeModes: ["sell"] }).tradeModes).toEqual(["sell"]);
    // "Rivens only" ignored the item modes, so they read as unticked.
    expect(general({ stockMode: "riven", tradeModes: ["buy", "sell"] })).toMatchObject({
      tradeModes: ["riven"],
      stockMode: "riven",
    });
  });

  it("drops the retired syndicate mode", () => {
    expect(general({ stockMode: "item", tradeModes: ["syndicate"] }).tradeModes).toEqual([]);
    expect(general({ stockMode: "item", tradeModes: ["buy", "syndicate"] }).tradeModes).toEqual([
      "buy",
    ]);
  });

  it("keeps stockMode in step with the checkboxes", () => {
    let g = defaultLiveScraperSettings().general;
    for (const mode of ["buy", "sell", "wishlist"] as const) g = withTradeMode(g, mode, false);
    expect(g).toMatchObject({ tradeModes: ["riven"], stockMode: "riven" });
    g = withTradeMode(g, "riven", false);
    expect(g).toMatchObject({ tradeModes: [], stockMode: "item" });
    g = withTradeMode(withTradeMode(g, "sell", true), "riven", true);
    expect(g).toMatchObject({ tradeModes: ["sell", "riven"], stockMode: "all" });
  });

  it("round-trips what the checkboxes wrote", () => {
    let g = defaultLiveScraperSettings().general;
    g = withTradeMode(g, "riven", false);
    expect(general({ ...g }).tradeModes).toEqual(["buy", "sell", "wishlist"]);
    g = withTradeMode(
      withTradeMode(withTradeMode(g, "buy", false), "wishlist", false),
      "sell",
      false,
    );
    g = withTradeMode(g, "riven", true);
    expect(general({ ...g })).toMatchObject({ tradeModes: ["riven"], stockMode: "riven" });
  });
});
