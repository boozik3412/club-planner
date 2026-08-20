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
import { assessRecognitionQuality } from "./quality";

type ArcGeometry = NonNullable<ReturnType<typeof arcFromBulge>>;

interface AcceptedArcCandidate {
  arc: DetectedArc;
  start: PointM;
  through: PointM;
  end: PointM;
  bulge: number;
  geometry: ArcGeometry;
}

interface DoorGapHint {
  start: SourcePoint;
  end: SourcePoint;
  confidence: number;
}

function normalizedAngleDifference(first: number, second: number): number {
  const tau = Math.PI * 2;
  const delta = ((first - second + Math.PI) % tau + tau) % tau - Math.PI;
  return Math.abs(delta);
}

function pairedRasterWallArcs(candidates: readonly AcceptedArcCandidate[]): AcceptedArcCandidate[] {
  const used = new Set<number>();
  const result: AcceptedArcCandidate[] = [];
  candidates.forEach((first, firstIndex) => {
    if (used.has(firstIndex)) return;
    const firstThroughAngle = Math.atan2(
      first.through.yM - first.geometry.center.yM,
      first.through.xM - first.geometry.center.xM,
    );
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    candidates.forEach((second, secondIndex) => {
      if (secondIndex <= firstIndex || used.has(secondIndex)) return;
      const centerDistance = distance(first.geometry.center, second.geometry.center);
      const radiusDifference = Math.abs(first.geometry.radiusM - second.geometry.radiusM);
      const secondThroughAngle = Math.atan2(
        second.through.yM - second.geometry.center.yM,
        second.through.xM - second.geometry.center.xM,
      );
      const strongGradientPair = (first.arc.evidence?.gradientSupport ?? 0) >= 0.9
        && (second.arc.evidence?.gradientSupport ?? 0) >= 0.9
        && Math.min(first.geometry.radiusM, second.geometry.radiusM) >= 1.2
        && Math.min(Math.abs(first.geometry.sweepRad), Math.abs(second.geometry.sweepRad)) >= Math.PI / 3;
      const centerToleranceM = strongGradientPair
        ? Math.max(1.15, Math.min(first.geometry.radiusM, second.geometry.radiusM) * 0.42)
        : Math.max(0.08, Math.min(first.geometry.radiusM, second.geometry.radiusM) * 0.05);
      if (centerDistance > centerToleranceM) return;
      if (radiusDifference < 0.04 || radiusDifference > (strongGradientPair ? 1.15 : 0.6)) return;
      if (normalizedAngleDifference(firstThroughAngle, secondThroughAngle) > (strongGradientPair ? Math.PI / 5.5 : Math.PI / 10)) return;
      if (Math.abs(Math.abs(first.geometry.sweepRad) - Math.abs(second.geometry.sweepRad)) > (strongGradientPair ? Math.PI / 4 : Math.PI / 6)) return;
      const score = centerDistance + radiusDifference * 0.05
        + normalizedAngleDifference(firstThroughAngle, secondThroughAngle);
      if (score < bestScore) {
        bestIndex = secondIndex;
        bestScore = score;
      }
    });
    if (bestIndex < 0) return;
    const second = candidates[bestIndex];
    used.add(firstIndex);
    used.add(bestIndex);
    const strongest = first.arc.confidence >= second.arc.confidence ? first : second;
    result.push({
      ...strongest,
      arc: {
        ...strongest.arc,
        confidence: Math.min(0.96, Math.max(first.arc.confidence, second.arc.confidence) + 0.06),
        evidence: { ...strongest.arc.evidence, concentricPair: true },
      },
    });
  });
  return result;
}

