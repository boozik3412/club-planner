import type { DetectedLine } from "./types";

interface Candidate {
  line: DetectedLine;
  angle: number;
  length: number;
  tangent: { x: number; y: number };
  normal: { x: number; y: number };
  startProjection: number;
  endProjection: number;
  normalProjection: number;
}

function candidate(line: DetectedLine): Candidate | null {
  const deltaX = line.end.x - line.start.x;
  const deltaY = line.end.y - line.start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (!(length > 0)) return null;
  let tangent = { x: deltaX / length, y: deltaY / length };
  if (tangent.x < 0 || (Math.abs(tangent.x) < 1e-8 && tangent.y < 0)) tangent = { x: -tangent.x, y: -tangent.y };
  const normal = { x: -tangent.y, y: tangent.x };
  const projections = [line.start, line.end].map((point) => point.x * tangent.x + point.y * tangent.y);
  return {
    line,
    angle: Math.atan2(tangent.y, tangent.x),
    length,
    tangent,
    normal,
    startProjection: Math.min(...projections),
    endProjection: Math.max(...projections),
    normalProjection: line.start.x * normal.x + line.start.y * normal.y,
  };
}

function parallel(first: Candidate, second: Candidate, toleranceSin = 0.045): boolean {
  return Math.abs(Math.sin(first.angle - second.angle)) <= toleranceSin;
}

function projectionOn(candidateLine: Candidate, point: { x: number; y: number }): number {
  return point.x * candidateLine.tangent.x + point.y * candidateLine.tangent.y;
}

function normalOn(candidateLine: Candidate, point: { x: number; y: number }): number {
  return point.x * candidateLine.normal.x + point.y * candidateLine.normal.y;
}

function intervalOn(reference: Candidate, line: DetectedLine): [number, number] {
  const values = [projectionOn(reference, line.start), projectionOn(reference, line.end)];
  return [Math.min(...values), Math.max(...values)];
}

function mergeFragments(lines: readonly DetectedLine[], minimumLengthPx: number): DetectedLine[] {
  const result: DetectedLine[] = [];
  const gapPx = Math.max(18, minimumLengthPx * 0.75);
  for (const source of [...lines].sort((first, second) => {
    const firstLength = Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y);
    const secondLength = Math.hypot(second.end.x - second.start.x, second.end.y - second.start.y);
    return secondLength - firstLength;
  })) {
    const item = candidate(source);
    if (!item || item.length < minimumLengthPx) continue;
    const matchIndex = result.findIndex((existing) => {
      const reference = candidate(existing);
      if (!reference || !parallel(reference, item, 0.05)) return false;
      const normalDistance = Math.abs(normalOn(reference, source.start) - reference.normalProjection);
      const [start, end] = intervalOn(reference, source);
      return normalDistance <= 1.25 && start <= reference.endProjection + gapPx && reference.startProjection <= end + gapPx;
    });
    if (matchIndex < 0) {
      result.push(source);
      continue;
    }
    const reference = candidate(result[matchIndex])!;
    const [sourceStart, sourceEnd] = intervalOn(reference, source);
    const start = Math.min(reference.startProjection, sourceStart);
    const end = Math.max(reference.endProjection, sourceEnd);
    const rho = (reference.normalProjection + normalOn(reference, source.start)) / 2;
    result[matchIndex] = {
      start: { x: reference.tangent.x * start + reference.normal.x * rho, y: reference.tangent.y * start + reference.normal.y * rho },
      end: { x: reference.tangent.x * end + reference.normal.x * rho, y: reference.tangent.y * end + reference.normal.y * rho },
      confidence: Math.min(0.98, Math.max(source.confidence, result[matchIndex].confidence) + 0.03),
    };
  }
  return result;
}

function distanceFromPrimaryAxis(angle: number): number {
  const normalized = ((angle % Math.PI) + Math.PI) % Math.PI;
  return Math.min(normalized, Math.abs(normalized - Math.PI / 2), Math.abs(normalized - Math.PI));
}

