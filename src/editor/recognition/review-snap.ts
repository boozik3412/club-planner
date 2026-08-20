import { nearestPointOnWallCurve } from "../architecture/geometry";
import type { PointM, SourcePoint } from "../model/types";
import { bulgeFromThreePoints } from "./graph";
import type { RecognitionDraft, RecognitionGuideSet, RecognitionLineGuide } from "./types";

export type ReviewSnapKind = "free" | "vertex" | "wall" | "intersection" | "wall-axis" | "source-line" | "arc" | "angle";

export interface ReviewSnapResult {
  id: string;
  kind: ReviewSnapKind;
  label: string;
  point: SourcePoint;
  distancePx: number;
  priority: number;
  vertexId?: string;
  wallId?: string;
  alongM?: number;
  guideId?: string;
}

export interface ReviewSnapModifiers {
  disabled?: boolean;
  constrainAngle?: boolean;
  cycleIndex?: number;
}

export interface ReviewSnapContext {
  draft: Pick<RecognitionDraft, "vertices" | "walls">;
  guides?: RecognitionGuideSet;
  metersPerSourceUnit: number;
  screenPxPerSourceUnit: number;
  startPoint?: SourcePoint;
  activeCandidateId?: string | null;
  captureRadiusPx?: number;
  releaseRadiusPx?: number;
  maximumDistanceM?: number;
  modifiers?: ReviewSnapModifiers;
}

function sourceDistance(first: SourcePoint, second: SourcePoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function toMeters(point: SourcePoint, scale: number): PointM {
  return { xM: point.x * scale, yM: point.y * scale };
}

function toSource(point: PointM, scale: number): SourcePoint {
  return { x: point.xM / scale, y: point.yM / scale };
}

function lineProjection(line: RecognitionLineGuide, point: SourcePoint): SourcePoint {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= Number.EPSILON) return line.start;
  const ratio = Math.max(0, Math.min(1, ((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) / squaredLength));
  return { x: line.start.x + dx * ratio, y: line.start.y + dy * ratio };
}

function candidate(
  rawPoint: SourcePoint,
  point: SourcePoint,
  screenScale: number,
  data: Omit<ReviewSnapResult, "point" | "distancePx">,
): ReviewSnapResult {
  return { ...data, point, distancePx: sourceDistance(rawPoint, point) * screenScale };
}

function arcCandidate(
  rawPoint: SourcePoint,
  guide: NonNullable<RecognitionGuideSet["arcs"]>[number],
  screenScale: number,
): ReviewSnapResult | null {
  const start = { xM: guide.start.x, yM: guide.start.y };
  const through = { xM: guide.through.x, yM: guide.through.y };
  const end = { xM: guide.end.x, yM: guide.end.y };
  const bulge = bulgeFromThreePoints(start, through, end);
  if (!bulge) return null;
  const nearest = nearestPointOnWallCurve(start, end, { kind: "arc", bulge }, { xM: rawPoint.x, yM: rawPoint.y });
  if (!nearest) return null;
  return candidate(rawPoint, { x: nearest.point.xM, y: nearest.point.yM }, screenScale, {
    id: `arc:${guide.id}`,
    kind: "arc",
    label: "дуга подложки",
    priority: guide.source === "contour" ? 2.35 : 2.7,
    guideId: guide.id,
  });
}

function angleCandidate(rawPoint: SourcePoint, startPoint: SourcePoint, screenScale: number): ReviewSnapResult | null {
  const dx = rawPoint.x - startPoint.x;
  const dy = rawPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy);
  if (length <= Number.EPSILON) return null;
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const point = { x: startPoint.x + Math.cos(angle) * length, y: startPoint.y + Math.sin(angle) * length };
  return candidate(rawPoint, point, screenScale, {
    id: `angle:${Math.round(angle / step)}`,
    kind: "angle",
    label: `угол ${Math.round(angle * 180 / Math.PI)}°`,
    priority: 0.5,
  });
}

function sortCandidates(first: ReviewSnapResult, second: ReviewSnapResult): number {
  const firstScore = first.priority * 100 + first.distancePx;
  const secondScore = second.priority * 100 + second.distancePx;
  return firstScore - secondScore || first.id.localeCompare(second.id);
}

