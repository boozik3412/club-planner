import { describe, expect, it } from "vitest";
import type { ArchitectureVertex, ArchitecturalWall } from "../model/types";
import { assessRecognitionQuality } from "./quality";

function isolatedGraph(count: number): { vertices: ArchitectureVertex[]; walls: ArchitecturalWall[] } {
  const vertices: ArchitectureVertex[] = [];
  const walls: ArchitecturalWall[] = [];
  for (let index = 0; index < count; index += 1) {
    const first = `v-${index}-a`;
    const second = `v-${index}-b`;
    vertices.push(
      { id: first, xM: index, yM: 0, provenance: "raster", reviewStatus: "candidate", locked: false },
      { id: second, xM: index + 0.5, yM: 0.5, provenance: "raster", reviewStatus: "candidate", locked: false },
    );
    walls.push({
      id: `w-${index}`, kind: "partition", startVertexId: first, endVertexId: second,
      curve: { kind: "line" }, thicknessM: 0.15, heightM: 3, baseElevationM: 0,
      heightSource: "default", thicknessSource: "default", provenance: "raster",
      reviewStatus: "candidate", locked: false, confidence: 0.95,
    });
  }
  return { vertices, walls };
}

describe("recognition quality fail-safe", () => {
  it("blocks batch acceptance for a candidate explosion regardless of confidence", () => {
    const quality = assessRecognitionQuality(isolatedGraph(180));
    expect(quality.status).toBe("unreliable");
    expect(quality.candidateExplosion).toBe(true);
    expect(quality.allowBatchAccept).toBe(false);
  });

  it("allows a compact connected rectangle", () => {
    const vertices: ArchitectureVertex[] = [
      { id: "a", xM: 0, yM: 0, provenance: "raster", reviewStatus: "candidate", locked: false },
      { id: "b", xM: 4, yM: 0, provenance: "raster", reviewStatus: "candidate", locked: false },
      { id: "c", xM: 4, yM: 3, provenance: "raster", reviewStatus: "candidate", locked: false },
      { id: "d", xM: 0, yM: 3, provenance: "raster", reviewStatus: "candidate", locked: false },
    ];
    const walls = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "a"]].map(([startVertexId, endVertexId], index): ArchitecturalWall => ({
      id: `w-${index}`, kind: "wall", startVertexId, endVertexId, curve: { kind: "line" },
      thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "default", thicknessSource: "default",
      provenance: "raster", reviewStatus: "candidate", locked: false, confidence: 0.9,
    }));
    const quality = assessRecognitionQuality({ vertices, walls });
    expect(quality.status).toBe("reliable");
    expect(quality.allowBatchAccept).toBe(true);
  });
});
