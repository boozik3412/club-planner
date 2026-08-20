import { describe, expect, it } from "vitest";
import { buildRecognitionGuideSet } from "./review-guides";

describe("recognition review guides", () => {
  it("deduplicates axes and provides source-line intersections", () => {
    const guides = buildRecognitionGuideSet({
      axes: [{ start: { x: 0, y: 50 }, end: { x: 100, y: 50 }, confidence: 0.9 }],
      rawLines: [
        { start: { x: 1, y: 50 }, end: { x: 99, y: 50 }, confidence: 0.7 },
        { start: { x: 50, y: 0 }, end: { x: 50, y: 100 }, confidence: 0.8 },
      ],
    });
    expect(guides.lines).toHaveLength(2);
    expect(guides.points).toHaveLength(1);
    expect(guides.points[0].point.x).toBeCloseTo(50);
    expect(guides.points[0].point.y).toBeCloseTo(50);
  });
});
