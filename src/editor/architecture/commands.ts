import { updateProject } from "../model/project";
import { createStableId } from "../model/templates";
import type {
  ArchitecturalOpening,
  ArchitecturalWall,
  ArchitectureVertex,
  PointM,
  ProjectState,
  RecognitionReviewStatus,
} from "../model/types";
import {
  arcFromBulge,
  architectureVertexMap,
  wallEndpoints,
  wallLengthM,
  wallPointAtDistance,
} from "./geometry";

export interface ArchitectureCommandResult {
  project: ProjectState;
  wallIds?: string[];
  openingId?: string;
}

export function createRectangularRoomCommand(
  project: ProjectState,
  first: PointM,
  second: PointM,
): ArchitectureCommandResult | null {
  if (![first.xM, first.yM, second.xM, second.yM].every(Number.isFinite)) return null;
  const minXM = Math.min(first.xM, second.xM);
  const minYM = Math.min(first.yM, second.yM);
  const maxXM = Math.max(first.xM, second.xM);
  const maxYM = Math.max(first.yM, second.yM);
  if (maxXM - minXM < 0.2 || maxYM - minYM < 0.2) return null;
  const vertices = [
    acceptedManualVertex({ xM: minXM, yM: minYM }),
    acceptedManualVertex({ xM: maxXM, yM: minYM }),
    acceptedManualVertex({ xM: maxXM, yM: maxYM }),
    acceptedManualVertex({ xM: minXM, yM: maxYM }),
  ];
  const walls = vertices.map((vertex, index): ArchitecturalWall => ({
    id: createStableId("wall"),
    kind: "wall",
    startVertexId: vertex.id,
    endVertexId: vertices[(index + 1) % vertices.length].id,
    curve: { kind: "line" },
    thicknessM: project.architecture.defaultWallThicknessM,
    heightM: project.architecture.defaultWallHeightM,
    baseElevationM: 0,
    heightSource: "user",
    thicknessSource: "user",
    provenance: "manual",
    confidence: 1,
    reviewStatus: "accepted",
    locked: false,
  }));
  return {
    project: updateProject(project, (draft) => {
      draft.architecture.vertices.push(...vertices);
      draft.architecture.walls.push(...walls);
    }),
    wallIds: walls.map((wall) => wall.id),
  };
}

function acceptedManualVertex(point: PointM): ArchitectureVertex {
  return {
    id: createStableId("vertex"),
    xM: point.xM,
    yM: point.yM,
    provenance: "manual",
    reviewStatus: "accepted",
    confidence: 1,
    locked: false,
  };
}

function editableWall(project: ProjectState, wallId: string): ArchitecturalWall | null {
  return project.architecture.walls.find((wall) => wall.id === wallId && !wall.locked) ?? null;
}

function openingIntersectsDistance(opening: ArchitecturalOpening, distanceM: number): boolean {
  return opening.offsetM < distanceM - 1e-6 && opening.offsetM + opening.widthM > distanceM + 1e-6;
}

export function setArchitectureReviewStatusCommand(
  project: ProjectState,
  wallIds: readonly string[],
  status: RecognitionReviewStatus,
): ProjectState {
  const ids = new Set(wallIds);
  return updateProject(project, (draft) => {
    draft.architecture.walls.forEach((wall) => {
      if (ids.has(wall.id) && !wall.locked) wall.reviewStatus = status;
    });
    const referenced = new Set(draft.architecture.walls.filter((wall) => wall.reviewStatus !== "rejected").flatMap((wall) => [wall.startVertexId, wall.endVertexId]));
    draft.architecture.vertices.forEach((vertex) => {
      if (!vertex.locked && !referenced.has(vertex.id)) vertex.reviewStatus = status === "rejected" ? "rejected" : vertex.reviewStatus;
    });
  });
}

export function moveArchitectureVertexCommand(
  project: ProjectState,
  vertexId: string,
  point: PointM,
): ProjectState {
  const vertex = project.architecture.vertices.find((candidate) => candidate.id === vertexId);
  if (!vertex || vertex.locked || !Number.isFinite(point.xM) || !Number.isFinite(point.yM)) return project;
  return updateProject(project, (draft) => {
    const target = draft.architecture.vertices.find((candidate) => candidate.id === vertexId)!;
    target.xM = point.xM;
    target.yM = point.yM;
    target.provenance = "manual";
    target.confidence = 1;
  });
}

