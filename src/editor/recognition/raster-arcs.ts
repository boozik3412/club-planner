import type { DetectedArc } from "./types";

interface Circle {
  center: { x: number; y: number };
  radius: number;
}

type PixelPoint = { x: number; y: number };

interface FittedCircle extends Circle {
  residualPx: number;
  support: number;
}

function solveThreeByThree(matrix: number[][], vector: number[]): number[] | null {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-8) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item < 4; item += 1) rows[column][item] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let item = column; item < 4; item += 1) rows[row][item] -= factor * rows[column][item];
    }
  }
  return rows.map((row) => row[3]);
}

function leastSquaresCircle(points: readonly PixelPoint[]): FittedCircle | null {
  if (points.length < 6) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sz = 0;
  let sxz = 0;
  let syz = 0;
  points.forEach((point) => {
    const z = -(point.x * point.x + point.y * point.y);
    sx += point.x;
    sy += point.y;
    sxx += point.x * point.x;
    syy += point.y * point.y;
    sxy += point.x * point.y;
    sz += z;
    sxz += point.x * z;
    syz += point.y * z;
  });
  const solved = solveThreeByThree(
    [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, points.length]],
    [sxz, syz, sz],
  );
  if (!solved) return null;
  const [a, b, c] = solved;
  const center = { x: -a / 2, y: -b / 2 };
  const squaredRadius = center.x * center.x + center.y * center.y - c;
  if (!(squaredRadius > 0)) return null;
  const radius = Math.sqrt(squaredRadius);
  const residuals = points.map((point) => Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius));
  const sorted = [...residuals].sort((first, second) => first - second);
  const trimCount = Math.max(1, Math.floor(sorted.length * 0.85));
  const residualPx = sorted.slice(0, trimCount).reduce((sum, value) => sum + value, 0) / trimCount;
  const tolerance = Math.max(1.6, Math.min(4, radius * 0.025));
  return {
    center,
    radius,
    residualPx,
    support: residuals.filter((value) => value <= tolerance).length / residuals.length,
  };
}

function unwrapSweep(points: readonly PixelPoint[], center: PixelPoint): number {
  if (points.length < 2) return 0;
  let previous = Math.atan2(points[0].y - center.y, points[0].x - center.x);
  let sweep = 0;
  for (let index = 1; index < points.length; index += 1) {
    const angle = Math.atan2(points[index].y - center.y, points[index].x - center.x);
    let delta = angle - previous;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    sweep += delta;
    previous = angle;
  }
  return sweep;
}

function contourWindows(points: readonly PixelPoint[]): PixelPoint[][] {
  const sampled = points.length <= 360
    ? [...points]
    : Array.from({ length: 360 }, (_, index) => points[Math.floor(index * points.length / 360)]);
  const result: PixelPoint[][] = [];
  const sizes = [1, 0.72, 0.5, 0.34]
    .map((ratio) => Math.floor(sampled.length * ratio))
    .filter((size, index, values) => size >= 18 && values.indexOf(size) === index);
  sizes.forEach((size) => {
    const step = Math.max(8, Math.floor(size * 0.45));
    for (let start = 0; start + size <= sampled.length; start += step) result.push(sampled.slice(start, start + size));
    if (size < sampled.length) result.push(sampled.slice(sampled.length - size));
  });
  return result;
}

/** Finds curved wall-face guides in ordered OpenCV contours. These remain
 * review guides unless graph construction finds a matching concentric face. */
