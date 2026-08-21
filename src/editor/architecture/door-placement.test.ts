import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import { resolveDoorPlacement } from "./door-placement";

describe("door placement", () => {
  it("projects the pointer onto the nearest editable partition", () => {
    const project = createEmptyProject();
    project.objects = [{
      ...createObjectFromTemplate("partition", 5, 4, "partition"),
      widthM: 4,
      rotationDeg: 90,
    }];
    const placement = resolveDoorPlacement(project, { xM: 5.08, yM: 3.25 }, 0.2);
    expect(placement).toMatchObject({ source: "project-object", sourceObjectId: "partition" });
    expect(placement?.point.xM).toBeCloseTo(5);
    expect(placement?.point.yM).toBeCloseTo(3.25);
    expect(placement?.alongM).toBeCloseTo(1.25);
  });

  it("ignores locked and distant walls", () => {
    const project = createEmptyProject();
    project.objects = [{ ...createObjectFromTemplate("partition", 2, 2, "locked"), widthM: 3, locked: true }];
    expect(resolveDoorPlacement(project, { xM: 2, yM: 2 }, 0.2)).toBeNull();
  });
});
