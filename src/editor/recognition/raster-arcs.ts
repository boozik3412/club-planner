import type { DetectedArc } from "./types";

interface Circle {
  center: { x: number; y: number };
  radius: number;
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
