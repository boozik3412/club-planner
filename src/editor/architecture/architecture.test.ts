import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { resolveArchitecture } from "./resolve-architecture";
import { validateArchitecture } from "./validate";

describe("architectural height resolution", () => {
  it("uses measured thicknesses and explicit fallbacks for zero-width source walls", () => {
    const project = createEmptyProject();
    const architecture = resolveArchitecture(project);
    const inferred = architecture.walls.find((wall) => wall.id === "wall-main-top");
    const measured = architecture.walls.find((wall) => wall.id === "wall-mid-left");

    expect(inferred).toMatchObject({
      heightM: 3.04,
      thicknessM: 0.15,
      heightSource: "region",
      thicknessSource: "default",
    });
    expect(measured).toMatchObject({ thicknessM: 0.32004, thicknessSource: "measurement" });
  });

  it("applies per-wall overrides without changing the semantic centerline", () => {
    const project = createEmptyProject();
    project.architecture.wallOverrides["wall-main-top"] = {
      heightM: 2.7,
      thicknessM: 0.22,
      baseElevationM: 0.15,
    };
    const wall = resolveArchitecture(project).walls.find((candidate) => candidate.id === "wall-main-top");

    expect(wall).toMatchObject({
      heightM: 2.7,
      thicknessM: 0.22,
      baseElevationM: 0.15,
      heightSource: "user",
      thicknessSource: "user",
    });
    expect(wall?.start).toEqual({ xM: 6.82498, yM: 0.91694 });
  });

  it("resolves project partitions from their physical height and elevation", () => {
    const project = createEmptyProject();
    project.objects = [{
      ...createObjectFromTemplate("partition", 12, 4, "partition-user"),
      heightM: 1.4,
      elevationM: 0.2,
    }];
    const wall = resolveArchitecture(project).walls.find((candidate) => candidate.sourceObjectId === "partition-user");
    expect(wall).toMatchObject({
      heightM: 1.4,
      baseElevationM: 0.2,
      thicknessM: 0.12,
      source: "project-object",
    });
  });

  it("validates all curated base openings", () => {
    const architecture = resolveArchitecture(createEmptyProject());
    expect(validateArchitecture(architecture)).toEqual([]);
  });

  it("reports an opening that is taller than its host wall", () => {
    const architecture = resolveArchitecture(createEmptyProject());
    architecture.openings[0].openingHeightM = 4;
    expect(validateArchitecture(architecture)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `opening-height:${architecture.openings[0].id}`, severity: "error" }),
    ]));
  });
});
