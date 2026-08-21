import {
  Box,
  Columns2,
  Grid3X3,
  Hand,
  Magnet,
  MousePointer2,
  Redo2,
  Ruler,
  Scan,
  Square,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceTool = "select" | "pan" | "measure";
export type WorkspaceMode = "2d" | "3d" | "split";

interface WorkspaceToolbarProps {
  activeTool: WorkspaceTool;
  workspaceMode: WorkspaceMode;
  canUndo: boolean;
  canRedo: boolean;
  snapEnabled: boolean;
  gridVisible: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToolChange: (tool: WorkspaceTool) => void;
  onFit: () => void;
  onSnapToggle: () => void;
  onGridToggle: () => void;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
}

function ToolButton({
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={`workspace-command${active ? " is-active" : ""}`}
      aria-label={title}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function WorkspaceToolbar({
  activeTool,
  workspaceMode,
  canUndo,
  canRedo,
  snapEnabled,
  gridVisible,
  onUndo,
  onRedo,
  onToolChange,
  onFit,
  onSnapToggle,
  onGridToggle,
  onWorkspaceModeChange,
}: WorkspaceToolbarProps) {
  return (
    <div className="workspace-toolbar" role="toolbar" aria-label="Основные инструменты">
      <div className="workspace-toolbar__group" aria-label="История">
        <ToolButton label="Отменить" shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo}><Undo2 aria-hidden="true" /></ToolButton>
        <ToolButton label="Повторить" shortcut="Ctrl+Y" disabled={!canRedo} onClick={onRedo}><Redo2 aria-hidden="true" /></ToolButton>
      </div>
      <div className="workspace-toolbar__separator" />
      <div className="workspace-toolbar__group" aria-label="Инструменты">
        <ToolButton label="Выбор" shortcut="V" active={activeTool === "select"} onClick={() => onToolChange("select")}><MousePointer2 aria-hidden="true" /></ToolButton>
        <ToolButton label="Рука" shortcut="H" active={activeTool === "pan"} onClick={() => onToolChange("pan")}><Hand aria-hidden="true" /></ToolButton>
        <ToolButton label="Линейка" shortcut="M" active={activeTool === "measure"} onClick={() => onToolChange("measure")}><Ruler aria-hidden="true" /></ToolButton>
      </div>
      <div className="workspace-toolbar__separator" />
      <div className="workspace-toolbar__group" aria-label="Точность и вид">
        <ToolButton label="Вписать" shortcut="F" onClick={onFit}><Scan aria-hidden="true" /></ToolButton>
        <ToolButton label="Привязки" active={snapEnabled} onClick={onSnapToggle}><Magnet aria-hidden="true" /></ToolButton>
        <ToolButton label="Сетка" active={gridVisible} onClick={onGridToggle}><Grid3X3 aria-hidden="true" /></ToolButton>
      </div>
      <div className="workspace-toolbar__spacer" />
      <div className="workspace-toolbar__group workspace-toolbar__modes" aria-label="Режим рабочей области">
        <ToolButton label="2D" shortcut="Ctrl+1" active={workspaceMode === "2d"} onClick={() => onWorkspaceModeChange("2d")}><Square aria-hidden="true" /></ToolButton>
        <ToolButton label="3D" shortcut="Ctrl+2" active={workspaceMode === "3d"} onClick={() => onWorkspaceModeChange("3d")}><Box aria-hidden="true" /></ToolButton>
        <ToolButton label="2D + 3D" shortcut="Ctrl+3" active={workspaceMode === "split"} onClick={() => onWorkspaceModeChange("split")}><Columns2 aria-hidden="true" /></ToolButton>
      </div>
    </div>
  );
}
