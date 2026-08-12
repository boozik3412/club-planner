import type { LayoutWarning } from "../analysis/layout-analysis";
import { resolveArchitecture } from "../architecture/resolve-architecture";
import type {
  ArchitectureValidationIssue,
  ResolvedArchitecturalOpening,
  ResolvedArchitecturalWall,
} from "../architecture/types";
import { validateArchitecture } from "../architecture/validate";
import type { ObjectKind, ProjectState } from "../model/types";
import { buildWallSolids, type WallSolid } from "./wall-solids";

export interface SceneObjectVolume {
  id: string;
  name: string;
  kind: ObjectKind;
  shape: "box" | "cylinder" | "oval";
  centerXM: number;
  centerYM: number;
  centerZM: number;
  widthM: number;
  heightM: number;
  depthM: number;
  rotationYRad: number;
  color: string;
  warning: boolean;
}

export interface SceneOpeningPanel {
  id: string;
  kind: "door" | "window";
  centerXM: number;
  centerYM: number;
  centerZM: number;
  widthM: number;
  heightM: number;
  depthM: number;
  rotationYRad: number;
  sourceObjectId?: string;
}

export interface SceneModel {
  walls: ResolvedArchitecturalWall[];
  wallSolids: WallSolid[];
  openings: SceneOpeningPanel[];
  objects: SceneObjectVolume[];
  issues: ArchitectureValidationIssue[];
  widthM: number;
  depthM: number;
  centerXM: number;
  centerZM: number;
  ceilingHeightM: number;
}

function openingPanel(opening: ResolvedArchitecturalOpening, wallMap: ReadonlyMap<string, ResolvedArchitecturalWall>): SceneOpeningPanel {
  const dx = opening.end.xM - opening.start.xM;
  const dz = opening.end.yM - opening.start.yM;
  const wall = opening.hostWallId ? wallMap.get(opening.hostWallId) : undefined;
  const baseElevationM = wall?.baseElevationM ?? 0;
  return {
    id: opening.id,
    kind: opening.kind,
    centerXM: (opening.start.xM + opening.end.xM) / 2,
    centerYM: baseElevationM + opening.sillHeightM + opening.openingHeightM / 2,
    centerZM: (opening.start.yM + opening.end.yM) / 2,
    widthM: Math.hypot(dx, dz),
    heightM: opening.openingHeightM,
    depthM: Math.max(0.04, wall?.thicknessM ? wall.thicknessM * 0.45 : 0.06),
    rotationYRad: -Math.atan2(dz, dx),
    sourceObjectId: opening.sourceObjectId,
  };
}

export function buildSceneModel(
  project: ProjectState,
  layoutWarnings: readonly LayoutWarning[] = [],
): SceneModel {
  const architecture = resolveArchitecture(project);
  const issues = validateArchitecture(architecture);
  const wallMap = new Map(architecture.walls.map((wall) => [wall.id, wall]));
  const warnedObjectIds = new Set(layoutWarnings.flatMap((warning) => warning.objectIds));
  return {
    walls: architecture.walls,
    wallSolids: architecture.walls.flatMap((wall) => buildWallSolids(wall, architecture.openings)),
    openings: architecture.openings.map((opening) => openingPanel(opening, wallMap)),
    objects: project.objects
      .filter((object) => object.kind !== "door" && object.kind !== "window" && object.kind !== "partition")
      .map((object) => ({
        id: object.id,
        name: object.name,
        kind: object.kind,
        shape: object.kind === "custom-circle"
          ? "cylinder"
          : object.kind === "custom-oval"
            ? "oval"
            : "box",
        centerXM: object.xM,
        centerYM: object.elevationM + object.heightM / 2,
        centerZM: object.yM,
        widthM: object.widthM,
        heightM: object.heightM,
        depthM: object.depthM,
        rotationYRad: -object.rotationDeg * Math.PI / 180,
        color: object.style?.fill ?? "#cbd5e1",
        warning: warnedObjectIds.has(object.id),
      })),
    issues,
    widthM: project.basePlan.widthM,
    depthM: project.basePlan.heightM,
    centerXM: project.basePlan.widthM / 2,
    centerZM: project.basePlan.heightM / 2,
    ceilingHeightM: project.architecture.defaultWallHeightM,
  };
}
