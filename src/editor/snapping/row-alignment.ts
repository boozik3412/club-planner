import type { PlanObject, PointM } from "../model/types";
import type { SnapGuide } from "./types";

const ROW_CROSS_TOLERANCE_M = 0.08;
const ROW_SPACING_TOLERANCE_M = 0.12;
const SIZE_RELATIVE_TOLERANCE = 0.05;
const ROTATION_TOLERANCE_DEG = 3;

interface Axis {
  xM: number;
  yM: number;
}

interface RowDescriptor {
  axis: Axis;
  normal: Axis;
  objects: PlanObject[];
  projections: number[];
  spacings: number[];
}

export interface RowAlignmentCandidate {
  deltaXM: number;
  deltaYM: number;
  guide: Omit<SnapGuide, "candidateIndex" | "candidateCount">;
}

function dot(point: PointM, axis: Axis): number {
  return point.xM * axis.xM + point.yM * axis.yM;
}

function normalizedRotationDifference(leftDeg: number, rightDeg: number): number {
  const difference = Math.abs(((leftDeg - rightDeg + 540) % 360) - 180);
  return Math.min(difference, Math.abs(180 - difference));
}

function closeSize(left: number, right: number): boolean {
  const scale = Math.max(0.1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) / scale <= SIZE_RELATIVE_TOLERANCE;
}

function similarObject(reference: PlanObject, candidate: PlanObject): boolean {
  return reference.type === candidate.type
    && closeSize(reference.widthM, candidate.widthM)
    && closeSize(reference.depthM, candidate.depthM)
    && normalizedRotationDifference(reference.rotationDeg, candidate.rotationDeg) <= ROTATION_TOLERANCE_DEG;
}

function farthestPairAxis(objects: readonly PlanObject[]): Axis | null {
  let bestDistance = 0;
  let axis: Axis | null = null;
  for (let first = 0; first < objects.length; first += 1) {
    for (let second = first + 1; second < objects.length; second += 1) {
      const dx = objects[second].xM - objects[first].xM;
      const dy = objects[second].yM - objects[first].yM;
      const distance = Math.hypot(dx, dy);
      if (distance <= bestDistance) continue;
      bestDistance = distance;
      axis = { xM: dx / distance, yM: dy / distance };
    }
  }
  if (!axis || bestDistance < 0.1) return null;
  if (axis.xM < -1e-9 || (Math.abs(axis.xM) <= 1e-9 && axis.yM < 0)) {
    axis = { xM: -axis.xM, yM: -axis.yM };
  }
  return axis;
}

function describeRow(objects: readonly PlanObject[]): RowDescriptor | null {
  if (objects.length < 2 || objects.some((object) => !similarObject(objects[0], object))) return null;
  const axis = farthestPairAxis(objects);
  if (!axis) return null;
  const normal = { xM: -axis.yM, yM: axis.xM };
  const crosses = objects.map((object) => dot({ xM: object.xM, yM: object.yM }, normal));
  if (Math.max(...crosses) - Math.min(...crosses) > ROW_CROSS_TOLERANCE_M) return null;
  const ordered = [...objects].sort((left, right) =>
    dot({ xM: left.xM, yM: left.yM }, axis) - dot({ xM: right.xM, yM: right.yM }, axis));
  const projections = ordered.map((object) => dot({ xM: object.xM, yM: object.yM }, axis));
  const spacings = projections.slice(1).map((value, index) => value - projections[index]);
  if (spacings.some((spacing) => spacing < 0.1)) return null;
  return { axis, normal, objects: ordered, projections, spacings };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function makePoint(axis: Axis, normal: Axis, alongM: number, crossM: number): PointM {
  return {
    xM: axis.xM * alongM + normal.xM * crossM,
    yM: axis.yM * alongM + normal.yM * crossM,
  };
}

function spacingPatternMatches(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((spacing, index) =>
    Math.abs(spacing - right[index]) <= Math.max(ROW_SPACING_TOLERANCE_M, spacing * 0.08));
}

export function findRowAlignmentCandidates(
  movingObjects: readonly PlanObject[],
  otherObjects: readonly PlanObject[],
  rawDeltaXM: number,
  rawDeltaYM: number,
  toleranceM: number,
): RowAlignmentCandidate[] {
  const moving = describeRow(movingObjects);
  if (!moving) return [];
  const eligible = otherObjects.filter((object) => similarObject(moving.objects[0], object));
  if (eligible.length < moving.objects.length) return [];

  const projected = eligible.map((object) => ({
    object,
    alongM: dot({ xM: object.xM, yM: object.yM }, moving.axis),
    crossM: dot({ xM: object.xM, yM: object.yM }, moving.normal),
  })).sort((left, right) => left.crossM - right.crossM || left.alongM - right.alongM);
  const clusters: typeof projected[] = [];
  for (const item of projected) {
    const cluster = clusters.find((candidate) => Math.abs(mean(candidate.map((entry) => entry.crossM)) - item.crossM) <= ROW_CROSS_TOLERANCE_M);
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }

  const movingCross = mean(moving.objects.map((object) =>
    dot({ xM: object.xM + rawDeltaXM, yM: object.yM + rawDeltaYM }, moving.normal)));
  const candidates: RowAlignmentCandidate[] = [];
  for (const cluster of clusters) {
    if (cluster.length !== moving.objects.length) continue;
    const ordered = [...cluster].sort((left, right) => left.alongM - right.alongM);
    const targetSpacings = ordered.slice(1).map((item, index) => item.alongM - ordered[index].alongM);
    if (!spacingPatternMatches(moving.spacings, targetSpacings)) continue;
    const targetCross = mean(ordered.map((item) => item.crossM));
    const crossAdjustment = targetCross - movingCross;
    if (Math.abs(crossAdjustment) > toleranceM) continue;
    const deltaXM = rawDeltaXM + moving.normal.xM * crossAdjustment;
    const deltaYM = rawDeltaYM + moving.normal.yM * crossAdjustment;
    const movingMarkers = moving.objects.map((object) => ({ xM: object.xM + deltaXM, yM: object.yM + deltaYM }));
    const targetMarkers = ordered.map((item) => ({ xM: item.object.xM, yM: item.object.yM }));
    const allAlong = [...movingMarkers, ...targetMarkers].map((point) => dot(point, moving.axis));
    const paddingM = Math.max(0.25, Math.min(moving.objects[0].widthM, moving.objects[0].depthM) / 2);
    candidates.push({
      deltaXM,
      deltaYM,
      guide: {
        snapType: "row-alignment",
        from: makePoint(moving.axis, moving.normal, Math.min(...allAlong) - paddingM, targetCross),
        to: makePoint(moving.axis, moving.normal, Math.max(...allAlong) + paddingM, targetCross),
        distanceM: 0,
        markers: [...movingMarkers, ...targetMarkers],
      },
    });
  }

  return candidates.sort((left, right) => {
    const leftAdjustment = Math.hypot(left.deltaXM - rawDeltaXM, left.deltaYM - rawDeltaYM);
    const rightAdjustment = Math.hypot(right.deltaXM - rawDeltaXM, right.deltaYM - rawDeltaYM);
    return leftAdjustment - rightAdjustment;
  });
}
