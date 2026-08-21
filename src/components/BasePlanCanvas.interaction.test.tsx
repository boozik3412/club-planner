/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../editor/model/project";
import { createObjectFromTemplate } from "../editor/model/templates";
import { EMPTY_SELECTION } from "../editor/model/types";
import { BasePlanCanvas } from "./BasePlanCanvas";

vi.mock("../editor/load-base-plan", () => ({
  loadBasePlan: vi.fn().mockResolvedValue({
    defsMarkup: "",
    geometryMarkup: "",
    labels: [],
  }),
}));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCanvas(overrides: Record<string, unknown> = {}) {
  const onCameraChange = vi.fn();
  const onGroupSelection = vi.fn();
  const onPreviewProject = vi.fn();
  const onCommitProject = vi.fn();
  const view = render(
    <BasePlanCanvas
      project={createEmptyProject()}
      selection={EMPTY_SELECTION}
      camera={{ x: 20, y: 30, zoom: 0.05 }}
      fitRequest={0}
      betweenRequest={null}
      measureRequest={null}
      selectedDimensionId={null}
      onCameraChange={onCameraChange}
      onVisibleCenterChange={vi.fn()}
      onSelectionChange={vi.fn()}
      onPreviewProject={onPreviewProject}
      onCommitProject={onCommitProject}
      onGroupSelection={onGroupSelection}
      onUngroupSelection={vi.fn()}
      onDeleteSelection={vi.fn()}
      onEnterGroup={vi.fn()}
      onBetweenMessage={vi.fn()}
      onAddDimension={vi.fn()}
      onAddRoom={vi.fn()}
      onPlaceDoor={vi.fn()}
      onDimensionSelect={vi.fn()}
      onMeasurementMessage={vi.fn()}
      onReady={vi.fn()}
      onError={vi.fn()}
      {...overrides}
    />,
  );
  return { ...view, onCameraChange, onGroupSelection, onPreviewProject, onCommitProject };
}