export function detachWallEndpointCommand(
  project: ProjectState,
  wallId: string,
  endpoint: "start" | "end",
): ArchitectureCommandResult | null {
  const wall = editableWall(project, wallId);
  if (!wall) return null;
  const sourceId = endpoint === "start" ? wall.startVertexId : wall.endVertexId;
  const source = project.architecture.vertices.find((vertex) => vertex.id === sourceId);
  if (!source || source.locked) return null;
  const duplicate = acceptedManualVertex(source);
  return {
    project: updateProject(project, (draft) => {
      draft.architecture.vertices.push(duplicate);
      const target = draft.architecture.walls.find((candidate) => candidate.id === wallId)!;
      if (endpoint === "start") target.startVertexId = duplicate.id;
      else target.endVertexId = duplicate.id;
      target.provenance = "manual";
    }),
    wallIds: [wallId],
  };
}

export function splitArchitecturalWallCommand(
  project: ProjectState,
  wallId: string,
  distanceM?: number,
): ArchitectureCommandResult | null {
  const wall = editableWall(project, wallId);
  if (!wall) return null;
  const vertices = architectureVertexMap(project.architecture);
  const lengthM = wallLengthM(wall, vertices);
  const splitM = distanceM ?? lengthM / 2;
  if (!(splitM > 0.02 && splitM < lengthM - 0.02)) return null;
  const hostedOpenings = project.architecture.openings.filter((opening) => opening.hostWallId === wallId && opening.reviewStatus !== "rejected");
  if (hostedOpenings.some((opening) => openingIntersectsDistance(opening, splitM))) return null;
  const splitPoint = wallPointAtDistance(wall, vertices, splitM);
  if (!splitPoint) return null;
  const middle = acceptedManualVertex(splitPoint);
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
  const next = updateProject(project, (draft) => {
    const index = draft.architecture.walls.findIndex((candidate) => candidate.id === wallId);
    draft.architecture.vertices.push(middle);
    draft.architecture.walls.splice(index, 1, first, second);
    draft.architecture.openings.forEach((opening) => {
      if (opening.hostWallId !== wallId || opening.offsetM < splitM) return;
      opening.hostWallId = second.id;
      opening.offsetM -= splitM;
    });
  });
  return { project: next, wallIds: [first.id, second.id] };
}

function normalizedAngleDifference(first: number, second: number): number {
  const difference = Math.abs(first - second) % (Math.PI * 2);
  return Math.min(difference, Math.PI * 2 - difference);
}

export function mergeArchitecturalWallsCommand(
  project: ProjectState,
  firstWallId: string,
  secondWallId: string,
  angularToleranceDeg = 3,
): ArchitectureCommandResult | null {
  const first = editableWall(project, firstWallId);
  const second = editableWall(project, secondWallId);
  if (!first || !second || first.kind !== second.kind || first.endVertexId !== second.startVertexId) return null;
  if (Math.abs(first.thicknessM - second.thicknessM) > 0.005 || Math.abs(first.heightM - second.heightM) > 0.005) return null;
  const vertices = architectureVertexMap(project.architecture);
  const firstEndpoints = wallEndpoints(first, vertices);
  const secondEndpoints = wallEndpoints(second, vertices);
  if (!firstEndpoints || !secondEndpoints || first.curve.kind !== second.curve.kind) return null;
  let curve: ArchitecturalWall["curve"] = { kind: "line" };
  if (first.curve.kind === "line" && second.curve.kind === "line") {
    const firstAngle = Math.atan2(firstEndpoints.end.yM - firstEndpoints.start.yM, firstEndpoints.end.xM - firstEndpoints.start.xM);
    const secondAngle = Math.atan2(secondEndpoints.end.yM - secondEndpoints.start.yM, secondEndpoints.end.xM - secondEndpoints.start.xM);
    if (normalizedAngleDifference(firstAngle, secondAngle) > angularToleranceDeg * Math.PI / 180) return null;
  } else if (first.curve.kind === "arc" && second.curve.kind === "arc") {
    const firstArc = arcFromBulge(firstEndpoints.start, firstEndpoints.end, first.curve.bulge);
    const secondArc = arcFromBulge(secondEndpoints.start, secondEndpoints.end, second.curve.bulge);
    if (!firstArc || !secondArc
      || Math.hypot(firstArc.center.xM - secondArc.center.xM, firstArc.center.yM - secondArc.center.yM) > 0.01
      || Math.abs(firstArc.radiusM - secondArc.radiusM) > 0.01
      || Math.sign(firstArc.sweepRad) !== Math.sign(secondArc.sweepRad)) return null;
    const sweep = firstArc.sweepRad + secondArc.sweepRad;
    if (Math.abs(sweep) >= Math.PI * 2 - 1e-5) return null;
    curve = { kind: "arc", bulge: Math.tan(sweep / 4) };
  } else return null;
  const firstLengthM = wallLengthM(first, vertices);
  const merged = structuredClone(first);
  merged.endVertexId = second.endVertexId;
  merged.curve = curve;
  merged.provenance = "manual";
  const sharedVertexId = first.endVertexId;
  const next = updateProject(project, (draft) => {
    const firstIndex = draft.architecture.walls.findIndex((wall) => wall.id === first.id);
    draft.architecture.walls[firstIndex] = merged;
    draft.architecture.walls = draft.architecture.walls.filter((wall) => wall.id !== second.id);
    draft.architecture.openings.forEach((opening) => {
      if (opening.hostWallId !== second.id) return;
      opening.hostWallId = first.id;
      opening.offsetM += firstLengthM;
    });
    const stillUsed = draft.architecture.walls.some((wall) => wall.startVertexId === sharedVertexId || wall.endVertexId === sharedVertexId);
    if (!stillUsed) draft.architecture.vertices = draft.architecture.vertices.filter((vertex) => vertex.id !== sharedVertexId);
  });
  return { project: next, wallIds: [merged.id] };
}

