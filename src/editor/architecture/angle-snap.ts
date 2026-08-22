import type { PointM } from "../model/types";

export function roundAngleDeg(angleDeg: number, stepDeg: number): number {
  if (!Number.isFinite(angleDeg) || !Number.isFinite(stepDeg) || stepDeg <= 0) return angleDeg;
  const rounded = Math.round(angleDeg / stepDeg) * stepDeg;
  return Math.abs(rounded) < 1e-10 ? 0 : rounded;
}

export function snapPointToAngleIncrement(
  anchor: PointM,
  point: PointM,
  stepDeg = 15,
  toleranceDeg = 4,
  force = false,
): PointM {
  const dx = point.xM - anchor.xM;
  const dy = point.yM - anchor.yM;
  const lengthM = Math.hypot(dx, dy);
  if (!(lengthM > 1e-9) || !Number.isFinite(stepDeg) || stepDeg <= 0) return point;
  const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  const snappedAngleDeg = roundAngleDeg(angleDeg, stepDeg);
  const differenceDeg = Math.abs(angleDeg - snappedAngleDeg);
  if (!force && differenceDeg > Math.max(0, toleranceDeg)) return point;
  const angleRad = snappedAngleDeg * Math.PI / 180;
  return {
    xM: anchor.xM + Math.cos(angleRad) * lengthM,
    yM: anchor.yM + Math.sin(angleRad) * lengthM,
  };
}
