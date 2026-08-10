import type { ProjectState } from "../model/types";
import type { LayoutWarning } from "./layout-analysis";

export interface ProjectSummary {
  seats: number;
  objectCount: number;
  zoneAreaM2: number;
  seatDensityPerM2: number | null;
  warningCount: number;
}

export function summarizeProject(
  project: ProjectState,
  warnings: readonly LayoutWarning[],
): ProjectSummary {
  const seats = project.objects.reduce((sum, object) => sum + (object.properties?.seats ?? 0), 0);
  const zoneAreaM2 = project.objects
    .filter((object) => object.kind === "zone")
    .reduce((sum, object) => sum + object.widthM * object.depthM, 0);
  return {
    seats,
    objectCount: project.objects.length,
    zoneAreaM2,
    seatDensityPerM2: zoneAreaM2 > 0 ? seats / zoneAreaM2 : null,
    warningCount: warnings.length,
  };
}
