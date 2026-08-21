/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceToolbar } from "./WorkspaceToolbar";

describe("WorkspaceToolbar", () => {
  it("exposes frequent commands with active states and working callbacks", () => {
    const onToolChange = vi.fn();
    const onSnapToggle = vi.fn();
    const onGridToggle = vi.fn();
    render(<WorkspaceToolbar
      activeTool="measure"
      workspaceMode="2d"
      canUndo={false}
      canRedo
      snapEnabled
      gridVisible={false}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      onToolChange={onToolChange}
      onFit={vi.fn()}
      onSnapToggle={onSnapToggle}
      onGridToggle={onGridToggle}
      onWorkspaceModeChange={vi.fn()}
    />);

    expect(screen.getByRole("toolbar", { name: "Основные инструменты" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить (Ctrl+Z)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Линейка (M)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Привязки" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Сетка" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Рука (H)" }));
    fireEvent.click(screen.getByRole("button", { name: "Привязки" }));
    fireEvent.click(screen.getByRole("button", { name: "Сетка" }));
    expect(onToolChange).toHaveBeenCalledWith("pan");
    expect(onSnapToggle).toHaveBeenCalledOnce();
    expect(onGridToggle).toHaveBeenCalledOnce();
  });
});
