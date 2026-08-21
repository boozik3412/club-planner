import { describe, expect, it } from "vitest";
import type { ArchitecturalWall, ArchitectureVertex } from "../model/types";
import { reviewWallsIntersectingRect, sourceRect } from "./review-selection";

const vertices = new Map<string, ArchitectureVertex>([
  ["a", { id: "a", xM: 0, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false }],
  ["b", { id: "b", xM: 4, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false }],
  ["c", { id: "c", xM: 0, yM: 3, provenance: "manual", reviewStatus: "accepted", locked: false }],
  ["d", { id: "d", xM: 4, yM: 3, provenance: "manual", reviewStatus: "accepted", locked: false }],
]);

function wall(id: string, startVertexId: string, endVertexId: string, curve: ArchitecturalWall["curve"]): ArchitecturalWall {
  return {
    id, kind: "wall", startVertexId, endVertexId, curve,
    thicknessM: 0.15, heightM: 3, baseElevationM: 0,
    heightSource: "user", thicknessSource: "user", provenance: "manual",
    reviewStatus: "accepted", locked: false,
  };
}

describe("review marquee geometry", () => {
  it("selects lines and arcs touched by the rectangle, not only enclosed endpoints", () => {
    const walls = [wall("line", "a", "b", { kind: "line" }), wall("arc", "c", "d", { kind: "arc", bulge: -1 })];
    expect(reviewWallsIntersectingRect(walls, vertices, 0.01, sourceRect({ x: 190, y: -10 }, { x: 210, y: 510 }))).toEqual(["line", "arc"]);
    expect(reviewWallsIntersectingRect(walls, vertices, 0.01, sourceRect({ x: 500, y: 500 }, { x: 600, y: 600 }))).toEqual([]);
  });
});
