export const CLUBPLAN_FORMAT = "clubplan" as const;
export const CLUBPLAN_FORMAT_VERSION = 1 as const;
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
  | "zone";

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
  | "zone";

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
  basePlanVisible: boolean;
  planLabelsVisible: boolean;
  objectLabelsVisible: boolean;
  basePlanOpacity: number;
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
  rotationDeg: number;
  layerId: LayerId;
  locked: boolean;
  labelVisible: boolean;
  style?: { fill?: string };
  properties?: { seats?: number };
}

export interface ObjectGroup {
  id: GroupId;
  name: string;
  objectIds: ObjectId[];
  locked: boolean;
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
  layers: Layer[];
  objects: PlanObject[];
  groups: ObjectGroup[];
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
