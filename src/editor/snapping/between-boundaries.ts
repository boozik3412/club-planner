import { moveObjects } from "../geometry/geometry";
import type { PlanObject, PointM } from "../model/types";
import { getObjectSupportRadius } from "./snap-resolver";
import type { BetweenBoundariesMode, PlanBoundary } from "./types";

interface Axis {
  xM: number;
  yM: number;
}

export type BetweenBoundariesResult =
  | { ok: true; objects: PlanObject[]; availableM: number; gapM: number }
  | { ok: false; message: string };

function dot(point: PointM, axis: Axis): number {
  return point.xM * axis.xM + point.yM * axis.yM;
}

function tangentFor(boundary: PlanBoundary): Axis | null {
  const dx = boundary.end.xM - boundary.start.xM;
  const dy = boundary.end.yM - boundary.start.yM;
  const length = Math.hypot(dx, dy);
  return length > Number.EPSILON ? { xM: dx / length, yM: dy / length } : null;
}

function intervalOnAxis(boundary: PlanBoundary, axis: Axis): [number, number] {
  const first = dot(boundary.start, axis);
  const second = dot(boundary.end, axis);
  return [Math.min(first, second), Math.max(first, second)];
}

export function alignObjectsBetweenBoundaries(
  objects: readonly PlanObject[],
  firstBoundary: PlanBoundary,
  secondBoundary: PlanBoundary,
  mode: BetweenBoundariesMode,
  fillOffsetM = 0,
): BetweenBoundariesResult {
  if (objects.length === 0) return { ok: false, message: "Нет предметов для выравнивания" };
  const firstTangent = tangentFor(firstBoundary);
  const secondTangent = tangentFor(secondBoundary);
  if (!firstTangent || !secondTangent) return { ok: false, message: "Перегородка не имеет длины" };
  const parallel = Math.abs(dot(firstTangent, secondTangent));
  if (parallel < Math.cos(3 * Math.PI / 180)) {
    return { ok: false, message: "Перегородки должны быть параллельны" };
  }

  const firstInterval = intervalOnAxis(firstBoundary, firstTangent);
  const secondInterval = intervalOnAxis(secondBoundary, firstTangent);
  if (Math.min(firstInterval[1], secondInterval[1]) - Math.max(firstInterval[0], secondInterval[0]) <= 0.1) {
    return { ok: false, message: "Перегородки не перекрываются по длине" };
  }

  const normal = { xM: -firstTangent.yM, yM: firstTangent.xM };
  const firstCoordinate = dot(firstBoundary.start, normal);
  const secondCoordinate = dot(secondBoundary.start, normal);
  const lowerIsFirst = firstCoordinate <= secondCoordinate;
  const lowerBoundary = lowerIsFirst ? firstBoundary : secondBoundary;
  const upperBoundary = lowerIsFirst ? secondBoundary : firstBoundary;
  const lowerCoordinate = Math.min(firstCoordinate, secondCoordinate) + lowerBoundary.thicknessM / 2;
  const upperCoordinate = Math.max(firstCoordinate, secondCoordinate) - upperBoundary.thicknessM / 2;
  const availableM = upperCoordinate - lowerCoordinate;
  if (availableM <= 0) return { ok: false, message: "Между перегородками нет свободного места" };

  const ordered = [...objects].sort((left, right) => dot(left, normal) - dot(right, normal));
  const radii = ordered.map((object) => getObjectSupportRadius(object, normal));

  if (mode === "fill") {
    if (objects.length !== 1) {
      return { ok: false, message: "Заполнить проём можно только одним предметом" };
    }
    const object = objects[0];
    if (object.kind === "custom-circle" || object.kind === "custom-oval") {
      return { ok: false, message: "Заполнить проём можно только прямоугольным предметом" };
    }
    const offsetM = Math.max(0, fillOffsetM);
    const desiredProjectionM = availableM - offsetM * 2;
    if (desiredProjectionM < 0.1) {
      return { ok: false, message: "Отступы не оставляют места для предмета" };
    }
    const radians = object.rotationDeg * Math.PI / 180;
    const localX = { xM: Math.cos(radians), yM: Math.sin(radians) };
    const localY = { xM: -Math.sin(radians), yM: Math.cos(radians) };
    const xProjection = Math.abs(dot(localX, normal));
    const yProjection = Math.abs(dot(localY, normal));
    let widthM = object.widthM;
    let depthM = object.depthM;
    if (xProjection >= yProjection && xProjection > 1e-6) {
      widthM = (desiredProjectionM - depthM * yProjection) / xProjection;
    } else if (yProjection > 1e-6) {
      depthM = (desiredProjectionM - widthM * xProjection) / yProjection;
    } else {
      return { ok: false, message: "Не удалось определить размер поперёк проёма" };
    }
    if (!Number.isFinite(widthM) || !Number.isFinite(depthM) || widthM < 0.1 || depthM < 0.1) {
      return { ok: false, message: "Выбранный угол не позволяет заполнить проём" };
    }
    const centerCoordinate = (lowerCoordinate + upperCoordinate) / 2;
    const centerDelta = centerCoordinate - dot(object, normal);
    return {
      ok: true,
      objects: [{
        ...object,
        xM: object.xM + normal.xM * centerDelta,
        yM: object.yM + normal.yM * centerDelta,
        widthM,
        depthM,
      }],
      availableM,
      gapM: offsetM,
    };
  }

  if (mode === "center" || ordered.length === 1) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < ordered.length; index += 1) {
      const coordinate = dot(ordered[index], normal);
      min = Math.min(min, coordinate - radii[index]);
      max = Math.max(max, coordinate + radii[index]);
    }
    const selectionWidth = max - min;
    const gapM = (availableM - selectionWidth) / 2;
    if (gapM < 0) return { ok: false, message: "Выборка не помещается между перегородками" };
    const deltaM = (lowerCoordinate + upperCoordinate) / 2 - (min + max) / 2;
    return {
      ok: true,
      objects: moveObjects(objects, normal.xM * deltaM, normal.yM * deltaM),
      availableM,
      gapM,
    };
  }

  const occupiedM = radii.reduce((sum, radius) => sum + radius * 2, 0);
  const gapM = (availableM - occupiedM) / (ordered.length + 1);
  if (gapM < 0) return { ok: false, message: "Предметы не помещаются между перегородками" };
  let cursor = lowerCoordinate + gapM;
  const replacements: PlanObject[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const object = ordered[index];
    const radius = radii[index];
    const targetCoordinate = cursor + radius;
    const deltaM = targetCoordinate - dot(object, normal);
    replacements.push({
      ...object,
      xM: object.xM + normal.xM * deltaM,
      yM: object.yM + normal.yM * deltaM,
    });
    cursor = targetCoordinate + radius + gapM;
  }
  return { ok: true, objects: replacements, availableM, gapM };
}
