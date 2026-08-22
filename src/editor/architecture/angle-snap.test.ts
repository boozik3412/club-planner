import { describe, expect, it } from "vitest";
import { roundAngleDeg, snapPointToAngleIncrement } from "./angle-snap";

describe("architecture angle snap", () => {
  it("rounds degrees to a configurable CAD increment", () => {
    expect(roundAngleDeg(13.4, 5)).toBe(15);
    expect(roundAngleDeg(87.6, 15)).toBe(90);
    expect(roundAngleDeg(-1.8, 5)).toBe(0);
    expect(roundAngleDeg(12.5, 0)).toBe(12.5);
  });

  it("snaps only inside tolerance unless the user forces the angle", () => {
    const anchor = { xM: 0, yM: 0 };
    const pointAt = (angleDeg: number) => ({
      xM: Math.cos(angleDeg * Math.PI / 180) * 4,
      yM: Math.sin(angleDeg * Math.PI / 180) * 4,
    });
    const near = snapPointToAngleIncrement(anchor, pointAt(13), 15, 4);
    expect(Math.atan2(near.yM, near.xM) * 180 / Math.PI).toBeCloseTo(15);
    expect(Math.hypot(near.xM, near.yM)).toBeCloseTo(4);

    const outside = pointAt(9);
    expect(snapPointToAngleIncrement(anchor, outside, 15, 4)).toEqual(outside);
    const forced = snapPointToAngleIncrement(anchor, outside, 15, 4, true);
    expect(Math.atan2(forced.yM, forced.xM) * 180 / Math.PI).toBeCloseTo(15);
  });
});
