import type {
  DetectedArc,
  DetectedLine,
  RecognitionArcGuide,
  RecognitionGuideSet,
  RecognitionLineGuide,
  RecognitionPointGuide,
} from "./types";
import type { SourcePoint } from "../model/types";

function length(line: Pick<DetectedLine, "start" | "end">): number {
  return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
}

function normalizedLine(line: Pick<DetectedLine, "start" | "end">): { start: SourcePoint; end: SourcePoint } {
  const reverse = line.start.x > line.end.x || (line.start.x === line.end.x && line.start.y > line.end.y);
  return reverse ? { start: line.end, end: line.start } : { start: line.start, end: line.end };
}

function near(first: SourcePoint, second: SourcePoint, tolerance: number): boolean {
  return Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
}

function duplicateLine(first: RecognitionLineGuide, second: RecognitionLineGuide): boolean {
  const firstNormalized = normalizedLine(first);
  const secondNormalized = normalizedLine(second);
  const tolerance = Math.max(3, Math.min(length(first), length(second)) * 0.025);
  return near(firstNormalized.start, secondNormalized.start, tolerance)
    && near(firstNormalized.end, secondNormalized.end, tolerance);
}

function segmentIntersection(first: RecognitionLineGuide, second: RecognitionLineGuide): SourcePoint | null {
  const ax = first.end.x - first.start.x;
  const ay = first.end.y - first.start.y;
  const bx = second.end.x - second.start.x;
  const by = second.end.y - second.start.y;
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) < 1e-6) return null;
  const dx = second.start.x - first.start.x;
  const dy = second.start.y - first.start.y;
  const firstT = (dx * by - dy * bx) / denominator;
  const secondT = (dx * ay - dy * ax) / denominator;
  const extension = 0.025;
  if (firstT < -extension || firstT > 1 + extension || secondT < -extension || secondT > 1 + extension) return null;
  return { x: first.start.x + ax * firstT, y: first.start.y + ay * firstT };
}

function deduplicateLines(lines: RecognitionLineGuide[], maximum = 360): RecognitionLineGuide[] {
  const accepted: RecognitionLineGuide[] = [];
  for (const line of lines.sort((first, second) => second.confidence * length(second) - first.confidence * length(first))) {
    if (!accepted.some((candidate) => duplicateLine(candidate, line))) accepted.push(line);
    if (accepted.length >= maximum) break;
  }
  return accepted;
}

function guideLines(
  axes: readonly DetectedLine[],
  rawLines: readonly DetectedLine[],
  vector: boolean,
  minimumLengthPx: number,
): RecognitionLineGuide[] {
  const strong = axes
    .filter((line) => length(line) >= minimumLengthPx)
    .map((line, index): RecognitionLineGuide => ({
      id: `guide-axis-${index}`,
      kind: "line",
      start: line.start,
      end: line.end,
      confidence: Math.max(0.72, line.confidence),
      source: vector ? "vector-line" : "wall-axis",
      pairedFaces: line.evidence?.pairedFaces,
    }));
  const raw = rawLines
    .filter((line) => length(line) >= minimumLengthPx)
    .map((line, index): RecognitionLineGuide => ({
      id: `guide-raw-${index}`,
      kind: "line",
      start: line.start,
      end: line.end,
      confidence: Math.min(0.69, line.confidence),
      source: vector ? "vector-line" : "raw-line",
      pairedFaces: line.evidence?.pairedFaces,
    }));
  return deduplicateLines([...strong, ...raw]);
}

function guideArcs(arcs: readonly DetectedArc[], vector: boolean): RecognitionArcGuide[] {
  return arcs
    .map((arc, index): RecognitionArcGuide => ({
      id: `guide-arc-${index}`,
      kind: "arc",
      start: arc.start,
      through: arc.through,
      end: arc.end,
      confidence: arc.confidence,
      source: vector ? "vector-arc" : arc.evidence?.contourSupport ? "contour" : "hough",
      fitResidualPx: arc.evidence?.fitResidualPx,
    }))
    .sort((first, second) => second.confidence - first.confidence)
    .slice(0, 72);
}

function guideIntersections(lines: readonly RecognitionLineGuide[]): RecognitionPointGuide[] {
  const strongest = [...lines]
    .sort((first, second) => second.confidence * length(second) - first.confidence * length(first))
    .slice(0, 140);
  const result: RecognitionPointGuide[] = [];
  for (let firstIndex = 0; firstIndex < strongest.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < strongest.length; secondIndex += 1) {
      const point = segmentIntersection(strongest[firstIndex], strongest[secondIndex]);
      if (!point || result.some((candidate) => near(candidate.point, point, 4))) continue;
      result.push({
        id: `guide-intersection-${result.length}`,
        kind: "intersection",
        point,
        confidence: Math.min(strongest[firstIndex].confidence, strongest[secondIndex].confidence),
      });
      if (result.length >= 320) return result;
    }
  }
  return result;
}

export function buildRecognitionGuideSet(input: {
  axes: readonly DetectedLine[];
  rawLines?: readonly DetectedLine[];
  arcs?: readonly DetectedArc[];
  vector?: boolean;
  minimumLengthPx?: number;
}): RecognitionGuideSet {
  const lines = guideLines(
    input.axes,
    input.rawLines ?? [],
    Boolean(input.vector),
    Math.max(10, input.minimumLengthPx ?? 18),
  );
  return {
    lines,
    arcs: guideArcs(input.arcs ?? [], Boolean(input.vector)),
    points: guideIntersections(lines),
  };
}