export function collectReviewSnapCandidates(rawPoint: SourcePoint, context: ReviewSnapContext): ReviewSnapResult[] {
  if (context.modifiers?.disabled || !(context.metersPerSourceUnit > 0) || !(context.screenPxPerSourceUnit > 0)) return [];
  const captureRadiusPx = context.captureRadiusPx ?? 10;
  const releaseRadiusPx = context.releaseRadiusPx ?? 16;
  const maximumDistanceM = context.maximumDistanceM ?? 0.25;
  const maximumDistancePx = maximumDistanceM / context.metersPerSourceUnit * context.screenPxPerSourceUnit;
  const threshold = Math.min(context.activeCandidateId ? Math.max(captureRadiusPx, releaseRadiusPx) : captureRadiusPx, maximumDistancePx);
  const candidates: ReviewSnapResult[] = [];

  context.draft.vertices.forEach((vertex) => {
    if (vertex.reviewStatus === "rejected") return;
    const item = candidate(rawPoint, toSource(vertex, context.metersPerSourceUnit), context.screenPxPerSourceUnit, {
      id: `vertex:${vertex.id}`,
      kind: "vertex",
      label: "узел",
      priority: 0,
      vertexId: vertex.id,
    });
    if (item.distancePx <= threshold) candidates.push(item);
  });

  const vertexMap = new Map(context.draft.vertices.map((vertex) => [vertex.id, vertex]));
  context.draft.walls.forEach((wall) => {
    if (wall.reviewStatus === "rejected") return;
    const start = vertexMap.get(wall.startVertexId);
    const end = vertexMap.get(wall.endVertexId);
    if (!start || !end) return;
    const nearest = nearestPointOnWallCurve(start, end, wall.curve, toMeters(rawPoint, context.metersPerSourceUnit));
    if (!nearest) return;
    const item = candidate(rawPoint, toSource(nearest.point, context.metersPerSourceUnit), context.screenPxPerSourceUnit, {
      id: `wall:${wall.id}:${Math.round(nearest.alongM * 1000)}`,
      kind: "wall",
      label: wall.curve.kind === "arc" ? "точка на дуге" : "точка на стене",
      priority: 1,
      wallId: wall.id,
      alongM: nearest.alongM,
    });
    if (item.distancePx <= threshold) candidates.push(item);
  });

  context.guides?.points.forEach((guide) => {
    const item = candidate(rawPoint, guide.point, context.screenPxPerSourceUnit, {
      id: `intersection:${guide.id}`,
      kind: "intersection",
      label: "пересечение",
      priority: 1.5,
      guideId: guide.id,
    });
    if (item.distancePx <= threshold) candidates.push(item);
  });

  context.guides?.lines.forEach((guide) => {
    const point = lineProjection(guide, rawPoint);
    const item = candidate(rawPoint, point, context.screenPxPerSourceUnit, {
      id: `line:${guide.id}`,
      kind: guide.source === "raw-line" ? "source-line" : "wall-axis",
      label: guide.source === "raw-line" ? "линия подложки" : "ось стены",
      priority: guide.source === "raw-line" ? 3 : 2,
      guideId: guide.id,
    });
    if (item.distancePx <= threshold) candidates.push(item);
  });

  context.guides?.arcs.forEach((guide) => {
    const item = arcCandidate(rawPoint, guide, context.screenPxPerSourceUnit);
    if (item && item.distancePx <= threshold) candidates.push(item);
  });

  if (context.modifiers?.constrainAngle && context.startPoint) {
    const item = angleCandidate(rawPoint, context.startPoint, context.screenPxPerSourceUnit);
    if (item) candidates.push(item);
  }
  return candidates.sort(sortCandidates);
}

export function resolveReviewSnap(rawPoint: SourcePoint, context: ReviewSnapContext): ReviewSnapResult {
  const candidates = collectReviewSnapCandidates(rawPoint, context);
  const captureRadiusPx = context.captureRadiusPx ?? 10;
  const releaseRadiusPx = context.releaseRadiusPx ?? 16;
  const active = context.activeCandidateId
    ? candidates.find((item) => item.id === context.activeCandidateId && item.distancePx <= releaseRadiusPx)
    : undefined;
  if (active && !context.modifiers?.cycleIndex) return active;
  const eligible = candidates.filter((item) => item.distancePx <= captureRadiusPx);
  if (eligible.length > 0) {
    const cycleIndex = Math.abs(context.modifiers?.cycleIndex ?? 0) % eligible.length;
    return eligible[cycleIndex];
  }
  return {
    id: "free",
    kind: "free",
    label: "свободная точка",
    point: rawPoint,
    distancePx: 0,
    priority: 99,
  };
}