function pruneShortIsolatedRasterWalls(
  walls: readonly ArchitecturalWall[],
  vertices: readonly ArchitectureVertex[],
  connectionToleranceM: number,
): ArchitecturalWall[] {
  if (walls.length <= 2) return [...walls];
  const vertexMap = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const degree = new Map<string, number>();
  walls.forEach((wall) => {
    degree.set(wall.startVertexId, (degree.get(wall.startVertexId) ?? 0) + 1);
    degree.set(wall.endVertexId, (degree.get(wall.endVertexId) ?? 0) + 1);
  });
  const lengths = walls.map((wall) => wallLengthM(wall, vertexMap));
  const maximumLength = Math.max(...lengths, 0);
  const endpointSupported = (wallIndex: number, vertexId: string) => {
    if ((degree.get(vertexId) ?? 0) > 1) return true;
    const point = vertexMap.get(vertexId);
    if (!point) return false;
    return walls.some((other, otherIndex) => {
      if (otherIndex === wallIndex) return false;
      const start = vertexMap.get(other.startVertexId);
      const end = vertexMap.get(other.endVertexId);
      if (!start || !end) return false;
      const nearest = nearestPointOnWallCurve(start, end, other.curve, point);
      return Boolean(nearest && nearest.distanceM <= connectionToleranceM);
    });
  };
  return walls.filter((wall, index) => {
    if (wall.curve.kind !== "line") return true;
    const isolated = !endpointSupported(index, wall.startVertexId) && !endpointSupported(index, wall.endVertexId);
    return !(isolated && lengths[index] < maximumLength * 0.45);
  });
}

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

function cross(first: SourcePoint, second: SourcePoint): number {
  return first.x * second.y - first.y * second.x;
}

/**
 * Extends nearly touching wall axes and splits them at T/cross junctions. The
 * resulting fragments share exact endpoints, so rooms and 3D geometry use a
 * real topological graph instead of a collection of visually close strokes.
 */
export function splitLinesAtJunctions(
  lines: readonly DetectedLine[],
  connectionTolerancePx: number,
  minimumFragmentPx = 4,
): DetectedLine[] {
  if (lines.length < 2) return [...lines];
  const parameters = lines.map(() => [0, 1]);
  lines.forEach((first, firstIndex) => {
    const firstDelta = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
    const firstLength = Math.hypot(firstDelta.x, firstDelta.y);
    if (firstLength <= 1e-6) return;
    lines.slice(firstIndex + 1).forEach((second, offset) => {
      const secondIndex = firstIndex + offset + 1;
      const secondDelta = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
      const secondLength = Math.hypot(secondDelta.x, secondDelta.y);
      if (secondLength <= 1e-6) return;
      const denominator = cross(firstDelta, secondDelta);
      if (Math.abs(denominator) / (firstLength * secondLength) < Math.sin(Math.PI / 36)) return;
      const betweenStarts = { x: second.start.x - first.start.x, y: second.start.y - first.start.y };
      const firstParameter = cross(betweenStarts, secondDelta) / denominator;
      const secondParameter = cross(betweenStarts, firstDelta) / denominator;
      const firstTolerance = connectionTolerancePx / firstLength;
      const secondTolerance = connectionTolerancePx / secondLength;
      if (firstParameter < -firstTolerance || firstParameter > 1 + firstTolerance
        || secondParameter < -secondTolerance || secondParameter > 1 + secondTolerance) return;
      const firstInside = firstParameter >= 0 && firstParameter <= 1;
      const secondInside = secondParameter >= 0 && secondParameter <= 1;
      if (!firstInside && !secondInside) {
        const firstExtension = Math.min(Math.abs(firstParameter), Math.abs(firstParameter - 1)) * firstLength;
        const secondExtension = Math.min(Math.abs(secondParameter), Math.abs(secondParameter - 1)) * secondLength;
        if (Math.max(firstExtension, secondExtension) > connectionTolerancePx) return;
      }
      parameters[firstIndex].push(firstParameter);
      parameters[secondIndex].push(secondParameter);
    });
  });
  return lines.flatMap((line, index) => {
    const delta = { x: line.end.x - line.start.x, y: line.end.y - line.start.y };
    const sorted = [...parameters[index]]
      .sort((first, second) => first - second)
      .filter((value, valueIndex, values) => valueIndex === 0 || Math.abs(value - values[valueIndex - 1]) > 1e-5);
    return sorted.slice(1).flatMap((endParameter, fragmentIndex) => {
      const startParameter = sorted[fragmentIndex];
      const start = { x: line.start.x + delta.x * startParameter, y: line.start.y + delta.y * startParameter };
      const end = { x: line.start.x + delta.x * endParameter, y: line.start.y + delta.y * endParameter };
      if (distance(start, end) < minimumFragmentPx) return [];
      return [{ ...line, start, end }];
    });
  });
}

