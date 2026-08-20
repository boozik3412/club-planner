import type { DetectedArc, DetectedLine } from "./types";

export interface PdfVectorGeometry {
  lines: DetectedLine[];
  arcs: DetectedArc[];
}

interface Point {
  x: number;
  y: number;
}

const DRAW_OP = {
  moveTo: 0,
  lineTo: 1,
  curveTo: 2,
  quadraticCurveTo: 3,
  closePath: 4,
} as const;

function cubicPoint(start: Point, first: Point, second: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * first.x + 3 * inverse * t ** 2 * second.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * first.y + 3 * inverse * t ** 2 * second.y + t ** 3 * end.y,
  };
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 2 * start.x + 2 * inverse * t * control.x + t ** 2 * end.x,
    y: inverse ** 2 * start.y + 2 * inverse * t * control.y + t ** 2 * end.y,
  };
}

function circleFromThreePoints(start: Point, through: Point, end: Point): { center: Point; radius: number } | null {
  const determinant = 2 * (
    start.x * (through.y - end.y)
    + through.x * (end.y - start.y)
    + end.x * (start.y - through.y)
  );
  if (Math.abs(determinant) < 1e-6) return null;
  const squared = (point: Point) => point.x ** 2 + point.y ** 2;
  const center = {
    x: (squared(start) * (through.y - end.y) + squared(through) * (end.y - start.y) + squared(end) * (start.y - through.y)) / determinant,
    y: (squared(start) * (end.x - through.x) + squared(through) * (start.x - end.x) + squared(end) * (through.x - start.x)) / determinant,
  };
  return { center, radius: Math.hypot(start.x - center.x, start.y - center.y) };
}

function circularArc(points: readonly Point[], confidence: number): DetectedArc | null {
  if (points.length < 5) return null;
  const start = points[0];
  const through = points[Math.floor(points.length / 2)];
  const end = points[points.length - 1];
  const circle = circleFromThreePoints(start, through, end);
  if (!circle || circle.radius < 2) return null;
  const maximumError = Math.max(0.75, circle.radius * 0.02);
  const fitsCircle = points.every((point) => Math.abs(Math.hypot(point.x - circle.center.x, point.y - circle.center.y) - circle.radius) <= maximumError);
  return fitsCircle ? { start, through, end, confidence } : null;
}

function appendCurve(
  geometry: PdfVectorGeometry,
  samples: Point[],
  confidence: number,
): void {
  const arc = circularArc(samples, confidence);
  if (arc) {
    geometry.arcs.push(arc);
    return;
  }
  for (let index = 1; index < samples.length; index += 1) {
    geometry.lines.push({ start: samples[index - 1], end: samples[index], confidence: confidence - 0.06 });
  }
}

/** Decode the compact DrawOPS stream used by PDF.js 6 constructPath. */
export function decodePdfDrawPath(data: ArrayLike<number>, confidence = 0.98): PdfVectorGeometry {
  const geometry: PdfVectorGeometry = { lines: [], arcs: [] };
  let index = 0;
  let current: Point | null = null;
  let subpathStart: Point | null = null;
  while (index < data.length) {
    const operation = data[index++];
    if (operation === DRAW_OP.moveTo) {
      current = { x: Number(data[index++]), y: Number(data[index++]) };
      subpathStart = current;
    } else if (operation === DRAW_OP.lineTo) {
      const next = { x: Number(data[index++]), y: Number(data[index++]) };
      if (current) geometry.lines.push({ start: current, end: next, confidence });
      current = next;
    } else if (operation === DRAW_OP.curveTo) {
      const first = { x: Number(data[index++]), y: Number(data[index++]) };
      const second = { x: Number(data[index++]), y: Number(data[index++]) };
      const end = { x: Number(data[index++]), y: Number(data[index++]) };
      if (current) appendCurve(geometry, Array.from({ length: 9 }, (_, sample) => cubicPoint(current!, first, second, end, sample / 8)), confidence);
      current = end;
    } else if (operation === DRAW_OP.quadraticCurveTo) {
      const control = { x: Number(data[index++]), y: Number(data[index++]) };
      const end = { x: Number(data[index++]), y: Number(data[index++]) };
      if (current) appendCurve(geometry, Array.from({ length: 9 }, (_, sample) => quadraticPoint(current!, control, end, sample / 8)), confidence);
      current = end;
    } else if (operation === DRAW_OP.closePath) {
      if (current && subpathStart && (current.x !== subpathStart.x || current.y !== subpathStart.y)) {
        geometry.lines.push({ start: current, end: subpathStart, confidence });
      }
      current = subpathStart;
    } else {
      break;
    }
  }
  return geometry;
}
