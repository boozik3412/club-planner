import type {
  ArchitectureValueSource,
  ObjectId,
  PointM,
} from "../model/types";
import type { BoundaryKind, BoundarySource } from "../snapping/types";
import type { OpeningKind } from "../semantics/types";

export interface HeightRegion {
  id: string;
  name: string;
  polygon: PointM[];
  floorElevationM: number;
  ceilingHeightM: number;
  source: Extract<ArchitectureValueSource, "measurement" | "user">;
}

export interface ResolvedArchitecturalWall {
  id: string;
  kind: BoundaryKind;
  start: PointM;
  end: PointM;
  thicknessM: number;
  heightM: number;
  baseElevationM: number;
  heightSource: ArchitectureValueSource;
  thicknessSource: ArchitectureValueSource;
  source: BoundarySource;
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
  source: "base-plan" | "project-object";
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
