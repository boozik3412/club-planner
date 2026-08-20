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

  it("rejects unpaired text strokes and long dimension-like lines", () => {
    const result = consolidateWallLines([
      line(10, 10, 45, 10), line(20, 30, 62, 33), line(20, 100, 370, 100),
    ], 400, 300, 20);
    expect(result).toHaveLength(0);
  });

  it("does not promote a medium unpaired stroke after perspective correction", () => {
    const result = consolidateWallLines([line(30, 90, 180, 92)], 900, 680, 20);
    expect(result).toHaveLength(0);
  });

  it("rejects paper edges after crop suggestion", () => {
    const result = consolidateWallLines([line(0, 4, 380, 4)], 400, 300, 20);
    expect(result).toHaveLength(0);
  });

  it("rejects a regular diagonal hatch family before face pairing", () => {
    const hatch = Array.from({ length: 9 }, (_, index) => line(40 + index * 18, 40, 220 + index * 18, 220));
    const result = consolidateWallLines([
      ...hatch,
      line(20, 280, 420, 280), line(20, 294, 420, 294),
    ], 500, 400, 24);
    expect(result).toHaveLength(1);
    expect(Math.abs(result[0].end.y - result[0].start.y)).toBeLessThan(1);
  });

  it("merges duplicate axes produced by several edges of one thick wall", () => {
    const result = consolidateWallLines([
      line(20, 40, 420, 40), line(20, 45, 420, 45),
      line(20, 49, 420, 49), line(20, 54, 420, 54),
    ], 500, 400, 24);
    expect(result).toHaveLength(1);
    expect((result[0].start.y + result[0].end.y) / 2).toBeCloseTo(47, 0);
  });
});
