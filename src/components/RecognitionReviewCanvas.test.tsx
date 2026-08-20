/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanSource } from "../editor/model/types";
import type { RecognitionDraft } from "../editor/recognition/types";
import { RecognitionReviewCanvas } from "./RecognitionReviewCanvas";

function emptyDraft(): RecognitionDraft {
  return {
    engineVersion: "test",
    source: {} as PlanSource,
    vertices: [],
    walls: [],
    openings: [],
    textHints: [],
    issues: [],
    guides: { lines: [], arcs: [], points: [] },
  };
}

afterEach(cleanup);

describe("recognition review canvas", () => {
  it("draws a continuous manual wall with a live metric preview", () => {
    const draft = emptyDraft();
    const onApplyCommand = vi.fn();
    render(<RecognitionReviewCanvas
      draft={draft}
      imageUrl="data:image/png;base64,"
      imageWidth={400}
      imageHeight={300}
      metersPerSourceUnit={0.01}
      visibleWalls={[]}
      visibleVertexIds={new Set()}
      selectedWallId={null}
      manualTool="line"
      manualWallProperties={{ kind: "wall", thicknessM: 0.15, heightM: 3, baseElevationM: 0 }}
      onSelectWall={vi.fn()}
      onSetManualTool={vi.fn()}
      onApplyCommand={onApplyCommand}
      onPreviewDraft={vi.fn()}
      onCommitPreview={vi.fn()}
      onAnalyzeRegion={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onError={vi.fn()}
    />);
    const canvas = screen.getByRole("img", { name: "Проверка и ручное исправление распознанной планировки" });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}),
    });

    fireEvent.click(canvas, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 50 });
    expect(screen.getByText(/1\.50 м/)).toBeInTheDocument();
    const exactLength = screen.getByRole("textbox", { name: "Точная длина новой стены, м" });
    fireEvent.change(exactLength, { target: { value: "2,40" } });
    fireEvent.keyDown(exactLength, { key: "Enter" });

    expect(onApplyCommand).toHaveBeenCalledTimes(1);
    const result = onApplyCommand.mock.calls[0][0](draft);
    expect(result.error).toBeUndefined();
    expect(result.draft.walls).toHaveLength(1);
    expect(result.draft.walls[0].reviewStatus).toBe("accepted");
    const createdVertices = result.draft.vertices;
    expect(Math.hypot(createdVertices[1].xM - createdVertices[0].xM, createdVertices[1].yM - createdVertices[0].yM)).toBeCloseTo(2.4);
    expect(screen.getByText("Укажите конец стены")).toBeInTheDocument();
  });

  it("maps Delete and Ctrl+Z to review transactions", () => {
    const draft = emptyDraft();
    draft.vertices.push(
      { id: "a", xM: 0, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
      { id: "b", xM: 1, yM: 0, provenance: "manual", reviewStatus: "accepted", locked: false },
    );
    draft.walls.push({
      id: "wall", kind: "wall", startVertexId: "a", endVertexId: "b", curve: { kind: "line" },
      thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "user", thicknessSource: "user",
      provenance: "manual", reviewStatus: "accepted", locked: false,
    });
    const onApplyCommand = vi.fn();
    const onUndo = vi.fn();
    render(<RecognitionReviewCanvas
      draft={draft}
      imageUrl="data:image/png;base64,"
      imageWidth={400}
      imageHeight={300}
      metersPerSourceUnit={0.01}
      visibleWalls={draft.walls}
      visibleVertexIds={new Set(["a", "b"])}
      selectedWallId="wall"
      manualTool="none"
      manualWallProperties={{ kind: "wall", thicknessM: 0.15, heightM: 3, baseElevationM: 0 }}
      onSelectWall={vi.fn()}
      onSetManualTool={vi.fn()}
      onApplyCommand={onApplyCommand}
      onPreviewDraft={vi.fn()}
      onCommitPreview={vi.fn()}
      onAnalyzeRegion={vi.fn()}
      onUndo={onUndo}
      onRedo={vi.fn()}
      onError={vi.fn()}
    />);
    fireEvent.keyDown(document, { key: "Delete" });
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(onApplyCommand).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
