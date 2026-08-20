import { createStableId } from "../model/templates";
import type {
  ArchitectureVertex,
  ArchitecturalOpening,
  ArchitecturalWall,
  PointM,
  PlanSource,
  SourcePoint,
} from "../model/types";
import { arcFromBulge, architectureVertexMap, nearestPointOnWallCurve, wallLengthM } from "../architecture/geometry";
import type {
  DetectedArc,
  DetectedLine,
  RecognitionDraft,
  RecognitionIssue,
  RecognitionOptions,
  RecognizedTextHint,
} from "./types";

function distance(first: SourcePoint | PointM, second: SourcePoint | PointM): number {
  const firstX = "xM" in first ? first.xM : first.x;
  const firstY = "yM" in first ? first.yM : first.y;
  const secondX = "xM" in second ? second.xM : second.x;
  const secondY = "yM" in second ? second.yM : second.y;
  return Math.hypot(secondX - firstX, secondY - firstY);
}

export function bulgeFromThreePoints(start: PointM, through: PointM, end: PointM): number | null {
  const determinant = 2 * (
    start.xM * (through.yM - end.yM)
    + through.xM * (end.yM - start.yM)
    + end.xM * (start.yM - through.yM)
  );
  if (Math.abs(determinant) < 1e-9) return null;
  const squared = (point: PointM) => point.xM * point.xM + point.yM * point.yM;
  const center = {
    xM: (squared(start) * (through.yM - end.yM) + squared(through) * (end.yM - start.yM) + squared(end) * (start.yM - through.yM)) / determinant,
    yM: (squared(start) * (end.xM - through.xM) + squared(through) * (start.xM - end.xM) + squared(end) * (through.xM - start.xM)) / determinant,
  };
  const startAngle = Math.atan2(start.yM - center.yM, start.xM - center.xM);
  const throughAngle = Math.atan2(through.yM - center.yM, through.xM - center.xM);
  const endAngle = Math.atan2(end.yM - center.yM, end.xM - center.xM);
  const tau = Math.PI * 2;
  const positive = (angle: number) => ((angle % tau) + tau) % tau;
  const ccwSweep = positive(endAngle - startAngle);
  const throughSweep = positive(throughAngle - startAngle);
  const sweep = throughSweep <= ccwSweep ? ccwSweep : ccwSweep - tau;
  if (Math.abs(sweep) < 1e-5 || Math.abs(sweep) >= tau - 1e-5) return null;
  return Math.tan(sweep / 4);
}

export function mergeNearbyVertices(
  points: readonly PointM[],
  toleranceM: number,
  provenance: ArchitectureVertex["provenance"],
): { vertices: ArchitectureVertex[]; indices: number[] } {
  const vertices: ArchitectureVertex[] = [];
  const sums: Array<{ xM: number; yM: number; count: number }> = [];
  const indices = points.map((point) => {
    let index = vertices.findIndex((candidate) => distance(candidate, point) <= toleranceM);
    if (index < 0) {
      index = vertices.length;
      vertices.push({
        id: createStableId("vertex"),
        xM: point.xM,
        yM: point.yM,
        provenance,
        confidence: 1,
        reviewStatus: "candidate",
        locked: false,
      });
      sums.push({ xM: point.xM, yM: point.yM, count: 1 });
    } else {
      const sum = sums[index];
      sum.xM += point.xM;
      sum.yM += point.yM;
      sum.count += 1;
      vertices[index].xM = sum.xM / sum.count;
      vertices[index].yM = sum.yM / sum.count;
    }
    return index;
  });
  return { vertices, indices };
}

function normalizeLine(line: DetectedLine): DetectedLine {
  return line.start.x < line.end.x || (line.start.x === line.end.x && line.start.y <= line.end.y)
    ? line
    : { ...line, start: line.end, end: line.start };
}

function lineAngle(line: DetectedLine): number {
  return Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
}

