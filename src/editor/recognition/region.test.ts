import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../model/project";
import type { RecognitionDraft } from "./types";
import { mergeRegionRecognition, normalizedPixelRegion } from "./region";

function draftAt(xM: number, status: "candidate" | "accepted" = "candidate"): RecognitionDraft {
  const source = createEmptyProject().planSources[0];
  return {
    engineVersion: "test",
    source: { ...source, metersPerSourceUnit: 0.1 },
    vertices: [
      { id: `v-${xM}-a`, xM, yM: 1, provenance: "raster", reviewStatus: status, locked: false },
      { id: `v-${xM}-b`, xM: xM + 1, yM: 1, provenance: "raster", reviewStatus: status, locked: false },
    ],
    walls: [{
      id: `w-${xM}`, kind: "wall", startVertexId: `v-${xM}-a`, endVertexId: `v-${xM}-b`, curve: { kind: "line" },
      thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "default", thicknessSource: "default",
      provenance: "raster", reviewStatus: status, locked: false,
    }],
    openings: [], textHints: [], issues: [],
  };
}

describe("selected-region recognition", () => {
  it("normalizes a dragged rectangle and clamps it to the image", () => {
    expect(normalizedPixelRegion({ x: 80, y: 70 }, { x: -5, y: 20 }, 60, 50)).toEqual({ x: 0, y: 20, width: 60, height: 30 });
  });

  it("replaces only candidates inside the selected area and shifts new geometry", () => {
    const current = draftAt(1);
    const accepted = draftAt(5, "accepted");
    current.vertices.push(...accepted.vertices);
    current.walls.push(...accepted.walls);
    const replacement = draftAt(0.2);
    const merged = mergeRegionRecognition(current, replacement, { x: 5, y: 0, width: 20, height: 20 }, current.source);
    expect(merged.walls.some((wall) => wall.id === "w-1")).toBe(false);
    expect(merged.walls.some((wall) => wall.id === "w-5")).toBe(true);
    expect(merged.vertices.find((vertex) => vertex.id === "v-0.2-a")?.xM).toBeCloseTo(0.7);
  });
});
