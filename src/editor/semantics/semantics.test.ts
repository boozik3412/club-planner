import { describe, expect, it } from "vitest";
import { createBundledProject } from "../model/project";
import { createObjectFromTemplate } from "../model/templates";
import {
  getBasePlanOpenings,
  getDoorSwingGeometry,
  openingFromProjectObject,
} from "./semantics";

describe("semantic openings", () => {
  it("loads checksum-bound doors and windows", () => {
    const project = createBundledProject();
    const openings = getBasePlanOpenings(project.basePlan);
    expect(openings.filter((opening) => opening.kind === "window").length).toBeGreaterThanOrEqual(6);
    expect(openings.filter((opening) => opening.kind === "door").length).toBeGreaterThanOrEqual(4);
    expect(() => getBasePlanOpenings({ ...project.basePlan, sha256: "other" })).toThrow(
      "не соответствуют",
    );
  });

  it("converts a rotated project door and computes its swing", () => {
    const door = {
      ...createObjectFromTemplate("door", 2, 3, "door"),
      widthM: 1,
      rotationDeg: 90,
    };
    const opening = openingFromProjectObject(door);
    expect(opening?.start).toMatchObject({ xM: 2, yM: 2.5 });
    const swing = opening ? getDoorSwingGeometry(opening) : null;
    expect(swing?.radiusM).toBeCloseTo(1);
    expect(swing?.openEnd.xM).toBeCloseTo(1);
    expect(swing?.openEnd.yM).toBeCloseTo(2.5);
  });

  it("keeps a reflected door opening and handedness consistent", () => {
    const door = {
      ...createObjectFromTemplate("door", 2, 3, "door"),
      widthM: 1,
      flipX: true,
    };
    const opening = openingFromProjectObject(door);
    expect(opening?.start).toMatchObject({ xM: 2.5, yM: 3 });
    expect(opening?.end).toMatchObject({ xM: 1.5, yM: 3 });
    expect(opening?.swing).toBe("left");
  });
});
