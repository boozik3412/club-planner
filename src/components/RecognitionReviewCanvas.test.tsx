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
      selectedWallIds={[]}
      manualTool="line"
      manualWallProperties={{ kind: "wall", thicknessM: 0.15, heightM: 3, baseElevationM: 0 }}
      onSelectWalls={vi.fn()}
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
      selectedWallIds={["wall"]}
      manualTool="none"
      manualWallProperties={{ kind: "wall", thicknessM: 0.15, heightM: 3, baseElevationM: 0 }}
      onSelectWalls={vi.fn()}
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

  it("creates exactly one minor arc from three points and exits the tool", () => {
    const draft = emptyDraft();
    const onApplyCommand = vi.fn();
    const onSetManualTool = vi.fn();
    render(<RecognitionReviewCanvas
      draft={draft}
      imageUrl="data:image/png;base64,"
      imageWidth={400}
      imageHeight={300}
      metersPerSourceUnit={0.01}
      visibleWalls={[]}
      visibleVertexIds={new Set()}
      selectedWallIds={[]}
      manualTool="arc"
      manualWallProperties={{ kind: "wall", thicknessM: 0.15, heightM: 3, baseElevationM: 0 }}
      onSelectWalls={vi.fn()}
      onSetManualTool={onSetManualTool}
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

    fireEvent.click(canvas, { clientX: 50, clientY: 150 });
    fireEvent.click(canvas, { clientX: 250, clientY: 150 });
    fireEvent.click(canvas, { clientX: 150, clientY: 50 });

    expect(onApplyCommand).toHaveBeenCalledOnce();
    const result = onApplyCommand.mock.calls[0][0](draft);
    expect(result.draft.walls).toHaveLength(1);
    expect(result.draft.walls[0].curve.kind).toBe("arc");
    if (result.draft.walls[0].curve.kind === "arc") {
      expect(Math.abs(4 * Math.atan(result.draft.walls[0].curve.bulge))).toBeLessThanOrEqual(Math.PI + 1e-6);
    }
    expect(onSetManualTool).toHaveBeenLastCalledWith("none");
  });

  it("selects every wall touched by a drag marquee", () => {
    const draft = emptyDraft();
    draft.vertices.push(
      { id: "a", xM: 0.2, yM: 0.5, provenance: "raster", reviewStatus: "candidate", locked: false },
      { id: "b", xM: 3, yM: 0.5, provenance: "raster", reviewStatus: "candidate", locked: false },
      { id: "c", xM: 0.2, yM: 1.5, provenance: "raster", reviewStatus: "candidate", locked: false },
      { id: "d", xM: 3, yM: 1.5, provenance: "raster", reviewStatus: "candidate", locked: false },
    );
    const makeWall = (id: string, startVertexId: string, endVertexId: string): RecognitionDraft["walls"][number] => ({
      id, kind: "wall", startVertexId, endVertexId, curve: { kind: "line" },
      thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "default", thicknessSource: "default",
      provenance: "raster", reviewStatus: "candidate", locked: false,
    });
    draft.walls.push(makeWall("first", "a", "b"), makeWall("second", "c", "d"));
    const onSelectWalls = vi.fn();
    render(<RecognitionReviewCanvas
      draft={draft}
      imageUrl="data:image/png;base64,"
      imageWidth={400}
      imageHeight={300}
      metersPerSourceUnit={0.01}
      visibleWalls={draft.walls}
      visibleVertexIds={new Set(["a", "b", "c", "d"])}
      selectedWallIds={[]}
      manualTool="none"
      manualWallProperties={{ kind: "wall", thicknessM: 0.15, heightM: 3, baseElevationM: 0 }}
      onSelectWalls={onSelectWalls}
      onSetManualTool={vi.fn()}
      onApplyCommand={vi.fn()}
      onPreviewDraft={vi.fn()}
      onCommitPreview={vi.fn()}
      onAnalyzeRegion={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onError={vi.fn()}
    />);
    const canvas = screen.getByRole("img", { name: "Проверка и ручное исправление распознанной планировки" }) as unknown as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    canvas.hasPointerCapture = vi.fn(() => false);

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 7, clientX: 180, clientY: 65 });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 7, clientX: 180, clientY: 65 });

    expect(onSelectWalls).toHaveBeenCalledWith(["first"]);
  });

  it("edits a selected arc with its curvature handle and commits once", () => {
    const draft = emptyDraft();
    draft.vertices.push(
      { id: "a", xM: 0.5, yM: 1.5, provenance: "manual", reviewStatus: "accepted", locked: false },
      { id: "b", xM: 2.5, yM: 1.5, provenance: "manual", reviewStatus: "accepted", locked: false },
    );
    draft.walls.push({
      id: "arc", kind: "wall", startVertexId: "a", endVertexId: "b", curve: { kind: "arc", bulge: -1 },
      thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "user", thicknessSource: "user",
      provenance: "manual", reviewStatus: "accepted", locked: false,
    });
    const onPreviewDraft = vi.fn();
    const onCommitPreview = vi.fn();
    const { container } = render(<RecognitionReviewCanvas
      draft={draft}
      imageUrl="data:image/png;base64,"
      imageWidth={400}
      imageHeight={300}
      metersPerSourceUnit={0.01}
      visibleWalls={draft.walls}
      visibleVertexIds={new Set(["a", "b"])}
      selectedWallIds={["arc"]}
      manualTool="none"
      manualWallProperties={{ kind: "wall", thicknessM: 0.15, heightM: 3, baseElevationM: 0 }}
      onSelectWalls={vi.fn()}
      onSetManualTool={vi.fn()}
      onApplyCommand={vi.fn()}
      onPreviewDraft={onPreviewDraft}
      onCommitPreview={onCommitPreview}
      onAnalyzeRegion={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onError={vi.fn()}
    />);
    const canvas = screen.getByRole("img", { name: "Проверка и ручное исправление распознанной планировки" }) as unknown as SVGSVGElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}),
    });
    const handle = container.querySelector(".review-arc-handle") as SVGCircleElement;
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 9, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 9, clientX: 150, clientY: 90 });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 9, clientX: 150, clientY: 90 });

    expect(onPreviewDraft).toHaveBeenCalledOnce();
    expect(onPreviewDraft.mock.calls[0][0].walls[0].curve).toEqual(expect.objectContaining({ kind: "arc" }));
    expect(onCommitPreview).toHaveBeenCalledOnce();
  });
});
