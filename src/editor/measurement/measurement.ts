import { getObjectCorners } from "../geometry/geometry";
import type { PlanObject, PointM, ProjectDimension } from "../model/types";
import type { SemanticOpening } from "../semantics/types";
import type { PlanBoundary } from "../snapping/types";

export type DimensionSnapKind = "vertex" | "wall" | "opening" | "object" | "grid";

export interface DimensionSnapGuide {
  point: PointM;
  kind: DimensionSnapKind;
  label: string;
}

export interface DimensionSnapResolution {
  point: PointM;
  guide: DimensionSnapGuide | null;
}

interface DimensionSnapOptions {
  enabled: boolean;
  disabled?: boolean;
  gridStepM: number;
  unitsPerMeter: number;
  zoom: number;
  boundaries: readonly PlanBoundary[];
  openings: readonly SemanticOpening[];
  objects: readonly PlanObject[];
}

interface SnapCandidate {
  point: PointM;
  kind: Exclude<DimensionSnapKind, "grid">;
  label: string;
  distanceM: number;
  priority: number;
}

export function distanceMeters(start: PointM, end: PointM): number {
  return Math.hypot(end.xM - start.xM, end.yM - start.yM);
}

export function dimensionMidpoint(dimension: Pick<ProjectDimension, "start" | "end">): PointM {
  return {
    xM: (dimension.start.xM + dimension.end.xM) / 2,
    yM: (dimension.start.yM + dimension.end.yM) / 2,
  };
}

export function formatMeters(value: number): string {
  return `${value.toFixed(2)} м`;
}

export function translateDimension(
  dimension: ProjectDimension,
  deltaXM: number,
  deltaYM: number,
): ProjectDimension {
  return {
    ...dimension,
    start: { xM: dimension.start.xM + deltaXM, yM: dimension.start.yM + deltaYM },
    end: { xM: dimension.end.xM + deltaXM, yM: dimension.end.yM + deltaYM },
  };
}

export function constrainDimensionPoint(point: PointM, anchor: PointM): PointM {
  const deltaX = point.xM - anchor.xM;
  const deltaY = point.yM - anchor.yM;
  return Math.abs(deltaX) >= Math.abs(deltaY)
    ? { xM: point.xM, yM: anchor.yM }
    : { xM: anchor.xM, yM: point.yM };
}

function distance(left: PointM, right: PointM): number {
  return Math.hypot(left.xM - right.xM, left.yM - right.yM);
}

function closestPointOnLine(point: PointM, start: PointM, end: PointM): PointM | null {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return null;
  const parameter = Math.max(0, Math.min(1, ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared));
  return { xM: start.xM + dx * parameter, yM: start.yM + dy * parameter };
}

function addPointCandidate(
  candidates: SnapCandidate[],
  raw: PointM,
  point: PointM,
  kind: SnapCandidate["kind"],
  label: string,
  priority: number,
) {
  candidates.push({ point, kind, label, priority, distanceM: distance(raw, point) });
}

export function resolveDimensionSnap(raw: PointM, options: DimensionSnapOptions): DimensionSnapResolution {
  if (!options.enabled || options.disabled) return { point: raw, guide: null };

  const pixelThresholdM = 10 / Math.max(1, options.unitsPerMeter * options.zoom);
  const thresholdM = Math.min(0.25, Math.max(0.01, pixelThresholdM));
  const candidates: SnapCandidate[] = [];

  for (const boundary of options.boundaries) {
    addPointCandidate(candidates, raw, boundary.start, "vertex", "Вершина стены", 0);
    addPointCandidate(candidates, raw, boundary.end, "vertex", "Вершина стены", 0);
    if (boundary.curve?.kind === "arc") continue;
    const projected = closestPointOnLine(raw, boundary.start, boundary.end);
    if (projected) addPointCandidate(candidates, raw, projected, "wall", "На стене", 1);
  }

  for (const opening of options.openings) {
    const center = {
      xM: (opening.start.xM + opening.end.xM) / 2,
      yM: (opening.start.yM + opening.end.yM) / 2,
    };
    addPointCandidate(candidates, raw, opening.start, "opening", "Край проёма", 0);
    addPointCandidate(candidates, raw, opening.end, "opening", "Край проёма", 0);
    addPointCandidate(candidates, raw, center, "opening", "Центр проёма", 1);
  }

  for (const object of options.objects) {
    addPointCandidate(candidates, raw, { xM: object.xM, yM: object.yM }, "object", "Центр предмета", 2);
    for (const corner of getObjectCorners(object)) {
      addPointCandidate(candidates, raw, corner, "object", "Угол предмета", 1);
    }
  }

  const entity = candidates
    .filter((candidate) => candidate.distanceM <= thresholdM)
    .sort((left, right) => {
      const priorityBias = Math.min(0.025, thresholdM * 0.25);
      return (left.distanceM + left.priority * priorityBias)
        - (right.distanceM + right.priority * priorityBias);
    })[0];
  if (entity) {
    return {
      point: entity.point,
      guide: { point: entity.point, kind: entity.kind, label: entity.label },
    };
  }

  const step = Math.max(0.001, options.gridStepM);
  const gridPoint = {
    xM: Math.round(raw.xM / step) * step,
    yM: Math.round(raw.yM / step) * step,
  };
  return {
    point: gridPoint,
    guide: { point: gridPoint, kind: "grid", label: "Сетка" },
  };
}
