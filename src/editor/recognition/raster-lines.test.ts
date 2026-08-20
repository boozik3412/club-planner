import { describe, expect, it } from "vitest";
import { consolidateWallLines } from "./raster-lines";
import type { DetectedLine } from "./types";

const line = (x1: number, y1: number, x2: number, y2: number): DetectedLine => ({
  start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, confidence: 0.7,
});

describe("raster wall-line consolidation", () => {
  it("turns parallel wall faces into one centerline", () => {
    const result = consolidateWallLines([line(20, 40, 420, 40), line(20, 52, 420, 52)], 500, 400, 24);
    expect(result).toHaveLength(1);
    expect(result[0].start.y).toBeCloseTo(46);
    expect(result[0].thicknessPx).toBeCloseTo(12);
  });

  it("merges fragmented faces before pairing", () => {
    const result = consolidateWallLines([
      line(10, 30, 180, 30), line(175, 30, 350, 30),
      line(10, 38, 170, 38), line(165, 38, 350, 38),
    ], 400, 300, 20);
    expect(result).toHaveLength(1);
    expect(result[0].end.x - result[0].start.x).toBeGreaterThan(330);
  });

  it("rejects short unpaired text strokes but keeps a long single wall axis", () => {
    const result = consolidateWallLines([
      line(10, 10, 45, 10), line(20, 30, 62, 33), line(20, 100, 370, 100),
    ], 400, 300, 20);
    expect(result).toHaveLength(1);
    expect(result[0].start.x).toBe(20);
  });

  it("keeps a medium-length unpaired wall after perspective correction", () => {
    const result = consolidateWallLines([line(30, 90, 180, 92)], 900, 680, 20);
    expect(result).toHaveLength(1);
  });

  it("rejects paper edges after crop suggestion", () => {
    const result = consolidateWallLines([line(0, 4, 380, 4)], 400, 300, 20);
    expect(result).toHaveLength(0);
  });
});
