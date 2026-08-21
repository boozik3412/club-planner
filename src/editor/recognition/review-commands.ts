import {
  architectureVertexMap,
  nearestPointOnWallCurve,
  wallLengthM,
  wallPointAtDistance,
} from "../architecture/geometry";
import type {
  ArchitecturalWall,
  ArchitecturalWallCurve,
  ArchitectureVertex,
  PointM,
} from "../model/types";
import { createStableId } from "../model/templates";
import type { RecognitionDraft } from "./types";

export interface ReviewEndpointTarget {
  point: PointM;
  vertexId?: string;
  wallId?: string;
  alongM?: number;
}

export interface ManualWallProperties {
  kind: ArchitecturalWall["kind"];
  thicknessM: number;
  heightM: number;
  baseElevationM: number;
}

export interface ReviewDraftCommandResult {
  draft: RecognitionDraft;
  wallId?: string;
  error?: string;
}

function acceptedVertex(point: PointM): ArchitectureVertex {
  return {
    id: createStableId("vertex"),
    xM: point.xM,
    yM: point.yM,
    provenance: "manual",
    confidence: 1,
    reviewStatus: "accepted",
    locked: false,
  };
}

function openingIntersectsDistance(opening: RecognitionDraft["openings"][number], distanceM: number): boolean {
  return opening.reviewStatus !== "rejected"
    && opening.offsetM < distanceM - 1e-6
    && opening.offsetM + opening.widthM > distanceM + 1e-6;
}

function findTargetWall(draft: RecognitionDraft, target: ReviewEndpointTarget): ArchitecturalWall | null {
  const direct = target.wallId
    ? draft.walls.find((wall) => wall.id === target.wallId && wall.reviewStatus !== "rejected")
    : undefined;
  if (direct) return direct;
  const vertices = architectureVertexMap({
    vertices: draft.vertices,
    walls: draft.walls,
    openings: draft.openings,
    heightRegions: [],
    defaultWallHeightM: 3,
    defaultWallThicknessM: 0.15,
  });
  let nearest: { wall: ArchitecturalWall; distanceM: number } | undefined;
  for (const wall of draft.walls) {
    if (wall.reviewStatus === "rejected") continue;
    const start = vertices.get(wall.startVertexId);
    const end = vertices.get(wall.endVertexId);
    if (!start || !end) continue;
    const projection = nearestPointOnWallCurve(start, end, wall.curve, target.point);
    if (projection && (!nearest || projection.distanceM < nearest.distanceM)) {
      nearest = { wall, distanceM: projection.distanceM };
    }
  }
  return nearest !== undefined && nearest.distanceM <= 0.03 ? nearest.wall : null;
}

function splitWallForEndpoint(
  draft: RecognitionDraft,
  wall: ArchitecturalWall,
  target: ReviewEndpointTarget,
): { vertexId?: string; error?: string } {
  const vertices = architectureVertexMap({
    vertices: draft.vertices,
    walls: draft.walls,
    openings: draft.openings,
    heightRegions: [],
    defaultWallHeightM: 3,
    defaultWallThicknessM: 0.15,
  });
  const start = vertices.get(wall.startVertexId);
  const end = vertices.get(wall.endVertexId);
  if (!start || !end) return { error: "У стены отсутствует одна из вершин." };
  const lengthM = wallLengthM(wall, vertices);
  const projection = nearestPointOnWallCurve(start, end, wall.curve, target.point);
  const splitM = target.alongM !== undefined && target.wallId === wall.id ? target.alongM : projection?.alongM;
  if (splitM === undefined) return { error: "Не удалось вычислить точку примыкания." };
  if (splitM <= 0.02) return { vertexId: wall.startVertexId };
  if (splitM >= lengthM - 0.02) return { vertexId: wall.endVertexId };
  if (draft.openings.some((opening) => opening.hostWallId === wall.id && openingIntersectsDistance(opening, splitM))) {
    return { error: "Нельзя создать узел внутри дверного или оконного проёма." };
  }
  const point = wallPointAtDistance(wall, vertices, splitM);
  if (!point) return { error: "Не удалось разделить геометрию стены." };
  const middle = acceptedVertex(point);
  const first = structuredClone(wall);
  const second = structuredClone(wall);
  second.id = createStableId("wall");
  first.endVertexId = middle.id;
  second.startVertexId = middle.id;
  first.provenance = "manual";
  second.provenance = "manual";
  first.locked = false;
  second.locked = false;
  if (wall.curve.kind === "arc") {
    const sweep = 4 * Math.atan(wall.curve.bulge);
    const fraction = splitM / lengthM;
    first.curve = { kind: "arc", bulge: Math.tan(sweep * fraction / 4) };
    second.curve = { kind: "arc", bulge: Math.tan(sweep * (1 - fraction) / 4) };
  }
  const wallIndex = draft.walls.findIndex((candidate) => candidate.id === wall.id);
  draft.vertices.push(middle);
  draft.walls.splice(wallIndex, 1, first, second);
  draft.openings.forEach((opening) => {
    if (opening.hostWallId !== wall.id || opening.offsetM < splitM) return;
    opening.hostWallId = second.id;
    opening.offsetM -= splitM;
  });
  return { vertexId: middle.id };
}

