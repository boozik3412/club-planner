import type {
  ArchitecturalWallCurve,
  ArchitectureHeightRegion,
  ArchitectureProvenance,
  ArchitectureValueSource,
  ObjectId,
  PointM,
  RecognitionReviewStatus,
} from "../model/types";
import type { BoundaryKind, BoundarySource } from "../snapping/types";
import type { OpeningKind } from "../semantics/types";

export type HeightRegion = ArchitectureHeightRegion;

export interface ResolvedArchitecturalWall {
  id: string;
  kind: BoundaryKind;
  start: PointM;
  end: PointM;
  curve?: ArchitecturalWallCurve;
  thicknessM: number;
  heightM: number;
  baseElevationM: number;
  heightSource: ArchitectureValueSource;
  thicknessSource: ArchitectureValueSource;
  source: BoundarySource;
  provenance?: ArchitectureProvenance | "project-object";
  confidence?: number;
  reviewStatus?: RecognitionReviewStatus;
  locked?: boolean;
  sourceObjectId?: ObjectId;
}

export interface ResolvedArchitecturalOpening {
  id: string;
  kind: OpeningKind;
  start: PointM;
  end: PointM;
  hostWallId: string | null;
  sillHeightM: number;
  openingHeightM: number;
  verticalSource: ArchitectureValueSource;
  source: "base-plan" | "project-architecture" | "project-object";
  provenance?: ArchitectureProvenance | "project-object";
  confidence?: number;
  reviewStatus?: RecognitionReviewStatus;
  locked?: boolean;
  sourceObjectId?: ObjectId;
  swing?: "left" | "right";
  openingAngleDeg?: number;
}

export interface ResolvedArchitecture {
  walls: ResolvedArchitecturalWall[];
  openings: ResolvedArchitecturalOpening[];
  heightRegions: HeightRegion[];
}

export interface ArchitectureValidationIssue {
  id: string;
  severity: "warning" | "error";
  message: string;
  wallId?: string;
  openingId?: string;
}
