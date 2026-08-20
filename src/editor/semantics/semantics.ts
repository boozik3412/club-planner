import type { BasePlanRef, PlanObject, ProjectState } from "../model/types";
import { createBundledArchitecture } from "../architecture/base-architecture";
import { architectureVertexMap, openingEndpoints } from "../architecture/geometry";
import type { DoorSwingGeometry, SemanticOpening } from "./types";

export function getBasePlanOpenings(basePlan: BasePlanRef): SemanticOpening[] {
  const architecture = createBundledArchitecture(basePlan);
  const vertices = architectureVertexMap(architecture);
  const walls = new Map(architecture.walls.map((wall) => [wall.id, wall]));
  return architecture.openings.flatMap((opening) => {
    const wall = walls.get(opening.hostWallId);
    const endpoints = wall ? openingEndpoints(opening, wall, vertices) : null;
    return endpoints ? [{
      id: opening.id,
      kind: opening.kind,
      ...endpoints,
      source: "base-plan" as const,
      swing: opening.swing,
      openingAngleDeg: opening.openingAngleDeg,
    }] : [];
  });
}

export function openingFromProjectObject(object: PlanObject): SemanticOpening | null {
  if (object.kind !== "door" && object.kind !== "window") return null;
  const radians = object.rotationDeg * Math.PI / 180;
  const halfLength = object.widthM / 2;
  const localXDirection = object.flipX ? -1 : 1;
  const dx = Math.cos(radians) * halfLength * localXDirection;
  const dy = Math.sin(radians) * halfLength * localXDirection;
  const storedSwing = object.properties?.doorSwing ?? "right";
  const reflectedHandedness = Boolean(object.flipX) !== Boolean(object.flipY);
  const effectiveSwing = reflectedHandedness
    ? storedSwing === "left" ? "right" : "left"
    : storedSwing;
  return {
    id: `object-opening:${object.id}`,
    kind: object.kind,
    start: { xM: object.xM - dx, yM: object.yM - dy },
    end: { xM: object.xM + dx, yM: object.yM + dy },
    source: "project-object",
    sourceObjectId: object.id,
    swing: object.kind === "door" ? effectiveSwing : undefined,
    openingAngleDeg: object.kind === "door" ? object.properties?.openingAngleDeg ?? 90 : undefined,
  };
}

export function getPlanOpenings(project: ProjectState): SemanticOpening[] {
  const vertices = architectureVertexMap(project.architecture);
  const walls = new Map(project.architecture.walls.map((wall) => [wall.id, wall]));
  const architectureOpenings = project.architecture.openings.flatMap((opening) => {
    if (opening.reviewStatus !== "accepted") return [];
    const wall = walls.get(opening.hostWallId);
    const endpoints = wall ? openingEndpoints(opening, wall, vertices) : null;
    return endpoints ? [{
      id: opening.id,
      kind: opening.kind,
      ...endpoints,
      source: opening.provenance === "bundled" ? "base-plan" as const : "project-architecture" as const,
      swing: opening.swing,
      openingAngleDeg: opening.openingAngleDeg,
    }] : [];
  });
  return [
    ...architectureOpenings,
    ...project.objects.flatMap((object) => {
      const opening = openingFromProjectObject(object);
      return opening ? [opening] : [];
    }),
  ];
}

export function getDoorSwingGeometry(opening: SemanticOpening): DoorSwingGeometry | null {
  if (opening.kind !== "door") return null;
  const dx = opening.end.xM - opening.start.xM;
  const dy = opening.end.yM - opening.start.yM;
  const radiusM = Math.hypot(dx, dy);
  if (radiusM <= Number.EPSILON) return null;
  const angle = (opening.openingAngleDeg ?? 90) * Math.PI / 180;
  const direction = opening.swing === "left" ? -1 : 1;
  const cosine = Math.cos(angle * direction);
  const sine = Math.sin(angle * direction);
  return {
    pivot: opening.start,
    closedEnd: opening.end,
    openEnd: {
      xM: opening.start.xM + dx * cosine - dy * sine,
      yM: opening.start.yM + dx * sine + dy * cosine,
    },
    radiusM,
    clockwise: direction > 0,
  };
}
