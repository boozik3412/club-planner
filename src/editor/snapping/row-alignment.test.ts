import { describe, expect, it } from "vitest";
import { createObjectFromTemplate } from "../model/templates";
import { findRowAlignmentCandidates } from "./row-alignment";

function table(id: string, xM: number, yM: number) {
  return { ...createObjectFromTemplate("table", xM, yM, id), widthM: 1, depthM: 0.8 };
}

describe("smart row alignment", () => {
  it("aligns two horizontal rows with the same interval pattern", () => {
    const moving = [table("m1", 1, 2), table("m2", 2.5, 2), table("m3", 4, 2)];
    const target = [table("t1", 10, 5), table("t2", 11.5, 5), table("t3", 13, 5)];
    const [result] = findRowAlignmentCandidates(moving, target, 5, 2.92, 0.1);

    expect(result.deltaYM).toBeCloseTo(3);
    expect(result.deltaXM).toBeCloseTo(5);
    expect(result.guide.snapType).toBe("row-alignment");
    expect(result.guide.markers).toHaveLength(6);
    expect(result.guide.from.yM).toBeCloseTo(5);
    expect(result.guide.to.yM).toBeCloseTo(5);
  });

  it("aligns vertical and diagonal rows without changing their internal spacing", () => {
    const verticalMoving = [table("vm1", 2, 1), table("vm2", 2, 2), table("vm3", 2, 3)];
    const verticalTarget = [table("vt1", 5, 7), table("vt2", 5, 8), table("vt3", 5, 9)];
    expect(findRowAlignmentCandidates(verticalMoving, verticalTarget, 2.94, 4, 0.1)[0].deltaXM).toBeCloseTo(3);

    const diagonalMoving = [table("dm1", 1, 1), table("dm2", 2, 2), table("dm3", 3, 3)];
    const shift = { xM: -Math.SQRT2, yM: Math.SQRT2 };
    const diagonalTarget = diagonalMoving.map((object, index) => table(`dt${index}`, object.xM + shift.xM, object.yM + shift.yM));
    const raw = { xM: shift.xM * 0.97, yM: shift.yM * 0.97 };
    const [diagonal] = findRowAlignmentCandidates(diagonalMoving, diagonalTarget, raw.xM, raw.yM, 0.1);
    expect(diagonal.deltaXM).toBeCloseTo(shift.xM);
    expect(diagonal.deltaYM).toBeCloseTo(shift.yM);
  });

  it("rejects unlike objects and a different interval pattern", () => {
    const moving = [table("m1", 1, 2), table("m2", 2.5, 2), table("m3", 4, 2)];
    const unlike = [table("t1", 10, 5), createObjectFromTemplate("sofa", 11.5, 5, "sofa"), table("t3", 13, 5)];
    expect(findRowAlignmentCandidates(moving, unlike, 5, 3, 0.1)).toHaveLength(0);

    const uneven = [table("u1", 10, 5), table("u2", 11.1, 5), table("u3", 13, 5)];
    expect(findRowAlignmentCandidates(moving, uneven, 5, 3, 0.1)).toHaveLength(0);
  });
});
