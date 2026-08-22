import { useEffect, useRef, useState } from "react";
import type { LayoutWarning } from "../editor/analysis/layout-analysis";
import type { ResolvedArchitecturalWall } from "../editor/architecture/types";
import { arcFromBulge } from "../editor/architecture/geometry";
import type { ProjectSummary } from "../editor/analysis/project-summary";
import { distanceMeters, formatMeters } from "../editor/measurement/measurement";
import { MIXED_VALUE, getMixedValue } from "../editor/selection/selection";
import { OBJECT_TEMPLATES } from "../editor/model/templates";
import type {
  CanvasSettings,
  ArchitecturalOpening,
  LayerId,
  ObjectType,
  PlanObject,
  ProjectState,
  SelectionState,
} from "../editor/model/types";
import { BLANK_PLAN_ID } from "../editor/model/types";
import type { MassObjectPatch } from "../editor/commands/project-commands";
import type { BetweenBoundariesMode } from "../editor/snapping/types";
import { APP_VERSION } from "../app-version";
import { formatDownloadProgress, type UpdaterViewState } from "../editor/updater/app-updater";

const WALL_ANGLE_STEPS_DEG = [1, 5, 15, 45, 90] as const;

interface SidebarProps {
  project: ProjectState;
  selection: SelectionState;
  selectedObjects: PlanObject[];
  currentPath: string | null;
  recentPaths: string[];
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  status: string;
  layoutWarnings: LayoutWarning[];
  projectSummary: ProjectSummary;
  workspaceMode: "2d" | "3d" | "split";
  architectureWalls: ResolvedArchitecturalWall[];
  selectedWall: ResolvedArchitecturalWall | null;
  selectedDimensionId: string | null;
  updaterState: UpdaterViewState;
  onNew: () => void;
  onOpen: () => void;
  onImportPlan: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportSvg: () => void;
  onExportPdf: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onCanvasChange: (patch: Partial<CanvasSettings>, label: string) => void;
  onWorkspaceModeChange: (mode: "2d" | "3d" | "split") => void;
  onSelectedWallChange: (wallId: string | null) => void;
  onArchitectureDefaultsChange: (patch: Partial<ProjectState["architecture"]>, label: string) => void;
  onWallOverrideChange: (wallId: string, patch: { heightM?: number; thicknessM?: number; baseElevationM?: number }, label: string) => void;
  onResetWallOverride: (wallId: string) => void;
  onResizeArchitecturalWall: (wallId: string, patch: { lengthM?: number; angleDeg?: number; radiusM?: number }, label: string) => void;
  onStraightenArchitecturalWall: (wallId: string, stepDeg: number) => void;
  onSplitArchitecturalWall: (wallId: string, distanceM?: number) => void;
  onMergeArchitecturalWalls: (firstWallId: string, secondWallId: string) => void;
  onDetachWallEndpoint: (wallId: string, endpoint: "start" | "end") => void;
  onAddArchitecturalOpening: (wallId: string, kind: "door" | "window") => void;
  onUpdateArchitecturalOpening: (openingId: string, patch: Partial<Pick<ArchitecturalOpening, "offsetM" | "widthM" | "sillHeightM" | "openingHeightM" | "swing" | "openingAngleDeg" | "reviewStatus">>, label: string) => void;
  onRemoveArchitecturalOpening: (openingId: string) => void;
  onArchitectureReviewStatus: (wallId: string, status: "candidate" | "accepted" | "rejected") => void;
  onSelectDimension: (dimensionId: string | null) => void;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onAddObject: (type: ObjectType) => void;
  onMassPatch: (patch: MassObjectPatch, label: string) => void;
  onRotateSelection: (deltaDeg: number) => void;
  onMirrorSelection: (axis: "horizontal" | "vertical") => void;
  onSplitPartition: (passageWidthM: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onAlignBetween: (mode: BetweenBoundariesMode) => void;
  onStartMeasure: () => void;
  onDeleteDimension: (dimensionId: string) => void;
  onCreateArray: (count: number, stepM: number, direction: "horizontal" | "vertical") => void;
  onSaveCompositeTemplate: (name: string) => void;
  onInstantiateCompositeTemplate: (templateId: string) => void;
  onDeleteCompositeTemplate: (templateId: string) => void;
  onEnterGroup: () => void;
  onExitGroup: () => void;
}

interface NumberFieldProps {
  label: string;
  value: number | typeof MIXED_VALUE | undefined;
  step?: number;
  min?: number;
  onCommit: (value: number) => void;
}

function NumberField({ label, value, step = 0.01, min, onCommit }: NumberFieldProps) {
  const mixed = value === MIXED_VALUE;
  const key = mixed ? `${label}-mixed` : `${label}-${value ?? "empty"}`;
  return (
    <label className="property-field">
      <span>{label}</span>
      <input
        key={key}
        type="number"
        step={step}
        min={min}
        defaultValue={typeof value === "number" ? Number(value.toFixed(3)) : ""}
        placeholder={mixed ? "разные значения" : ""}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onBlur={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onCommit(next);
        }}
      />
    </label>
  );
}

