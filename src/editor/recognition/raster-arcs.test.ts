import { describe, expect, it } from "vitest";
import { deduplicateDetectedArcs, detectContourArcCandidates, isMeaningfulRasterArc } from "./raster-arcs";

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

  it("fits a partial curved wall face from an ordered contour", () => {
    const contour = Array.from({ length: 81 }, (_, index) => {
      const angle = Math.PI * (0.1 + index / 80 * 0.72);
      const noise = Math.sin(index * 1.7) * 0.35;
      return { x: 160 + Math.cos(angle) * (92 + noise), y: 140 + Math.sin(angle) * (92 + noise) };
    });
    const arcs = detectContourArcCandidates([contour], 600);
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs[0].evidence?.contourSupport).toBeGreaterThan(0.9);
    expect(arcs[0].evidence?.fitResidualPx).toBeLessThan(1);
  });

  it("does not classify a rectangular corner as a smooth arc", () => {
    const contour = [
      ...Array.from({ length: 40 }, (_, index) => ({ x: 20 + index * 2, y: 20 })),
      ...Array.from({ length: 40 }, (_, index) => ({ x: 98, y: 20 + index * 2 })),
    ];
    expect(detectContourArcCandidates([contour], 600)).toHaveLength(0);
  });
});
