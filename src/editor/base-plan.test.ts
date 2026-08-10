import { describe, expect, it } from "vitest";
import {
  PLAN_HEIGHT_UNITS,
  PLAN_WIDTH_UNITS,
  getRotatedViewBox,
  normalizeQuarterTurn,
} from "./base-plan";

describe("normalizeQuarterTurn", () => {
  it("normalizes positive and negative quarter turns", () => {
    expect(normalizeQuarterTurn(-90)).toBe(270);
    expect(normalizeQuarterTurn(450)).toBe(90);
    expect(normalizeQuarterTurn(720)).toBe(0);
  });
});

describe("getRotatedViewBox", () => {
  it("keeps the source bounds for 0 and 180 degrees", () => {
    expect(getRotatedViewBox(0)).toEqual([0, 0, PLAN_WIDTH_UNITS, PLAN_HEIGHT_UNITS]);
    expect(getRotatedViewBox(180)).toEqual([0, 0, PLAN_WIDTH_UNITS, PLAN_HEIGHT_UNITS]);
  });

  it("swaps width and height for 90 and 270 degrees", () => {
    const [, , width, height] = getRotatedViewBox(90);
    expect(width).toBe(PLAN_HEIGHT_UNITS);
    expect(height).toBe(PLAN_WIDTH_UNITS);
    expect(getRotatedViewBox(270)).toEqual(getRotatedViewBox(90));
  });
});
