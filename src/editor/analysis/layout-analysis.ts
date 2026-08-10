import { getObjectsBounds } from "../geometry/geometry";
import type { BoundsM, PlanObject, PointM, ProjectState } from "../model/types";
import { getDoorSwingGeometry, getPlanOpenings } from "../semantics/semantics";
import { getPlanBoundaries } from "../snapping/boundaries";
import { getObjectSupportRadius } from "../snapping/snap-resolver";

export type LayoutWarningKind = "collision" | "wall" | "passage" | "door-swing";

export interface LayoutWarning {
  id: string;
  kind: LayoutWarningKind;
  objectIds: string[];
  message: string;
}

function overlaps(first: BoundsM, second: BoundsM): boolean {
  return first.minXM < second.maxXM
    && first.maxXM > second.minXM
    && first.minYM < second.maxYM
    && first.maxYM > second.minYM;
}

function isPhysicalObject(object: PlanObject): boolean {
  return object.kind !== "zone" && object.kind !== "window" && object.kind !== "door";
}

function distanceToSegment(point: PointM, start: PointM, end: PointM): number {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.xM - start.xM, point.yM - start.yM);
  const position = Math.max(0, Math.min(1,
    ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared));
  const closest = { xM: start.xM + dx * position, yM: start.yM + dy * position };
  return Math.hypot(point.xM - closest.xM, point.yM - closest.yM);
}

function passageGap(first: BoundsM, second: BoundsM): number | null {
  const overlapX = Math.min(first.maxXM, second.maxXM) - Math.max(first.minXM, second.minXM);
  const overlapY = Math.min(first.maxYM, second.maxYM) - Math.max(first.minYM, second.minYM);
  if (overlapY > 0) {
    if (first.maxXM <= second.minXM) return second.minXM - first.maxXM;
    if (second.maxXM <= first.minXM) return first.minXM - second.maxXM;
  }
  if (overlapX > 0) {
    if (first.maxYM <= second.minYM) return second.minYM - first.maxYM;
    if (second.maxYM <= first.minYM) return first.minYM - second.maxYM;
  }
  return null;
}

function normalizeRadians(value: number): number {
  const full = Math.PI * 2;
  return ((value % full) + full) % full;
}

function pointInsideDoorSweep(object: PlanObject, project: ProjectState): boolean {
  const center = { xM: object.xM, yM: object.yM };
  return getPlanOpenings(project).some((opening) => {
    const geometry = getDoorSwingGeometry(opening);
    if (!geometry || opening.sourceObjectId === object.id) return false;
    const bounds = getObjectsBounds([object]);
    const support = bounds ? Math.hypot(bounds.widthM, bounds.heightM) / 2 : 0;
    const dx = center.xM - geometry.pivot.xM;
    const dy = center.yM - geometry.pivot.yM;
    const distance = Math.hypot(dx, dy);
    if (distance > geometry.radiusM + support) return false;
    if (distance <= support) return true;
    const closedAngle = Math.atan2(
      geometry.closedEnd.yM - geometry.pivot.yM,
      geometry.closedEnd.xM - geometry.pivot.xM,
    );
    const pointAngle = Math.atan2(dy, dx);
    const sweep = (opening.openingAngleDeg ?? 90) * Math.PI / 180;
    const relative = geometry.clockwise
      ? normalizeRadians(pointAngle - closedAngle)
      : normalizeRadians(closedAngle - pointAngle);
    return relative <= sweep;
  });
}

export function getClearanceBounds(object: PlanObject, minimumPassageWidthM: number): BoundsM | null {
  const bounds = getObjectsBounds([object]);
  if (!bounds) return null;
  const padding = Math.max(0, minimumPassageWidthM) / 2;
  return {
    minXM: bounds.minXM - padding,
    minYM: bounds.minYM - padding,
    maxXM: bounds.maxXM + padding,
    maxYM: bounds.maxYM + padding,
    widthM: bounds.widthM + padding * 2,
    heightM: bounds.heightM + padding * 2,
    centerXM: bounds.centerXM,
    centerYM: bounds.centerYM,
  };
}

export function analyzeLayout(project: ProjectState): LayoutWarning[] {
  const physical = project.objects.filter(isPhysicalObject);
  const boundsById = new Map(physical.map((object) => [object.id, getObjectsBounds([object]) as BoundsM]));
  const warnings: LayoutWarning[] = [];

  for (let firstIndex = 0; firstIndex < physical.length; firstIndex += 1) {
    const first = physical[firstIndex];
    const firstBounds = boundsById.get(first.id) as BoundsM;
    for (let secondIndex = firstIndex + 1; secondIndex < physical.length; secondIndex += 1) {
      const second = physical[secondIndex];
      const secondBounds = boundsById.get(second.id) as BoundsM;
      if (overlaps(firstBounds, secondBounds)) {
        warnings.push({
          id: `collision:${first.id}:${second.id}`,
          kind: "collision",
          objectIds: [first.id, second.id],
          message: `${first.name} пересекается с «${second.name}»`,
        });
        continue;
      }
      const gapM = passageGap(firstBounds, secondBounds);
      if (gapM !== null && gapM < project.canvas.minimumPassageWidthM) {
        warnings.push({
          id: `passage:${first.id}:${second.id}`,
          kind: "passage",
          objectIds: [first.id, second.id],
          message: `Проход между «${first.name}» и «${second.name}»: ${gapM.toFixed(2)} м`,
        });
      }
    }
  }

  const boundaries = getPlanBoundaries(project);
  for (const object of physical.filter((candidate) => candidate.kind !== "partition")) {
    for (const boundary of boundaries) {
      if (boundary.sourceObjectId === object.id) continue;
      const dx = boundary.end.xM - boundary.start.xM;
      const dy = boundary.end.yM - boundary.start.yM;
      const length = Math.hypot(dx, dy);
      if (length <= Number.EPSILON) continue;
      const normal = { xM: -dy / length, yM: dx / length };
      const radius = getObjectSupportRadius(object, normal);
      if (distanceToSegment(object, boundary.start, boundary.end) < radius + boundary.thicknessM / 2 - 0.01) {
        warnings.push({
          id: `wall:${object.id}:${boundary.id}`,
          kind: "wall",
          objectIds: [object.id],
          message: `${object.name} пересекает стену или перегородку`,
        });
        break;
      }
    }
  }

  for (const object of physical) {
    if (pointInsideDoorSweep(object, project)) {
      warnings.push({
        id: `door-swing:${object.id}`,
        kind: "door-swing",
        objectIds: [object.id],
        message: `${object.name} попадает в зону открывания двери`,
      });
    }
  }
  return warnings;
}
