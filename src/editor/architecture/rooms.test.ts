import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../model/project";
import { computeRooms } from "./rooms";

describe("computeRooms", () => {
  it("finds bounded faces and ignores the exterior", () => {
    const architecture = createEmptyProject().architecture;
    architecture.vertices = [
      { id: "a", xM: 0, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
      { id: "b", xM: 4, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
      { id: "c", xM: 4, yM: 3, provenance: "manual", reviewStatus: "accepted", locked: false },
      { id: "d", xM: 0, yM: 3, provenance: "manual", reviewStatus: "accepted", locked: false },
    ];
    architecture.walls = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]].map(([startVertexId, endVertexId], index) => ({
      id: `w${index}`, kind: "wall" as const, startVertexId, endVertexId, curve: { kind: "line" as const },
      thicknessM: 0.2, heightM: 3, baseElevationM: 0, heightSource: "user" as const, thicknessSource: "user" as const,
      provenance: "manual" as const, reviewStatus: "accepted" as const, locked: false,
    }));
    expect(computeRooms(architecture)).toEqual([expect.objectContaining({ areaM2: 12 })]);
  });
});
