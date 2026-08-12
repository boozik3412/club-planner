/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../editor/model/project";
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
  render(
    <BasePlanCanvas
      project={createEmptyProject()}
      selection={EMPTY_SELECTION}
      camera={{ x: 20, y: 30, zoom: 0.05 }}
      fitRequest={0}
      betweenRequest={null}
      measureRequest={null}
      onCameraChange={onCameraChange}
      onVisibleCenterChange={vi.fn()}
      onSelectionChange={vi.fn()}
      onPreviewProject={vi.fn()}
      onCommitProject={vi.fn()}
      onGroupSelection={onGroupSelection}
      onUngroupSelection={vi.fn()}
      onDeleteSelection={vi.fn()}
      onEnterGroup={vi.fn()}
      onBetweenMessage={vi.fn()}
      onAddDimension={vi.fn()}
      onMeasurementMessage={vi.fn()}
      onReady={vi.fn()}
      onError={vi.fn()}
      {...overrides}
    />,
  );
  return { onCameraChange, onGroupSelection };
}

describe("BasePlanCanvas pointer navigation", () => {
  it("pans the camera while the right mouse button is held", () => {
    const { onCameraChange } = renderCanvas();
    const canvas = screen.getByRole("img", { name: "Актуальная планировка компьютерного клуба" });

    fireEvent.pointerDown(canvas, { button: 2, pointerId: 7, clientX: 100, clientY: 120 });
    fireEvent.pointerMove(canvas, { buttons: 2, pointerId: 7, clientX: 160, clientY: 150 });
    fireEvent.pointerUp(canvas, { button: 2, pointerId: 7, clientX: 160, clientY: 150 });
    fireEvent.contextMenu(canvas, { button: 2, clientX: 160, clientY: 150 });

    expect(onCameraChange).toHaveBeenLastCalledWith({ x: 80, y: 60, zoom: 0.05 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
});