/** Identify a repeated diagonal family before wall-face pairing. */
function hatchCandidateIndices(candidates: readonly Candidate[], minimumDimension: number): Set<number> {
  const result = new Set<number>();
  const minimumAxisDistance = Math.PI / 18;
  candidates.forEach((seed, seedIndex) => {
    if (result.has(seedIndex) || distanceFromPrimaryAxis(seed.angle) < minimumAxisDistance) return;
    const family = candidates.flatMap((item, index) => {
      if (!parallel(seed, item, 0.035)) return [];
      const [start, end] = intervalOn(seed, item.line);
      const overlap = Math.min(seed.endProjection, end) - Math.max(seed.startProjection, start);
      if (overlap < Math.min(seed.length, item.length) * 0.42 || overlap < minimumDimension * 0.08) return [];
      return [{ index, rho: normalOn(seed, item.line.start) }];
    }).sort((first, second) => first.rho - second.rho);
    if (family.length < 5) return;
    const gaps = family.slice(1).map((item, index) => item.rho - family[index].rho)
      .filter((gap) => gap >= Math.max(4, minimumDimension * 0.004));
    if (gaps.length < 3) return;
    const sortedGaps = [...gaps].sort((first, second) => first - second);
    const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
    const regular = gaps.filter((gap) => Math.abs(gap - median) <= Math.max(4, median * 0.45)).length;
    if (regular / gaps.length < 0.65) return;
    family.forEach((item) => result.add(item.index));
  });
  return result;
}

function mergeDuplicateWallAxes(lines: readonly DetectedLine[]): DetectedLine[] {
  const result: DetectedLine[] = [];
  for (const source of [...lines].sort((first, second) => second.confidence - first.confidence)) {
    const item = candidate(source);
    if (!item) continue;
    const matchIndex = result.findIndex((existing) => {
      const reference = candidate(existing);
      if (!reference || !parallel(reference, item, 0.035)) return false;
      const [start, end] = intervalOn(reference, source);
      const overlap = Math.min(reference.endProjection, end) - Math.max(reference.startProjection, start);
      const normalDistance = Math.abs(normalOn(reference, source.start) - reference.normalProjection);
      const combinedThickness = (existing.thicknessPx ?? 0) + (source.thicknessPx ?? 0);
      return overlap >= Math.min(reference.length, item.length) * 0.65
        && normalDistance <= Math.max(5, combinedThickness * 1.2);
    });
    if (matchIndex < 0) {
      result.push(source);
      continue;
    }
    const reference = candidate(result[matchIndex])!;
    const [sourceStart, sourceEnd] = intervalOn(reference, source);
    const start = Math.min(reference.startProjection, sourceStart);
    const end = Math.max(reference.endProjection, sourceEnd);
    const referenceWeight = Math.max(1, reference.length);
    const sourceWeight = Math.max(1, item.length);
    const rho = (reference.normalProjection * referenceWeight + normalOn(reference, source.start) * sourceWeight)
      / (referenceWeight + sourceWeight);
    result[matchIndex] = {
      start: { x: reference.tangent.x * start + reference.normal.x * rho, y: reference.tangent.y * start + reference.normal.y * rho },
      end: { x: reference.tangent.x * end + reference.normal.x * rho, y: reference.tangent.y * end + reference.normal.y * rho },
      thicknessPx: Math.max(result[matchIndex].thicknessPx ?? 0, source.thicknessPx ?? 0) || undefined,
      confidence: Math.max(result[matchIndex].confidence, source.confidence),
      evidence: {
        pairedFaces: true,
        overlapRatio: Math.max(result[matchIndex].evidence?.overlapRatio ?? 0, source.evidence?.overlapRatio ?? 0),
        thicknessConsistency: Math.min(result[matchIndex].evidence?.thicknessConsistency ?? 1, source.evidence?.thicknessConsistency ?? 1),
      },
    };
  }
  return result;
}

