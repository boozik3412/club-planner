import { createEmptyProject } from "../model/project";
import type { ProjectState } from "../model/types";
import type { RecognitionDraft } from "./types";

export function createProjectFromRecognitionDraft(draft: RecognitionDraft): ProjectState {
  const project = createEmptyProject();
  project.basePlan = {
    id: draft.source.id,
    asset: draft.source.previewPath ?? draft.source.embeddedPath,
    widthM: draft.source.widthM,
    heightM: draft.source.heightM,
    unitsPerMeter: 100,
    sha256: draft.source.sha256,
  };
  project.planSources = [structuredClone(draft.source)];
  project.activePlanSourceId = draft.source.id;
  project.architecture.vertices = structuredClone(draft.vertices);
  project.architecture.walls = structuredClone(draft.walls);
  project.architecture.openings = structuredClone(draft.openings);
  project.architecture.heightRegions = [];
  project.architecture.defaultWallHeightM = draft.walls[0]?.heightM ?? project.architecture.defaultWallHeightM;
  project.architecture.defaultWallThicknessM = draft.walls[0]?.thicknessM ?? project.architecture.defaultWallThicknessM;
  project.canvas.semanticLayerVisible = true;
  project.canvas.basePlanVisible = true;
  project.canvas.basePlanOpacity = 0.45;
  project.project.modifiedAt = new Date().toISOString();
  return project;
}
