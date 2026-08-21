import { describe, expect, it } from "vitest";
import { createBundledProject, createEmptyProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import {
  boundaryFromPartitionObject,
  getBasePlanBoundaries,
  getPlanBoundaries,
} from "./boundaries";

describe("semantic plan boundaries", () => {
  it("loads checked boundaries only for the matching base plan", () => {
    const project = createBundledProject();
    const boundaries = getBasePlanBoundaries(project.basePlan);
    expect(boundaries.length).toBeGreaterThanOrEqual(20);
    expect(boundaries.filter((boundary) => boundary.kind === "partition")).toHaveLength(6);
    expect(() => getBasePlanBoundaries({ ...project.basePlan, sha256: "other" })).toThrow(
      "не соответствуют",
    );
  });

  it("derives a rotated project partition centerline", () => {
    const partition = {
      ...createObjectFromTemplate("partition", 4, 5, "partition"),
      widthM: 2,
      depthM: 0.2,
      rotationDeg: 90,
    };
    const boundary = boundaryFromPartitionObject(partition);
    expect(boundary.start.xM).toBeCloseTo(4);
    expect(boundary.start.yM).toBeCloseTo(4);
    expect(boundary.end.xM).toBeCloseTo(4);
    expect(boundary.end.yM).toBeCloseTo(6);
    expect(boundary.thicknessM).toBe(0.2);
    expect(boundary.sourceObjectId).toBe("partition");
  });

  it("can exclude moving partitions from snap candidates", () => {
    const project = createEmptyProject();
    project.objects = [createObjectFromTemplate("partition", 4, 5, "partition")];
    expect(getPlanBoundaries(project).some((boundary) => boundary.sourceObjectId === "partition")).toBe(true);
    expect(getPlanBoundaries(project, new Set(["partition"])).some((boundary) => boundary.sourceObjectId === "partition")).toBe(false);
  });
});
