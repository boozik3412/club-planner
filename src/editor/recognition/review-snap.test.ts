import { describe, expect, it } from "vitest";
import type { RecognitionDraft } from "./types";
import { resolveReviewSnap } from "./review-snap";

const draft = {
  vertices: [
    { id: "v", xM: 1, yM: 1, provenance: "manual", reviewStatus: "accepted", locked: false },
    { id: "a", xM: 0, yM: 2, provenance: "manual", reviewStatus: "accepted", locked: false },
    { id: "b", xM: 4, yM: 2, provenance: "manual", reviewStatus: "accepted", locked: false },
  ],
  walls: [{
    id: "w", kind: "wall", startVertexId: "a", endVertexId: "b", curve: { kind: "line" },
    thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "user", thicknessSource: "user",
    provenance: "manual", reviewStatus: "accepted", locked: false,
  }],
} satisfies Pick<RecognitionDraft, "vertices" | "walls">;

describe("review magnetic snapping", () => {
  it("prefers a shared vertex and reports its topology target", () => {
    const result = resolveReviewSnap({ x: 100.6, y: 99.8 }, {
      draft, metersPerSourceUnit: 0.01, screenPxPerSourceUnit: 1,
    });
    expect(result.kind).toBe("vertex");
    expect(result.vertexId).toBe("v");
    expect(result.point).toEqual({ x: 100, y: 100 });
  });

  it("projects onto an active wall and Alt disables snapping", () => {
    const context = { draft, metersPerSourceUnit: 0.01, screenPxPerSourceUnit: 1 };
    const snapped = resolveReviewSnap({ x: 203, y: 198 }, context);
    expect(snapped.kind).toBe("wall");
    expect(snapped.wallId).toBe("w");
    expect(snapped.point.y).toBe(200);
    expect(resolveReviewSnap({ x: 203, y: 198 }, { ...context, modifiers: { disabled: true } }).kind).toBe("free");
  });

  it("uses screen pixels so the capture aperture is zoom-independent", () => {
    const farAtNormalZoom = resolveReviewSnap({ x: 100, y: 111 }, {
      draft, metersPerSourceUnit: 0.01, screenPxPerSourceUnit: 1,
    });
    const nearWhenZoomedOut = resolveReviewSnap({ x: 100, y: 111 }, {
      draft, metersPerSourceUnit: 0.01, screenPxPerSourceUnit: 0.5,
    });
    expect(farAtNormalZoom.kind).toBe("free");
    expect(nearWhenZoomedOut.kind).toBe("vertex");
  });

  it("keeps an active magnet until the larger release radius is crossed", () => {
    const result = resolveReviewSnap({ x: 100, y: 113 }, {
      draft, metersPerSourceUnit: 0.01, screenPxPerSourceUnit: 1,
      activeCandidateId: "vertex:v", captureRadiusPx: 10, releaseRadiusPx: 16,
    });
    expect(result.kind).toBe("vertex");
    expect(result.distancePx).toBeCloseTo(13);
  });
});
