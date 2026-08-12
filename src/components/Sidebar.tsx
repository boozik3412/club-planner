import { useEffect, useRef, useState } from "react";
import type { LayoutWarning } from "../editor/analysis/layout-analysis";
import type { ResolvedArchitecturalWall } from "../editor/architecture/types";
import type { ProjectSummary } from "../editor/analysis/project-summary";
import { distanceMeters, formatMeters } from "../editor/measurement/measurement";
import { MIXED_VALUE, getMixedValue } from "../editor/selection/selection";
import { OBJECT_TEMPLATES } from "../editor/model/templates";
import type {
  CanvasSettings,
  LayerId,
  ObjectType,
  PlanObject,
  ProjectState,
  SelectionState,
} from "../editor/model/types";
import type { MassObjectPatch } from "../editor/commands/project-commands";
import type { BetweenBoundariesMode } from "../editor/snapping/types";

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
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportSvg: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onCanvasChange: (patch: Partial<CanvasSettings>, label: string) => void;
  onWorkspaceModeChange: (mode: "2d" | "3d" | "split") => void;
  onSelectedWallChange: (wallId: string | null) => void;
  onArchitectureDefaultsChange: (patch: Partial<ProjectState["architecture"]>, label: string) => void;
  onWallOverrideChange: (wallId: string, patch: { heightM?: number; thicknessM?: number; baseElevationM?: number }, label: string) => void;
  onResetWallOverride: (wallId: string) => void;
  onAddObject: (type: ObjectType) => void;
  onMassPatch: (patch: MassObjectPatch, label: string) => void;
  onRotateSelection: (deltaDeg: number) => void;
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
  onNew,
  onOpen,
  onOpenRecent,
  onSave,
  onSaveAs,
  onExportSvg,
  onUndo,
  onRedo,
  onFit,
  onCanvasChange,
  onWorkspaceModeChange,
  onSelectedWallChange,
  onArchitectureDefaultsChange,
  onWallOverrideChange,
  onResetWallOverride,
  onAddObject,
  onMassPatch,
  onRotateSelection,
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

  return (
    <aside className="sidebar">
      <header className="brand-row">
        <div>
          <h1>Планировщик клуба</h1>
          <p title={currentPath ?? undefined}>{currentPath ? shortPath(currentPath) : "Новый проект"}{dirty ? " •" : ""}</p>
        </div>
        <span className="version-tag">Tauri 2</span>
      </header>

      <nav className="file-toolbar" aria-label="Файл и история">
        <button type="button" onClick={onNew} title="Новый проект">Новый</button>
        <button type="button" onClick={onOpen} title="Открыть · Ctrl+O">Открыть</button>
        <button className="button--primary" type="button" onClick={onSave} title="Сохранить · Ctrl+S">Сохранить</button>
        <button type="button" onClick={onSaveAs} title="Сохранить как · Ctrl+Shift+S">Как…</button>
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Отменить · Ctrl+Z">↶</button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Повторить · Ctrl+Y">↷</button>
      </nav>

      {recentPaths.length > 0 ? (
        <details className="recent-projects">
          <summary>Недавние проекты</summary>
          {recentPaths.map((path) => <button key={path} type="button" onClick={() => onOpenRecent(path)} title={path}>{shortPath(path)}</button>)}
        </details>
      ) : null}

      <div className="base-note">
        <strong>Актуальная базовая планировка</strong>
        <span>Замер 2026 · слой заблокирован · {project.objects.length} предметов</span>
      </div>

      <section className="panel-section">
        <h2>Навигация и холст</h2>
        <div className="button-grid button-grid--three">
          <button className="button--primary" type="button" onClick={onFit}>Вписать</button>
          <button type="button" onClick={() => onCanvasChange({ rotationDeg: project.canvas.rotationDeg - 90 }, "Поворот холста")}>↺ 90°</button>
          <button type="button" onClick={() => onCanvasChange({ rotationDeg: project.canvas.rotationDeg + 90 }, "Поворот холста")}>90° ↻</button>
        </div>
        <button className="button button--wide" type="button" onClick={() => onCanvasChange({ rotationDeg: 0 }, "Сброс поворота холста")}>Сбросить поворот холста</button>

        <div className="check-grid">
          <label className="check-row"><input type="checkbox" checked={project.canvas.basePlanVisible} onChange={(event) => onCanvasChange({ basePlanVisible: event.target.checked }, "Видимость базового плана")} />Базовый план</label>
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
        <button className="button button--wide" type="button" onClick={onStartMeasure}>Линейка · постоянный размер</button>
        <label className="field-label">Контраст базового чертежа · {Math.round(project.canvas.basePlanOpacity * 100)}%</label>
        <CommitRange value={project.canvas.basePlanOpacity} onCommit={(value) => onCanvasChange({ basePlanOpacity: value }, "Контраст базового плана")} />
        <p className="hint">Колесо — масштаб · ПКМ, средняя кнопка или Пробел+ЛКМ — панорама · ЛКМ по фону — рамка · Ctrl+C / Ctrl+V — копировать / вставить. Проверка проходов информационная и не подтверждает соответствие нормам.</p>
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
          <span>Стена базового плана</span>
          <select value={selectedWall?.id ?? ""} onChange={(event) => onSelectedWallChange(event.target.value || null)}>
            <option value="">Выберите стену…</option>
            {architectureWalls.filter((wall) => wall.source === "base-plan").map((wall) => (
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
            </div>
            <button className="button button--wide" type="button" onClick={() => onResetWallOverride(selectedWall.id)}>Вернуть значения из обмера</button>
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
              <div className="managed-list__row" key={dimension.id}>
                <span><strong>{dimension.name}</strong><small>{formatMeters(distanceMeters(dimension.start, dimension.end))}</small></span>
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
        <button className="button button--wide" type="button" onClick={onExportSvg}>Экспортировать SVG</button>
      </section>

      <footer className="sidebar-footer" aria-live="polite"><span className="status-dot" aria-hidden="true" />{status}</footer>
    </aside>
  );
}
