import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { analyzeLayout, getClearanceBounds } from "./layout-analysis";
import { summarizeProject } from "./project-summary";

describe("layout analysis and project summary", () => {
  it("detects collisions and narrow passages", () => {
    const project = createEmptyProject();
    project.objects = [
      createObjectFromTemplate("table", 20, 3, "first"),
      createObjectFromTemplate("table", 20.5, 3, "second"),
      createObjectFromTemplate("table", 23, 3, "third"),
    ];
    project.canvas.minimumPassageWidthM = 2;
    const warnings = analyzeLayout(project);
    expect(warnings.some((warning) => warning.kind === "collision")).toBe(true);
    expect(warnings.some((warning) => warning.kind === "passage")).toBe(true);
  });

  it("expands clearance bounds by half the required passage on each side", () => {
    const object = createObjectFromTemplate("table", 20, 3, "table");
    const bounds = getClearanceBounds(object, 1);
    expect(bounds?.widthM).toBeCloseTo(object.widthM + 1);
    expect(bounds?.heightM).toBeCloseTo(object.depthM + 1);
  });

  it("summarizes seats, zone area, density and warnings", () => {
    const project = createEmptyProject();
    project.objects = [
      createObjectFromTemplate("pc2", 20, 3, "pc"),
      { ...createObjectFromTemplate("zone", 20, 5, "zone"), widthM: 4, depthM: 5 },
    ];
    const summary = summarizeProject(project, [{
      id: "warning",
      kind: "passage",
      objectIds: ["pc"],
      message: "warning",
    }]);
    expect(summary).toMatchObject({ seats: 2, objectCount: 2, zoneAreaM2: 20, warningCount: 1 });
    expect(summary.seatDensityPerM2).toBeCloseTo(0.1);
  });
});