export function bridgeColoredDoorGaps(
  walls: readonly DetectedLine[],
  coloredLines: readonly DetectedLine[],
  scale: number,
): { lines: DetectedLine[]; doorGaps: DoorGapHint[] } {
  if (walls.length < 2 || coloredLines.length === 0) return { lines: [...walls], doorGaps: [] };
  const used = new Set<number>();
  const bridged: DetectedLine[] = [];
  const doorGaps: DoorGapHint[] = [];
  walls.forEach((first, firstIndex) => {
    if (used.has(firstIndex)) return;
    const firstDelta = { x: first.end.x - first.start.x, y: first.end.y - first.start.y };
    const firstLength = Math.hypot(firstDelta.x, firstDelta.y);
    if (!(firstLength > 0)) return;
    const tangent = { x: firstDelta.x / firstLength, y: firstDelta.y / firstLength };
    const normal = { x: -tangent.y, y: tangent.x };
    const firstValues = [first.start, first.end].map((point) => point.x * tangent.x + point.y * tangent.y);
    const firstInterval: [number, number] = [Math.min(...firstValues), Math.max(...firstValues)];
    let match: { index: number; startProjection: number; endProjection: number; rho: number; gapStart: number; gapEnd: number; confidence: number } | null = null;
    walls.slice(firstIndex + 1).forEach((second, offset) => {
      const secondIndex = firstIndex + offset + 1;
      if (used.has(secondIndex)) return;
      const secondDelta = { x: second.end.x - second.start.x, y: second.end.y - second.start.y };
      const secondLength = Math.hypot(secondDelta.x, secondDelta.y);
      if (!(secondLength > 0) || Math.abs(cross(firstDelta, secondDelta)) / (firstLength * secondLength) > 0.05) return;
      const normalDistance = Math.abs(second.start.x * normal.x + second.start.y * normal.y
        - (first.start.x * normal.x + first.start.y * normal.y));
      if (normalDistance > Math.max(6, (first.thicknessPx ?? 0) + (second.thicknessPx ?? 0))) return;
      const secondValues = [second.start, second.end].map((point) => point.x * tangent.x + point.y * tangent.y);
      const secondInterval: [number, number] = [Math.min(...secondValues), Math.max(...secondValues)];
      const gapStart = firstInterval[1] < secondInterval[0] ? firstInterval[1]
        : secondInterval[1] < firstInterval[0] ? secondInterval[1] : Number.NaN;
      const gapEnd = firstInterval[1] < secondInterval[0] ? secondInterval[0]
        : secondInterval[1] < firstInterval[0] ? firstInterval[0] : Number.NaN;
      const gapM = (gapEnd - gapStart) * scale;
      if (!Number.isFinite(gapM) || gapM < 0.42 || gapM > 1.8) return;
      const rho = ((first.start.x * normal.x + first.start.y * normal.y)
        + (second.start.x * normal.x + second.start.y * normal.y)) / 2;
      const gapStartPoint = { x: tangent.x * gapStart + normal.x * rho, y: tangent.y * gapStart + normal.y * rho };
      const gapEndPoint = { x: tangent.x * gapEnd + normal.x * rho, y: tangent.y * gapEnd + normal.y * rho };
      const leaf = coloredLines.find((candidate) => {
        const leafLength = distance(candidate.start, candidate.end);
        if (leafLength * scale < 0.4 || leafLength * scale > 1.9) return false;
        const lengthRatio = leafLength * scale / gapM;
        if (lengthRatio < 0.55 || lengthRatio > 1.35 || (candidate.evidence?.coloredOpeningSupport ?? 0) < 0.65) return false;
        const leafDelta = { x: candidate.end.x - candidate.start.x, y: candidate.end.y - candidate.start.y };
        const angleSin = Math.abs(cross(firstDelta, leafDelta)) / (firstLength * leafLength);
        if (angleSin < Math.sin(Math.PI / 9)) return false;
        return Math.min(
          distance(candidate.start, gapStartPoint), distance(candidate.start, gapEndPoint),
          distance(candidate.end, gapStartPoint), distance(candidate.end, gapEndPoint),
        ) * scale <= 0.3;
      });
      if (!leaf) return;
      match = {
        index: secondIndex,
        startProjection: Math.min(firstInterval[0], secondInterval[0]),
        endProjection: Math.max(firstInterval[1], secondInterval[1]),
        rho,
        gapStart,
        gapEnd,
        confidence: Math.min(0.95, Math.max(first.confidence, second.confidence, leaf.confidence)),
      };
    });
    const selected = match as { index: number; startProjection: number; endProjection: number; rho: number; gapStart: number; gapEnd: number; confidence: number } | null;
    if (!selected) return;
    used.add(firstIndex);
    used.add(selected.index);
    const pointAt = (projection: number) => ({ x: tangent.x * projection + normal.x * selected.rho, y: tangent.y * projection + normal.y * selected.rho });
    bridged.push({
      start: pointAt(selected.startProjection), end: pointAt(selected.endProjection),
      confidence: selected.confidence,
      thicknessPx: Math.max(first.thicknessPx ?? 0, walls[selected.index].thicknessPx ?? 0) || undefined,
      evidence: { pairedFaces: true },
    });
    doorGaps.push({ start: pointAt(selected.gapStart), end: pointAt(selected.gapEnd), confidence: selected.confidence });
  });
  walls.forEach((line, index) => {
    if (!used.has(index)) bridged.push(line);
  });
  return { lines: bridged, doorGaps };
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
      evidence: {
        pairedFaces: candidate.evidence?.pairedFaces || line.evidence?.pairedFaces || undefined,
        overlapRatio: Math.max(candidate.evidence?.overlapRatio ?? 0, line.evidence?.overlapRatio ?? 0) || undefined,
        thicknessConsistency: Math.max(candidate.evidence?.thicknessConsistency ?? 0, line.evidence?.thicknessConsistency ?? 0) || undefined,
        pixelSupport: Math.max(candidate.evidence?.pixelSupport ?? 0, line.evidence?.pixelSupport ?? 0) || undefined,
        coloredOpeningSupport: Math.max(candidate.evidence?.coloredOpeningSupport ?? 0, line.evidence?.coloredOpeningSupport ?? 0) || undefined,
      },
    };
  }
  return result;
}

