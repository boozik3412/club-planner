import architectureData from "../../../assets/base_plan_boundaries.json";
import type { BasePlanRef, PointM } from "../model/types";
import type { BoundaryKind } from "../snapping/types";
import type { HeightRegion } from "./types";

export interface BaseArchitectureBoundary {
  id: string;
  kind: BoundaryKind;
  start: PointM;
  end: PointM;
  thicknessM: number;
  heightM?: number;
}

export interface BaseArchitectureOpening {
  id: string;
  kind: "door" | "window";
  start: PointM;
  end: PointM;
  hostWallId: string;
  sillHeightM: number;
  openingHeightM: number;
  verticalSource: "measurement" | "default";
  swing?: "left" | "right";
  openingAngleDeg?: number;
}

interface BaseArchitectureFile {
  basePlanId: string;
  basePlanSha256: string;
  defaultWallHeightM: number;
  defaultWallThicknessM: number;
  heightRegions: HeightRegion[];
  boundaries: BaseArchitectureBoundary[];
  openings: BaseArchitectureOpening[];
}

const file = architectureData as BaseArchitectureFile;

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}: ожидалось положительное число`);
}

function validateFile(): void {
  assertPositive(file.defaultWallHeightM, "defaultWallHeightM");
  assertPositive(file.defaultWallThicknessM, "defaultWallThicknessM");
  const wallIds = new Set(file.boundaries.map((wall) => wall.id));
  for (const region of file.heightRegions) {
    assertPositive(region.ceilingHeightM, `${region.id}.ceilingHeightM`);
    if (region.polygon.length < 3) throw new Error(`Высотная зона ${region.id} не образует полигон`);
  }
  for (const opening of file.openings) {
    if (!wallIds.has(opening.hostWallId)) {
      throw new Error(`Проём ${opening.id} ссылается на неизвестную стену ${opening.hostWallId}`);
    }
    if (opening.sillHeightM < 0) throw new Error(`Проём ${opening.id}: отрицательная высота подоконника`);
    assertPositive(opening.openingHeightM, `${opening.id}.openingHeightM`);
  }
}

validateFile();

export function getBaseArchitecture(basePlan: BasePlanRef): BaseArchitectureFile {
  if (file.basePlanId !== basePlan.id || file.basePlanSha256 !== basePlan.sha256) {
    throw new Error("Архитектурные данные не соответствуют актуальному базовому плану");
  }
  return structuredClone(file);
}
