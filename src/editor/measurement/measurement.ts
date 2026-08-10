import type { PointM, ProjectDimension } from "../model/types";

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
