import { beforeEach, describe, expect, it, vi } from "vitest";

import { request } from "../../services/wfmClient";
import { searchSimilarRivens, searchSimilarRivensOrThrow } from "../../services/wfmRivenSearch";

vi.mock("../../services/wfmClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/wfmClient")>();
  return { ...actual, request: vi.fn(), requestV2: vi.fn() };
});

const requestMock = vi.mocked(request);

describe("searchSimilarRivens stat filters", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ payload: { auctions: [] } });
  });

  // WFM keeps only the first repeated positive_stats/negative_stats key, so every
  // picked stat has to travel in one comma list or the rest are silently dropped.
  it("sends every picked stat in one comma list per polarity", async () => {
    await searchSimilarRivens("rubico", {
      positiveStats: ["critical_chance", "damage"],
      negativeStats: ["zoom"],
    });

    const path = String(requestMock.mock.calls[0]?.[1]);
    expect(path).toContain("positive_stats=critical_chance%2Cdamage");
    expect(path).toContain("negative_stats=zoom");
    expect(path.match(/positive_stats=/g)).toHaveLength(1);
    expect(path.match(/negative_stats=/g)).toHaveLength(1);
  });

  it("omits the stat keys when nothing is picked", async () => {
    await searchSimilarRivens("rubico-prime");

    const path = String(requestMock.mock.calls[0]?.[1]);
    expect(path).not.toContain("positive_stats");
    expect(path).not.toContain("negative_stats");
  });

  it("asks for fixed-price listings only and skips the price_desc page when pricing", async () => {
    const auction = {
      id: "a1",
      owner: { ingame_name: "x" },
      is_direct_sell: true,
      buyout_price: 5,
      starting_price: 5,
      item: { attributes: [] },
    };
    requestMock.mockResolvedValue({ payload: { auctions: [auction] } });
    const listings = await searchSimilarRivensOrThrow("boar", { directOnly: true, ascOnly: true });

    expect(listings).toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(String(requestMock.mock.calls[0]?.[1])).toContain("buyout_policy=direct");
  });

  it("still fetches both pages for a display search", async () => {
    const auction = {
      id: "a1",
      owner: { ingame_name: "x" },
      is_direct_sell: true,
      buyout_price: 5,
      starting_price: 5,
      item: { attributes: [] },
    };
    requestMock.mockResolvedValue({ payload: { auctions: [auction] } });
    await searchSimilarRivens("latron");

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(String(requestMock.mock.calls[0]?.[1])).not.toContain("buyout_policy");
  });

  it("throws for the engine and answers an empty list for display when the request fails", async () => {
    requestMock.mockRejectedValue(new Error("rate limit hit"));
    await expect(searchSimilarRivensOrThrow("boar_prime", { ascOnly: true })).rejects.toThrow(
      /rate limit/,
    );
    expect(await searchSimilarRivens("kuva_bramma")).toEqual([]);
  });
});