export function resizeArchitecturalWallCommand(
  project: ProjectState,
  wallId: string,
  patch: { lengthM?: number; angleDeg?: number; radiusM?: number },
): ProjectState {
  const wall = editableWall(project, wallId);
  if (!wall) return project;
  const vertices = architectureVertexMap(project.architecture);
  const endpoints = wallEndpoints(wall, vertices);
  if (!endpoints) return project;
  const currentLengthM = wallLengthM(wall, vertices);
  const currentAngle = Math.atan2(endpoints.end.yM - endpoints.start.yM, endpoints.end.xM - endpoints.start.xM);
  const lengthM = patch.lengthM ?? currentLengthM;
  const angle = patch.angleDeg === undefined ? currentAngle : patch.angleDeg * Math.PI / 180;
  if (!Number.isFinite(lengthM) || lengthM <= 0.04 || !Number.isFinite(angle)) return project;
  return updateProject(project, (draft) => {
    const targetWall = draft.architecture.walls.find((candidate) => candidate.id === wallId)!;
    const targetEnd = draft.architecture.vertices.find((vertex) => vertex.id === targetWall.endVertexId)!;
    if (targetWall.curve.kind === "line") {
      targetEnd.xM = endpoints.start.xM + Math.cos(angle) * lengthM;
      targetEnd.yM = endpoints.start.yM + Math.sin(angle) * lengthM;
    } else {
      const currentArc = arcFromBulge(endpoints.start, endpoints.end, targetWall.curve.bulge);
      const radiusM = patch.radiusM ?? currentArc?.radiusM ?? lengthM;
      if (!(radiusM >= lengthM / 2)) return;
      const minorSweep = 2 * Math.asin(Math.min(1, lengthM / (2 * radiusM)));
      const originalSweep = currentArc?.sweepRad ?? 4 * Math.atan(targetWall.curve.bulge);
      const sweep = Math.sign(originalSweep || 1) * (Math.abs(originalSweep) > Math.PI ? Math.PI * 2 - minorSweep : minorSweep);
      const chordM = 2 * radiusM * Math.sin(Math.abs(sweep) / 2);
      targetEnd.xM = endpoints.start.xM + Math.cos(angle) * chordM;
      targetEnd.yM = endpoints.start.yM + Math.sin(angle) * chordM;
      targetWall.curve.bulge = Math.tan(sweep / 4);
    }
    targetEnd.provenance = "manual";
    targetWall.provenance = "manual";
    const nextLengthM = wallLengthM(targetWall, architectureVertexMap(draft.architecture));
    draft.architecture.openings.forEach((opening) => {
      if (opening.hostWallId === wallId) opening.offsetM = Math.min(opening.offsetM, Math.max(0, nextLengthM - opening.widthM));
    });
  });
}

