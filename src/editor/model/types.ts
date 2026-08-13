export const CLUBPLAN_FORMAT = "clubplan" as const;
export const CLUBPLAN_FORMAT_VERSION = 3 as const;
export const BASE_PLAN_ID = "measurement-2026-08-10";
export const BASE_PLAN_ASSET = "base_plan_new_measurement.svg";
export const BASE_PLAN_SHA256 =
  "b3aa3f1edfe4ff58bd10afcb95138cd6f661d537e93d51e751577540841d42d5";

export type ObjectId = string;
export type GroupId = string;
export type LayerId = "equipment" | "furniture" | "zones" | string;

export type ObjectType =
  | "pc1"
  | "pc2"
  | "pc5"
  | "computer"
  | "gaming-chair"
  | "table"
  | "sofa"
  | "armchair"
  | "console"
  | "reception"
  | "bar"
  | "server"
  | "partition"
  | "zone"
  | "custom-rectangle"
  | "custom-circle"
  | "custom-oval"
  | "door"
  | "window";

export type ObjectKind =
  | "pc"
  | "computer"
  | "gaming-chair"
  | "table"
  | "sofa"
  | "armchair"
  | "console"
  | "reception"
  | "bar"
  | "server"
  | "partition"
  | "zone"
  | "custom-rectangle"
  | "custom-circle"
  | "custom-oval"
  | "door"
  | "window";

export interface ProjectMetadata {
  id: string;
  createdAt: string;
  modifiedAt: string;
}

export interface BasePlanRef {
  id: string;
  asset: string;
  widthM: number;
  heightM: number;
  unitsPerMeter: number;
  sha256: string;
}

export interface CanvasSettings {
  rotationDeg: number;
  gridVisible: boolean;
  gridStepM: number;
  snapEnabled: boolean;
  snapStepM: number;
  wallSnapOffsetM: number;
  autoRotateFurnitureToWall: boolean;
  autoRotatePartitionsToWall: boolean;
  semanticLayerVisible: boolean;
  clearanceWarningsVisible: boolean;
  minimumPassageWidthM: number;
  basePlanVisible: boolean;
  planLabelsVisible: boolean;
  objectLabelsVisible: boolean;
  basePlanOpacity: number;
}

export type ArchitectureValueSource = "measurement" | "region" | "default" | "user";

export interface WallArchitectureOverride {
  heightM?: number;
  thicknessM?: number;
  baseElevationM?: number;
}

export interface ArchitectureSettings {
  defaultWallHeightM: number;
  defaultWallThicknessM: number;
  wallOverrides: Record<string, WallArchitectureOverride>;
}

export interface Layer {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface PlanObject {
  id: ObjectId;
  type: ObjectType;
  kind: ObjectKind;
  name: string;
  xM: number;
  yM: number;
  widthM: number;
  depthM: number;
  heightM: number;
  elevationM: number;
  rotationDeg: number;
  flipX?: boolean;
  flipY?: boolean;
  layerId: LayerId;
  locked: boolean;
  labelVisible: boolean;
  style?: { fill?: string };
  properties?: {
    seats?: number;
    doorSwing?: "left" | "right";
    openingAngleDeg?: number;
  };
}

export interface ObjectGroup {
  id: GroupId;
  name: string;
  objectIds: ObjectId[];
  locked: boolean;
}

export interface ProjectDimension {
  id: string;
  name: string;
  start: PointM;
  end: PointM;
  labelVisible: boolean;
}

export interface CompositeTemplateItem {
  offsetXM: number;
  offsetYM: number;
  object: Omit<PlanObject, "id" | "xM" | "yM" | "locked">;
}

export interface CompositeTemplate {
  id: string;
  name: string;
  items: CompositeTemplateItem[];
}

export interface ProjectState {
  format: typeof CLUBPLAN_FORMAT;
  formatVersion: typeof CLUBPLAN_FORMAT_VERSION;
  generator: {
    name: "Club Planner";
    version: string;
  };
  project: ProjectMetadata;
  basePlan: BasePlanRef;
  canvas: CanvasSettings;
  architecture: ArchitectureSettings;
  layers: Layer[];
  objects: PlanObject[];
  groups: ObjectGroup[];
  dimensions: ProjectDimension[];
  customTemplates: CompositeTemplate[];
}

export interface SelectionState {
  objectIds: ObjectId[];
  groupIds: GroupId[];
  groupEditId: GroupId | null;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface PointM {
  xM: number;
  yM: number;
}

export interface BoundsM {
  minXM: number;
  minYM: number;
  maxXM: number;
  maxYM: number;
  widthM: number;
  heightM: number;
  centerXM: number;
  centerYM: number;
}

export const EMPTY_SELECTION: SelectionState = {
  objectIds: [],
  groupIds: [],
  groupEditId: null,
};
