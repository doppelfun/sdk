import { describe, it, expect } from "vitest";
import { BLOCK_SIZE_M, getBlockBounds } from "./blockBounds.js";

describe("blockBounds", () => {
  it("BLOCK_SIZE_M is 100", () => {
    expect(BLOCK_SIZE_M).toBe(100);
  });

  it("getBlockBounds returns local [0,100) for any slot", () => {
    const b = getBlockBounds("0_0");
    expect(b).toEqual({ xMin: 0, zMin: 0, xMax: 100, zMax: 100 });
    expect(getBlockBounds("1_2")).toEqual(b);
  });
});
