import boundaryData from "../../../assets/base_plan_boundaries.json";
import type { BasePlanRef, ObjectId, PlanObject, ProjectState } from "../model/types";
import type { BoundaryKind, PlanBoundary } from "./types";

interface BoundaryFileEntry {
  id: string;
  kind: BoundaryKind;
  start: { xM: number; yM: number };
  end: { xM: number; yM: number };
  thicknessM: number;
}

interface BoundaryFile {
  basePlanId: string;
  basePlanSha256: string;
  boundaries: BoundaryFileEntry[];
}

const file = boundaryData as BoundaryFile;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Некорректная координата границы: ${label}`);
}

function validateBoundary(entry: BoundaryFileEntry): void {
  if (!entry.id || (entry.kind !== "wall" && entry.kind !== "partition")) {
    throw new Error("Некорректная семантическая граница базового плана");
  }
  assertFinite(entry.start.xM, `${entry.id}.start.xM`);
  assertFinite(entry.start.yM, `${entry.id}.start.yM`);
  assertFinite(entry.end.xM, `${entry.id}.end.xM`);
  assertFinite(entry.end.yM, `${entry.id}.end.yM`);
  assertFinite(entry.thicknessM, `${entry.id}.thicknessM`);
  if (entry.thicknessM < 0 || (entry.start.xM === entry.end.xM && entry.start.yM === entry.end.yM)) {
    throw new Error(`Некорректная геометрия границы ${entry.id}`);
  }
}

file.boundaries.forEach(validateBoundary);

export function getBasePlanBoundaries(basePlan: BasePlanRef): PlanBoundary[] {
  if (file.basePlanId !== basePlan.id || file.basePlanSha256 !== basePlan.sha256) {
    throw new Error("Семантические стены не соответствуют актуальному базовому плану");
  }
  return file.boundaries.map((entry) => ({
    ...structuredClone(entry),
    source: "base-plan",
  }));
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
  return [
    ...getBasePlanBoundaries(project.basePlan),
    ...getProjectPartitionBoundaries(project.objects, excludedObjectIds),
  ];
}