describe("BasePlanCanvas pointer navigation", () => {
  it("coalesces a burst of right-button pan events into one camera commit", () => {
    const requestAnimationFrame = vi.fn(() => 41);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const { container, onCameraChange } = renderCanvas();
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });
    const cameraLayer = container.querySelector(".plan-camera-layer");

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 7, clientX: 100, clientY: 120 });
    for (let index = 1; index <= 120; index += 1) {
      fireEvent.pointerMove(canvas, {
        buttons: 2,
        pointerId: 7,
        clientX: 100 + index * 2,
        clientY: 120 + index,
      });
    }

    expect(onCameraChange).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(canvas).toHaveClass("is-panning");

    fireEvent.pointerUp(canvas, { button: 2, pointerId: 7, clientX: 340, clientY: 240 });
    fireEvent.contextMenu(canvas, { button: 2, clientX: 340, clientY: 240 });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(onCameraChange).toHaveBeenCalledOnce();
    expect(onCameraChange).toHaveBeenLastCalledWith({ x: 260, y: 150, zoom: 0.05 });
    expect(cameraLayer).toHaveStyle({ transform: "translate(260px, 150px) scale(0.05)" });
    expect(canvas).not.toHaveClass("is-panning");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("writes the latest transient camera to the composited layer on the next frame", () => {
    const scheduledFrames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return 42;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container, onCameraChange } = renderCanvas();
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });
    const cameraLayer = container.querySelector(".plan-camera-layer");

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 12, clientX: 100, clientY: 120 });
    fireEvent.pointerMove(canvas, { buttons: 2, pointerId: 12, clientX: 120, clientY: 130 });
    fireEvent.pointerMove(canvas, { buttons: 2, pointerId: 12, clientX: 140, clientY: 150 });

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(scheduledFrames).toHaveLength(1);
    scheduledFrames[0]!(16);
    expect(cameraLayer).toHaveStyle({ transform: "translate(60px, 60px) scale(0.05)" });
    expect(onCameraChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { button: 2, pointerId: 12, clientX: 140, clientY: 150 });
    expect(onCameraChange).toHaveBeenCalledOnce();
    expect(onCameraChange).toHaveBeenCalledWith({ x: 60, y: 60, zoom: 0.05 });
  });

  it("pans with the left button while the Hand tool is active", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 71));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { onCameraChange } = renderCanvas({ panToolActive: true });
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 17, clientX: 80, clientY: 90 });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 17, clientX: 110, clientY: 105 });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 17, clientX: 110, clientY: 105 });

    expect(onCameraChange).toHaveBeenCalledWith({ x: 50, y: 45, zoom: 0.05 });
  });

  it("keeps Shift plus right click reserved for grouping", () => {
    const onGroupSelection = vi.fn();
    renderCanvas({
      selection: { ...EMPTY_SELECTION, objectIds: ["first", "second"] },
      onGroupSelection,
    });
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 8, shiftKey: true, clientX: 100, clientY: 120 });
    fireEvent.contextMenu(canvas, { button: 2, shiftKey: true, clientX: 100, clientY: 120 });

    expect(onGroupSelection).toHaveBeenCalledOnce();
  });

  it("selects a persistent dimension by its line and always shows its length", () => {
    const project = createEmptyProject();
    project.dimensions = [{
      id: "dimension-1",
      name: "Размер 1",
      start: { xM: 1, yM: 1 },
      end: { xM: 4, yM: 5 },
      labelVisible: false,
    }];
    const onDimensionSelect = vi.fn();
    renderCanvas({ project, onDimensionSelect, selectedDimensionId: "dimension-1" });

    const dimension = screen.getByRole("button", { name: "Размер 1 · 5.00 м" });
    expect(dimension).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("5.00 м")).toHaveLength(2);

    fireEvent.pointerDown(dimension, { button: 0, pointerId: 9, clientX: 120, clientY: 120 });
    expect(onDimensionSelect).toHaveBeenCalledWith("dimension-1");
  });

  it("edits a selected dimension with live handles and commits one undo transaction", () => {
    const project = createEmptyProject();
    project.dimensions = [{
      id: "dimension-1",
      name: "Размер 1",
      start: { xM: 1, yM: 1 },
      end: { xM: 4, yM: 1 },
      labelVisible: true,
    }];
    const { container, onCommitProject } = renderCanvas({ project, selectedDimensionId: "dimension-1" });
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });
    const endHandle = container.querySelector('[data-dimension-handle="end"]') as SVGElement;
    const units = project.basePlan.unitsPerMeter;
    const startX = 20 + 4 * units * 0.05;
    const y = 30 + units * 0.05;
    const endX = 20 + 6 * units * 0.05;

    expect(container.querySelectorAll(".dimension-edit-handle")).toHaveLength(3);
    fireEvent.pointerDown(endHandle, { button: 0, pointerId: 14, clientX: startX, clientY: y });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 14, clientX: endX, clientY: y, altKey: true });

    expect(screen.getAllByText("5.00 м").length).toBeGreaterThan(0);
    expect(onCommitProject).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { button: 0, pointerId: 14, clientX: endX, clientY: y });
    expect(onCommitProject).toHaveBeenCalledOnce();
    expect(onCommitProject).toHaveBeenCalledWith(expect.any(Object), "Изменение размера");
    expect(onCommitProject.mock.lastCall?.[0].dimensions[0].end.xM).toBeCloseTo(6);
  });

  it("cancels a dimension drag without committing on pointer cancellation", () => {
    const project = createEmptyProject();
    project.dimensions = [{
      id: "dimension-1",
      name: "Размер 1",
      start: { xM: 1, yM: 1 },
      end: { xM: 4, yM: 1 },
      labelVisible: true,
    }];
    const { container, onCommitProject } = renderCanvas({ project, selectedDimensionId: "dimension-1" });
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });
    const moveHandle = container.querySelector('[data-dimension-handle="move"]') as SVGElement;

    fireEvent.pointerDown(moveHandle, { button: 0, pointerId: 15, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 15, clientX: 130, clientY: 120, altKey: true });
    fireEvent.pointerCancel(canvas, { pointerId: 15, clientX: 130, clientY: 120 });

    expect(onCommitProject).not.toHaveBeenCalled();
    expect(screen.getAllByText("3.00 м").length).toBeGreaterThan(0);
  });

  it("renders imported architecture with physical thickness and a stable hit area", () => {
    const project = createEmptyProject();
    project.architecture.vertices = [
      { id: "v1", xM: 1, yM: 1, provenance: "raster", reviewStatus: "accepted", locked: false },
      { id: "v2", xM: 5, yM: 1, provenance: "raster", reviewStatus: "accepted", locked: false },
    ];
    project.architecture.walls = [{
      id: "imported-wall", kind: "wall", startVertexId: "v1", endVertexId: "v2", curve: { kind: "line" },
      thicknessM: 0.2, heightM: 3.2, baseElevationM: 0, heightSource: "default", thicknessSource: "default",
      provenance: "raster", reviewStatus: "accepted", locked: false,
    }];
    const onWallSelect = vi.fn();
    const { container } = renderCanvas({ project, camera: { x: 20, y: 30, zoom: 1 }, onWallSelect });

    expect(container.querySelector(".semantic-boundary__body")).toHaveAttribute("stroke-width", "20");
    const hitArea = screen.getByRole("button", { name: "Стена imported-wall" });
    expect(hitArea).toHaveClass("semantic-boundary__hit");
    fireEvent.pointerDown(hitArea, { button: 0, pointerId: 31 });
    expect(onWallSelect).toHaveBeenCalledWith("imported-wall");
  });

  it("moves a shared architecture vertex with live preview and one commit", () => {
    const project = createEmptyProject();
    project.canvas.snapEnabled = false;
    project.architecture.vertices = [
      { id: "v1", xM: 1, yM: 1, provenance: "raster", reviewStatus: "accepted", locked: false },
      { id: "shared", xM: 3, yM: 1, provenance: "raster", reviewStatus: "accepted", locked: false },
      { id: "v3", xM: 3, yM: 4, provenance: "raster", reviewStatus: "accepted", locked: false },
    ];
    project.architecture.walls = [
      {
        id: "wall-a", kind: "wall", startVertexId: "v1", endVertexId: "shared", curve: { kind: "line" },
        thicknessM: 0.15, heightM: 3.2, baseElevationM: 0, heightSource: "default", thicknessSource: "default",
        provenance: "raster", reviewStatus: "accepted", locked: false,
      },
      {
        id: "wall-b", kind: "partition", startVertexId: "shared", endVertexId: "v3", curve: { kind: "line" },
        thicknessM: 0.1, heightM: 3.2, baseElevationM: 0, heightSource: "default", thicknessSource: "default",
        provenance: "manual", reviewStatus: "accepted", locked: false,
      },
    ];
    const { container, onPreviewProject, onCommitProject } = renderCanvas({
      project,
      selectedWallId: "wall-a",
      camera: { x: 20, y: 30, zoom: 1 },
      onWallSelect: vi.fn(),
    });
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });
    const handle = container.querySelector('[data-architecture-vertex-id="shared"]') as SVGElement;

    expect(container.querySelectorAll(".architecture-vertex-handle")).toHaveLength(2);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 32, clientX: 320, clientY: 130 });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 32, clientX: 370, clientY: 180, altKey: true });

    const preview = onPreviewProject.mock.lastCall?.[0];
    expect(preview.architecture.vertices.find((vertex: { id: string }) => vertex.id === "shared")).toMatchObject({ xM: 3.5, yM: 1.5 });
    expect(onCommitProject).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { button: 0, pointerId: 32, clientX: 370, clientY: 180 });
    expect(onCommitProject).toHaveBeenCalledOnce();
    expect(onCommitProject).toHaveBeenCalledWith(expect.any(Object), "Перемещение узла стены");
  });

  it("cancels an architecture vertex drag without changing history", () => {
    const project = createEmptyProject();
    project.canvas.snapEnabled = false;
    project.architecture.vertices = [
      { id: "v1", xM: 1, yM: 1, provenance: "manual", reviewStatus: "accepted", locked: false },
      { id: "v2", xM: 3, yM: 1, provenance: "manual", reviewStatus: "accepted", locked: false },
    ];
    project.architecture.walls = [{
      id: "wall", kind: "wall", startVertexId: "v1", endVertexId: "v2", curve: { kind: "line" },
      thicknessM: 0.15, heightM: 3, baseElevationM: 0, heightSource: "user", thicknessSource: "user",
      provenance: "manual", reviewStatus: "accepted", locked: false,
    }];
    const { container, onPreviewProject, onCommitProject } = renderCanvas({ project, selectedWallId: "wall" });
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });
    const handle = container.querySelector('[data-architecture-vertex-id="v2"]') as SVGElement;

    fireEvent.pointerDown(handle, { button: 0, pointerId: 33, clientX: 35, clientY: 35 });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 33, clientX: 45, clientY: 45, altKey: true });
    fireEvent.pointerCancel(canvas, { pointerId: 33, clientX: 45, clientY: 45 });

    expect(onCommitProject).not.toHaveBeenCalled();
    expect(onPreviewProject).toHaveBeenLastCalledWith(null);
  });

  it("shows a long smart guide and aligns two matching visible rows", () => {
    const project = createEmptyProject();
    const moving = [1, 2, 3].map((x, index) => createObjectFromTemplate("table", x, 1, `moving-${index}`));
    const target = [5, 6, 7].map((x, index) => createObjectFromTemplate("table", x, 4, `target-${index}`));
    project.objects = [...moving, ...target];
    const selection = { ...EMPTY_SELECTION, objectIds: moving.map((object) => object.id) };
    const { container, onPreviewProject, onCommitProject } = renderCanvas({ project, selection });
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });
    const firstObject = container.querySelector('[data-object-id="moving-0"]') as SVGElement;
    const startX = 20 + 1 * project.basePlan.unitsPerMeter * 0.05;
    const startY = 30 + 1 * project.basePlan.unitsPerMeter * 0.05;
    const almostAlignedY = startY + 2.94 * project.basePlan.unitsPerMeter * 0.05;

    fireEvent.pointerDown(firstObject, { button: 0, pointerId: 11, clientX: startX, clientY: startY });
    fireEvent.pointerMove(canvas, { buttons: 1, pointerId: 11, clientX: startX, clientY: almostAlignedY });

    expect(screen.getByText(/Ряды на одной линии/)).toBeInTheDocument();
    expect(container.querySelector(".snap-guide__distance--row-alignment")).not.toBeNull();
    expect(container.querySelectorAll(".snap-guide__row-marker")).toHaveLength(6);
    const preview = onPreviewProject.mock.lastCall?.[0];
    expect(preview.objects.find((object: { id: string }) => object.id === "moving-0").yM).toBeCloseTo(4);

    fireEvent.pointerUp(canvas, { button: 0, pointerId: 11, clientX: startX, clientY: almostAlignedY });
    expect(onCommitProject).toHaveBeenCalledWith(expect.any(Object), "Перемещение выборки");
    expect(screen.queryByText(/Ряды на одной линии/)).not.toBeInTheDocument();
  });
});
