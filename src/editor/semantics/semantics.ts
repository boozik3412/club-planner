import semanticData from "../../../assets/base_plan_boundaries.json";
import type { BasePlanRef, PlanObject, ProjectState } from "../model/types";
import type { DoorSwingGeometry, SemanticOpening } from "./types";

interface OpeningFileEntry {
  id: string;
  kind: "door" | "window";
  start: { xM: number; yM: number };
  end: { xM: number; yM: number };
  swing?: "left" | "right";
  openingAngleDeg?: number;
}

interface SemanticFile {
  basePlanId: string;
  basePlanSha256: string;
  openings: OpeningFileEntry[];
}

const file = semanticData as SemanticFile;

function validateOpening(opening: OpeningFileEntry): void {
  const values = [opening.start.xM, opening.start.yM, opening.end.xM, opening.end.yM];
  if (!opening.id || !values.every(Number.isFinite)) {
    throw new Error("Некорректный семантический проём базового плана");
  }
  if (opening.start.xM === opening.end.xM && opening.start.yM === opening.end.yM) {
    throw new Error(`Семантический проём ${opening.id} не имеет длины`);
  }
}

file.openings.forEach(validateOpening);

export function getBasePlanOpenings(basePlan: BasePlanRef): SemanticOpening[] {
  if (file.basePlanId !== basePlan.id || file.basePlanSha256 !== basePlan.sha256) {
    throw new Error("Семантические проёмы не соответствуют актуальному базовому плану");
  }
  return file.openings.map((opening) => ({
    ...structuredClone(opening),
    source: "base-plan",
  }));
}

export function openingFromProjectObject(object: PlanObject): SemanticOpening | null {
  if (object.kind !== "door" && object.kind !== "window") return null;
  const radians = object.rotationDeg * Math.PI / 180;
  const halfLength = object.widthM / 2;
  const dx = Math.cos(radians) * halfLength;
  const dy = Math.sin(radians) * halfLength;
  return {
    id: `object-opening:${object.id}`,
    kind: object.kind,
    start: { xM: object.xM - dx, yM: object.yM - dy },
    end: { xM: object.xM + dx, yM: object.yM + dy },
    source: "project-object",
    sourceObjectId: object.id,
    swing: object.kind === "door" ? object.properties?.doorSwing ?? "right" : undefined,
    openingAngleDeg: object.kind === "door" ? object.properties?.openingAngleDeg ?? 90 : undefined,
  };
}

export function getPlanOpenings(project: ProjectState): SemanticOpening[] {
  return [
    ...getBasePlanOpenings(project.basePlan),
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
