import { describe, expect, it } from "vitest";
import { arcFromBulge, architectureVertexMap, wallLengthM } from "./geometry";
import {
  addArchitecturalOpeningCommand,
  createRectangularRoomCommand,
  detachWallEndpointCommand,
  mergeArchitecturalWallsCommand,
  moveArchitecturalOpeningCommand,
  removeArchitecturalOpeningCommand,
  resizeArchitecturalWallCommand,
  straightenArchitecturalWallCommand,
  splitArchitecturalWallCommand,
  updateArchitecturalOpeningCommand,
} from "./commands";
import { createEmptyProject } from "../model/project";
import type { ArchitecturalWall, ProjectState } from "../model/types";

function projectWithWall(curve: ArchitecturalWall["curve"] = { kind: "line" }): ProjectState {
  const project = createEmptyProject();
  project.architecture.vertices = [
    { id: "a", xM: 0, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
    { id: "b", xM: 4, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
  ];
  project.architecture.walls = [{
    id: "wall", kind: "wall", startVertexId: "a", endVertexId: "b", curve,
    thicknessM: 0.2, heightM: 3, baseElevationM: 0, heightSource: "user", thicknessSource: "user",
    provenance: "manual", reviewStatus: "accepted", locked: false,
  }];
  project.architecture.openings = [];
  return project;
}

describe("architecture commands", () => {
  it("creates a closed rectangular room with shared accepted vertices", () => {
    const project = createEmptyProject();
    project.architecture.defaultWallHeightM = 3.2;
    const result = createRectangularRoomCommand(project, { xM: 5, yM: 4 }, { xM: 1, yM: 1 });

    expect(result?.project.architecture.vertices).toHaveLength(4);
    expect(result?.project.architecture.walls).toHaveLength(4);
    expect(result?.wallIds).toHaveLength(4);
    expect(result?.project.architecture.walls.every((wall) => wall.heightM === 3.2 && wall.reviewStatus === "accepted")).toBe(true);
    expect(createRectangularRoomCommand(project, { xM: 0, yM: 0 }, { xM: 0.1, yM: 2 })).toBeNull();
  });

  it("splits a line and transfers openings after the split", () => {
    let project = projectWithWall();
    const opening = addArchitecturalOpeningCommand(project, "wall", "door", 0.8)!;
    project = moveArchitecturalOpeningCommand(opening.project, opening.openingId!, 2.7);
    const result = splitArchitecturalWallCommand(project, "wall", 2)!;
    expect(result.project.architecture.walls).toHaveLength(2);
    expect(result.project.architecture.openings[0].hostWallId).toBe(result.wallIds?.[1]);
    expect(result.project.architecture.openings[0].offsetM).toBeCloseTo(0.7);
  });

  it("refuses to split through an opening", () => {
    const result = addArchitecturalOpeningCommand(projectWithWall(), "wall", "door", 1)!;
    expect(splitArchitecturalWallCommand(result.project, "wall", 2)).toBeNull();
  });

  it("edits and removes a hosted opening without letting it leave its wall", () => {
    const added = addArchitecturalOpeningCommand(projectWithWall(), "wall", "window", 1)!;
    const openingId = added.openingId!;
    const changed = updateArchitecturalOpeningCommand(added.project, openingId, {
      offsetM: 9,
      widthM: 1.5,
      sillHeightM: 0.8,
      openingHeightM: 1.1,
    });
    const opening = changed.architecture.openings.find((candidate) => candidate.id === openingId)!;
    expect(opening.offsetM).toBeCloseTo(2.5);
    expect(opening.widthM).toBe(1.5);
    expect(opening.sillHeightM).toBe(0.8);
    expect(removeArchitecturalOpeningCommand(changed, openingId).architecture.openings).toHaveLength(0);
  });

  it("places a door at the requested point and refuses an overlap", () => {
    const added = addArchitecturalOpeningCommand(projectWithWall(), "wall", "door", 0.9, 1.4)!;
    expect(added.project.architecture.openings[0].offsetM).toBeCloseTo(0.95);
    expect(addArchitecturalOpeningCommand(added.project, "wall", "door", 0.9, 1.6)).toBeNull();
  });

  it("splits an arc on the same original circle", () => {
    const project = projectWithWall({ kind: "arc", bulge: 1 });
    const original = arcFromBulge(project.architecture.vertices[0], project.architecture.vertices[1], 1)!;
    const result = splitArchitecturalWallCommand(project, "wall")!;
    const vertices = architectureVertexMap(result.project.architecture);
    result.project.architecture.walls.forEach((wall) => {
      const start = vertices.get(wall.startVertexId)!;
      const end = vertices.get(wall.endVertexId)!;
      const arc = arcFromBulge(start, end, wall.curve.kind === "arc" ? wall.curve.bulge : 0)!;
      expect(arc.radiusM).toBeCloseTo(original.radiusM, 6);
      expect(arc.center.xM).toBeCloseTo(original.center.xM, 6);
      expect(arc.center.yM).toBeCloseTo(original.center.yM, 6);
    });
  });

  it("merges compatible collinear walls and preserves openings", () => {
    const split = splitArchitecturalWallCommand(projectWithWall(), "wall")!;
    const withOpening = addArchitecturalOpeningCommand(split.project, split.wallIds![1], "window", 0.5)!;
    const merged = mergeArchitecturalWallsCommand(withOpening.project, split.wallIds![0], split.wallIds![1])!;
    expect(merged.project.architecture.walls).toHaveLength(1);
    expect(merged.project.architecture.openings[0].hostWallId).toBe("wall");
    expect(merged.project.architecture.openings[0].offsetM).toBeGreaterThan(2);
  });

  it("detaches a shared endpoint and resizes a wall", () => {
    const project = projectWithWall();
    const detached = detachWallEndpointCommand(project, "wall", "end")!;
    expect(detached.project.architecture.vertices).toHaveLength(3);
    const resized = resizeArchitecturalWallCommand(detached.project, "wall", { lengthM: 6, angleDeg: 90 });
    const wall = resized.architecture.walls[0];
    expect(wallLengthM(wall, architectureVertexMap(resized.architecture))).toBeCloseTo(6);
    const end = resized.architecture.vertices.find((vertex) => vertex.id === wall.endVertexId)!;
    expect(end.xM).toBeCloseTo(0);
    expect(end.yM).toBeCloseTo(6);
  });

  it("straightens a line to the chosen angle increment without changing its length", () => {
    const project = projectWithWall();
    const lengthM = 4;
    const sourceAngleRad = 13 * Math.PI / 180;
    project.architecture.vertices[1].xM = Math.cos(sourceAngleRad) * lengthM;
    project.architecture.vertices[1].yM = Math.sin(sourceAngleRad) * lengthM;

    const straightened = straightenArchitecturalWallCommand(project, "wall", 15);
    const wall = straightened.architecture.walls[0];
    const vertices = architectureVertexMap(straightened.architecture);
    const start = vertices.get(wall.startVertexId)!;
    const end = vertices.get(wall.endVertexId)!;
    expect(Math.atan2(end.yM - start.yM, end.xM - start.xM) * 180 / Math.PI).toBeCloseTo(15);
    expect(wallLengthM(wall, vertices)).toBeCloseTo(lengthM);
    expect(straightenArchitecturalWallCommand(straightened, "wall", 15)).toBe(straightened);
    const arcProject = projectWithWall({ kind: "arc", bulge: 0.2 });
    expect(straightenArchitecturalWallCommand(arcProject, "wall", 15)).toBe(arcProject);
  });
});
