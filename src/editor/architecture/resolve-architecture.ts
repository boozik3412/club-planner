import type { PointM, ProjectState } from "../model/types";
import { boundaryFromPartitionObject } from "../snapping/boundaries";
import { architectureVertexMap, openingEndpoints, wallEndpoints } from "./geometry";
import type {
  HeightRegion,
  ResolvedArchitecture,
  ResolvedArchitecturalOpening,
  ResolvedArchitecturalWall,
} from "./types";

function polygonArea(points: readonly PointM[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.xM * next.yM - next.xM * current.yM;
  }
  return Math.abs(area / 2);
}

function pointInPolygon(point: PointM, polygon: readonly PointM[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects = (currentPoint.yM > point.yM) !== (previousPoint.yM > point.yM)
      && point.xM < (previousPoint.xM - currentPoint.xM)
        * (point.yM - currentPoint.yM)
        / (previousPoint.yM - currentPoint.yM)
        + currentPoint.xM;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function findHeightRegion(
  point: PointM,
  regions: readonly HeightRegion[],
): HeightRegion | null {
  let winner: HeightRegion | null = null;
  let winnerArea = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    if (!pointInPolygon(point, region.polygon)) continue;
    const area = polygonArea(region.polygon);
    if (area < winnerArea) {
      winner = region;
      winnerArea = area;
    }
  }
  return winner;
}

export function resolveArchitecture(project: ProjectState): ResolvedArchitecture {
  const vertices = architectureVertexMap(project.architecture);
  const graphWalls: ResolvedArchitecturalWall[] = project.architecture.walls.flatMap((wall) => {
    if (wall.reviewStatus !== "accepted") return [];
    const endpoints = wallEndpoints(wall, vertices);
    if (!endpoints) return [];
    return [{
      ...wall,
      ...endpoints,
      source: wall.provenance === "bundled" ? "base-plan" as const : "project-architecture" as const,
    }];
  });

  const projectWalls: ResolvedArchitecturalWall[] = project.objects
    .filter((object) => object.kind === "partition")
    .map((object) => {
      const boundary = boundaryFromPartitionObject(object);
      return {
        ...boundary,
        curve: { kind: "line" },
        thicknessM: object.depthM,
        heightM: object.heightM,
        baseElevationM: object.elevationM,
        heightSource: "user",
        thicknessSource: "user",
        provenance: "project-object",
        reviewStatus: "accepted",
        locked: object.locked,
      };
    });

  const graphWallMap = new Map(project.architecture.walls.map((wall) => [wall.id, wall]));
  const graphOpenings: ResolvedArchitecturalOpening[] = project.architecture.openings.flatMap((opening) => {
    if (opening.reviewStatus !== "accepted") return [];
    const wall = graphWallMap.get(opening.hostWallId);
    if (!wall) return [];
    const endpoints = openingEndpoints(opening, wall, vertices);
    if (!endpoints) return [];
    return [{
      ...opening,
      ...endpoints,
      source: opening.provenance === "bundled" ? "base-plan" as const : "project-architecture" as const,
    }];
  });
  const projectOpenings: ResolvedArchitecturalOpening[] = project.objects
    .filter((object) => object.kind === "door" || object.kind === "window")
    .map((object) => {
      const radians = object.rotationDeg * Math.PI / 180;
      const dx = Math.cos(radians) * object.widthM / 2;
      const dy = Math.sin(radians) * object.widthM / 2;
      return {
        id: `object-opening:${object.id}`,
        kind: object.kind as "door" | "window",
        start: { xM: object.xM - dx, yM: object.yM - dy },
        end: { xM: object.xM + dx, yM: object.yM + dy },
        hostWallId: null,
        sillHeightM: object.elevationM,
        openingHeightM: object.heightM,
        verticalSource: "user",
        source: "project-object",
        provenance: "project-object",
        reviewStatus: "accepted",
        locked: object.locked,
        sourceObjectId: object.id,
        swing: object.kind === "door" ? object.properties?.doorSwing ?? "right" : undefined,
        openingAngleDeg: object.kind === "door" ? object.properties?.openingAngleDeg ?? 90 : undefined,
      };
    });

  return {
    walls: [...graphWalls, ...projectWalls],
    openings: [...graphOpenings, ...projectOpenings],
    heightRegions: project.architecture.heightRegions,
  };
}