export function detectContourArcCandidates(
  contours: readonly (readonly PixelPoint[])[],
  minimumDimension: number,
): DetectedArc[] {
  const candidates: DetectedArc[] = [];
  contours.forEach((contour) => {
    if (contour.length < 18) return;
    contourWindows(contour).forEach((window) => {
      const fit = leastSquaresCircle(window);
      if (!fit || fit.support < 0.72 || fit.residualPx > Math.max(2.8, fit.radius * 0.035)) return;
      const sweep = unwrapSweep(window, fit.center);
      const sweepSamples = Math.round(Math.abs(sweep) / (Math.PI * 2) * 180);
      if (!isMeaningfulRasterArc(fit.radius, sweepSamples, 180, minimumDimension)) return;
      const directionChanges = window.slice(1).reduce((changes, point, index) => {
        const previousAngle = Math.atan2(window[index].y - fit.center.y, window[index].x - fit.center.x);
        const angle = Math.atan2(point.y - fit.center.y, point.x - fit.center.x);
        let delta = angle - previousAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        return changes + (Math.sign(delta) !== 0 && Math.sign(delta) !== Math.sign(sweep) ? 1 : 0);
      }, 0);
      if (directionChanges / Math.max(1, window.length - 1) > 0.16) return;
      const start = window[0];
      const through = window[Math.floor(window.length / 2)];
      const end = window[window.length - 1];
      candidates.push({
        start,
        through,
        end,
        confidence: Math.min(0.92, 0.42 + fit.support * 0.35 + Math.min(0.15, Math.abs(sweep) / Math.PI * 0.1)),
        evidence: { contourSupport: fit.support, fitResidualPx: fit.residualPx },
      });
    });
  });
  return deduplicateDetectedArcs(candidates)
    .sort((first, second) => second.confidence - first.confidence)
    .slice(0, 72);
}

function circleFromArc(arc: DetectedArc): Circle | null {
  const { start, through, end } = arc;
  const determinant = 2 * (
    start.x * (through.y - end.y)
    + through.x * (end.y - start.y)
    + end.x * (start.y - through.y)
  );
  if (Math.abs(determinant) < 1e-5) return null;
  const squared = (point: { x: number; y: number }) => point.x ** 2 + point.y ** 2;
  const center = {
    x: (squared(start) * (through.y - end.y) + squared(through) * (end.y - start.y) + squared(end) * (start.y - through.y)) / determinant,
    y: (squared(start) * (end.x - through.x) + squared(through) * (start.x - end.x) + squared(end) * (through.x - start.x)) / determinant,
  };
  return { center, radius: Math.hypot(start.x - center.x, start.y - center.y) };
}

export function isMeaningfulRasterArc(radiusPx: number, runSamples: number, sampleCount: number, minimumDimension: number): boolean {
  if (!(radiusPx >= Math.max(12, minimumDimension * 0.018))) return false;
  const sweepRad = runSamples / sampleCount * Math.PI * 2;
  if (sweepRad < Math.PI / 3 || sweepRad > Math.PI * 1.82) return false;
  const sagittaPx = radiusPx * (1 - Math.cos(Math.min(Math.PI, sweepRad) / 2));
  const chordPx = 2 * radiusPx * Math.sin(Math.min(Math.PI, sweepRad) / 2);
  return sagittaPx >= Math.max(3.5, minimumDimension * 0.004) && sagittaPx / Math.max(chordPx, 1) >= 0.095;
}

export function deduplicateDetectedArcs(arcs: readonly DetectedArc[]): DetectedArc[] {
  const sorted = [...arcs].sort((first, second) => second.confidence - first.confidence);
  const accepted: Array<{ arc: DetectedArc; circle: Circle }> = [];
  for (const arc of sorted) {
    const circle = circleFromArc(arc);
    if (!circle) continue;
    const duplicate = accepted.some((item) => {
      const radius = Math.max(circle.radius, item.circle.radius);
      const centerDistance = Math.hypot(circle.center.x - item.circle.center.x, circle.center.y - item.circle.center.y);
      const radiusDifference = Math.abs(circle.radius - item.circle.radius);
      const throughDistance = Math.hypot(arc.through.x - item.arc.through.x, arc.through.y - item.arc.through.y);
      return centerDistance <= Math.max(5, radius * 0.1)
        && radiusDifference <= Math.max(4, radius * 0.1)
        && throughDistance <= Math.max(10, radius * 0.35);
    });
    if (!duplicate) accepted.push({ arc, circle });
  }
  return accepted.map((item) => item.arc);
}