function resolveEndpoint(draft: RecognitionDraft, target: ReviewEndpointTarget): { vertexId?: string; error?: string } {
  if (target.vertexId) {
    const vertex = draft.vertices.find((candidate) => candidate.id === target.vertexId && candidate.reviewStatus !== "rejected");
    if (vertex) return { vertexId: vertex.id };
  }
  if (target.wallId) {
    const wall = findTargetWall(draft, target);
    if (wall) return splitWallForEndpoint(draft, wall, target);
  }
  const nearVertex = draft.vertices.find((vertex) => vertex.reviewStatus !== "rejected"
    && Math.hypot(vertex.xM - target.point.xM, vertex.yM - target.point.yM) <= 0.02);
  if (nearVertex) return { vertexId: nearVertex.id };
  const vertex = acceptedVertex(target.point);
  draft.vertices.push(vertex);
  return { vertexId: vertex.id };
}

export function addManualWallToDraft(
  current: RecognitionDraft,
  startTarget: ReviewEndpointTarget,
  endTarget: ReviewEndpointTarget,
  curve: ArchitecturalWallCurve,
  properties: ManualWallProperties,
): ReviewDraftCommandResult {
  if (!Number.isFinite(startTarget.point.xM) || !Number.isFinite(startTarget.point.yM)
    || !Number.isFinite(endTarget.point.xM) || !Number.isFinite(endTarget.point.yM)
    || Math.hypot(endTarget.point.xM - startTarget.point.xM, endTarget.point.yM - startTarget.point.yM) < 0.02) {
    return { draft: current, error: "Стена должна быть длиннее 2 см." };
  }
  const draft = structuredClone(current);
  const start = resolveEndpoint(draft, startTarget);
  if (!start.vertexId) return { draft: current, error: start.error ?? "Не удалось создать начальный узел." };
  const end = resolveEndpoint(draft, endTarget);
  if (!end.vertexId) return { draft: current, error: end.error ?? "Не удалось создать конечный узел." };
  if (start.vertexId === end.vertexId) return { draft: current, error: "Начало и конец стены совпадают." };
  const duplicate = draft.walls.some((wall) => wall.reviewStatus !== "rejected"
    && ((wall.startVertexId === start.vertexId && wall.endVertexId === end.vertexId)
      || (wall.startVertexId === end.vertexId && wall.endVertexId === start.vertexId)));
  if (duplicate) return { draft: current, error: "Такая стена уже существует." };
  const wall: ArchitecturalWall = {
    id: createStableId("wall"),
    kind: properties.kind,
    startVertexId: start.vertexId,
    endVertexId: end.vertexId,
    curve,
    thicknessM: Math.max(0.01, properties.thicknessM),
    heightM: Math.max(0.1, properties.heightM),
    baseElevationM: Math.max(0, properties.baseElevationM),
    heightSource: "user",
    thicknessSource: "user",
    provenance: "manual",
    confidence: 1,
    reviewStatus: "accepted",
    locked: false,
  };
  draft.walls.push(wall);
  return { draft, wallId: wall.id };
}

export function deleteReviewWallFromDraft(current: RecognitionDraft, wallId: string): ReviewDraftCommandResult {
  const source = current.walls.find((wall) => wall.id === wallId);
  if (!source) return { draft: current, error: "Стена не найдена." };
  if (source.locked) return { draft: current, error: "Заблокированную стену удалить нельзя." };
  const draft = structuredClone(current);
  if (source.provenance === "manual") {
    draft.walls = draft.walls.filter((wall) => wall.id !== wallId);
    draft.openings = draft.openings.filter((opening) => opening.hostWallId !== wallId);
  } else {
    const wall = draft.walls.find((candidate) => candidate.id === wallId)!;
    wall.reviewStatus = "rejected";
    draft.openings.forEach((opening) => {
      if (opening.hostWallId === wallId) opening.reviewStatus = "rejected";
    });
  }
  const referenced = new Set(draft.walls
    .filter((wall) => wall.reviewStatus !== "rejected")
    .flatMap((wall) => [wall.startVertexId, wall.endVertexId]));
  draft.vertices = draft.vertices.filter((vertex) => {
    if (referenced.has(vertex.id)) return true;
    if (vertex.provenance === "manual") return false;
    vertex.reviewStatus = "rejected";
    return true;
  });
  return { draft };
}

export function deleteReviewWallsFromDraft(
  current: RecognitionDraft,
  wallIds: readonly string[],
): ReviewDraftCommandResult {
  const ids = [...new Set(wallIds)];
  if (ids.length === 0) return { draft: current };
  let draft = current;
  for (const wallId of ids) {
    if (!draft.walls.some((wall) => wall.id === wallId && !wall.locked)) continue;
    const result = deleteReviewWallFromDraft(draft, wallId);
    if (result.error) return result;
    draft = result.draft;
  }
  return { draft };
}
