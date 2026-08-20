import { describe, expect, it } from "vitest";
import type { PlanSource } from "../model/types";
import { DEFAULT_RECOGNITION_OPTIONS } from "./types";
import { bridgeColoredDoorGaps, buildRecognitionGraph, bulgeFromThreePoints, mergeCollinearLines, mergeNearbyVertices, splitLinesAtJunctions } from "./graph";

const source: PlanSource = {
  id: "source-test",
  kind: "image",
  name: "plan.png",
  mimeType: "image/png",
  sha256: "a".repeat(64),
  embeddedPath: "sources/plan.png",
  widthM: 10,
  heightM: 5,
  rotationDeg: 0,
  sourceWidth: 1000,
  sourceHeight: 500,
  metersPerSourceUnit: 0.01,
  locked: true,
};

describe("recognition graph", () => {
  it("bridges collinear wall faces across a colored door leaf", () => {
    const result = bridgeColoredDoorGaps([
      { start: { x: 10, y: 0 }, end: { x: 10, y: 100 }, confidence: 0.9, thicknessPx: 5 },
      { start: { x: 10, y: 140 }, end: { x: 10, y: 240 }, confidence: 0.9, thicknessPx: 5 },
    ], [{
      start: { x: 10, y: 100 }, end: { x: 50, y: 100 }, confidence: 0.9,
      evidence: { coloredOpeningSupport: 1 },
    }], 0.02);
    expect(result.lines).toHaveLength(1);
    expect(result.doorGaps).toEqual([{ start: { x: 10, y: 100 }, end: { x: 10, y: 140 }, confidence: 0.9 }]);
  });
  it("splits a host wall and snaps a T junction to one point", () => {
    const result = splitLinesAtJunctions([
      { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, confidence: 0.9 },
      { start: { x: 50, y: 52 }, end: { x: 50, y: 3 }, confidence: 0.9 },
    ], 4);
    expect(result).toHaveLength(3);
    expect(result.filter((line) => Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) === 50)).toHaveLength(2);
    expect(result.some((line) => line.start.x === 50 && line.start.y === 0 || line.end.x === 50 && line.end.y === 0)).toBe(true);
  });
  it("merges close endpoints into one shared vertex", () => {
    const merged = mergeNearbyVertices([{ xM: 0, yM: 0 }, { xM: 0.03, yM: 0.02 }, { xM: 1, yM: 0 }], 0.08, "raster");
    expect(merged.vertices).toHaveLength(2);
    expect(merged.indices[0]).toBe(merged.indices[1]);
  });

  it("merges overlapping collinear detections", () => {
    const result = mergeCollinearLines([
      { start: { x: 0, y: 10 }, end: { x: 100, y: 10 }, confidence: 0.7 },
      { start: { x: 90, y: 11 }, end: { x: 180, y: 11 }, confidence: 0.8 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].end.x).toBe(180);
  });

  it("creates editable line and true arc candidates", () => {
    const draft = buildRecognitionGraph({
      source,
      lines: [{ start: { x: 0, y: 0 }, end: { x: 500, y: 0 }, confidence: 0.92 }],
      arcs: [{ start: { x: 500, y: 0 }, through: { x: 600, y: 100 }, end: { x: 500, y: 200 }, confidence: 0.8 }],
      options: DEFAULT_RECOGNITION_OPTIONS,
      geometrySource: "vector",
    });
    expect(draft.walls).toHaveLength(2);
    expect(draft.walls[1].curve.kind).toBe("arc");
    expect(draft.vertices).toHaveLength(3);
    expect(draft.walls.every((wall) => wall.reviewStatus === "candidate")).toBe(true);
  });

  it("classifies a door swing arc as an opening hosted by a wall", () => {
    const draft = buildRecognitionGraph({
      source,
      lines: [{ start: { x: 0, y: 100 }, end: { x: 500, y: 100 }, confidence: 0.95 }],
      arcs: [{ start: { x: 200, y: 100 }, through: { x: 270, y: 130 }, end: { x: 300, y: 200 }, confidence: 0.85 }],
      options: DEFAULT_RECOGNITION_OPTIONS,
      geometrySource: "vector",
    });
    expect(draft.openings).toHaveLength(1);
    expect(draft.openings[0].kind).toBe("door");
    expect(draft.openings[0].hostWallId).toBe(draft.walls[0].id);
  });

  it("rejects tiny raster circles caused by letters and line corners", () => {
    const draft = buildRecognitionGraph({
      source,
      lines: [],
      arcs: [{ start: { x: 30, y: 0 }, through: { x: 0, y: 30 }, end: { x: -30, y: 0 }, confidence: 0.7 }],
      options: DEFAULT_RECOGNITION_OPTIONS,
    });
    expect(draft.walls).toHaveLength(0);
    expect(draft.openings).toHaveLength(0);
  });

  it("does not turn a weak raster circle into a door opening", () => {
    const draft = buildRecognitionGraph({
      source,
      lines: [{ start: { x: 0, y: 100 }, end: { x: 500, y: 100 }, confidence: 0.95 }],
      arcs: [{ start: { x: 200, y: 100 }, through: { x: 270, y: 130 }, end: { x: 300, y: 200 }, confidence: 0.61 }],
      options: DEFAULT_RECOGNITION_OPTIONS,
    });
    expect(draft.openings).toHaveLength(0);
  });

  it("requires concentric evidence before creating a raster curved wall", () => {
    const single = buildRecognitionGraph({
      source,
      lines: [],
      arcs: [{ start: { x: 200, y: 100 }, through: { x: 300, y: 0 }, end: { x: 400, y: 100 }, confidence: 0.91 }],
      options: { ...DEFAULT_RECOGNITION_OPTIONS, detectOpenings: false },
      geometrySource: "raster",
    });
    expect(single.walls).toHaveLength(0);

    const paired = buildRecognitionGraph({
      source,
      lines: [],
      arcs: [
        { start: { x: 200, y: 100 }, through: { x: 300, y: 0 }, end: { x: 400, y: 100 }, confidence: 0.91 },
        { start: { x: 190, y: 100 }, through: { x: 300, y: -10 }, end: { x: 410, y: 100 }, confidence: 0.88 },
      ],
      options: { ...DEFAULT_RECOGNITION_OPTIONS, detectOpenings: false },
      geometrySource: "raster",
    });
    expect(paired.walls).toHaveLength(1);
    expect(paired.walls[0].curve.kind).toBe("arc");
  });

  it("keeps a strongly supported curved wall when partial Hough runs make the two faces imprecise", () => {
    const draft = buildRecognitionGraph({
      source: { ...source, metersPerSourceUnit: 0.017 },
      lines: [],
      arcs: [
        {
          start: { x: 166, y: 400 }, through: { x: 194, y: 279 }, end: { x: 316, y: 256 },
          confidence: 0.9, evidence: { gradientSupport: 0.96 },
        },
        {
          start: { x: 166, y: 498 }, through: { x: 163, y: 318 }, end: { x: 321, y: 230 },
          confidence: 0.87, evidence: { gradientSupport: 0.97 },
        },
      ],
      options: { ...DEFAULT_RECOGNITION_OPTIONS, detectOpenings: false },
      geometrySource: "raster",
    });
    expect(draft.walls).toHaveLength(1);
    expect(draft.walls[0].curve.kind).toBe("arc");
    expect(draft.walls[0].confidence).toBeGreaterThan(0.9);
  });

  it("prunes short isolated raster graphics but keeps connected wall chains", () => {
    const draft = buildRecognitionGraph({
      source,
      lines: [
        { start: { x: 0, y: 0 }, end: { x: 500, y: 0 }, confidence: 0.95 },
        { start: { x: 500, y: 0 }, end: { x: 500, y: 300 }, confidence: 0.94 },
        { start: { x: 80, y: 120 }, end: { x: 180, y: 120 }, confidence: 0.98 },
      ],
      options: DEFAULT_RECOGNITION_OPTIONS,
      geometrySource: "raster",
    });
    expect(draft.walls).toHaveLength(2);
  });

  it("uses a nearby OCR window label as a reviewable hosted opening", () => {
    const draft = buildRecognitionGraph({
      source,
      lines: [{ start: { x: 0, y: 100 }, end: { x: 500, y: 100 }, confidence: 0.95 }],
      textHints: [{ id: "text-window", text: "ОКНО", confidence: 0.9, bounds: { x: 220, y: 80, width: 60, height: 20 } }],
      options: DEFAULT_RECOGNITION_OPTIONS,
    });
    expect(draft.openings).toHaveLength(1);
    expect(draft.openings[0]).toMatchObject({ kind: "window", reviewStatus: "candidate" });
  });

  it("computes the semicircle bulge from three points", () => {
    expect(Math.abs(bulgeFromThreePoints({ xM: 0, yM: 0 }, { xM: 1, yM: -1 }, { xM: 2, yM: 0 }) ?? 0)).toBeCloseTo(1, 6);
  });
});
