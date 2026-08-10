import { getObjectsBounds } from "../geometry/geometry";
import type { BoundsM, PlanObject, PointM } from "../model/types";
import type { SnapGuide } from "./types";

interface ObjectSnapCandidate {
  deltaXM: number;
  deltaYM: number;
  guide: Omit<SnapGuide, "candidateIndex" | "candidateCount">;
}

export interface ObjectSnapResult {
  deltaXM: number;
  deltaYM: number;
  guide: SnapGuide;
}

function movedBounds(bounds: BoundsM, deltaXM: number, deltaYM: number): BoundsM {
  return {
    ...bounds,
    minXM: bounds.minXM + deltaXM,
    maxXM: bounds.maxXM + deltaXM,
    minYM: bounds.minYM + deltaYM,
    maxYM: bounds.maxYM + deltaYM,
    centerXM: bounds.centerXM + deltaXM,
    centerYM: bounds.centerYM + deltaYM,
  };
}

function candidateMagnitude(candidate: ObjectSnapCandidate): number {
  return Math.hypot(candidate.deltaXM, candidate.deltaYM);
}

function guideLine(
  snapType: SnapGuide["snapType"],
  from: PointM,
  to: PointM,
  distanceM = 0,
): ObjectSnapCandidate["guide"] {
  return { snapType, from, to, distanceM };
}

function isSnapTarget(object: PlanObject): boolean {
  return object.kind !== "zone" && object.kind !== "door" && object.kind !== "window";
}

export function resolveObjectSnap(
  movingObjects: readonly PlanObject[],
  otherObjects: readonly PlanObject[],
  rawDeltaXM: number,
  rawDeltaYM: number,
  toleranceM: number,
  candidateIndex: number,
): ObjectSnapResult | null {
  const baseBounds = getObjectsBounds(movingObjects);
  if (!baseBounds) return null;
  const moving = movedBounds(baseBounds, rawDeltaXM, rawDeltaYM);
  const targets = otherObjects.filter(isSnapTarget).flatMap((object) => {
    const bounds = getObjectsBounds([object]);
    return bounds ? [{ object, bounds }] : [];
  });
  const candidates: ObjectSnapCandidate[] = [];

  for (const target of targets) {
    const xAlignments = [
      target.bounds.minXM - moving.maxXM,
      target.bounds.maxXM - moving.minXM,
    ];
    for (const adjustment of xAlignments) {
      if (Math.abs(adjustment) > 1e-9 && Math.abs(adjustment) <= toleranceM) {
        const xM = adjustment > 0 ? target.bounds.minXM : target.bounds.maxXM;
        candidates.push({
          deltaXM: rawDeltaXM + adjustment,
          deltaYM: rawDeltaYM,
          guide: guideLine(
            "object-edge",
            { xM, yM: moving.centerYM },
            { xM, yM: target.bounds.centerYM },
          ),
        });
      }
    }
    const yAlignments = [
      target.bounds.minYM - moving.maxYM,
      target.bounds.maxYM - moving.minYM,
    ];
    for (const adjustment of yAlignments) {
      if (Math.abs(adjustment) > 1e-9 && Math.abs(adjustment) <= toleranceM) {
        const yM = adjustment > 0 ? target.bounds.minYM : target.bounds.maxYM;
        candidates.push({
          deltaXM: rawDeltaXM,
          deltaYM: rawDeltaYM + adjustment,
          guide: guideLine(
            "object-edge",
            { xM: moving.centerXM, yM },
            { xM: target.bounds.centerXM, yM },
          ),
        });
      }
    }
    const centerAdjustmentX = target.bounds.centerXM - moving.centerXM;
    if (Math.abs(centerAdjustmentX) > 1e-9 && Math.abs(centerAdjustmentX) <= toleranceM) {
      candidates.push({
        deltaXM: rawDeltaXM + centerAdjustmentX,
        deltaYM: rawDeltaYM,
        guide: guideLine(
          "object-center",
          { xM: target.bounds.centerXM, yM: moving.centerYM },
          { xM: target.bounds.centerXM, yM: target.bounds.centerYM },
        ),
      });
    }
    const centerAdjustmentY = target.bounds.centerYM - moving.centerYM;
    if (Math.abs(centerAdjustmentY) > 1e-9 && Math.abs(centerAdjustmentY) <= toleranceM) {
      candidates.push({
        deltaXM: rawDeltaXM,
        deltaYM: rawDeltaYM + centerAdjustmentY,
        guide: guideLine(
          "object-center",
          { xM: moving.centerXM, yM: target.bounds.centerYM },
          { xM: target.bounds.centerXM, yM: target.bounds.centerYM },
        ),
      });
    }
  }

  for (let firstIndex = 0; firstIndex < targets.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < targets.length; secondIndex += 1) {
      const first = targets[firstIndex].bounds;
      const second = targets[secondIndex].bounds;
      const left = first.centerXM <= second.centerXM ? first : second;
      const right = left === first ? second : first;
      const freeX = right.minXM - left.maxXM - moving.widthM;
      if (freeX >= 0) {
        const targetCenterX = (left.maxXM + right.minXM) / 2;
        const adjustment = targetCenterX - moving.centerXM;
        if (Math.abs(adjustment) <= toleranceM) {
          candidates.push({
            deltaXM: rawDeltaXM + adjustment,
            deltaYM: rawDeltaYM,
            guide: guideLine(
              "equal-gap",
              { xM: left.maxXM, yM: moving.centerYM },
              { xM: right.minXM, yM: moving.centerYM },
              freeX / 2,
            ),
          });
        }
      }
      const top = first.centerYM <= second.centerYM ? first : second;
      const bottom = top === first ? second : first;
      const freeY = bottom.minYM - top.maxYM - moving.heightM;
      if (freeY >= 0) {
        const targetCenterY = (top.maxYM + bottom.minYM) / 2;
        const adjustment = targetCenterY - moving.centerYM;
        if (Math.abs(adjustment) <= toleranceM) {
          candidates.push({
            deltaXM: rawDeltaXM,
            deltaYM: rawDeltaYM + adjustment,
            guide: guideLine(
              "equal-gap",
              { xM: moving.centerXM, yM: top.maxYM },
              { xM: moving.centerXM, yM: bottom.minYM },
              freeY / 2,
            ),
          });
        }
      }
    }
  }

  candidates.sort((left, right) => candidateMagnitude({
    ...left,
    deltaXM: left.deltaXM - rawDeltaXM,
    deltaYM: left.deltaYM - rawDeltaYM,
  }) - candidateMagnitude({
    ...right,
    deltaXM: right.deltaXM - rawDeltaXM,
    deltaYM: right.deltaYM - rawDeltaYM,
  }));
  if (candidates.length === 0) return null;
  const normalizedIndex = ((candidateIndex % candidates.length) + candidates.length) % candidates.length;
  const candidate = candidates[normalizedIndex];
  return {
    deltaXM: candidate.deltaXM,
    deltaYM: candidate.deltaYM,
    guide: {
      ...candidate.guide,
      candidateIndex: normalizedIndex,
      candidateCount: candidates.length,
    },
  };
}