function MixedCheckbox({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: boolean | typeof MIXED_VALUE | undefined;
  onCommit: (value: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === MIXED_VALUE;
  }, [value]);
  return (
    <label className="check-row">
      <input ref={ref} type="checkbox" checked={value === true} onChange={(event) => onCommit(event.target.checked)} />
      {label}
    </label>
  );
}

function CommitRange({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className="range"
      type="range"
      min="0.2"
      max="1"
      step="0.01"
      value={draft}
      onChange={(event) => setDraft(Number(event.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
    />
  );
}

function shortPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function UpdaterPanel({
  state,
  onCheck,
  onInstall,
}: {
  state: UpdaterViewState;
  onCheck: () => void;
  onInstall: () => void;
}) {
  if (state.phase === "unavailable") return null;
  const busy = state.phase === "checking" || state.phase === "installing" || state.phase === "restarting";
  return (
    <section className={`updater-panel updater-panel--${state.phase}`} aria-live="polite">
      <div className="updater-panel__heading">
        <strong>Обновления</strong>
        {state.phase === "available" || state.phase === "installing" || state.phase === "restarting"
          ? <span>Доступна v{state.info.version}</span>
          : <span>Версия {APP_VERSION}</span>}
      </div>
      {state.phase === "available" ? (
        <>
          {state.info.notes ? <p className="updater-panel__notes">{state.info.notes}</p> : null}
          <button className="button--primary button--wide" type="button" onClick={onInstall}>
            Установить и перезапустить
          </button>
        </>
      ) : null}
      {state.phase === "installing" ? (
        <>
          <progress
            max={state.progress.totalBytes ?? undefined}
            value={state.progress.totalBytes ? state.progress.downloadedBytes : undefined}
            aria-label="Загрузка обновления"
          />
          <span>{formatDownloadProgress(state.progress)}</span>
        </>
      ) : null}
      {state.phase === "restarting" ? <span>Обновление установлено · перезапуск…</span> : null}
      {state.phase === "checking" ? <span>Проверяем GitHub Releases…</span> : null}
      {state.phase === "current" ? <span>Установлена актуальная версия.</span> : null}
      {state.phase === "error" ? <span className="updater-panel__error">{state.message}</span> : null}
      {state.phase === "idle" || state.phase === "current" || state.phase === "error" ? (
        <button type="button" disabled={busy} onClick={onCheck}>Проверить обновления</button>
      ) : null}
    </section>
  );
}

export function Sidebar({
  project,
  selection,
  selectedObjects,
  currentPath,
  recentPaths,
  dirty,
  canUndo,
  canRedo,
  status,
  layoutWarnings,
  projectSummary,
  workspaceMode,
  architectureWalls,
  selectedWall,
  selectedDimensionId,
  updaterState,
  onNew,
  onOpen,
  onImportPlan,
  onOpenRecent,
  onSave,
  onSaveAs,
  onExportSvg,
  onExportPdf,
  onUndo,
  onRedo,
  onFit,
  onCanvasChange,
  onWorkspaceModeChange,
  onSelectedWallChange,
  onArchitectureDefaultsChange,
  onWallOverrideChange,
  onResetWallOverride,
  onResizeArchitecturalWall,
  onStraightenArchitecturalWall,
  onSplitArchitecturalWall,
  onMergeArchitecturalWalls,
  onDetachWallEndpoint,
  onAddArchitecturalOpening,
  onUpdateArchitecturalOpening,
  onRemoveArchitecturalOpening,
  onArchitectureReviewStatus,
  onSelectDimension,
  onCheckForUpdates,
  onInstallUpdate,
  onAddObject,
  onMassPatch,
  onRotateSelection,
  onMirrorSelection,
  onSplitPartition,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  onAlignBetween,
  onStartMeasure,
  onDeleteDimension,
  onCreateArray,
  onSaveCompositeTemplate,
  onInstantiateCompositeTemplate,
  onDeleteCompositeTemplate,
  onEnterGroup,
  onExitGroup,
}: SidebarProps) {
  const [arrayCount, setArrayCount] = useState(3);
  const [arrayStepM, setArrayStepM] = useState(1.5);
  const [arrayDirection, setArrayDirection] = useState<"horizontal" | "vertical">("horizontal");
  const [templateName, setTemplateName] = useState("");
  const [passageWidthM, setPassageWidthM] = useState(0.9);
  const [mergeWallId, setMergeWallId] = useState("");
  const [wallAngleStepDeg, setWallAngleStepDeg] = useState(15);
  const selectedWallOpenings = selectedWall
    ? project.architecture.openings.filter((opening) => opening.hostWallId === selectedWall.id)
    : [];
  const single = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const width = getMixedValue(selectedObjects, "widthM");
  const depth = getMixedValue(selectedObjects, "depthM");
  const height = getMixedValue(selectedObjects, "heightM");
  const elevation = getMixedValue(selectedObjects, "elevationM");
  const angle = getMixedValue(selectedObjects, "rotationDeg");
  const layer = getMixedValue(selectedObjects, "layerId");
  const locked = getMixedValue(selectedObjects, "locked");
  const labelVisible = getMixedValue(selectedObjects, "labelVisible");
  const canFillOpening = single !== null
    && single.kind !== "custom-circle"
    && single.kind !== "custom-oval"
    && !single.locked;
  const selectedWallLengthM = selectedWall ? (() => {
    if (selectedWall.curve?.kind === "arc") {
      const arc = arcFromBulge(selectedWall.start, selectedWall.end, selectedWall.curve.bulge);
      if (arc) return Math.abs(arc.sweepRad) * arc.radiusM;
    }
    return Math.hypot(selectedWall.end.xM - selectedWall.start.xM, selectedWall.end.yM - selectedWall.start.yM);
  })() : 0;
  const selectedWallAngleDeg = selectedWall ? Math.atan2(selectedWall.end.yM - selectedWall.start.yM, selectedWall.end.xM - selectedWall.start.xM) * 180 / Math.PI : 0;
  const selectedWallRadiusM = selectedWall?.curve?.kind === "arc" ? arcFromBulge(selectedWall.start, selectedWall.end, selectedWall.curve.bulge)?.radiusM : undefined;
  const activePlanSource = project.planSources.find((source) => source.id === project.activePlanSourceId);
  const blankProject = project.activePlanSourceId === BLANK_PLAN_ID;

  return (
    <aside className="sidebar">
      <header className="brand-row">
        <div>
          <h1>Планировщик клуба</h1>
          <p title={currentPath ?? undefined}>{currentPath ? shortPath(currentPath) : "Новый проект"}{dirty ? " •" : ""}</p>
        </div>
        <span className="version-tag">v{APP_VERSION}</span>
      </header>

      <nav className="file-toolbar" aria-label="Файл и история">
        <button type="button" onClick={onNew} title="Новый проект · Ctrl+N">Новый</button>
        <button type="button" onClick={onOpen} title="Открыть · Ctrl+O">Открыть</button>
        <button className="button--primary" type="button" onClick={onSave} title="Сохранить · Ctrl+S">Сохранить</button>
        <button type="button" onClick={onSaveAs} title="Сохранить как · Ctrl+Shift+S">Как…</button>
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Отменить · Ctrl+Z">↶</button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Повторить · Ctrl+Y">↷</button>
      </nav>
      <button className="button button--wide import-plan-button" type="button" onClick={onImportPlan}>Импортировать PDF / изображение…</button>

      <UpdaterPanel state={updaterState} onCheck={onCheckForUpdates} onInstall={onInstallUpdate} />

      {recentPaths.length > 0 ? (
        <details className="recent-projects">
          <summary>Недавние проекты</summary>
          {recentPaths.map((path) => <button key={path} type="button" onClick={() => onOpenRecent(path)} title={path}>{shortPath(path)}</button>)}
        </details>
      ) : null}

      <div className="base-note">
        <strong>{blankProject ? "Пустой проект" : "Подложка проекта"}</strong>
        <span>{activePlanSource?.name ?? "Без подложки"} · {blankProject ? "импортируйте план или начните чертить" : "слой заблокирован"} · {project.objects.length} предметов</span>
      </div>

      <section className="panel-section">
        <h2>Навигация и холст</h2>
        <div className="button-grid button-grid--three">
          <button className="button--primary" type="button" onClick={onFit} title="Вписать план · Ctrl+0 или F">Вписать</button>
          <button type="button" onClick={() => onCanvasChange({ rotationDeg: project.canvas.rotationDeg - 90 }, "Поворот холста")}>↺ 90°</button>
          <button type="button" onClick={() => onCanvasChange({ rotationDeg: project.canvas.rotationDeg + 90 }, "Поворот холста")}>90° ↻</button>
        </div>
        <button className="button button--wide" type="button" onClick={() => onCanvasChange({ rotationDeg: 0 }, "Сброс поворота холста")}>Сбросить поворот холста</button>

        <div className="check-grid">
          <label className="check-row"><input type="checkbox" checked={project.canvas.basePlanVisible} onChange={(event) => onCanvasChange({ basePlanVisible: event.target.checked }, "Видимость подложки")} />Подложка</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.gridVisible} onChange={(event) => onCanvasChange({ gridVisible: event.target.checked }, "Видимость сетки")} />Сетка 0,5 м</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.snapEnabled} onChange={(event) => onCanvasChange({ snapEnabled: event.target.checked }, "Привязка")} />Привязка 0,1 м</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.planLabelsVisible} onChange={(event) => onCanvasChange({ planLabelsVisible: event.target.checked }, "Надписи плана")} />Надписи плана</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.objectLabelsVisible} onChange={(event) => onCanvasChange({ objectLabelsVisible: event.target.checked }, "Подписи предметов")} />Подписи предметов</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.semanticLayerVisible} onChange={(event) => onCanvasChange({ semanticLayerVisible: event.target.checked }, "Семантический слой")} />Стены, двери и окна</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.clearanceWarningsVisible} onChange={(event) => onCanvasChange({ clearanceWarningsVisible: event.target.checked }, "Зоны проходов")} />Зоны проходов</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.autoRotateFurnitureToWall} onChange={(event) => onCanvasChange({ autoRotateFurnitureToWall: event.target.checked }, "Автоповорот мебели")} />Поворот мебели по стене</label>
          <label className="check-row"><input type="checkbox" checked={project.canvas.autoRotatePartitionsToWall} onChange={(event) => onCanvasChange({ autoRotatePartitionsToWall: event.target.checked }, "Автоповорот перегородок")} />Поворот перегородок</label>
        </div>
        <NumberField label="Отступ от стены, м" value={project.canvas.wallSnapOffsetM} min={0} onCommit={(value) => onCanvasChange({ wallSnapOffsetM: Math.max(0, value) }, "Отступ от стены")} />
        <NumberField label="Минимальный проход, м" value={project.canvas.minimumPassageWidthM} min={0} onCommit={(value) => onCanvasChange({ minimumPassageWidthM: Math.max(0, value) }, "Минимальная ширина прохода")} />
        <button className="button button--wide" type="button" onClick={onStartMeasure} title="Линейка · M">Линейка · постоянный размер</button>
        <label className="field-label">Прозрачность подложки · {Math.round(project.canvas.basePlanOpacity * 100)}%</label>
        <CommitRange value={project.canvas.basePlanOpacity} onCommit={(value) => onCanvasChange({ basePlanOpacity: value }, "Контраст базового плана")} />
        <p className="hint">Колесо — масштаб · ПКМ, средняя кнопка или Пробел+ЛКМ — панорама · ЛКМ по фону — рамка · Ctrl+C / Ctrl+V — копировать / вставить. Проверка проходов информационная и не подтверждает соответствие нормам.</p>
        <details className="shortcut-help">
          <summary>Горячие клавиши</summary>
          <dl>
            <div><dt>Ctrl+N / O / S</dt><dd>новый / открыть / сохранить</dd></div>
            <div><dt>Ctrl+Shift+S / Ctrl+E</dt><dd>сохранить как / экспорт SVG</dd></div>
            <div><dt>Ctrl+Shift+E</dt><dd>экспорт PDF</dd></div>
            <div><dt>Ctrl+Z / Ctrl+Y</dt><dd>отменить / повторить</dd></div>
            <div><dt>Ctrl+C / V / D</dt><dd>копировать / вставить / дубликат</dd></div>
            <div><dt>Ctrl+G / Ctrl+Shift+G</dt><dd>группа / разгруппировать</dd></div>
            <div><dt>Ctrl+A / Ctrl+L</dt><dd>выделить всё / блокировка</dd></div>
            <div><dt>R / Shift+R</dt><dd>поворот вправо / влево</dd></div>
            <div><dt>Shift+H / Shift+V</dt><dd>отразить по горизонтали / вертикали</dd></div>
            <div><dt>V / H / M</dt><dd>выбор / рука / линейка</dd></div>
            <div><dt>P / D</dt><dd>помещение / дверь на стене</dd></div>
            <div><dt>F / Ctrl+0</dt><dd>вписать план</dd></div>
            <div><dt>Ctrl+1 / 2 / 3</dt><dd>2D / 3D / совместный вид</dd></div>
            <div><dt>Стрелки / Shift+стрелки</dt><dd>шаг сетки / точный шаг 1 см</dd></div>
            <div><dt>Delete / Esc</dt><dd>удалить / отменить выбор</dd></div>
          </dl>
        </details>
      </section>

      <section className="panel-section architecture-panel">
        <div className="section-heading-row">
          <h2>Архитектура и 3D</h2>
          <span className="source-badge">обмер + схема</span>
        </div>
        <div className="button-grid button-grid--three view-mode-buttons" aria-label="Режим отображения">
          <button type="button" className={workspaceMode === "2d" ? "is-active" : ""} onClick={() => onWorkspaceModeChange("2d")}>2D</button>
          <button type="button" className={workspaceMode === "3d" ? "is-active" : ""} onClick={() => onWorkspaceModeChange("3d")}>3D</button>
          <button type="button" className={workspaceMode === "split" ? "is-active" : ""} onClick={() => onWorkspaceModeChange("split")}>Вместе</button>
        </div>
        <div className="property-grid">
          <NumberField label="Высота стен по умолчанию, м" value={project.architecture.defaultWallHeightM} min={0.1} onCommit={(value) => onArchitectureDefaultsChange({ defaultWallHeightM: Math.max(0.1, value) }, "Высота стен по умолчанию")} />
          <NumberField label="Толщина стен по умолчанию, м" value={project.architecture.defaultWallThicknessM} min={0.01} onCommit={(value) => onArchitectureDefaultsChange({ defaultWallThicknessM: Math.max(0.01, value) }, "Толщина стен по умолчанию")} />
        </div>
        <label className="property-field property-field--wide">
          <span>Архитектурная стена</span>
          <select value={selectedWall?.id ?? ""} onChange={(event) => onSelectedWallChange(event.target.value || null)}>
            <option value="">Выберите стену…</option>
            {architectureWalls.filter((wall) => wall.source !== "project-object").map((wall) => (
              <option key={wall.id} value={wall.id}>{wall.id}</option>
            ))}
          </select>
        </label>
        {selectedWall ? (
          <div className="wall-editor">
            <div className="wall-editor__meta">
              <strong>{selectedWall.id}</strong>
              <span>Высота: {selectedWall.heightSource === "user" ? "введено пользователем" : selectedWall.heightSource === "region" ? "из высотной зоны" : selectedWall.heightSource === "measurement" ? "из обмера" : "по умолчанию"}</span>
              <span>Толщина: {selectedWall.thicknessSource === "user" ? "введено пользователем" : selectedWall.thicknessSource === "measurement" ? "из обмера" : "расчётная"}</span>
            </div>
            <div className="property-grid">
              <NumberField label="Высота стены, м" value={selectedWall.heightM} min={0.1} onCommit={(value) => onWallOverrideChange(selectedWall.id, { heightM: Math.max(0.1, value) }, "Высота стены")} />
              <NumberField label="Толщина стены, м" value={selectedWall.thicknessM} min={0.01} onCommit={(value) => onWallOverrideChange(selectedWall.id, { thicknessM: Math.max(0.01, value) }, "Толщина стены")} />
              <NumberField label="Отметка основания, м" value={selectedWall.baseElevationM} min={0} onCommit={(value) => onWallOverrideChange(selectedWall.id, { baseElevationM: Math.max(0, value) }, "Отметка основания стены")} />
              <NumberField label="Длина / обрезка, м" value={selectedWallLengthM} min={0.05} onCommit={(value) => onResizeArchitecturalWall(selectedWall.id, { lengthM: Math.max(0.05, value) }, "Изменение длины стены")} />
              <NumberField
                label={selectedWall.curve?.kind === "arc" ? "Точный угол хорды дуги, °" : "Точный угол стены, °"}
                value={selectedWallAngleDeg}
                step={1}
                onCommit={(value) => onResizeArchitecturalWall(selectedWall.id, { angleDeg: value }, "Точный угол стены")}
              />
              {selectedWallRadiusM !== undefined ? <NumberField label="Радиус дуги, м" value={selectedWallRadiusM} min={0.05} onCommit={(value) => onResizeArchitecturalWall(selectedWall.id, { radiusM: value }, "Изменение радиуса дуги")} /> : null}
            </div>
            <div className="wall-angle-tools">
              <label className="property-field property-field--wide">
                <span>Шаг автовыпрямления угла</span>
                <select value={wallAngleStepDeg} onChange={(event) => setWallAngleStepDeg(Number(event.target.value))}>
                  {WALL_ANGLE_STEPS_DEG.map((step) => <option key={step} value={step}>{step}°</option>)}
                </select>
              </label>
              <button
                className="button button--wide"
                type="button"
                disabled={selectedWall.curve?.kind === "arc"}
                onClick={() => onStraightenArchitecturalWall(selectedWall.id, wallAngleStepDeg)}
              >
                Выровнять к ближайшим {wallAngleStepDeg}°
              </button>
              <p className="hint">При перетаскивании узла угол магнитится к шагу 15°. Shift фиксирует магнит, Alt временно отключает.</p>
            </div>
            <div className="button-grid"><button type="button" onClick={() => onDetachWallEndpoint(selectedWall.id, "start")}>Отделить начало</button><button type="button" onClick={() => onDetachWallEndpoint(selectedWall.id, "end")}>Отделить конец</button></div>
            <div className="button-grid"><button type="button" onClick={() => onSplitArchitecturalWall(selectedWall.id, selectedWallLengthM / 2)}>Разделить пополам</button><button type="button" onClick={() => onAddArchitecturalOpening(selectedWall.id, "door")}>Добавить дверь</button><button type="button" onClick={() => onAddArchitecturalOpening(selectedWall.id, "window")}>Добавить окно</button></div>
            {selectedWallOpenings.map((opening) => (
              <details className="opening-editor" key={opening.id}>
                <summary>{opening.kind === "door" ? "Дверь" : "Окно"} · {opening.id}</summary>
                <div className="property-grid">
                  <NumberField label="Смещение проёма, м" value={opening.offsetM} min={0} onCommit={(value) => onUpdateArchitecturalOpening(opening.id, { offsetM: value }, "Перемещение проёма")} />
                  <NumberField label="Ширина проёма, м" value={opening.widthM} min={0.05} onCommit={(value) => onUpdateArchitecturalOpening(opening.id, { widthM: value }, "Ширина проёма")} />
                  <NumberField label="Высота подоконника, м" value={opening.sillHeightM} min={0} onCommit={(value) => onUpdateArchitecturalOpening(opening.id, { sillHeightM: value }, "Вертикальная отметка проёма")} />
                  <NumberField label="Высота проёма, м" value={opening.openingHeightM} min={0.05} onCommit={(value) => onUpdateArchitecturalOpening(opening.id, { openingHeightM: value }, "Высота проёма")} />
                  {opening.kind === "door" ? <NumberField label="Угол открывания, °" value={opening.openingAngleDeg ?? 90} min={0} step={1} onCommit={(value) => onUpdateArchitecturalOpening(opening.id, { openingAngleDeg: value }, "Угол открывания двери")} /> : null}
                </div>
                {opening.kind === "door" ? <label className="property-field property-field--wide"><span>Направление открывания</span><select value={opening.swing ?? "right"} onChange={(event) => onUpdateArchitecturalOpening(opening.id, { swing: event.target.value as "left" | "right" }, "Направление открывания двери")}><option value="left">Влево</option><option value="right">Вправо</option></select></label> : null}
                {opening.reviewStatus === "candidate" ? <div className="button-grid"><button type="button" onClick={() => onUpdateArchitecturalOpening(opening.id, { reviewStatus: "accepted" }, "Принятие проёма")}>Принять</button><button type="button" onClick={() => onUpdateArchitecturalOpening(opening.id, { reviewStatus: "rejected" }, "Отклонение проёма")}>Отклонить</button></div> : null}
                <button className="button button--wide" type="button" onClick={() => onRemoveArchitecturalOpening(opening.id)}>Удалить проём</button>
              </details>
            ))}
            {selectedWall.reviewStatus === "candidate" ? <div className="button-grid"><button type="button" onClick={() => onArchitectureReviewStatus(selectedWall.id, "accepted")}>Принять</button><button type="button" onClick={() => onArchitectureReviewStatus(selectedWall.id, "rejected")}>Отклонить</button></div> : null}
            <label className="property-field property-field--wide"><span>Объединить со следующей стеной</span><select value={mergeWallId} onChange={(event) => setMergeWallId(event.target.value)}><option value="">Выберите…</option>{architectureWalls.filter((wall) => wall.id !== selectedWall.id && wall.source !== "project-object").map((wall) => <option key={wall.id} value={wall.id}>{wall.id}</option>)}</select></label>
            <button className="button button--wide" type="button" disabled={!mergeWallId} onClick={() => { onMergeArchitecturalWalls(selectedWall.id, mergeWallId); setMergeWallId(""); }}>Объединить совместимые стены</button>
            {selectedWall.source === "base-plan" ? <button className="button button--wide" type="button" onClick={() => onResetWallOverride(selectedWall.id)}>Вернуть значения из обмера</button> : null}
          </div>
        ) : <p className="hint">Выберите стену в списке или щёлкните по ней в 3D. Нулевые толщины исходного плана показываются расчётной толщиной.</p>}
      </section>

      <section className="panel-section">
        <h2>Добавить предмет</h2>
        <div className="object-grid" aria-label="Библиотека предметов">
          {OBJECT_TEMPLATES.map((template) => (
            <button key={template.type} type="button" onClick={() => onAddObject(template.type)}>{template.shortLabel}</button>
          ))}
        </div>
      </section>

      <section className="panel-section selection-section">
        <div className="section-heading-row">
          <h2>{selectedObjects.length > 0 ? `Выбрано: ${selectedObjects.length}` : "Выбранные предметы"}</h2>
          {selection.groupEditId ? <button type="button" onClick={onExitGroup}>Выйти из группы</button> : null}
        </div>
        {selectedObjects.length === 0 ? (
          <div className="empty-selection"><span className="empty-selection__mark" aria-hidden="true">□</span><span>Выберите предмет на плане.</span><small>Shift+клик добавляет или убирает предмет.</small></div>
        ) : (
          <div className="property-panel">
            {single ? (
              <label className="property-field property-field--wide"><span>Название</span><input defaultValue={single.name} key={`${single.id}-${single.name}`} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => onMassPatch({ name: event.currentTarget.value.trim() || single.name }, "Название предмета")} /></label>
            ) : null}
            <div className="property-grid">
              {single ? <><NumberField label="X, м" value={single.xM} onCommit={(value) => onMassPatch({ xM: value }, "Координата X")} /><NumberField label="Y, м" value={single.yM} onCommit={(value) => onMassPatch({ yM: value }, "Координата Y")} /></> : null}
              <NumberField label="Ширина, м" value={width} min={0.1} onCommit={(value) => onMassPatch({ widthM: value }, "Массовая ширина")} />
              <NumberField label="Глубина, м" value={depth} min={0.1} onCommit={(value) => onMassPatch({ depthM: value }, "Массовая глубина")} />
              <NumberField label="Высота, м" value={height} min={0.1} onCommit={(value) => onMassPatch({ heightM: value }, "Массовая высота")} />
              <NumberField label="Отметка от пола, м" value={elevation} min={0} onCommit={(value) => onMassPatch({ elevationM: value }, "Отметка установки")} />
              <NumberField label="Угол, °" value={angle} step={1} onCommit={(value) => onMassPatch({ rotationDeg: value }, "Абсолютный угол")} />
              <label className="property-field"><span>Слой</span><select value={layer === MIXED_VALUE || layer === undefined ? "" : layer} onChange={(event) => event.target.value && onMassPatch({ layerId: event.target.value as LayerId }, "Слой предметов")}><option value="">разные значения</option>{project.layers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
            </div>
            <div className="check-grid"><MixedCheckbox label="Заблокировано" value={locked} onCommit={(value) => onMassPatch({ locked: value }, "Блокировка предметов")} /><MixedCheckbox label="Подпись видна" value={labelVisible} onCommit={(value) => onMassPatch({ labelVisible: value }, "Видимость подписей")} /></div>
            <div className="button-grid button-grid--three"><button type="button" onClick={() => onRotateSelection(-90)}>↺ 90°</button><button type="button" onClick={() => onMassPatch({ rotationDeg: 0 }, "Сброс угла")}>0°</button><button type="button" onClick={() => onRotateSelection(90)}>90° ↻</button></div>
            <div className="button-grid button-grid--two action-row"><button type="button" onClick={() => onMirrorSelection("horizontal")} title="Shift+H">Отразить ↔</button><button type="button" onClick={() => onMirrorSelection("vertical")} title="Shift+V">Отразить ↕</button></div>
            {single?.kind === "partition" ? (
              <details className="selection-tool" open>
                <summary>Проход в перегородке</summary>
                <label className="property-field property-field--wide"><span>Ширина прохода, м</span><input type="number" min="0.1" step="0.1" value={passageWidthM} onChange={(event) => setPassageWidthM(Number(event.target.value))} /></label>
                <button className="button button--wide" type="button" disabled={single.locked || !Number.isFinite(passageWidthM) || passageWidthM <= 0 || passageWidthM > single.widthM - 0.2} onClick={() => onSplitPartition(passageWidthM)}>Разделить перегородку</button>
                <p className="hint">Проход создаётся по центру, обе части остаются отдельными редактируемыми перегородками.</p>
              </details>
            ) : null}
            <div className="button-grid button-grid--two action-row"><button type="button" onClick={onDuplicate}>Дублировать</button><button className="button--danger" type="button" onClick={onDelete}>Удалить</button></div>
            <div className="button-grid button-grid--two action-row"><button type="button" onClick={onGroup} disabled={selectedObjects.length < 2 || selection.groupIds.length > 0}>Сгруппировать</button><button type="button" onClick={onUngroup} disabled={selection.groupIds.length === 0}>Разгруппировать</button></div>
            <div className={`button-grid action-row${selectedObjects.length > 1 || canFillOpening ? " button-grid--two" : ""}`}>
              <button type="button" onClick={() => onAlignBetween("center")} disabled={!selectedObjects.some((object) => !object.locked)}>По центру между</button>
              {selectedObjects.length > 1 ? <button type="button" onClick={() => onAlignBetween("distribute")} disabled={!selectedObjects.some((object) => !object.locked)}>Равные промежутки</button> : null}
              {canFillOpening ? <button type="button" onClick={() => onAlignBetween("fill")}>Заполнить проём</button> : null}
            </div>
            <details className="selection-tool" open>
              <summary>Ряд / массив объектов</summary>
              <div className="property-grid">
                <label className="property-field"><span>Количество</span><input type="number" min="2" max="100" step="1" value={arrayCount} onChange={(event) => setArrayCount(Number(event.target.value))} /></label>
                <label className="property-field"><span>Шаг, м</span><input type="number" min="0.1" step="0.1" value={arrayStepM} onChange={(event) => setArrayStepM(Number(event.target.value))} /></label>
                <label className="property-field property-field--wide"><span>Направление</span><select value={arrayDirection} onChange={(event) => setArrayDirection(event.target.value as "horizontal" | "vertical")}><option value="horizontal">По горизонтали</option><option value="vertical">По вертикали</option></select></label>
              </div>
              <button className="button button--wide" type="button" onClick={() => onCreateArray(arrayCount, arrayStepM, arrayDirection)}>Создать ряд</button>
            </details>
            {selection.groupIds.length === 1 && !selection.groupEditId ? <button className="button button--wide" type="button" onClick={onEnterGroup}>Редактировать элементы группы</button> : null}
          </div>
        )}
      </section>

      <section className="panel-section">
        <h2>Составные шаблоны</h2>
        <div className="inline-entry">
          <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Название шаблона" aria-label="Название составного шаблона" />
          <button type="button" disabled={selectedObjects.length === 0} onClick={() => { onSaveCompositeTemplate(templateName); setTemplateName(""); }}>Сохранить выборку</button>
        </div>
        {project.customTemplates.length > 0 ? (
          <div className="managed-list">
            {project.customTemplates.map((template) => (
              <div className="managed-list__row" key={template.id}>
                <span><strong>{template.name}</strong><small>{template.items.length} объектов</small></span>
                <button type="button" onClick={() => onInstantiateCompositeTemplate(template.id)}>Вставить</button>
                <button className="button--danger" type="button" onClick={() => onDeleteCompositeTemplate(template.id)} aria-label={`Удалить шаблон ${template.name}`}>×</button>
              </div>
            ))}
          </div>
        ) : <p className="hint">Выберите готовый набор предметов и сохраните его как повторно используемый модуль проекта.</p>}
      </section>

      <section className="panel-section">
        <h2>Постоянные размеры</h2>
        {project.dimensions.length > 0 ? (
          <div className="managed-list">
            {project.dimensions.map((dimension) => (
              <div className={`managed-list__row${selectedDimensionId === dimension.id ? " is-selected" : ""}`} key={dimension.id}>
                <button
                  className="managed-list__select"
                  type="button"
                  aria-pressed={selectedDimensionId === dimension.id}
                  onClick={() => onSelectDimension(selectedDimensionId === dimension.id ? null : dimension.id)}
                >
                  <strong>{dimension.name}</strong><small>{formatMeters(distanceMeters(dimension.start, dimension.end))}</small>
                </button>
                <button className="button--danger" type="button" onClick={() => onDeleteDimension(dimension.id)} aria-label={`Удалить ${dimension.name}`}>Удалить</button>
              </div>
            ))}
          </div>
        ) : <p className="hint">Создайте размер инструментом «Линейка».</p>}
      </section>

      <section className="panel-section project-summary">
        <h2>Сводка проекта</h2>
        <dl className="summary-grid">
          <div><dt>Игровых мест</dt><dd>{projectSummary.seats}</dd></div>
          <div><dt>Объектов</dt><dd>{projectSummary.objectCount}</dd></div>
          <div><dt>Площадь зон</dt><dd>{projectSummary.zoneAreaM2.toFixed(1)} м²</dd></div>
          <div><dt>Плотность</dt><dd>{projectSummary.seatDensityPerM2 === null ? "—" : `${projectSummary.seatDensityPerM2.toFixed(2)} места/м²`}</dd></div>
        </dl>
        <div className={`warning-summary${layoutWarnings.length > 0 ? " has-warning" : ""}`}>
          <strong>{layoutWarnings.length > 0 ? `Предупреждений: ${layoutWarnings.length}` : "Пересечений не найдено"}</strong>
          {layoutWarnings.slice(0, 6).map((warning) => <span key={warning.id}>{warning.message}</span>)}
          {layoutWarnings.length > 6 ? <span>И ещё {layoutWarnings.length - 6}…</span> : null}
        </div>
        <p className="hint">Расчёт помогает сравнивать варианты планировки, но не является проверкой строительных, пожарных или санитарных норм.</p>
      </section>

      <section className="panel-section export-section">
        <div className="button-grid button-grid--two">
          <button type="button" onClick={onExportSvg} title="Ctrl+E">Экспорт SVG</button>
          <button className="button--primary" type="button" onClick={onExportPdf} title="Ctrl+Shift+E">Экспорт PDF</button>
        </div>
      </section>

      <footer className="sidebar-footer" aria-live="polite"><span className="status-dot" aria-hidden="true" />{status}</footer>
    </aside>
  );
}
