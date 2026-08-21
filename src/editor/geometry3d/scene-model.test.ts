import { describe, expect, it } from "vitest";
import type { ResolvedArchitecturalOpening, ResolvedArchitecturalWall } from "../architecture/types";
import { createBundledProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { buildSceneModel } from "./scene-model";
import { buildWallSolids } from "./wall-solids";

const wall: ResolvedArchitecturalWall = {
  id: "wall-test",
  kind: "wall",
  start: { xM: 0, yM: 0 },
  end: { xM: 5, yM: 0 },
  thicknessM: 0.2,
  heightM: 3,
  baseElevationM: 0,
  heightSource: "user",
  thicknessSource: "user",
  source: "base-plan",
};

function opening(overrides: Partial<ResolvedArchitecturalOpening>): ResolvedArchitecturalOpening {
  return {
    id: "opening-test",
    kind: "door",
    start: { xM: 2, yM: 0 },
    end: { xM: 3, yM: 0 },
    hostWallId: wall.id,
    sillHeightM: 0,
    openingHeightM: 2,
    verticalSource: "measurement",
    source: "base-plan",
    ...overrides,
  };
}

describe("schematic 3D geometry", () => {
  it("builds one solid for a wall without openings", () => {
    expect(buildWallSolids(wall, [])).toEqual([
      expect.objectContaining({ lengthM: 5, heightM: 3, depthM: 0.2, centerXM: 2.5 }),
    ]);
  });

  it("splits a door into two piers and a lintel without CSG", () => {
    const solids = buildWallSolids(wall, [opening({})]);
    expect(solids).toHaveLength(3);
    expect(solids.map((solid) => solid.heightM)).toContain(1);
    expect(solids.reduce((sum, solid) => sum + solid.lengthM * solid.heightM, 0)).toBeCloseTo(13);
  });

  it("adds lower and upper wall parts around a window", () => {
    const solids = buildWallSolids(wall, [opening({ kind: "window", sillHeightM: 0.8, openingHeightM: 1.2 })]);
    expect(solids).toHaveLength(4);
    expect(solids.map((solid) => solid.heightM)).toEqual(expect.arrayContaining([0.8, 1]));
  });

  it("segments a true arc with at most one-centimetre chord error", () => {
    const arcWall: ResolvedArchitecturalWall = {
      ...wall,
      end: { xM: 4, yM: 0 },
      curve: { kind: "arc", bulge: 1 },
    };
    const solids = buildWallSolids(arcWall, []);
    expect(solids.length).toBeGreaterThan(10);
    const radiusM = 2;
    solids.forEach((solid) => {
      const angle = 2 * Math.asin(Math.min(1, solid.lengthM / (2 * radiusM)));
      const errorM = radiusM * (1 - Math.cos(angle / 2));
      expect(errorM).toBeLessThanOrEqual(0.011);
    });
  });

  it("maps plan XY to scene XZ and keeps physical elevation", () => {
    const project = createBundledProject();
    project.objects = [{
      ...createObjectFromTemplate("custom-oval", 4, 2, "oval"),
      widthM: 2,
      depthM: 1,
      heightM: 1.4,
      elevationM: 0.3,
    }];
    const scene = buildSceneModel(project);
    expect(scene.objects[0]).toMatchObject({
      id: "oval",
      shape: "oval",
      centerXM: 4,
      centerZM: 2,
      centerYM: 1,
      widthM: 2,
      depthM: 1,
      heightM: 1.4,
    });
    expect(scene.wallSolids.length).toBeGreaterThan(20);
  });
});
