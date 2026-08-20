import { describe, expect, it } from "vitest";
import { deduplicateDetectedArcs, isMeaningfulRasterArc } from "./raster-arcs";

describe("raster arc filtering", () => {
  it("rejects nearly straight Hough fragments and keeps a door swing", () => {
    expect(isMeaningfulRasterArc(180, 12, 180, 700)).toBe(false);
    expect(isMeaningfulRasterArc(180, 20, 180, 700)).toBe(false);
    expect(isMeaningfulRasterArc(70, 45, 180, 700)).toBe(true);
  });

  it("deduplicates close circle detections", () => {
    const arcs = deduplicateDetectedArcs([
      { start: { x: 100, y: 50 }, through: { x: 135.36, y: 64.64 }, end: { x: 150, y: 100 }, confidence: 0.9 },
      { start: { x: 101, y: 50 }, through: { x: 136, y: 65 }, end: { x: 150, y: 99 }, confidence: 0.8 },
    ]);
    expect(arcs).toHaveLength(1);
  });
});
