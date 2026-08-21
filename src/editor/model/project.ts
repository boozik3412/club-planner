import {
  BASE_PLAN_ASSET,
  BASE_PLAN_ID,
  BASE_PLAN_SHA256,
  BLANK_PLAN_ASSET,
  BLANK_PLAN_ID,
  BLANK_PLAN_SHA256,
  CLUBPLAN_FORMAT,
  CLUBPLAN_FORMAT_VERSION,
  type ObjectId,
  type PlanObject,
  type ProjectState,
} from "./types";
import { APP_VERSION } from "../../app-version";
import { createBundledArchitecture } from "../architecture/base-architecture";
import { createStableId } from "./templates";

export const PLAN_UNITS_PER_METER = 377.952755906;
export const PLAN_WIDTH_M = 23_569.5996 / PLAN_UNITS_PER_METER;
export const PLAN_HEIGHT_M = 2_752.6399 / PLAN_UNITS_PER_METER;
export const BLANK_PLAN_WIDTH_M = 40;
export const BLANK_PLAN_HEIGHT_M = 30;
export const BLANK_PLAN_UNITS_PER_METER = 100;

export function normalizeAngle(angleDeg: number): number {
  return ((angleDeg % 360) + 360) % 360;
}

export function snapMeters(value: number, enabled: boolean, stepM: number): number {
  if (!enabled || !Number.isFinite(stepM) || stepM <= 0) return value;
  return Math.round(value / stepM) * stepM;
}

export function cloneProject(project: ProjectState): ProjectState {
  return structuredClone(project);
}

export function createEmptyProject(
  now = new Date().toISOString(),
  projectId = createStableId("project"),
): ProjectState {
  const basePlan = {
    id: BLANK_PLAN_ID,
    asset: BLANK_PLAN_ASSET,
    widthM: BLANK_PLAN_WIDTH_M,
    heightM: BLANK_PLAN_HEIGHT_M,
    unitsPerMeter: BLANK_PLAN_UNITS_PER_METER,
    sha256: BLANK_PLAN_SHA256,
  };
  return {
    format: CLUBPLAN_FORMAT,
    formatVersion: CLUBPLAN_FORMAT_VERSION,
    generator: { name: "Club Planner", version: APP_VERSION },
    project: { id: projectId, createdAt: now, modifiedAt: now },
    basePlan,
    planSources: [{
      id: BLANK_PLAN_ID,
      kind: "bundled-svg",
      name: "Пустой лист",
      mimeType: "image/svg+xml",
      sha256: BLANK_PLAN_SHA256,
      embeddedPath: `sources/${BLANK_PLAN_ASSET}`,
      widthM: BLANK_PLAN_WIDTH_M,
      heightM: BLANK_PLAN_HEIGHT_M,
      rotationDeg: 0,
      locked: true,
    }],
    activePlanSourceId: BLANK_PLAN_ID,
    canvas: {
      rotationDeg: 0,
      gridVisible: true,
      gridStepM: 0.5,
      snapEnabled: true,
      snapStepM: 0.1,
      wallSnapOffsetM: 0,
      autoRotateFurnitureToWall: false,
      autoRotatePartitionsToWall: true,
      semanticLayerVisible: true,
      clearanceWarningsVisible: true,
      minimumPassageWidthM: 1,
      basePlanVisible: false,
      planLabelsVisible: true,
      objectLabelsVisible: true,
      basePlanOpacity: 0.82,
    },
    architecture: {
      defaultWallHeightM: 3,
      defaultWallThicknessM: 0.15,
      vertices: [],
      walls: [],
      openings: [],
      heightRegions: [],
    },
    layers: [
      { id: "equipment", name: "Оборудование", visible: true, locked: false },
      { id: "furniture", name: "Мебель", visible: true, locked: false },
      { id: "zones", name: "Зоны", visible: true, locked: false },
    ],
    objects: [],
    groups: [],
    dimensions: [],
    customTemplates: [],
  };
}

/** Preserves the historical bundled measurement for migrated legacy projects. */
export function createBundledProject(
  now = new Date().toISOString(),
  projectId = createStableId("project"),
): ProjectState {
  const project = createEmptyProject(now, projectId);
  project.basePlan = {
    id: BASE_PLAN_ID,
    asset: BASE_PLAN_ASSET,
    widthM: PLAN_WIDTH_M,
    heightM: PLAN_HEIGHT_M,
    unitsPerMeter: PLAN_UNITS_PER_METER,
    sha256: BASE_PLAN_SHA256,
  };
  project.planSources = [{
    id: BASE_PLAN_ID,
    kind: "bundled-svg",
    name: "Актуальный обмер 2026",
    mimeType: "image/svg+xml",
    sha256: BASE_PLAN_SHA256,
    embeddedPath: `sources/${BASE_PLAN_ASSET}`,
    widthM: PLAN_WIDTH_M,
    heightM: PLAN_HEIGHT_M,
    rotationDeg: 0,
    locked: true,
  }];
  project.activePlanSourceId = BASE_PLAN_ID;
  project.canvas.basePlanVisible = true;
  project.architecture = createBundledArchitecture(project.basePlan);
  return project;
}

export function updateProject(
  project: ProjectState,
  mutation: (draft: ProjectState) => void,
  modifiedAt = new Date().toISOString(),
): ProjectState {
  const next = cloneProject(project);
  mutation(next);
  next.project.modifiedAt = modifiedAt;
  return next;
}

export function getObjectMap(project: ProjectState): Map<ObjectId, PlanObject> {
  return new Map(project.objects.map((object) => [object.id, object]));
}

export function isObjectEditable(project: ProjectState, object: PlanObject): boolean {
  const layer = project.layers.find((candidate) => candidate.id === object.layerId);
  return !object.locked && !layer?.locked && layer?.visible !== false;
}

export function normalizeProjectAngles(project: ProjectState): ProjectState {
  return updateProject(project, (draft) => {
    draft.canvas.rotationDeg = normalizeAngle(draft.canvas.rotationDeg);
    for (const object of draft.objects) {
      object.rotationDeg = normalizeAngle(object.rotationDeg);
    }
  });
}
