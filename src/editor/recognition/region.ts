import type { PlanSource } from "../model/types";
import type { DetectedArc, DetectedLine, RecognitionDraft, RecognitionImage } from "./types";
import { assessRecognitionQuality } from "./quality";

export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function inside(point: { x: number; y: number }, region: PixelRegion): boolean {
  return point.x >= region.x && point.x <= region.x + region.width
    && point.y >= region.y && point.y <= region.y + region.height;
}

export function normalizedPixelRegion(
  first: { x: number; y: number },
  second: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
): PixelRegion {
  const x = Math.max(0, Math.floor(Math.min(first.x, second.x)));
  const y = Math.max(0, Math.floor(Math.min(first.y, second.y)));
  const right = Math.min(imageWidth, Math.ceil(Math.max(first.x, second.x)));
  const bottom = Math.min(imageHeight, Math.ceil(Math.max(first.y, second.y)));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

export function cropRecognitionImage(
  imageData: ImageData,
  region: PixelRegion,
  metersPerPixel: number,
  vectorLines: readonly DetectedLine[],
  vectorArcs: readonly DetectedArc[] = [],
  vectorOpeningLines: readonly DetectedLine[] = [],
): RecognitionImage {
  const rgba = new Uint8ClampedArray(region.width * region.height * 4);
  for (let row = 0; row < region.height; row += 1) {
    const sourceOffset = ((region.y + row) * imageData.width + region.x) * 4;
    rgba.set(imageData.data.subarray(sourceOffset, sourceOffset + region.width * 4), row * region.width * 4);
  }
  const lines = vectorLines
    .filter((line) => inside(line.start, region) || inside(line.end, region))
    .map((line) => ({
      ...line,
      start: { x: line.start.x - region.x, y: line.start.y - region.y },
      end: { x: line.end.x - region.x, y: line.end.y - region.y },
    }));
  const arcs = vectorArcs
    .filter((arc) => inside(arc.start, region) || inside(arc.through, region) || inside(arc.end, region))
    .map((arc) => ({
      ...arc,
      start: { x: arc.start.x - region.x, y: arc.start.y - region.y },
      through: { x: arc.through.x - region.x, y: arc.through.y - region.y },
      end: { x: arc.end.x - region.x, y: arc.end.y - region.y },
    }));
  const openingLines = vectorOpeningLines
    .filter((line) => inside(line.start, region) || inside(line.end, region))
    .map((line) => ({
      ...line,
      start: { x: line.start.x - region.x, y: line.start.y - region.y },
      end: { x: line.end.x - region.x, y: line.end.y - region.y },
    }));
  return {
    width: region.width,
    height: region.height,
    rgba,
    cropQuad: [
      { x: 0, y: 0 }, { x: region.width, y: 0 },
      { x: region.width, y: region.height }, { x: 0, y: region.height },
    ],
    outputWidth: region.width,
    outputHeight: region.height,
    metersPerPixel,
    vectorLines: lines,
    vectorOpeningLines: openingLines,
    vectorArcs: arcs,
  };
}

export function mergeRegionRecognition(
  current: RecognitionDraft,
  recognized: RecognitionDraft,
  region: PixelRegion,
  source: PlanSource,
): RecognitionDraft {
  const scale = source.metersPerSourceUnit ?? 0;
  const boundsM = {
    left: region.x * scale,
    top: region.y * scale,
    right: (region.x + region.width) * scale,
    bottom: (region.y + region.height) * scale,
  };
  const currentVertices = new Map(current.vertices.map((vertex) => [vertex.id, vertex]));
  const removableWallIds = new Set(current.walls.filter((wall) => {
    if (wall.reviewStatus !== "candidate" || wall.provenance === "manual") return false;
    const start = currentVertices.get(wall.startVertexId);
    const end = currentVertices.get(wall.endVertexId);
    if (!start || !end) return false;
    const xM = (start.xM + end.xM) / 2;
    const yM = (start.yM + end.yM) / 2;
    return xM >= boundsM.left && xM <= boundsM.right && yM >= boundsM.top && yM <= boundsM.bottom;
  }).map((wall) => wall.id));
  const walls = current.walls.filter((wall) => !removableWallIds.has(wall.id));
  const openings = current.openings.filter((opening) => !removableWallIds.has(opening.hostWallId));
  const usedVertexIds = new Set(walls.flatMap((wall) => [wall.startVertexId, wall.endVertexId]));
  const xOffsetM = region.x * scale;
  const yOffsetM = region.y * scale;
  const shiftedVertices = recognized.vertices.map((vertex) => ({
    ...vertex,
    xM: vertex.xM + xOffsetM,
    yM: vertex.yM + yOffsetM,
  }));
  const next: RecognitionDraft = {
    ...current,
    engineVersion: recognized.engineVersion,
    source,
    vertices: [...current.vertices.filter((vertex) => usedVertexIds.has(vertex.id)), ...shiftedVertices],
    walls: [...walls, ...recognized.walls],
    openings: [...openings, ...recognized.openings],
    textHints: [
      ...current.textHints.filter((hint) => !inside({ x: hint.bounds.x, y: hint.bounds.y }, region)),
      ...recognized.textHints.map((hint) => ({
        ...hint,
        bounds: { ...hint.bounds, x: hint.bounds.x + region.x, y: hint.bounds.y + region.y },
      })),
    ],
    issues: [
      ...current.issues.filter((issue) => !issue.wallId || !removableWallIds.has(issue.wallId)),
      ...recognized.issues.map((issue) => ({
        ...issue,
        point: issue.point ? { x: issue.point.x + xOffsetM, y: issue.point.y + yOffsetM } : undefined,
      })),
    ],
  };
  next.quality = assessRecognitionQuality(next);
  return next;
}
