import { describe, expect, it } from "vitest";
import type { ArchitectureSettings, ArchitecturalWall } from "../model/types";
import {
  architectureVertexMap,
  nearestPointOnWallCurve,
  openingEndpoints,
  wallLengthM,
  wallPointAtDistance,
  wallPolyline,
  wallSvgPath,
} from "./geometry";

function fixture(): { architecture: ArchitectureSettings; wall: ArchitecturalWall } {
  const wall: ArchitecturalWall = {
    id: "arc-wall",
    kind: "wall",
    startVertexId: "a",
    endVertexId: "b",
    curve: { kind: "arc", bulge: Math.tan(Math.PI / 8) },
    thicknessM: 0.2,
    heightM: 3,
    baseElevationM: 0,
    heightSource: "user",
    thicknessSource: "user",
    provenance: "manual",
    reviewStatus: "accepted",
    locked: false,
  };
  return {
    wall,
    architecture: {
      defaultWallHeightM: 3,
      defaultWallThicknessM: 0.2,
      vertices: [
        { id: "a", xM: 0, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
        { id: "b", xM: 2, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
      ],
      walls: [wall],
      openings: [],
      heightRegions: [],
    },
  };
}

describe("architectural arc geometry", () => {
  it("uses a true semicircle-compatible length and point evaluation", () => {
    const { architecture, wall } = fixture();
    const vertices = architectureVertexMap(architecture);
    expect(wallLengthM(wall, vertices)).toBeCloseTo(Math.PI / Math.SQRT2, 5);
    const middle = wallPointAtDistance(wall, vertices, wallLengthM(wall, vertices) / 2);
    expect(middle).not.toBeNull();
    expect(middle?.xM).toBeCloseTo(1, 5);
    expect(Math.abs(middle?.yM ?? 0)).toBeGreaterThan(0.4);
  });

  it("places hosted openings along the curve and renders an SVG arc", () => {
    const { architecture, wall } = fixture();
    const vertices = architectureVertexMap(architecture);
    const endpoints = openingEndpoints({
      id: "door",
      kind: "door",
      hostWallId: wall.id,
      offsetM: 0.5,
      widthM: 0.9,
      sillHeightM: 0,
      openingHeightM: 2,
      verticalSource: "user",
      provenance: "manual",
      reviewStatus: "accepted",
      locked: false,
    }, wall, vertices);
    expect(endpoints).not.toBeNull();
    expect(wallSvgPath(wall, vertices, 100)).toContain(" A ");
    expect(wallPolyline(wall, vertices, 0.01).length).toBeGreaterThanOrEqual(8);
  });

  it("finds the analytical nearest point and tangent on an arc", () => {
    const nearest = nearestPointOnWallCurve(
      { xM: 0, yM: 0 },
      { xM: 2, yM: 0 },
      { kind: "arc", bulge: -1 },
      { xM: 1, yM: 1.2 },
    )!;
    expect(nearest.point.xM).toBeCloseTo(1, 6);
    expect(nearest.point.yM).toBeCloseTo(1, 6);
    expect(Math.hypot(nearest.tangent.xM, nearest.tangent.yM)).toBeCloseTo(1, 6);
  });
});