export function buildRecognitionGraph(input: {
  source: PlanSource;
  lines: readonly DetectedLine[];
  openingLines?: readonly DetectedLine[];
  arcs?: readonly DetectedArc[];
  textHints?: readonly RecognizedTextHint[];
  options: RecognitionOptions;
  engineVersion?: string;
  geometrySource?: "vector" | "raster";
}): RecognitionDraft {
  const scale = input.source.metersPerSourceUnit;
  if (!scale || !Number.isFinite(scale) || scale <= 0) throw new Error("Перед распознаванием необходимо подтвердить масштаб");
  const geometrySource = input.geometrySource ?? (input.source.kind === "pdf" ? "vector" : "raster");
  const toMeters = (point: SourcePoint): PointM => ({ xM: point.x * scale, yM: point.y * scale });
  const filteredLines = mergeCollinearLines(input.lines)
    .filter((line) => distance(line.start, line.end) * scale >= input.options.minimumWallLengthM);
  const bridged = bridgeColoredDoorGaps(filteredLines, input.openingLines ?? [], scale);
  const mergedLines = splitLinesAtJunctions(
    bridged.lines,
    Math.max(2, input.options.joinToleranceM / scale),
    Math.max(3, Math.min(input.options.minimumWallLengthM / scale * 0.3, 10)),
  );
  const allPoints: PointM[] = mergedLines.flatMap((line) => [toMeters(line.start), toMeters(line.end)]);
  const acceptedArcs = (input.arcs ?? []).flatMap((arc) => {
    const start = toMeters(arc.start);
    const through = toMeters(arc.through);
    const end = toMeters(arc.end);
    const bulge = bulgeFromThreePoints(start, through, end);
    const geometry = bulge ? arcFromBulge(start, end, bulge) : null;
    const minimumArcConfidence = geometrySource === "vector" ? 0.45 : 0.74;
    return bulge && geometry && arc.confidence >= minimumArcConfidence
      && geometry.radiusM >= Math.max(0.4, input.options.minimumWallLengthM / 2)
      && distance(start, end) >= Math.min(0.15, input.options.minimumWallLengthM)
      ? [{ arc, start, through, end, bulge, geometry }]
      : [];
  });
  const doorArcs = input.options.detectOpenings && geometrySource === "vector"
    ? acceptedArcs.filter((item) => item.arc.confidence >= (geometrySource === "vector" ? 0.55 : 0.82)
      && item.geometry.radiusM >= 0.45 && item.geometry.radiusM <= 1.8
      && Math.abs(item.geometry.sweepRad) >= Math.PI / 5 && Math.abs(item.geometry.sweepRad) <= Math.PI * 0.85)
    : [];
  const remainingArcs = acceptedArcs.filter((item) => !doorArcs.includes(item));
  const wallArcs = geometrySource === "vector" ? remainingArcs : pairedRasterWallArcs(remainingArcs);
  wallArcs.forEach((item) => allPoints.push(item.start, item.end));
  const merged = mergeNearbyVertices(allPoints, input.options.joinToleranceM, geometrySource === "vector" ? "vector-pdf" : "raster");
  const provenance = geometrySource === "vector" ? "vector-pdf" as const : "raster" as const;
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
  let walls = mergedLines.map((line, index) => makeWall(index * 2, index * 2 + 1, line.confidence, { kind: "line" }));
  const arcOffset = mergedLines.length * 2;
  wallArcs.forEach((item, index) => walls.push(makeWall(arcOffset + index * 2, arcOffset + index * 2 + 1, item.arc.confidence, { kind: "arc", bulge: item.bulge })));
  let usedVertexIds = new Set(walls.flatMap((wall) => [wall.startVertexId, wall.endVertexId]));
  let vertices = merged.vertices.filter((vertex) => usedVertexIds.has(vertex.id));
  if (geometrySource === "raster") {
    walls = pruneShortIsolatedRasterWalls(walls, vertices, Math.max(0.1, input.options.joinToleranceM * 1.25));
    usedVertexIds = new Set(walls.flatMap((wall) => [wall.startVertexId, wall.endVertexId]));
    vertices = vertices.filter((vertex) => usedVertexIds.has(vertex.id));
  }
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
    for (const gap of bridged.doorGaps) {
      const gapStart = toMeters(gap.start);
      const gapEnd = toMeters(gap.end);
      const midpoint = { xM: (gapStart.xM + gapEnd.xM) / 2, yM: (gapStart.yM + gapEnd.yM) / 2 };
      let best: { wall: ArchitecturalWall; alongM: number; distanceM: number } | null = null;
      for (const wall of walls) {
        const start = vertexMap.get(wall.startVertexId);
        const end = vertexMap.get(wall.endVertexId);
        if (!start || !end) continue;
        const nearest = nearestPointOnWallCurve(start, end, wall.curve, midpoint);
        if (!nearest || nearest.distanceM > 0.2) continue;
        if (!best || nearest.distanceM < best.distanceM) best = { wall, alongM: nearest.alongM, distanceM: nearest.distanceM };
      }
      if (!best) continue;
      const widthM = distance(gapStart, gapEnd);
      const hostLengthM = wallLengthM(best.wall, vertexMap);
      openings.push({
        id: createStableId("opening"), kind: "door", hostWallId: best.wall.id,
        offsetM: Math.max(0, Math.min(hostLengthM - widthM, best.alongM - widthM / 2)),
        widthM, sillHeightM: 0, openingHeightM: Math.min(2.1, best.wall.heightM),
        verticalSource: "default", swing: "right", openingAngleDeg: 90,
        provenance, confidence: Math.min(0.94, gap.confidence), reviewStatus: "candidate", locked: false,
      });
    }
  }
  if (input.options.detectOpenings && input.openingLines?.length) {
    const coloredLines = mergeCollinearLines(input.openingLines, Math.max(14, Math.min(90, 1.2 / scale)), 6)
      .filter((line) => distance(line.start, line.end) * scale >= 0.3);
    for (const line of coloredLines) {
      const lineMidpoint = { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 };
      const alreadyUsedForGap = bridged.doorGaps.some((gap) => Math.min(
        distance(lineMidpoint, { x: (gap.start.x + gap.end.x) / 2, y: (gap.start.y + gap.end.y) / 2 }) * scale,
        distance(line.start, gap.start) * scale,
        distance(line.start, gap.end) * scale,
      ) <= Math.max(0.45, distance(gap.start, gap.end) * scale * 1.4));
      if (alreadyUsedForGap) continue;
      const start = toMeters(line.start);
      const end = toMeters(line.end);
      const midpoint = { xM: (start.xM + end.xM) / 2, yM: (start.yM + end.yM) / 2 };
      const lengthM = distance(start, end);
      const lineTangent = { xM: (end.xM - start.xM) / lengthM, yM: (end.yM - start.yM) / lengthM };
      let bestWindow: { wall: ArchitecturalWall; alongM: number; distanceM: number } | null = null;
      for (const wall of walls) {
        const wallStart = vertexMap.get(wall.startVertexId);
        const wallEnd = vertexMap.get(wall.endVertexId);
        if (!wallStart || !wallEnd) continue;
        const nearest = nearestPointOnWallCurve(wallStart, wallEnd, wall.curve, midpoint);
        if (!nearest || nearest.distanceM > Math.max(0.22, wall.thicknessM * 1.5)) continue;
        const angleSin = Math.abs(lineTangent.xM * nearest.tangent.yM - lineTangent.yM * nearest.tangent.xM);
        if (angleSin > Math.sin(Math.PI / 18)) continue;
        if (!bestWindow || nearest.distanceM < bestWindow.distanceM) {
          bestWindow = { wall, alongM: nearest.alongM, distanceM: nearest.distanceM };
        }
      }
      if (bestWindow && lengthM <= 4) {
        const hostLengthM = wallLengthM(bestWindow.wall, vertexMap);
        const widthM = Math.min(lengthM, hostLengthM);
        openings.push({
          id: createStableId("opening"), kind: "window", hostWallId: bestWindow.wall.id,
          offsetM: Math.max(0, Math.min(hostLengthM - widthM, bestWindow.alongM - widthM / 2)),
          widthM, sillHeightM: 0.9, openingHeightM: Math.min(1.2, Math.max(0.2, bestWindow.wall.heightM - 0.9)),
          verticalSource: "default", provenance,
          confidence: Math.min(0.9, 0.62 + (line.evidence?.coloredOpeningSupport ?? 0) * 0.16 + Math.min(1, lengthM / 1.4) * 0.12),
          reviewStatus: "candidate", locked: false,
        });
        continue;
      }
      let bestEndpoint: { wall: ArchitecturalWall; alongM: number; distanceM: number; tangent: PointM } | null = null;
      for (const point of [start, end]) {
        for (const wall of walls) {
          const wallStart = vertexMap.get(wall.startVertexId);
          const wallEnd = vertexMap.get(wall.endVertexId);
          if (!wallStart || !wallEnd) continue;
          const nearest = nearestPointOnWallCurve(wallStart, wallEnd, wall.curve, point);
          if (!nearest || nearest.distanceM > Math.max(0.28, wall.thicknessM * 2)) continue;
          if (!bestEndpoint || nearest.distanceM < bestEndpoint.distanceM) {
            bestEndpoint = { wall, alongM: nearest.alongM, distanceM: nearest.distanceM, tangent: nearest.tangent };
          }
        }
      }
      const endpointAngleSin = bestEndpoint
        ? Math.abs(lineTangent.xM * bestEndpoint.tangent.yM - lineTangent.yM * bestEndpoint.tangent.xM)
        : 0;
      if (bestEndpoint && lengthM >= 0.6 && lengthM <= 1.8 && endpointAngleSin >= Math.sin(Math.PI / 9)) {
        const hostLengthM = wallLengthM(bestEndpoint.wall, vertexMap);
        const widthM = Math.min(lengthM, hostLengthM);
        openings.push({
          id: createStableId("opening"), kind: "door", hostWallId: bestEndpoint.wall.id,
          offsetM: Math.max(0, Math.min(hostLengthM - widthM, bestEndpoint.alongM - widthM / 2)),
          widthM, sillHeightM: 0, openingHeightM: Math.min(2.1, bestEndpoint.wall.heightM),
          verticalSource: "default", swing: "right", openingAngleDeg: 90,
          provenance, confidence: Math.min(0.9, 0.7 + (line.evidence?.coloredOpeningSupport ?? 0) * 0.2),
          reviewStatus: "candidate", locked: false,
        });
        continue;
      }
    }
  }
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
  const quality = assessRecognitionQuality({ vertices, walls });
  if (quality.status === "unreliable") {
    issues.unshift({
      id: "quality:unreliable",
      severity: "warning",
      message: `Результат распознавания ненадёжен (${quality.score}/100): ${quality.reasons.join("; ")}`,
    });
  }
  return {
    engineVersion: input.engineVersion ?? "local-hybrid-1",
    source: input.source,
    vertices,
    walls,
    openings: deduplicatedOpenings,
    textHints: [...(input.textHints ?? [])],
    issues,
    quality,
  };
}
