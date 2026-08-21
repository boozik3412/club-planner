import { wallPolyline } from "../architecture/geometry";
import type { ArchitecturalWall, ArchitectureVertex, SourcePoint } from "../model/types";

export interface SourceRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function sourceRect(first: SourcePoint, second: SourcePoint): SourceRect {
  return {
    minX: Math.min(first.x, second.x),
    minY: Math.min(first.y, second.y),
    maxX: Math.max(first.x, second.x),
    maxY: Math.max(first.y, second.y),
  };
}

function pointInside(point: SourcePoint, rect: SourceRect): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

function segmentIntersectsRect(start: SourcePoint, end: SourcePoint, rect: SourceRect): boolean {
  if (pointInside(start, rect) || pointInside(end, rect)) return true;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  const clips: Array<[number, number]> = [
    [-dx, start.x - rect.minX],
    [dx, rect.maxX - start.x],
    [-dy, start.y - rect.minY],
    [dy, rect.maxY - start.y],
  ];
  for (const [p, q] of clips) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) minimum = Math.max(minimum, ratio);
    else maximum = Math.min(maximum, ratio);
    if (minimum > maximum) return false;
  }
  return true;
}

export function reviewWallsIntersectingRect(
  walls: readonly ArchitecturalWall[],
  vertices: ReadonlyMap<string, ArchitectureVertex>,
  metersPerSourceUnit: number,
  rect: SourceRect,
): string[] {
  if (!(metersPerSourceUnit > 0)) return [];
  const toSource = (point: { xM: number; yM: number }): SourcePoint => ({
    x: point.xM / metersPerSourceUnit,
    y: point.yM / metersPerSourceUnit,
  });
  return walls.flatMap((wall) => {
    if (wall.reviewStatus === "rejected") return [];
    const points = wallPolyline(wall, vertices).map(toSource);
    for (let index = 1; index < points.length; index += 1) {
      if (segmentIntersectsRect(points[index - 1], points[index], rect)) return [wall.id];
    }
    return points.some((point) => pointInside(point, rect)) ? [wall.id] : [];
  });
}