/** Convert noisy Hough segments into wall axes by pairing parallel wall faces. */
export function consolidateWallLines(
  rawLines: readonly DetectedLine[],
  imageWidth: number,
  imageHeight: number,
  minimumLengthPx: number,
): DetectedLine[] {
  const minimumDimension = Math.min(imageWidth, imageHeight);
  const maximumDimension = Math.max(imageWidth, imageHeight);
  const boundaryMarginPx = minimumDimension * 0.08;
  const followsImageBoundary = (line: DetectedLine) => [
    [line.start.x, line.end.x, 0], [line.start.x, line.end.x, imageWidth],
    [line.start.y, line.end.y, 0], [line.start.y, line.end.y, imageHeight],
  ].some(([first, second, boundary]) => Math.abs(first - boundary) <= boundaryMarginPx && Math.abs(second - boundary) <= boundaryMarginPx);
  const fragments = mergeFragments(rawLines, Math.max(20, minimumLengthPx));
  const candidates = fragments.map(candidate).filter((value): value is Candidate => Boolean(value));
  const hatchIndices = hatchCandidateIndices(candidates, minimumDimension);
  const paired = new Set<number>();
  const result: DetectedLine[] = [];
  const maximumThicknessPx = Math.max(18, minimumDimension * 0.035);
  const minimumThicknessPx = Math.max(3, minimumDimension * 0.00375);

  candidates.forEach((first, firstIndex) => {
    if (paired.has(firstIndex) || hatchIndices.has(firstIndex)) return;
    let best: { index: number; score: number; interval: [number, number]; rho: number; thickness: number } | null = null;
    candidates.forEach((second, secondIndex) => {
      if (secondIndex === firstIndex || paired.has(secondIndex) || hatchIndices.has(secondIndex) || !parallel(first, second)) return;
      const [secondStart, secondEnd] = intervalOn(first, second.line);
      const overlapStart = Math.max(first.startProjection, secondStart);
      const overlapEnd = Math.min(first.endProjection, secondEnd);
      const overlap = overlapEnd - overlapStart;
      const thickness = Math.abs(normalOn(first, second.line.start) - first.normalProjection);
      if (thickness < minimumThicknessPx || thickness > maximumThicknessPx) return;
      if (overlap < Math.min(first.length, second.length) * 0.55 || overlap < Math.max(minimumLengthPx, minimumDimension * 0.07)) return;
      const score = overlap - thickness * 0.15;
      if (!best || score > best.score) {
        best = {
          index: secondIndex,
          score,
          interval: [Math.min(first.startProjection, secondStart), Math.max(first.endProjection, secondEnd)],
          rho: (first.normalProjection + normalOn(first, second.line.start)) / 2,
          thickness,
        };
      }
    });
    const match = best as { index: number; score: number; interval: [number, number]; rho: number; thickness: number } | null;
    if (!match) return;
    paired.add(firstIndex);
    paired.add(match.index);
    result.push({
      start: {
        x: first.tangent.x * match.interval[0] + first.normal.x * match.rho,
        y: first.tangent.y * match.interval[0] + first.normal.y * match.rho,
      },
      end: {
        x: first.tangent.x * match.interval[1] + first.normal.x * match.rho,
        y: first.tangent.y * match.interval[1] + first.normal.y * match.rho,
      },
      thicknessPx: match.thickness,
      confidence: Math.min(0.98, 0.72 + match.score / Math.max(imageWidth, imageHeight) * 0.7),
      evidence: {
        pairedFaces: true,
        overlapRatio: Math.min(1, (match.interval[1] - match.interval[0]) / Math.max(first.length, candidates[match.index].length)),
        thicknessConsistency: 1,
      },
    });
  });

  // A long unpaired stroke is more often a dimension, hatch or table line than
  // a wall. Thin one-line partitions will use a separate topology-backed path.
  return mergeDuplicateWallAxes(result)
    .filter((line) => !followsImageBoundary(line))
    .sort((first, second) => {
      const firstLength = Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y);
      const secondLength = Math.hypot(second.end.x - second.start.x, second.end.y - second.start.y);
      return second.confidence * secondLength - first.confidence * firstLength;
    })
    .slice(0, Math.max(48, Math.round(maximumDimension / 8)));
}