export function addArchitecturalOpeningCommand(
  project: ProjectState,
  wallId: string,
  kind: "door" | "window",
  widthM = kind === "door" ? 0.9 : 1.2,
  centerDistanceM?: number,
): ArchitectureCommandResult | null {
  const wall = editableWall(project, wallId);
  if (!wall || widthM <= 0.1) return null;
  const lengthM = wallLengthM(wall, architectureVertexMap(project.architecture));
  if (widthM > lengthM - 0.02) return null;
  const safeCenterM = Math.min(
    lengthM - widthM / 2 - 0.01,
    Math.max(widthM / 2 + 0.01, centerDistanceM ?? lengthM / 2),
  );
  const offsetM = safeCenterM - widthM / 2;
  const overlaps = project.architecture.openings.some((opening) => opening.hostWallId === wallId
    && opening.reviewStatus !== "rejected"
    && offsetM < opening.offsetM + opening.widthM + 0.02
    && offsetM + widthM + 0.02 > opening.offsetM);
  if (overlaps) return null;
  const opening: ArchitecturalOpening = {
    id: createStableId("opening"), kind, hostWallId: wallId, offsetM, widthM,
    sillHeightM: kind === "door" ? 0 : 0.9, openingHeightM: kind === "door" ? Math.min(2.1, wall.heightM) : Math.min(1.2, Math.max(0.1, wall.heightM - 0.9)),
    verticalSource: "user", swing: kind === "door" ? "right" : undefined, openingAngleDeg: kind === "door" ? 90 : undefined,
    provenance: "manual", reviewStatus: "accepted", confidence: 1, locked: false,
  };
  return {
    project: updateProject(project, (draft) => { draft.architecture.openings.push(opening); }),
    wallIds: [wallId],
    openingId: opening.id,
  };
}

export function moveArchitecturalOpeningCommand(
  project: ProjectState,
  openingId: string,
  offsetM: number,
): ProjectState {
  const opening = project.architecture.openings.find((candidate) => candidate.id === openingId);
  if (!opening || opening.locked || !Number.isFinite(offsetM)) return project;
  const wall = project.architecture.walls.find((candidate) => candidate.id === opening.hostWallId);
  if (!wall) return project;
  const lengthM = wallLengthM(wall, architectureVertexMap(project.architecture));
  return updateProject(project, (draft) => {
    const target = draft.architecture.openings.find((candidate) => candidate.id === openingId)!;
    target.offsetM = Math.min(Math.max(0, offsetM), Math.max(0, lengthM - target.widthM));
    target.provenance = "manual";
  });
}

export function updateArchitecturalOpeningCommand(
  project: ProjectState,
  openingId: string,
  patch: Partial<Pick<ArchitecturalOpening,
    "offsetM" | "widthM" | "sillHeightM" | "openingHeightM" | "swing" | "openingAngleDeg" | "reviewStatus">>,
): ProjectState {
  const opening = project.architecture.openings.find((candidate) => candidate.id === openingId);
  if (!opening || opening.locked) return project;
  const wall = project.architecture.walls.find((candidate) => candidate.id === opening.hostWallId);
  if (!wall) return project;
  const lengthM = wallLengthM(wall, architectureVertexMap(project.architecture));
  const widthM = patch.widthM ?? opening.widthM;
  const offsetM = patch.offsetM ?? opening.offsetM;
  const sillHeightM = patch.sillHeightM ?? opening.sillHeightM;
  const openingHeightM = patch.openingHeightM ?? opening.openingHeightM;
  if (!(widthM > 0.05 && widthM <= lengthM)
    || !Number.isFinite(offsetM)
    || !(sillHeightM >= 0)
    || !(openingHeightM > 0.05)
    || sillHeightM + openingHeightM > wall.heightM + 1e-6) return project;
  return updateProject(project, (draft) => {
    const target = draft.architecture.openings.find((candidate) => candidate.id === openingId)!;
    target.widthM = widthM;
    target.offsetM = Math.min(Math.max(0, offsetM), Math.max(0, lengthM - widthM));
    target.sillHeightM = sillHeightM;
    target.openingHeightM = openingHeightM;
    if (patch.swing !== undefined && target.kind === "door") target.swing = patch.swing;
    if (patch.openingAngleDeg !== undefined && target.kind === "door") {
      target.openingAngleDeg = Math.min(180, Math.max(0, patch.openingAngleDeg));
    }
    if (patch.reviewStatus !== undefined) target.reviewStatus = patch.reviewStatus;
    target.verticalSource = "user";
    target.provenance = "manual";
    target.confidence = 1;
  });
}

export function removeArchitecturalOpeningCommand(
  project: ProjectState,
  openingId: string,
): ProjectState {
  const opening = project.architecture.openings.find((candidate) => candidate.id === openingId);
  if (!opening || opening.locked) return project;
  return updateProject(project, (draft) => {
    draft.architecture.openings = draft.architecture.openings.filter((candidate) => candidate.id !== openingId);
  });
}
