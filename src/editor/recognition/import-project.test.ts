import { describe, expect, it } from "vitest";
import { buildRecognitionGraph } from "./graph";
import { createProjectFromRecognitionDraft } from "./import-project";
import { DEFAULT_RECOGNITION_OPTIONS } from "./types";

describe("createProjectFromRecognitionDraft", () => {
  it("replaces bundled architecture but keeps recognition review states", () => {
    const draft = buildRecognitionGraph({
      source: {
        id: "imported", kind: "image", name: "plan.png", mimeType: "image/png", sha256: "a".repeat(64),
        embeddedPath: "sources/plan.png", previewPath: "previews/plan.png", widthM: 10, heightM: 5,
        sourceWidth: 1000, sourceHeight: 500, rotationDeg: 0, metersPerSourceUnit: 0.01, locked: true,
      },
      lines: [{ start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, confidence: 0.9 }],
      options: DEFAULT_RECOGNITION_OPTIONS,
    });
    draft.walls[0].reviewStatus = "accepted";
    const project = createProjectFromRecognitionDraft(draft);
    expect(project.activePlanSourceId).toBe("imported");
    expect(project.basePlan.widthM).toBe(10);
    expect(project.architecture.walls).toHaveLength(1);
    expect(project.architecture.walls[0].reviewStatus).toBe("accepted");
  });
});
