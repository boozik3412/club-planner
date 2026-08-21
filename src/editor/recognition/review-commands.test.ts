import { describe, expect, it } from "vitest";
import type { ArchitecturalWall, ArchitectureVertex, PlanSource } from "../model/types";
import type { RecognitionDraft } from "./types";
import { addManualWallToDraft, deleteReviewWallFromDraft, deleteReviewWallsFromDraft } from "./review-commands";

function vertex(id: string, xM: number, yM: number, provenance: ArchitectureVertex["provenance"] = "raster"): ArchitectureVertex {
  return { id, xM, yM, provenance, reviewStatus: "candidate", locked: false };
}

function wall(id: string, startVertexId: string, endVertexId: string, provenance: ArchitecturalWall["provenance"] = "raster"): ArchitecturalWall {
  return {
    id, kind: "wall", startVertexId, endVertexId, curve: { kind: "line" },
    thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "default", thicknessSource: "default",
    provenance, reviewStatus: provenance === "manual" ? "accepted" : "candidate", locked: false,
  };
}

function draft(): RecognitionDraft {
  return {
    engineVersion: "test", source: {} as PlanSource,
    vertices: [vertex("a", 0, 0), vertex("b", 4, 0)], walls: [wall("existing", "a", "b")],
    openings: [], textHints: [], issues: [],
  };
}

const properties = { kind: "partition" as const, thicknessM: 0.12, heightM: 2.8, baseElevationM: 0 };

describe("recognition review commands", () => {
  it("reuses a vertex and splits a host wall when a manual wall joins its middle", () => {
    const result = addManualWallToDraft(
      draft(),
      { point: { xM: 2, yM: -1 } },
      { point: { xM: 2, yM: 0 }, wallId: "existing", alongM: 2 },
      { kind: "line" },
      properties,
    );
    expect(result.error).toBeUndefined();
    expect(result.draft.walls).toHaveLength(3);
    expect(result.draft.vertices).toHaveLength(4);
    const created = result.draft.walls.find((candidate) => candidate.id === result.wallId)!;
    const hostParts = result.draft.walls.filter((candidate) => candidate.id !== result.wallId);
    expect(hostParts.some((candidate) => candidate.endVertexId === created.endVertexId)).toBe(true);
    expect(hostParts.some((candidate) => candidate.startVertexId === created.endVertexId)).toBe(true);
  });

  it("refuses to split through an opening", () => {
    const current = draft();
    current.openings.push({
      id: "door", kind: "door", hostWallId: "existing", offsetM: 1.5, widthM: 1,
      sillHeightM: 0, openingHeightM: 2.1, verticalSource: "default", provenance: "raster",
      reviewStatus: "candidate", locked: false,
    });
    const result = addManualWallToDraft(
      current,
      { point: { xM: 2, yM: -1 } },
      { point: { xM: 2, yM: 0 }, wallId: "existing", alongM: 2 },
      { kind: "line" },
      properties,
    );
    expect(result.error).toContain("проёма");
    expect(result.draft).toBe(current);
  });

  it("rejects recognized geometry but removes manual geometry and orphan vertices", () => {
    const recognized = deleteReviewWallFromDraft(draft(), "existing");
    expect(recognized.draft.walls[0].reviewStatus).toBe("rejected");
    expect(recognized.draft.vertices.every((candidate) => candidate.reviewStatus === "rejected")).toBe(true);

    const current = draft();
    current.vertices.push(vertex("c", 0, 1, "manual"), vertex("d", 2, 1, "manual"));
    current.walls.push(wall("manual", "c", "d", "manual"));
    const manual = deleteReviewWallFromDraft(current, "manual");
    expect(manual.draft.walls.some((candidate) => candidate.id === "manual")).toBe(false);
    expect(manual.draft.vertices.some((candidate) => candidate.id === "c" || candidate.id === "d")).toBe(false);
  });

  it("deletes a mixed multi-selection in one draft command", () => {
    const current = draft();
    current.vertices.push(vertex("c", 0, 1, "manual"), vertex("d", 2, 1, "manual"));
    current.walls.push(wall("manual", "c", "d", "manual"));
    const result = deleteReviewWallsFromDraft(current, ["existing", "manual", "manual"]);

    expect(result.draft.walls.find((candidate) => candidate.id === "existing")?.reviewStatus).toBe("rejected");
    expect(result.draft.walls.some((candidate) => candidate.id === "manual")).toBe(false);
    expect(result.draft.vertices.some((candidate) => candidate.id === "c" || candidate.id === "d")).toBe(false);
  });
});