export function mergeCollinearLines(lines: readonly DetectedLine[], gapPx = 12, offsetPx = 5): DetectedLine[] {
  const result: DetectedLine[] = [];
  const sorted = lines.map(normalizeLine).sort((first, second) => Math.hypot(second.end.x - second.start.x, second.end.y - second.start.y) - Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y));
  for (const line of sorted) {
    const angle = lineAngle(line);
    const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    const tx = Math.cos(angle);
    const ty = Math.sin(angle);
    const normalX = -ty;
    const normalY = tx;
    const match = result.findIndex((candidate) => {
      const angleDifference = Math.abs(Math.sin(lineAngle(candidate) - angle));
      const normalDistance = Math.abs((candidate.start.x - line.start.x) * normalX + (candidate.start.y - line.start.y) * normalY);
      const projections = [candidate.start, candidate.end, line.start, line.end].map((point) => point.x * tx + point.y * ty);
      const firstStart = Math.min(projections[0], projections[1]);
      const firstEnd = Math.max(projections[0], projections[1]);
      const secondStart = Math.min(projections[2], projections[3]);
      const secondEnd = Math.max(projections[2], projections[3]);
      return angleDifference < 0.035 && normalDistance <= offsetPx && secondStart <= firstEnd + gapPx && firstStart <= secondEnd + gapPx;
    });
    if (match < 0) {
      if (length > 0) result.push(line);
      continue;
    }
    const candidate = result[match];
    const points = [candidate.start, candidate.end, line.start, line.end];
    const projections = points.map((point) => point.x * tx + point.y * ty);
    const minIndex = projections.indexOf(Math.min(...projections));
    const maxIndex = projections.indexOf(Math.max(...projections));
    result[match] = {
      start: points[minIndex],
      end: points[maxIndex],
      confidence: Math.min(1, Math.max(candidate.confidence, line.confidence) + 0.05),
      thicknessPx: Math.max(candidate.thicknessPx ?? 0, line.thicknessPx ?? 0) || undefined,
    };
  }
  return result;
}

