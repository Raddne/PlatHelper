import { describe, expect, it } from "vitest";

import { rotateBatch } from "../../config/shared/rotateBatch";

describe("rotateBatch", () => {
  it("returns a short list whole and resets the offset", () => {
    expect(rotateBatch([1, 2, 3], 2, 5)).toEqual({ items: [1, 2, 3], nextOffset: 0 });
  });

  it("walks a long list in blocks, wrapping around, so everything gets a turn", () => {
    const list = [0, 1, 2, 3, 4, 5, 6];
    const seen: number[] = [];
    let offset = 0;
    for (let round = 0; round < 3; round++) {
      const batch = rotateBatch(list, offset, 3);
      seen.push(...batch.items);
      offset = batch.nextOffset;
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 1]);
    expect(offset).toBe(2);
  });

  it("survives a list that shrank below the stored offset", () => {
    expect(rotateBatch([0, 1, 2, 3], 9, 2)).toEqual({ items: [1, 2], nextOffset: 3 });
  });
});
