import architectureData from "../../../assets/base_plan_boundaries.json";
import type {
  ArchitectureHeightRegion,
  ArchitectureSettings,
  ArchitectureVertex,
  ArchitecturalOpening,
  ArchitecturalWall,
  BasePlanRef,
  PointM,
} from "../model/types";
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

function pointInPolygon(point: PointM, polygon: readonly PointM[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const prior = polygon[previous];
    const crosses = (current.yM > point.yM) !== (prior.yM > point.yM)
      && point.xM < (prior.xM - current.xM) * (point.yM - current.yM)
        / (prior.yM - current.yM) + current.xM;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonArea(points: readonly PointM[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.xM * next.yM - next.xM * current.yM;
  }
  return Math.abs(area / 2);
}

function containingRegion(point: PointM, regions: readonly ArchitectureHeightRegion[]) {
  return regions
    .filter((region) => pointInPolygon(point, region.polygon))
    .sort((left, right) => polygonArea(left.polygon) - polygonArea(right.polygon))[0];
}

/** Converts the checksum-bound legacy semantic asset into the editable v4 graph. */
export function createBundledArchitecture(basePlan: BasePlanRef): ArchitectureSettings {
  const base = getBaseArchitecture(basePlan);
  const vertices: ArchitectureVertex[] = [];
  const vertexIds = new Map<string, string>();
  const getVertexId = (point: PointM) => {
    const key = `${point.xM.toFixed(5)}:${point.yM.toFixed(5)}`;
    const existing = vertexIds.get(key);
    if (existing) return existing;
    const id = `base-vertex-${vertices.length + 1}`;
    vertexIds.set(key, id);
    vertices.push({
      id,
      xM: point.xM,
      yM: point.yM,
      provenance: "bundled",
      reviewStatus: "accepted",
      locked: true,
    });
    return id;
  };

  const heightRegions = structuredClone(base.heightRegions) as ArchitectureHeightRegion[];
  const walls: ArchitecturalWall[] = base.boundaries.map((boundary) => {
    const midpoint = {
      xM: (boundary.start.xM + boundary.end.xM) / 2,
      yM: (boundary.start.yM + boundary.end.yM) / 2,
    };
    const region = containingRegion(midpoint, heightRegions);
    const thicknessM = boundary.thicknessM > 0
      ? boundary.thicknessM
      : base.defaultWallThicknessM;
    const heightM = boundary.heightM ?? region?.ceilingHeightM ?? base.defaultWallHeightM;
    const baseElevationM = region?.floorElevationM ?? 0;
    const heightSource = boundary.heightM !== undefined
      ? "measurement" as const
      : region
        ? "region" as const
        : "default" as const;
    const thicknessSource = boundary.thicknessM > 0 ? "measurement" as const : "default" as const;
    return {
      id: boundary.id,
      kind: boundary.kind,
      startVertexId: getVertexId(boundary.start),
      endVertexId: getVertexId(boundary.end),
      curve: { kind: "line" },
      thicknessM,
      heightM,
      baseElevationM,
      heightSource,
      thicknessSource,
      provenance: "bundled",
      reviewStatus: "accepted",
      locked: true,
      reference: {
        thicknessM,
        heightM,
        baseElevationM,
        heightSource,
        thicknessSource,
      },
    };
  });

  const wallMap = new Map(walls.map((wall) => [wall.id, wall]));
  const vertexMap = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const openings: ArchitecturalOpening[] = base.openings.map((opening) => {
    const wall = wallMap.get(opening.hostWallId);
    if (!wall) throw new Error(`Проём ${opening.id} ссылается на неизвестную стену`);
    const start = vertexMap.get(wall.startVertexId);
    const end = vertexMap.get(wall.endVertexId);
    if (!start || !end) throw new Error(`Стена ${wall.id} ссылается на неизвестную вершину`);
    const dx = end.xM - start.xM;
    const dy = end.yM - start.yM;
    const lengthM = Math.hypot(dx, dy);
    const tx = dx / lengthM;
    const ty = dy / lengthM;
    const first = (opening.start.xM - start.xM) * tx + (opening.start.yM - start.yM) * ty;
    const second = (opening.end.xM - start.xM) * tx + (opening.end.yM - start.yM) * ty;
    return {
      id: opening.id,
      kind: opening.kind,
      hostWallId: opening.hostWallId,
      offsetM: Math.max(0, Math.min(first, second)),
      widthM: Math.abs(second - first),
      sillHeightM: opening.sillHeightM,
      openingHeightM: opening.openingHeightM,
      verticalSource: opening.verticalSource,
      swing: opening.swing,
      openingAngleDeg: opening.openingAngleDeg,
      provenance: "bundled",
      reviewStatus: "accepted",
      locked: true,
    };
  });

  return {
    defaultWallHeightM: base.defaultWallHeightM,
    defaultWallThicknessM: base.defaultWallThicknessM,
    vertices,
    walls,
    openings,
    heightRegions,
  };
}
