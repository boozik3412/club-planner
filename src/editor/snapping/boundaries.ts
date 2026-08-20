import type { BasePlanRef, ObjectId, PlanObject, ProjectState } from "../model/types";
import { createBundledArchitecture } from "../architecture/base-architecture";
import { architectureVertexMap, wallEndpoints } from "../architecture/geometry";
import type { PlanBoundary } from "./types";

export function getBasePlanBoundaries(basePlan: BasePlanRef): PlanBoundary[] {
  const architecture = createBundledArchitecture(basePlan);
  const vertices = architectureVertexMap(architecture);
  return architecture.walls.flatMap((wall) => {
    const endpoints = wallEndpoints(wall, vertices);
    return endpoints ? [{
      id: wall.id,
      kind: wall.kind,
      ...endpoints,
      thicknessM: wall.thicknessM,
      curve: wall.curve,
      source: "base-plan" as const,
    }] : [];
  });
}

export function boundaryFromPartitionObject(object: PlanObject): PlanBoundary {
  const radians = object.rotationDeg * Math.PI / 180;
  const halfLength = object.widthM / 2;
  const dx = Math.cos(radians) * halfLength;
  const dy = Math.sin(radians) * halfLength;
  return {
    id: `object-boundary:${object.id}`,
    kind: "partition",
    start: { xM: object.xM - dx, yM: object.yM - dy },
    end: { xM: object.xM + dx, yM: object.yM + dy },
    thicknessM: object.depthM,
    curve: { kind: "line" },
    source: "project-object",
    sourceObjectId: object.id,
  };
}

export function getProjectPartitionBoundaries(
  objects: readonly PlanObject[],
  excludedObjectIds: ReadonlySet<ObjectId> = new Set(),
): PlanBoundary[] {
  return objects.flatMap((object) =>
    object.kind === "partition" && !excludedObjectIds.has(object.id)
      ? [boundaryFromPartitionObject(object)]
      : [],
  );
}

export function getPlanBoundaries(
  project: ProjectState,
  excludedObjectIds: ReadonlySet<ObjectId> = new Set(),
): PlanBoundary[] {
  const vertices = architectureVertexMap(project.architecture);
  const architectureBoundaries = project.architecture.walls.flatMap((wall) => {
    if (wall.reviewStatus !== "accepted") return [];
    const endpoints = wallEndpoints(wall, vertices);
    return endpoints ? [{
      id: wall.id,
      kind: wall.kind,
      ...endpoints,
      thicknessM: wall.thicknessM,
      curve: wall.curve,
      source: wall.provenance === "bundled" ? "base-plan" as const : "project-architecture" as const,
    }] : [];
  });
  return [
    ...architectureBoundaries,
    ...getProjectPartitionBoundaries(project.objects, excludedObjectIds),
  ];
}
