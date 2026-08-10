import { getObjectsBounds } from "../geometry/geometry";
import { normalizeAngle } from "../model/project";
import type { PlanObject, PointM } from "../model/types";
import { resolveObjectSnap } from "./object-snap";
import type { PlanBoundary, SnapGuide, SnapResolution } from "./types";

const ACQUIRE_PX = 10;
const RELEASE_PX = 16;
const MIN_ACQUIRE_M = 0.02;
const MAX_ACQUIRE_M = 0.25;
const MIN_RELEASE_M = 0.04;
const MAX_RELEASE_M = 0.35;

interface Axis {
  xM: number;
  yM: number;
}

interface SnapCandidate {
  key: string;
  boundary: PlanBoundary;
  adjustmentXM: number;
  adjustmentYM: number;
  normal: Axis;
  tangent: Axis;
  faceCoordinateM: number;
  contactTangentCoordinateM: number;
  object: PlanObject;
  normalRadiusM: number;
  side: -1 | 1;
  snapType: SnapGuide["snapType"];
  rotationDeg: number | null;
}

export interface ResolveMoveSnapInput {
  objects: readonly PlanObject[];
  otherObjects?: readonly PlanObject[];
  rawDeltaXM: number;
  rawDeltaYM: number;
  boundaries: readonly PlanBoundary[];
  snapEnabled: boolean;
  snapStepM: number;
  unitsPerMeter: number;
  zoom: number;
  wallOffsetM?: number;
  autoRotateFurniture?: boolean;
  autoRotatePartitions?: boolean;
  candidateIndex?: number;
  activeBoundaryId?: string | null;
  snappingDisabled?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dot(point: PointM, axis: Axis): number {
  return point.xM * axis.xM + point.yM * axis.yM;
}

function getBoundaryAxes(boundary: PlanBoundary): { tangent: Axis; normal: Axis } | null {
  const dx = boundary.end.xM - boundary.start.xM;
  const dy = boundary.end.yM - boundary.start.yM;
  const length = Math.hypot(dx, dy);
  if (length <= Number.EPSILON) return null;
  const tangent = { xM: dx / length, yM: dy / length };
  return { tangent, normal: { xM: -tangent.yM, yM: tangent.xM } };
}

export function getObjectSupportRadius(object: PlanObject, axis: Axis): number {
  const radians = object.rotationDeg * Math.PI / 180;
  const localX = { xM: Math.cos(radians), yM: Math.sin(radians) };
  const localY = { xM: -Math.sin(radians), yM: Math.cos(radians) };
  const xProjection = dot(localX, axis);
  const yProjection = dot(localY, axis);
  const halfWidth = object.widthM / 2;
  const halfDepth = object.depthM / 2;
  if (object.kind === "custom-circle" || object.kind === "custom-oval") {
    return Math.hypot(halfWidth * xProjection, halfDepth * yProjection);
  }
  return Math.abs(halfWidth * xProjection) + Math.abs(halfDepth * yProjection);
}

function getToleranceM(px: number, unitsPerMeter: number, zoom: number, min: number, max: number): number {
  const screenScale = unitsPerMeter * zoom;
  if (!Number.isFinite(screenScale) || screenScale <= 0) return max;
  return clamp(px / screenScale, min, max);
}

function signedAngleDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

function getParallelRotation(
  object: PlanObject,
  tangent: Axis,
  objectCount: number,
  autoRotateFurniture: boolean,
  autoRotatePartitions: boolean,
): number | null {
  if (objectCount !== 1 || object.kind === "custom-circle") return null;
  const enabled = object.kind === "partition" ? autoRotatePartitions : autoRotateFurniture;
  if (!enabled) return null;
  const wallAngle = Math.atan2(tangent.yM, tangent.xM) * 180 / Math.PI;
  const first = wallAngle;
  const second = wallAngle + 180;
  const target = Math.abs(signedAngleDelta(object.rotationDeg, first))
    <= Math.abs(signedAngleDelta(object.rotationDeg, second))
    ? first
    : second;
  const normalized = normalizeAngle(target);
  return Math.abs(signedAngleDelta(object.rotationDeg, normalized)) < 0.001 ? null : normalized;
}

function candidateMagnitude(candidate: SnapCandidate): number {
  return Math.hypot(candidate.adjustmentXM, candidate.adjustmentYM);
}

function findBoundaryCandidates(
  objects: readonly PlanObject[],
  boundary: PlanBoundary,
  rawDeltaXM: number,
  rawDeltaYM: number,
  toleranceM: number,
  snapStepM: number,
  wallOffsetM: number,
  autoRotateFurniture: boolean,
  autoRotatePartitions: boolean,
): SnapCandidate[] {
  const axes = getBoundaryAxes(boundary);
  if (!axes) return [];
  const { tangent, normal } = axes;
  const boundaryT1 = dot(boundary.start, tangent);
  const boundaryT2 = dot(boundary.end, tangent);
  const boundaryMinT = Math.min(boundaryT1, boundaryT2);
  const boundaryMaxT = Math.max(boundaryT1, boundaryT2);
  const boundaryMidT = (boundaryMinT + boundaryMaxT) / 2;
  const centerCoordinate = dot(boundary.start, normal);
  const halfThickness = boundary.thicknessM / 2;
  const candidates: SnapCandidate[] = [];

  for (const object of objects) {
    const rotationDeg = getParallelRotation(
      object,
      tangent,
      objects.length,
      autoRotateFurniture,
      autoRotatePartitions,
    );
    const workingObject = rotationDeg === null ? object : { ...object, rotationDeg };
    const movedCenter = { xM: object.xM + rawDeltaXM, yM: object.yM + rawDeltaYM };
    const tangentCoordinate = dot(movedCenter, tangent);
    const tangentRadius = getObjectSupportRadius(workingObject, tangent);
    if (tangentCoordinate + tangentRadius < boundaryMinT - toleranceM
      || tangentCoordinate - tangentRadius > boundaryMaxT + toleranceM) continue;

    const objectCoordinate = dot(movedCenter, normal);
    const normalRadius = getObjectSupportRadius(workingObject, normal);
    for (const side of [1, -1] as const) {
      const faceCoordinateM = centerCoordinate + side * halfThickness;
      const targetCenterCoordinate = faceCoordinateM + side * (normalRadius + wallOffsetM);
      const normalAdjustment = targetCenterCoordinate - objectCoordinate;
      if (Math.abs(normalAdjustment) > toleranceM) continue;

      const addCandidate = (
        snapType: SnapGuide["snapType"],
        tangentAdjustment: number,
        contactTangentCoordinateM: number,
      ) => {
        const targetTangent = tangentCoordinate + tangentAdjustment;
        if (targetTangent + tangentRadius < boundaryMinT
          || targetTangent - tangentRadius > boundaryMaxT) return;
        candidates.push({
          key: `${boundary.id}:${object.id}:${side}:${snapType}:${contactTangentCoordinateM.toFixed(6)}`,
          boundary,
          adjustmentXM: normal.xM * normalAdjustment + tangent.xM * tangentAdjustment,
          adjustmentYM: normal.yM * normalAdjustment + tangent.yM * tangentAdjustment,
          normal,
          tangent,
          faceCoordinateM,
          contactTangentCoordinateM,
          object,
          normalRadiusM: normalRadius,
          side,
          snapType,
          rotationDeg,
        });
      };

      const gridTangent = Number.isFinite(snapStepM) && snapStepM > 0
        ? Math.round(tangentCoordinate / snapStepM) * snapStepM
        : tangentCoordinate;
      addCandidate(
        rotationDeg === null ? "wall" : "parallel",
        gridTangent - tangentCoordinate,
        clamp(gridTangent, boundaryMinT, boundaryMaxT),
      );

      const centerAdjustment = boundaryMidT - tangentCoordinate;
      if (Math.abs(centerAdjustment) <= toleranceM) {
        addCandidate("center", centerAdjustment, boundaryMidT);
      }

      const isEllipse = workingObject.kind === "custom-circle" || workingObject.kind === "custom-oval";
      if (!isEllipse) {
        const cornerTargets = [
          { centerT: boundaryMinT + tangentRadius, contactT: boundaryMinT },
          { centerT: boundaryMaxT - tangentRadius, contactT: boundaryMaxT },
        ];
        for (const corner of cornerTargets) {
          const cornerAdjustment = corner.centerT - tangentCoordinate;
          if (Math.abs(cornerAdjustment) <= toleranceM) {
            addCandidate("corner", cornerAdjustment, corner.contactT);
          }
        }
      }
    }
  }
  return candidates;
}

function resolveGridDelta(
  objects: readonly PlanObject[],
  rawDeltaXM: number,
  rawDeltaYM: number,
  snapStepM: number,
): { deltaXM: number; deltaYM: number } {
  const bounds = getObjectsBounds(objects);
  if (!bounds || !Number.isFinite(snapStepM) || snapStepM <= 0) {
    return { deltaXM: rawDeltaXM, deltaYM: rawDeltaYM };
  }
  const targetX = Math.round((bounds.centerXM + rawDeltaXM) / snapStepM) * snapStepM;
  const targetY = Math.round((bounds.centerYM + rawDeltaYM) / snapStepM) * snapStepM;
  return { deltaXM: targetX - bounds.centerXM, deltaYM: targetY - bounds.centerYM };
}

export function resolveMoveSnap(input: ResolveMoveSnapInput): SnapResolution {
  const {
    objects,
    otherObjects = [],
    rawDeltaXM,
    rawDeltaYM,
    boundaries,
    snapEnabled,
    snapStepM,
    unitsPerMeter,
    zoom,
    wallOffsetM = 0,
    autoRotateFurniture = false,
    autoRotatePartitions = true,
    candidateIndex = 0,
    activeBoundaryId = null,
    snappingDisabled = false,
  } = input;
  if (objects.length === 0 || !snapEnabled || snappingDisabled) {
    return {
      deltaXM: rawDeltaXM,
      deltaYM: rawDeltaYM,
      activeBoundaryId: null,
      guide: null,
      rotations: {},
    };
  }

  const acquireToleranceM = getToleranceM(
    ACQUIRE_PX,
    unitsPerMeter,
    zoom,
    MIN_ACQUIRE_M,
    MAX_ACQUIRE_M,
  );
  const releaseToleranceM = getToleranceM(
    RELEASE_PX,
    unitsPerMeter,
    zoom,
    MIN_RELEASE_M,
    MAX_RELEASE_M,
  );

  const candidates: SnapCandidate[] = [];
  if (activeBoundaryId) {
    const active = boundaries.find((boundary) => boundary.id === activeBoundaryId);
    if (active) {
      candidates.push(...findBoundaryCandidates(
        objects,
        active,
        rawDeltaXM,
        rawDeltaYM,
        releaseToleranceM,
        snapStepM,
        wallOffsetM,
        autoRotateFurniture,
        autoRotatePartitions,
      ));
    }
  }
  for (const boundary of boundaries) {
    candidates.push(...findBoundaryCandidates(
      objects,
      boundary,
      rawDeltaXM,
      rawDeltaYM,
      acquireToleranceM,
      snapStepM,
      wallOffsetM,
      autoRotateFurniture,
      autoRotatePartitions,
    ));
  }

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.key, candidate])).values()]
    .sort((left, right) => candidateMagnitude(left) - candidateMagnitude(right));
  if (uniqueCandidates.length === 0) {
    const objectSnap = resolveObjectSnap(
      objects,
      otherObjects,
      rawDeltaXM,
      rawDeltaYM,
      acquireToleranceM,
      candidateIndex,
    );
    if (objectSnap) {
      return {
        deltaXM: objectSnap.deltaXM,
        deltaYM: objectSnap.deltaYM,
        activeBoundaryId: null,
        guide: objectSnap.guide,
        rotations: {},
      };
    }
    const grid = resolveGridDelta(objects, rawDeltaXM, rawDeltaYM, snapStepM);
    return { ...grid, activeBoundaryId: null, guide: null, rotations: {} };
  }

  const normalizedCandidateIndex = ((candidateIndex % uniqueCandidates.length) + uniqueCandidates.length)
    % uniqueCandidates.length;
  const candidate = uniqueCandidates[normalizedCandidateIndex];
  const deltaXM = rawDeltaXM + candidate.adjustmentXM;
  const deltaYM = rawDeltaYM + candidate.adjustmentYM;
  const to = {
    xM: candidate.normal.xM * candidate.faceCoordinateM
      + candidate.tangent.xM * candidate.contactTangentCoordinateM,
    yM: candidate.normal.yM * candidate.faceCoordinateM
      + candidate.tangent.yM * candidate.contactTangentCoordinateM,
  };
  const from = {
    xM: to.xM + candidate.normal.xM * candidate.side * wallOffsetM,
    yM: to.yM + candidate.normal.yM * candidate.side * wallOffsetM,
  };
  return {
    deltaXM,
    deltaYM,
    activeBoundaryId: candidate.boundary.id,
    rotations: candidate.rotationDeg === null ? {} : { [candidate.object.id]: candidate.rotationDeg },
    guide: {
      boundary: candidate.boundary,
      from,
      to,
      distanceM: wallOffsetM,
      snapType: candidate.snapType,
      candidateIndex: normalizedCandidateIndex,
      candidateCount: uniqueCandidates.length,
    },
  };
}
