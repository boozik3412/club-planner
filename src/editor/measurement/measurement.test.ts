import { describe, expect, it } from "vitest";
import { dimensionMidpoint, distanceMeters, formatMeters } from "./measurement";

describe("measurement geometry", () => {
  it("measures, formats and centers a dimension", () => {
    expect(distanceMeters({ xM: 1, yM: 2 }, { xM: 4, yM: 6 })).toBe(5);
    expect(formatMeters(5)).toBe("5.00 м");
    expect(dimensionMidpoint({ start: { xM: 1, yM: 2 }, end: { xM: 4, yM: 6 } }))
      .toEqual({ xM: 2.5, yM: 4 });
  });
});