export function buildRecognitionGraph(input: {
  source: PlanSource;
  lines: readonly DetectedLine[];
  arcs?: readonly DetectedArc[];
  textHints?: readonly RecognizedTextHint[];
  options: RecognitionOptions;
  engineVersion?: string;
}): RecognitionDraft {
  const scale = input.source.metersPerSourceUnit;
  if (!scale || !Number.isFinite(scale) || scale <= 0) throw new Error("Перед распознаванием необходимо подтвердить масштаб");
  const toMeters = (point: SourcePoint): PointM => ({ xM: point.x * scale, yM: point.y * scale });
  const mergedLines = mergeCollinearLines(input.lines).filter((line) => distance(line.start, line.end) * scale >= input.options.minimumWallLengthM);
  const allPoints: PointM[] = mergedLines.flatMap((line) => [toMeters(line.start), toMeters(line.end)]);
  const acceptedArcs = (input.arcs ?? []).flatMap((arc) => {
    const start = toMeters(arc.start);
    const through = toMeters(arc.through);
    const end = toMeters(arc.end);
    const bulge = bulgeFromThreePoints(start, through, end);
    const geometry = bulge ? arcFromBulge(start, end, bulge) : null;
    const minimumArcConfidence = input.source.kind === "pdf" ? 0.45 : 0.62;
    return bulge && geometry && arc.confidence >= minimumArcConfidence
      && geometry.radiusM >= Math.max(0.4, input.options.minimumWallLengthM / 2)
      && distance(start, end) >= Math.min(0.15, input.options.minimumWallLengthM)
      ? [{ arc, start, through, end, bulge, geometry }]
      : [];
  });
  const doorArcs = input.options.detectOpenings
    ? acceptedArcs.filter((item) => item.arc.confidence >= (input.source.kind === "pdf" ? 0.55 : 0.72)
      && item.geometry.radiusM >= 0.45 && item.geometry.radiusM <= 1.8
      && Math.abs(item.geometry.sweepRad) >= Math.PI / 5 && Math.abs(item.geometry.sweepRad) <= Math.PI * 0.85)
    : [];
  const wallArcs = acceptedArcs.filter((item) => !doorArcs.includes(item));
  wallArcs.forEach((item) => allPoints.push(item.start, item.end));
  const merged = mergeNearbyVertices(allPoints, input.options.joinToleranceM, input.source.kind === "pdf" ? "vector-pdf" : "raster");
  const provenance = input.source.kind === "pdf" ? "vector-pdf" as const : "raster" as const;
  const makeWall = (startIndex: number, endIndex: number, confidence: number, curve: ArchitecturalWall["curve"]): ArchitecturalWall => ({
    id: createStableId("wall"),
    kind: "wall",
    startVertexId: merged.vertices[merged.indices[startIndex]].id,
    endVertexId: merged.vertices[merged.indices[endIndex]].id,
    curve,
    thicknessM: input.options.defaultWallThicknessM,
    heightM: input.options.defaultWallHeightM,
    baseElevationM: 0,
    heightSource: "default",
    thicknessSource: "default",
    provenance,
    confidence: Math.min(1, Math.max(0, confidence)),
    reviewStatus: "candidate",
    locked: false,
  });
  const walls = mergedLines.map((line, index) => makeWall(index * 2, index * 2 + 1, line.confidence, { kind: "line" }));
  const arcOffset = mergedLines.length * 2;
  wallArcs.forEach((item, index) => walls.push(makeWall(arcOffset + index * 2, arcOffset + index * 2 + 1, item.arc.confidence, { kind: "arc", bulge: item.bulge })));
  const usedVertexIds = new Set(walls.flatMap((wall) => [wall.startVertexId, wall.endVertexId]));
  const vertices = merged.vertices.filter((vertex) => usedVertexIds.has(vertex.id));
  if (vertices.length > 0) {
    const minX = Math.min(...vertices.map((vertex) => vertex.xM));
    const maxX = Math.max(...vertices.map((vertex) => vertex.xM));
    const minY = Math.min(...vertices.map((vertex) => vertex.yM));
    const maxY = Math.max(...vertices.map((vertex) => vertex.yM));
    const boundaryToleranceM = Math.max(input.options.joinToleranceM, 0.12);
    walls.forEach((wall) => {
      const start = vertices.find((vertex) => vertex.id === wall.startVertexId);
      const end = vertices.find((vertex) => vertex.id === wall.endVertexId);
      if (!start || !end) return;
      const onOuterBoundary = [
        [start.xM, end.xM, minX], [start.xM, end.xM, maxX],
        [start.yM, end.yM, minY], [start.yM, end.yM, maxY],
      ].some(([first, second, boundary]) => Math.abs(first - boundary) <= boundaryToleranceM && Math.abs(second - boundary) <= boundaryToleranceM);
      if (!onOuterBoundary) wall.kind = "partition";
    });
  }
  const issues: RecognitionIssue[] = [];
  const vertexMap = architectureVertexMap({
    defaultWallHeightM: input.options.defaultWallHeightM,
    defaultWallThicknessM: input.options.defaultWallThicknessM,
    vertices,
    walls,
    openings: [],
    heightRegions: [],
  });
  const openings: ArchitecturalOpening[] = doorArcs.flatMap((item): ArchitecturalOpening[] => {
    let best: { wall: ArchitecturalWall; alongM: number; distanceM: number; pivot: PointM; other: PointM; tangent: PointM } | null = null;
    for (const pivot of [item.start, item.end]) {
      const other = pivot === item.start ? item.end : item.start;
      for (const wall of walls.filter((candidate) => candidate.curve.kind === "line")) {
        const start = vertexMap.get(wall.startVertexId);
        const end = vertexMap.get(wall.endVertexId);
        if (!start || !end) continue;
        const nearest = nearestPointOnWallCurve(start, end, wall.curve, pivot);
        if (!nearest || nearest.distanceM > Math.max(0.25, wall.thicknessM * 2)) continue;
        if (!best || nearest.distanceM < best.distanceM) best = { wall, alongM: nearest.alongM, distanceM: nearest.distanceM, pivot, other, tangent: nearest.tangent };
      }
    }
    if (!best) return [];
    const hostLengthM = wallLengthM(best.wall, vertexMap);
    const widthM = Math.min(item.geometry.radiusM, hostLengthM);
    const direction = (best.other.xM - best.pivot.xM) * best.tangent.xM + (best.other.yM - best.pivot.yM) * best.tangent.yM;
    const offsetM = Math.max(0, Math.min(hostLengthM - widthM, direction >= 0 ? best.alongM : best.alongM - widthM));
    return [{
      id: createStableId("opening"),
      kind: "door" as const,
      hostWallId: best.wall.id,
      offsetM,
      widthM,
      sillHeightM: 0,
      openingHeightM: Math.min(2.1, best.wall.heightM),
      verticalSource: "default" as const,
      swing: item.geometry.sweepRad > 0 ? "right" as const : "left" as const,
      openingAngleDeg: Math.min(180, Math.abs(item.geometry.sweepRad) * 180 / Math.PI),
      provenance,
      confidence: Math.min(0.95, item.arc.confidence * 0.9),
      reviewStatus: "candidate" as const,
      locked: false,
    }];
  });
  if (input.options.detectOpenings) {
    for (const hint of input.textHints ?? []) {
      const normalized = hint.text.toLocaleLowerCase("ru-RU");
      const kind = /(?:^|[\s:;,.])(окно|window|win)(?:$|[\s:;,.])/iu.test(normalized)
        ? "window" as const
        : /(?:^|[\s:;,.])(дверь|door)(?:$|[\s:;,.])/iu.test(normalized) ? "door" as const : null;
      if (!kind) continue;
      const center = toMeters({
        x: hint.bounds.x + hint.bounds.width / 2,
        y: hint.bounds.y + hint.bounds.height / 2,
      });
      let nearest: { wall: ArchitecturalWall; alongM: number; distanceM: number } | null = null;
      for (const wall of walls) {
        const start = vertexMap.get(wall.startVertexId);
        const end = vertexMap.get(wall.endVertexId);
        if (!start || !end) continue;
        const candidate = nearestPointOnWallCurve(start, end, wall.curve, center);
        if (!candidate || candidate.distanceM > 0.6) continue;
        if (!nearest || candidate.distanceM < nearest.distanceM) nearest = { wall, alongM: candidate.alongM, distanceM: candidate.distanceM };
      }
      if (!nearest) continue;
      const hostLengthM = wallLengthM(nearest.wall, vertexMap);
      const widthM = Math.min(kind === "door" ? 0.9 : 1.2, Math.max(0.2, hostLengthM - 0.02));
      if (!(hostLengthM > widthM)) continue;
      const offsetM = Math.min(Math.max(0, nearest.alongM - widthM / 2), hostLengthM - widthM);
      if (openings.some((opening) => opening.hostWallId === nearest!.wall.id
        && Math.abs(opening.offsetM - offsetM) < Math.max(opening.widthM, widthM) * 0.5)) continue;
      openings.push({
        id: createStableId("opening"), kind, hostWallId: nearest.wall.id, offsetM, widthM,
        sillHeightM: kind === "door" ? 0 : 0.9,
        openingHeightM: Math.min(kind === "door" ? 2.1 : 1.2, nearest.wall.heightM - (kind === "door" ? 0 : 0.9)),
        verticalSource: "default", swing: kind === "door" ? "right" : undefined,
        openingAngleDeg: kind === "door" ? 90 : undefined,
        provenance, confidence: Math.min(0.82, hint.confidence * 0.85),
        reviewStatus: "candidate", locked: false,
      });
    }
  }
  const degree = new Map<string, number>();
  walls.forEach((wall) => {
    degree.set(wall.startVertexId, (degree.get(wall.startVertexId) ?? 0) + 1);
    degree.set(wall.endVertexId, (degree.get(wall.endVertexId) ?? 0) + 1);
    if (wall.curve.kind === "arc") {
      const start = vertices.find((vertex) => vertex.id === wall.startVertexId);
      const end = vertices.find((vertex) => vertex.id === wall.endVertexId);
      if (!start || !end || !arcFromBulge(start, end, wall.curve.bulge)) {
        issues.push({ id: `arc:${wall.id}`, severity: "error", wallId: wall.id, message: "Некорректная геометрия дуговой стены" });
      }
    }
  });
  degree.forEach((count, vertexId) => {
    if (count !== 1) return;
    const vertex = vertices.find((candidate) => candidate.id === vertexId);
    issues.push({
      id: `endpoint:${vertexId}`,
      severity: "warning",
      message: "Свободный конец стены: возможно, помещение не замкнуто",
      point: vertex ? { x: vertex.xM, y: vertex.yM } : undefined,
    });
  });
  if (walls.length === 0) issues.push({ id: "no-walls", severity: "error", message: "Стены не найдены. Добавьте их вручную или измените параметры анализа." });
  const deduplicatedOpenings = openings
    .sort((first, second) => (second.confidence ?? 0) - (first.confidence ?? 0))
    .filter((opening, index, candidates) => !candidates.slice(0, index).some((accepted) => {
      if (accepted.hostWallId !== opening.hostWallId || accepted.kind !== opening.kind) return false;
      const overlapM = Math.min(accepted.offsetM + accepted.widthM, opening.offsetM + opening.widthM)
        - Math.max(accepted.offsetM, opening.offsetM);
      return overlapM > Math.min(accepted.widthM, opening.widthM) * 0.35;
    }));
  return {
    engineVersion: input.engineVersion ?? "local-hybrid-1",
    source: input.source,
    vertices,
    walls,
    openings: deduplicatedOpenings,
    textHints: [...(input.textHints ?? [])],
    issues,
  };
}
