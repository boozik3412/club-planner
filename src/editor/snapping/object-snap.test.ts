import { describe, expect, it } from "vitest";
import { createObjectFromTemplate } from "../model/templates";
import { resolveObjectSnap } from "./object-snap";

describe("object snap", () => {
  it("snaps edge-to-edge and center-to-center", () => {
    const moving = { ...createObjectFromTemplate("table", 1, 2, "moving"), widthM: 1, depthM: 1 };
    const target = { ...createObjectFromTemplate("table", 3, 2, "target"), widthM: 1, depthM: 1 };
    const edge = resolveObjectSnap([moving], [target], 0.95, 0, 0.1, 0);
    expect(edge?.deltaXM).toBeCloseTo(1);
    expect(edge?.guide.snapType).toBe("object-edge");

    const center = resolveObjectSnap([moving], [target], 1.95, 0, 0.1, 0);
    expect(center?.deltaXM).toBeCloseTo(2);
    expect(center?.guide.snapType).toBe("object-center");
  });

  it("centers a moving object into an equal-gap slot", () => {
    const moving = { ...createObjectFromTemplate("table", 3.05, 2, "moving"), widthM: 1, depthM: 1 };
    const left = { ...createObjectFromTemplate("table", 1, 2, "left"), widthM: 1, depthM: 1 };
    const right = { ...createObjectFromTemplate("table", 5, 2, "right"), widthM: 1, depthM: 1 };
    const result = resolveObjectSnap([moving], [left, right], 0, 0, 0.1, 0);
    const candidates = Array.from({ length: result?.guide.candidateCount ?? 0 }, (_, index) =>
      resolveObjectSnap([moving], [left, right], 0, 0, 0.1, index));
    expect(candidates.some((candidate) => candidate?.guide.snapType === "equal-gap"
      && Math.abs((candidate?.deltaXM ?? 1) + 0.05) < 1e-6)).toBe(true);
  });
});
