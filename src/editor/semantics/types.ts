import type { ObjectId, PointM } from "../model/types";

export type OpeningKind = "door" | "window";

export interface SemanticOpening {
  id: string;
  kind: OpeningKind;
  start: PointM;
  end: PointM;
  source: "base-plan" | "project-architecture" | "project-object";
  sourceObjectId?: ObjectId;
  swing?: "left" | "right";
  openingAngleDeg?: number;
}

export interface DoorSwingGeometry {
  pivot: PointM;
  closedEnd: PointM;
  openEnd: PointM;
  radiusM: number;
  clockwise: boolean;
}
