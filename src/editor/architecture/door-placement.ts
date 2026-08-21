import { arcFromBulge, nearestPointOnWallCurve } from "./geometry";
import type { PointM, ProjectState } from "../model/types";
import { getPlanBoundaries } from "../snapping/boundaries";
import type { BoundarySource, PlanBoundary } from "../snapping/types";

export interface DoorPlacement {
  boundaryId: string;
  source: BoundarySource;
  sourceObjectId?: string;
  point: PointM;
  tangent: PointM;
  alongM: number;
  distanceM: number;
}

function boundaryLengthM(boundary: PlanBoundary): number {
  if (boundary.curve?.kind === "arc") {
    const arc = arcFromBulge(boundary.start, boundary.end, boundary.curve.bulge);
    if (arc) return Math.abs(arc.sweepRad) * arc.radiusM;
  }
  return Math.hypot(boundary.end.xM - boundary.start.xM, boundary.end.yM - boundary.start.yM);
}

function boundaryEditable(project: ProjectState, boundary: PlanBoundary): boolean {
  if (boundary.source === "project-object") {
    const object = project.objects.find((candidate) => candidate.id === boundary.sourceObjectId);
    const group = project.groups.find((candidate) => candidate.objectIds.includes(boundary.sourceObjectId ?? ""));
    return Boolean(object && !object.locked && !group?.locked);
  }
  return Boolean(project.architecture.walls.find((wall) => wall.id === boundary.id && !wall.locked));
}

export function resolveDoorPlacement(
  project: ProjectState,
  target: PointM,
  maximumDistanceM: number,
  doorWidthM = 0.9,
): DoorPlacement | null {
  let winner: DoorPlacement | null = null;
  for (const boundary of getPlanBoundaries(project)) {
    if (!boundaryEditable(project, boundary) || boundaryLengthM(boundary) < doorWidthM + 0.2) continue;
    const nearest = nearestPointOnWallCurve(
      boundary.start,
      boundary.end,
      boundary.curve ?? { kind: "line" },
      target,
    );
    if (!nearest || nearest.distanceM > maximumDistanceM || (winner && winner.distanceM <= nearest.distanceM)) continue;
    winner = {
      boundaryId: boundary.id,
      source: boundary.source,
      sourceObjectId: boundary.sourceObjectId,
      point: nearest.point,
      tangent: nearest.tangent,
      alongM: nearest.alongM,
      distanceM: nearest.distanceM,
    };
  }
  return winner;
}
