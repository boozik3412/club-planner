import type { BoundsM, PlanObject, PointM } from "../model/types";
import { normalizeAngle } from "../model/project";

export function rotatePoint(
  point: PointM,
  center: PointM,
  angleDeg: number,
): PointM {
  const radians = (angleDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.xM - center.xM;
  const dy = point.yM - center.yM;
  return {
    xM: center.xM + dx * cosine - dy * sine,
    yM: center.yM + dx * sine + dy * cosine,
  };
}

export function getObjectCorners(object: PlanObject): PointM[] {
  const halfWidth = object.widthM / 2;
  const halfDepth = object.depthM / 2;
  const center = { xM: object.xM, yM: object.yM };
  return [
    { xM: object.xM - halfWidth, yM: object.yM - halfDepth },
    { xM: object.xM + halfWidth, yM: object.yM - halfDepth },
    { xM: object.xM + halfWidth, yM: object.yM + halfDepth },
    { xM: object.xM - halfWidth, yM: object.yM + halfDepth },
  ].map((point) => rotatePoint(point, center, object.rotationDeg));
}

export function getObjectsBounds(objects: readonly PlanObject[]): BoundsM | null {
  if (objects.length === 0) return null;

  let minXM = Number.POSITIVE_INFINITY;
  let minYM = Number.POSITIVE_INFINITY;
  let maxXM = Number.NEGATIVE_INFINITY;
  let maxYM = Number.NEGATIVE_INFINITY;

  for (const object of objects) {
    for (const point of getObjectCorners(object)) {
      minXM = Math.min(minXM, point.xM);
      minYM = Math.min(minYM, point.yM);
      maxXM = Math.max(maxXM, point.xM);
      maxYM = Math.max(maxYM, point.yM);
    }
  }

  return {
    minXM,
    minYM,
    maxXM,
    maxYM,
    widthM: maxXM - minXM,
    heightM: maxYM - minYM,
    centerXM: (minXM + maxXM) / 2,
    centerYM: (minYM + maxYM) / 2,
  };
}

export function moveObjects(
  objects: readonly PlanObject[],
  deltaXM: number,
  deltaYM: number,
): PlanObject[] {
  return objects.map((object) => ({
    ...object,
    xM: object.xM + deltaXM,
    yM: object.yM + deltaYM,
  }));
}

export function rotateObjectsAroundCenter(
  objects: readonly PlanObject[],
  deltaDeg: number,
): PlanObject[] {
  const bounds = getObjectsBounds(objects);
  if (!bounds) return [];
  const center = { xM: bounds.centerXM, yM: bounds.centerYM };
  return objects.map((object) => {
    const nextCenter = rotatePoint({ xM: object.xM, yM: object.yM }, center, deltaDeg);
    return {
      ...object,
      xM: nextCenter.xM,
      yM: nextCenter.yM,
      rotationDeg: normalizeAngle(object.rotationDeg + deltaDeg),
    };
  });
}

export function isObjectInsideBounds(object: PlanObject, bounds: BoundsM): boolean {
  return getObjectCorners(object).every(
    (point) =>
      point.xM >= bounds.minXM &&
      point.xM <= bounds.maxXM &&
      point.yM >= bounds.minYM &&
      point.yM <= bounds.maxYM,
  );
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function resizeObjectFromHandle(
  object: PlanObject,
  handle: ResizeHandle,
  deltaXM: number,
  deltaYM: number,
  keepRatio: boolean,
  snap: (value: number) => number,
): PlanObject {
  const radians = (-object.rotationDeg * Math.PI) / 180;
  const localX = deltaXM * Math.cos(radians) - deltaYM * Math.sin(radians);
  const localY = deltaXM * Math.sin(radians) + deltaYM * Math.cos(radians);
  const originalWidth = object.widthM;
  const originalDepth = object.depthM;
  let widthM = originalWidth;
  let depthM = originalDepth;

  if (handle.includes("e")) widthM = Math.max(0.1, originalWidth + localX);
  if (handle.includes("w")) widthM = Math.max(0.1, originalWidth - localX);
  if (handle.includes("s")) depthM = Math.max(0.1, originalDepth + localY);
  if (handle.includes("n")) depthM = Math.max(0.1, originalDepth - localY);

  if (keepRatio && handle.length === 2) {
    const ratio = originalWidth / originalDepth;
    if (widthM / depthM > ratio) depthM = widthM / ratio;
    else widthM = depthM * ratio;
  }

  widthM = Math.max(0.1, snap(widthM));
  depthM = Math.max(0.1, snap(depthM));

  let localShiftX = 0;
  let localShiftY = 0;
  if (handle.includes("e")) localShiftX = (widthM - originalWidth) / 2;
  if (handle.includes("w")) localShiftX = -(widthM - originalWidth) / 2;
  if (handle.includes("s")) localShiftY = (depthM - originalDepth) / 2;
  if (handle.includes("n")) localShiftY = -(depthM - originalDepth) / 2;

  const worldRadians = (object.rotationDeg * Math.PI) / 180;
  const worldShiftX = localShiftX * Math.cos(worldRadians) - localShiftY * Math.sin(worldRadians);
  const worldShiftY = localShiftX * Math.sin(worldRadians) + localShiftY * Math.cos(worldRadians);

  return {
    ...object,
    widthM,
    depthM,
    xM: object.xM + worldShiftX,
    yM: object.yM + worldShiftY,
  };
}
