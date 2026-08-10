import type { ObjectId, PointM } from "../model/types";

export type BoundaryKind = "wall" | "partition";
export type BoundarySource = "base-plan" | "project-object";

export interface PlanBoundary {
  id: string;
  kind: BoundaryKind;
  start: PointM;
  end: PointM;
  thicknessM: number;
  source: BoundarySource;
  sourceObjectId?: ObjectId;
}

export interface SnapGuide {
  boundary: PlanBoundary;
  from: PointM;
  to: PointM;
  distanceM: number;
  snapType: "wall" | "center" | "corner" | "parallel";
  candidateIndex: number;
  candidateCount: number;
}

export interface SnapResolution {
  deltaXM: number;
  deltaYM: number;
  activeBoundaryId: string | null;
  guide: SnapGuide | null;
  rotations: Record<ObjectId, number>;
}

export type BetweenBoundariesMode = "center" | "distribute" | "fill";

export interface BetweenBoundariesRequest {
  id: number;
  mode: BetweenBoundariesMode;
}
