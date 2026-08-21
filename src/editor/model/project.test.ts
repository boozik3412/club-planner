import { describe, expect, it } from "vitest";
import { createBundledProject, createEmptyProject } from "./project";
import { BASE_PLAN_ID, BLANK_PLAN_ID } from "./types";

describe("project creation", () => {
  it("starts a new project on a genuinely blank sheet", () => {
    const project = createEmptyProject("2026-08-21T00:00:00.000Z", "blank");
    expect(project.basePlan.id).toBe(BLANK_PLAN_ID);
    expect(project.activePlanSourceId).toBe(BLANK_PLAN_ID);
    expect(project.canvas.basePlanVisible).toBe(false);
    expect(project.architecture).toMatchObject({ vertices: [], walls: [], openings: [] });
    expect(project.objects).toEqual([]);
  });

  it("keeps the historical measured plan available for legacy migration", () => {
    const project = createBundledProject("2026-08-21T00:00:00.000Z", "legacy");
    expect(project.basePlan.id).toBe(BASE_PLAN_ID);
    expect(project.canvas.basePlanVisible).toBe(true);
    expect(project.architecture.walls.length).toBeGreaterThan(20);
  });
});
