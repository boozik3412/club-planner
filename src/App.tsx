import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BasePlanCanvas } from "./components/BasePlanCanvas";
import { Sidebar } from "./components/Sidebar";
import { analyzeLayout } from "./editor/analysis/layout-analysis";
import { resolveArchitecture } from "./editor/architecture/resolve-architecture";
import { summarizeProject } from "./editor/analysis/project-summary";
import {
  addDimensionCommand,
  createObjectArrayCommand,
  deleteCompositeTemplateCommand,
  deleteDimensionCommand,
  instantiateCompositeTemplateCommand,
  saveCompositeTemplateCommand,
} from "./editor/commands/advanced-commands";
import {
  addObjectCommand,
  copySelectionToClipboard,
  deleteSelectionCommand,
  duplicateSelectionCommand,
  groupObjectsCommand,
  moveObjectsCommand,
  pasteObjectClipboardCommand,
  rotateSelectionCommand,
  rotateGroupToAngleCommand,
  setGroupsLockedCommand,
  ungroupObjectsCommand,
  updateObjectsCommand,
  type MassObjectPatch,
  type ObjectClipboard,
} from "./editor/commands/project-commands";
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  isHistoryDirty,
  markHistorySaved,
  redoHistory,
  undoHistory,
} from "./editor/history/history";
import { loadBasePlan } from "./editor/load-base-plan";
import { createEmptyProject, normalizeAngle, updateProject } from "./editor/model/project";
import { EMPTY_SELECTION, type CameraState, type CanvasSettings, type ObjectType, type PointM, type ProjectState, type SelectionState } from "./editor/model/types";
import {
  chooseAndOpenProject,
  clearRecovery,
  confirmAction,
  exitApplication,
  isTauriRuntime,
  openProjectAtPath,
  readRecovery,
  saveProjectContents,
  saveSvgContents,
  showError,
  writeRecovery,
  type FilePayload,
} from "./editor/persistence/desktop-files";
import { buildProjectSvg } from "./editor/persistence/export-svg";
import {
  createRecoveryEnvelope,
  decodeProject,
  decodeRecoveryEnvelope,
  encodeProject,
} from "./editor/persistence/serialization";
import { getSelectedObjects, pruneSelection, selectAllEditable, selectTarget } from "./editor/selection/selection";
import type {
  BetweenBoundariesMode,
  BetweenBoundariesRequest,
} from "./editor/snapping/types";

const RECENT_KEY = "club-planner.recent-projects.v1";
const LazyPlan3DView = lazy(() => import("./components/Plan3DView").then((module) => ({ default: module.Plan3DView })));
type WorkspaceMode = "2d" | "3d" | "split";

function readRecentPaths(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

export default function App() {
  const [history, setHistory] = useState(() => createHistory(createEmptyProject()));
  const [previewProject, setPreviewProject] = useState<ProjectState | null>(null);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  const [camera, setCamera] = useState<CameraState>({ x: 20, y: 20, zoom: 0.05 });
  const [fitRequest, setFitRequest] = useState(0);
  const [betweenRequest, setBetweenRequest] = useState<BetweenBoundariesRequest | null>(null);
  const [measureRequest, setMeasureRequest] = useState<number | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("2d");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [recentPaths, setRecentPaths] = useState(readRecentPaths);
  const [status, setStatus] = useState("Готово · локальный режим");
  const statusTimerRef = useRef<number | null>(null);
  const visiblePlanCenterRef = useRef<PointM>({
    xM: history.present.project.basePlan.widthM / 2,
    yM: history.present.project.basePlan.heightM / 2,
  });
  const objectClipboardRef = useRef<{ contents: ObjectClipboard; pasteCount: number } | null>(null);
  const recoveryCheckedRef = useRef(false);
  const measureSequenceRef = useRef(0);
  const project = previewProject ?? history.present.project;
  const dirty = isHistoryDirty(history);
  const selectedObjects = useMemo(() => getSelectedObjects(project, selection), [project, selection]);
  const layoutWarnings = useMemo(() => analyzeLayout(project), [project]);
  const projectSummary = useMemo(() => summarizeProject(project, layoutWarnings), [layoutWarnings, project]);
  const architecture = useMemo(() => resolveArchitecture(project), [project]);
  const selectedWall = useMemo(
    () => architecture.walls.find((wall) => wall.id === selectedWallId) ?? null,
    [architecture.walls, selectedWallId],
  );

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null;
      setStatus("Готово · локальный режим");
    }, 4_000);
  }, []);

  useEffect(() => () => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const rememberPath = useCallback((path: string) => {
    setRecentPaths((current) => {
      const next = [path, ...current.filter((candidate) => candidate !== path)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const commitProject = useCallback((nextProject: ProjectState, label: string) => {
    setHistory((current) => commitHistory(current, nextProject, label));
    setPreviewProject(null);
    setBetweenRequest(null);
    setMeasureRequest(null);
    setSelection((current) => pruneSelection(nextProject, current));
    showStatus(label);
  }, [showStatus]);

  const commitMutation = useCallback((label: string, mutation: (draft: ProjectState) => void) => {
    setHistory((current) => commitHistory(current, updateProject(current.present.project, mutation), label));
    setPreviewProject(null);
    showStatus(label);
  }, [showStatus]);

  const confirmDiscardIfNeeded = useCallback(async () => {
    if (!isHistoryDirty(history)) return true;
    return confirmAction("В проекте есть несохранённые изменения. Продолжить без сохранения?");
  }, [history]);

  const loadPayload = useCallback((payload: FilePayload) => {
    const decoded = decodeProject(payload.contents);
    setHistory(createHistory(decoded.project, true));
    setPreviewProject(null);
    setBetweenRequest(null);
    setMeasureRequest(null);
    setSelection(EMPTY_SELECTION);
    const projectPath = decoded.legacy ? null : payload.path;
    setCurrentPath(projectPath);
    if (projectPath) rememberPath(projectPath);
    setFitRequest((value) => value + 1);
    showStatus(decoded.legacy
      ? `Legacy JSON импортирован · ${decoded.warnings.length} предупреждений`
      : decoded.warnings.length > 0
        ? `Проект открыт · ${decoded.warnings.join("; ")}`
        : "Проект открыт");
  }, [rememberPath, showStatus]);

  const handleNew = useCallback(async () => {
    if (!(await confirmDiscardIfNeeded())) return;
    const next = createEmptyProject();
    setHistory(createHistory(next));
    setPreviewProject(null);
    setBetweenRequest(null);
    setMeasureRequest(null);
    setSelection(EMPTY_SELECTION);
    setCurrentPath(null);
    setFitRequest((value) => value + 1);
    await clearRecovery();
    showStatus("Создан новый проект");
  }, [confirmDiscardIfNeeded, showStatus]);

  const handleOpen = useCallback(async () => {
    if (!(await confirmDiscardIfNeeded())) return;
    try {
      const payload = await chooseAndOpenProject();
      if (payload) loadPayload(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showError(`Не удалось открыть проект: ${message}`);
      showStatus(`Ошибка открытия: ${message}`);
    }
  }, [confirmDiscardIfNeeded, loadPayload, showStatus]);

  const handleOpenRecent = useCallback(async (path: string) => {
    if (!(await confirmDiscardIfNeeded())) return;
    try {
      loadPayload(await openProjectAtPath(path));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showError(`Не удалось открыть недавний проект: ${message}`);
      showStatus(`Ошибка открытия: ${message}`);
    }
  }, [confirmDiscardIfNeeded, loadPayload, showStatus]);

  const saveProject = useCallback(async (forceChoose: boolean) => {
    try {
      const path = await saveProjectContents(encodeProject(history.present.project), currentPath, forceChoose);
      if (!path) return;
      setCurrentPath(path);
      rememberPath(path);
      setHistory((current) => markHistorySaved(current));
      await clearRecovery();
      showStatus(`Проект сохранён · ${path.split(/[\\/]/).pop() ?? path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showError(`Не удалось сохранить проект: ${message}`);
      showStatus(`Ошибка сохранения: ${message}`);
    }
  }, [currentPath, history.present.project, rememberPath, showStatus]);

  const handleExportSvg = useCallback(async () => {
    try {
      const plan = await loadBasePlan();
      const path = await saveSvgContents(buildProjectSvg(history.present.project, plan));
      if (path) showStatus("SVG экспортирован");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showError(`Не удалось экспортировать SVG: ${message}`);
      showStatus(`Ошибка экспорта: ${message}`);
    }
  }, [history.present.project, showStatus]);

  const handleUndo = useCallback(() => {
    const next = undoHistory(history);
    if (next === history) return;
    setHistory(next);
    setPreviewProject(null);
    setBetweenRequest(null);
    setMeasureRequest(null);
    setSelection((current) => pruneSelection(next.present.project, current));
    showStatus(`Отменено: ${history.present.label}`);
  }, [history, showStatus]);

  const handleRedo = useCallback(() => {
    const next = redoHistory(history);
    if (next === history) return;
    setHistory(next);
    setPreviewProject(null);
    setBetweenRequest(null);
    setMeasureRequest(null);
    setSelection((current) => pruneSelection(next.present.project, current));
    showStatus(`Повторено: ${next.present.label}`);
  }, [history, showStatus]);

  const handleCanvasChange = useCallback((patch: Partial<CanvasSettings>, label: string) => {
    commitMutation(label, (draft) => {
      draft.canvas = { ...draft.canvas, ...patch };
      draft.canvas.rotationDeg = normalizeAngle(draft.canvas.rotationDeg);
    });
  }, [commitMutation]);

  const handleArchitectureDefaultsChange = useCallback((
    patch: Partial<ProjectState["architecture"]>,
    label: string,
  ) => {
    commitMutation(label, (draft) => {
      draft.architecture = { ...draft.architecture, ...patch };
    });
  }, [commitMutation]);

  const handleWallOverrideChange = useCallback((
    wallId: string,
    patch: { heightM?: number; thicknessM?: number; baseElevationM?: number },
    label: string,
  ) => {
    commitMutation(label, (draft) => {
      const current = draft.architecture.wallOverrides[wallId] ?? {};
      draft.architecture.wallOverrides[wallId] = { ...current, ...patch };
    });
  }, [commitMutation]);

  const handleResetWallOverride = useCallback((wallId: string) => {
    commitMutation("Сброс параметров стены", (draft) => {
      delete draft.architecture.wallOverrides[wallId];
    });
  }, [commitMutation]);

  const handle3DObjectSelect = useCallback((objectId: string, additive: boolean) => {
    setSelectedWallId(null);
    setSelection((current) => selectTarget(project, current, objectId, additive));
  }, [project]);

  const handle3DWallSelect = useCallback((wallId: string, sourceObjectId?: string) => {
    if (sourceObjectId) {
      setSelectedWallId(null);
      setSelection((current) => selectTarget(project, current, sourceObjectId, false));
      return;
    }
    setSelection(EMPTY_SELECTION);
    setSelectedWallId(wallId);
  }, [project]);

  const handleClear3DSelection = useCallback(() => {
    setSelection(EMPTY_SELECTION);
    setSelectedWallId(null);
  }, []);

  const handleVisibleCenterChange = useCallback((center: PointM) => {
    visiblePlanCenterRef.current = center;
  }, []);

  const handleAddObject = useCallback((type: ObjectType) => {
    const base = history.present.project;
    const { xM, yM } = visiblePlanCenterRef.current;
    const result = addObjectCommand(base, type, xM, yM);
    setHistory((current) => commitHistory(current, result.project, "Добавление предмета"));
    setSelection({ objectIds: [result.objectId], groupIds: [], groupEditId: null });
    showStatus("Предмет добавлен");
  }, [history.present.project, showStatus]);

  const handleMassPatch = useCallback((patch: MassObjectPatch, label: string) => {
    let next = updateObjectsCommand(history.present.project, selection.objectIds, patch);
    if (patch.locked !== undefined && selection.groupIds.length > 0) {
      next = setGroupsLockedCommand(next, selection.groupIds, patch.locked);
    }
    if (patch.rotationDeg !== undefined && selection.groupIds.length === 1) {
      next = rotateGroupToAngleCommand(history.present.project, selection.groupIds[0], patch.rotationDeg);
    }
    commitProject(next, label);
  }, [commitProject, history.present.project, selection.groupIds, selection.objectIds]);

  const handleRotateSelection = useCallback((deltaDeg: number) => {
    commitProject(rotateSelectionCommand(history.present.project, selection, deltaDeg), `Поворот на ${deltaDeg > 0 ? "+" : ""}${deltaDeg}°`);
  }, [commitProject, history.present.project, selection]);

  const handleAlignBetween = useCallback((mode: BetweenBoundariesMode) => {
    if (selection.objectIds.length === 0) {
      showStatus("Сначала выберите предметы");
      return;
    }
    if (selectedObjects.every((object) => object.locked)) {
      showStatus("Все выбранные предметы заблокированы");
      return;
    }
    setPreviewProject(null);
    setMeasureRequest(null);
    setBetweenRequest((current) => ({ id: (current?.id ?? 0) + 1, mode }));
    showStatus("Укажите первую перегородку на плане");
  }, [selectedObjects, selection.objectIds.length, showStatus]);

  const handleStartMeasure = useCallback(() => {
    setPreviewProject(null);
    setBetweenRequest(null);
    measureSequenceRef.current += 1;
    setMeasureRequest(measureSequenceRef.current);
    showStatus("Укажите первую точку размера");
  }, [showStatus]);

  const handleAddDimension = useCallback((start: PointM, end: PointM) => {
    const next = addDimensionCommand(history.present.project, start, end);
    setMeasureRequest(null);
    if (next === history.present.project) {
      showStatus("Размер не создан: точки совпадают");
      return;
    }
    commitProject(next, "Добавление размера");
  }, [commitProject, history.present.project, showStatus]);

  const handleDeleteDimension = useCallback((dimensionId: string) => {
    commitProject(deleteDimensionCommand(history.present.project, dimensionId), "Удаление размера");
  }, [commitProject, history.present.project]);

  const handleCreateArray = useCallback((count: number, stepM: number, direction: "horizontal" | "vertical") => {
    const result = createObjectArrayCommand(history.present.project, selection, count, stepM, direction);
    if (!result) {
      showStatus("Выберите хотя бы один незаблокированный предмет");
      return;
    }
    commitProject(result.project, "Создание ряда объектов");
    setSelection(result.selection);
  }, [commitProject, history.present.project, selection, showStatus]);

  const handleSaveCompositeTemplate = useCallback((name: string) => {
    const result = saveCompositeTemplateCommand(history.present.project, selection.objectIds, name);
    if (!result) {
      showStatus("Выберите предметы для шаблона");
      return;
    }
    commitProject(result.project, "Сохранение составного шаблона");
  }, [commitProject, history.present.project, selection.objectIds, showStatus]);

  const handleInstantiateCompositeTemplate = useCallback((templateId: string) => {
    const base = history.present.project;
    const { xM, yM } = visiblePlanCenterRef.current;
    const result = instantiateCompositeTemplateCommand(
      base,
      templateId,
      xM,
      yM,
    );
    if (!result) return;
    commitProject(result.project, "Добавление составного шаблона");
    setSelection(result.selection);
  }, [commitProject, history.present.project]);

  const handleDeleteCompositeTemplate = useCallback((templateId: string) => {
    commitProject(deleteCompositeTemplateCommand(history.present.project, templateId), "Удаление составного шаблона");
  }, [commitProject, history.present.project]);

  const handleDelete = useCallback(() => {
    if (selection.objectIds.length === 0) return;
    commitProject(deleteSelectionCommand(history.present.project, selection), "Удаление выборки");
    setSelection(EMPTY_SELECTION);
  }, [commitProject, history.present.project, selection]);

  const handleDuplicate = useCallback(() => {
    const duplicated = duplicateSelectionCommand(history.present.project, selection);
    if (!duplicated) return;
    commitProject(duplicated.project, "Дублирование выборки");
    setSelection(duplicated.selection);
  }, [commitProject, history.present.project, selection]);

  const handleCopy = useCallback(() => {
    const contents = copySelectionToClipboard(history.present.project, selection);
    if (!contents) {
      showStatus("Сначала выберите предметы");
      return;
    }
    objectClipboardRef.current = { contents, pasteCount: 0 };
    showStatus(`Скопировано: ${contents.objects.length}`);
  }, [history.present.project, selection, showStatus]);

  const handlePaste = useCallback(() => {
    const clipboard = objectClipboardRef.current;
    if (!clipboard) {
      showStatus("Буфер предметов пуст");
      return;
    }
    clipboard.pasteCount += 1;
    const pasted = pasteObjectClipboardCommand(
      history.present.project,
      clipboard.contents,
      0.35 * clipboard.pasteCount,
    );
    if (!pasted) return;
    commitProject(pasted.project, "Вставка копии");
    setSelection(pasted.selection);
  }, [commitProject, history.present.project, showStatus]);

  const handleGroup = useCallback(() => {
    const grouped = groupObjectsCommand(history.present.project, selection.objectIds);
    if (!grouped) {
      showStatus("Для новой группы выберите минимум два несгруппированных предмета");
      return;
    }
    commitProject(grouped.project, "Группировка");
    setSelection({ objectIds: [...selection.objectIds], groupIds: [grouped.groupId], groupEditId: null });
  }, [commitProject, history.present.project, selection.objectIds, showStatus]);

  const handleUngroup = useCallback(() => {
    if (selection.groupIds.length === 0) return;
    commitProject(ungroupObjectsCommand(history.present.project, selection.groupIds), "Разгруппировка");
    setSelection((current) => ({ ...current, groupIds: [], groupEditId: null }));
  }, [commitProject, history.present.project, selection.groupIds]);

  const handleEnterGroup = useCallback((explicitGroupId?: string) => {
    const groupId = explicitGroupId ?? selection.groupIds[0];
    if (!groupId) return;
    setSelection({ objectIds: [], groupIds: [], groupEditId: groupId });
    showStatus("Режим редактирования группы");
  }, [selection.groupIds, showStatus]);

  const handleExitGroup = useCallback(() => {
    const groupId = selection.groupEditId;
    if (!groupId) return;
    const group = history.present.project.groups.find((candidate) => candidate.id === groupId);
    setSelection(group
      ? { objectIds: [...group.objectIds], groupIds: [group.id], groupEditId: null }
      : EMPTY_SELECTION);
    showStatus("Редактирование группы завершено");
  }, [history.present.project.groups, selection.groupEditId, showStatus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const control = event.ctrlKey || event.metaKey;
      if (event.key === "F5" || (control && ["r", "p", "+", "-", "0"].includes(key))) {
        event.preventDefault();
        return;
      }
      if (control && key === "s") {
        event.preventDefault();
        void saveProject(event.shiftKey);
        return;
      }
      if (control && key === "o") {
        event.preventDefault();
        void handleOpen();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (control && key === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
      } else if (control && key === "y") {
        event.preventDefault();
        handleRedo();
      } else if (control && key === "d") {
        event.preventDefault();
        handleDuplicate();
      } else if (control && key === "c") {
        event.preventDefault();
        handleCopy();
      } else if (control && key === "v") {
        event.preventDefault();
        handlePaste();
      } else if (control && key === "g") {
        event.preventDefault();
        if (event.shiftKey) handleUngroup();
        else handleGroup();
      } else if (control && key === "a") {
        event.preventDefault();
        setSelection(selectAllEditable(history.present.project));
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handleDelete();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (selection.groupEditId) handleExitGroup();
        else setSelection(EMPTY_SELECTION);
      } else if (key === "r") {
        event.preventDefault();
        handleRotateSelection(event.shiftKey ? -90 : 90);
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selection.objectIds.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 0.01 : history.present.project.canvas.snapStepM;
        const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        commitProject(moveObjectsCommand(history.present.project, selection.objectIds, deltaX, deltaY), "Перемещение клавишами");
      }
    };
    const blockContextMenu = (event: MouseEvent) => event.preventDefault();
    const blockAuxNavigation = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("contextmenu", blockContextMenu);
    window.addEventListener("auxclick", blockAuxNavigation);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("contextmenu", blockContextMenu);
      window.removeEventListener("auxclick", blockAuxNavigation);
    };
  }, [commitProject, handleCopy, handleDelete, handleDuplicate, handleExitGroup, handleGroup, handleOpen, handlePaste, handleRedo, handleRotateSelection, handleUndo, handleUngroup, history.present.project, saveProject, selection]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void writeRecovery(createRecoveryEnvelope(history.present.project, currentPath)).catch((error) => {
        showStatus(`Ошибка автосохранения: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [currentPath, dirty, history.present.project, showStatus]);

  useEffect(() => {
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    void (async () => {
      try {
        const source = await readRecovery();
        if (!source) return;
        if (await confirmAction("Найдено автосохранение после предыдущего сеанса. Восстановить проект?", "Восстановление Club Planner")) {
          const recovered = decodeRecoveryEnvelope(source);
          setHistory(createHistory(recovered.project, false));
          setCurrentPath(recovered.sourcePath);
          setSelection(EMPTY_SELECTION);
          setFitRequest((value) => value + 1);
          showStatus("Проект восстановлен из автосохранения");
        } else {
          await clearRecovery();
        }
      } catch (error) {
        showStatus(`Ошибка восстановления: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, [showStatus]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let closing = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing) return;
      try {
        if (dirty) {
          if (!(await confirmAction("Закрыть приложение и оставить несохранённые изменения только в автосохранении?"))) return;
          await writeRecovery(createRecoveryEnvelope(history.present.project, currentPath));
        }
        closing = true;
        await exitApplication();
      } catch (error) {
        closing = false;
        const message = error instanceof Error ? error.message : String(error);
        await showError(`Не удалось безопасно закрыть приложение: ${message}`);
        showStatus(`Закрытие отменено: ${message}`);
      }
    }).then((callback) => { unlisten = callback; });
    return () => unlisten?.();
  }, [currentPath, dirty, history.present.project, showStatus]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const fileName = currentPath?.split(/[\\/]/).pop() ?? "Новый проект";
    void getCurrentWindow().setTitle(`${dirty ? "● " : ""}${fileName} — Club Planner`);
  }, [currentPath, dirty]);

  return (
    <div className="app-shell">
      <Sidebar
        project={project}
        selection={selection}
        selectedObjects={selectedObjects}
        currentPath={currentPath}
        recentPaths={recentPaths}
        dirty={dirty}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        status={status}
        layoutWarnings={layoutWarnings}
        projectSummary={projectSummary}
        workspaceMode={workspaceMode}
        architectureWalls={architecture.walls}
        selectedWall={selectedWall}
        onNew={() => { void handleNew(); }}
        onOpen={() => { void handleOpen(); }}
        onOpenRecent={(path) => { void handleOpenRecent(path); }}
        onSave={() => { void saveProject(false); }}
        onSaveAs={() => { void saveProject(true); }}
        onExportSvg={() => { void handleExportSvg(); }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onFit={() => setFitRequest((value) => value + 1)}
        onCanvasChange={handleCanvasChange}
        onWorkspaceModeChange={setWorkspaceMode}
        onSelectedWallChange={setSelectedWallId}
        onArchitectureDefaultsChange={handleArchitectureDefaultsChange}
        onWallOverrideChange={handleWallOverrideChange}
        onResetWallOverride={handleResetWallOverride}
        onAddObject={handleAddObject}
        onMassPatch={handleMassPatch}
        onRotateSelection={handleRotateSelection}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onGroup={handleGroup}
        onUngroup={handleUngroup}
        onAlignBetween={handleAlignBetween}
        onStartMeasure={handleStartMeasure}
        onDeleteDimension={handleDeleteDimension}
        onCreateArray={handleCreateArray}
        onSaveCompositeTemplate={handleSaveCompositeTemplate}
        onInstantiateCompositeTemplate={handleInstantiateCompositeTemplate}
        onDeleteCompositeTemplate={handleDeleteCompositeTemplate}
        onEnterGroup={() => handleEnterGroup()}
        onExitGroup={handleExitGroup}
      />
      <main className="workspace" aria-label="Рабочая область плана">
        <div className="workspace-mode-toolbar" aria-label="Режим рабочей области">
          <button type="button" className={workspaceMode === "2d" ? "is-active" : ""} onClick={() => setWorkspaceMode("2d")}>2D</button>
          <button type="button" className={workspaceMode === "3d" ? "is-active" : ""} onClick={() => setWorkspaceMode("3d")}>3D</button>
          <button type="button" className={workspaceMode === "split" ? "is-active" : ""} onClick={() => setWorkspaceMode("split")}>2D + 3D</button>
          <span>Высоты из обмера · схема, не BIM-модель</span>
        </div>
        <div className={`workspace-content workspace-content--${workspaceMode}`}>
          {workspaceMode !== "3d" ? (
            <div className="workspace-pane workspace-pane--2d">
              <BasePlanCanvas
                project={project}
                selection={selection}
                camera={camera}
                fitRequest={fitRequest}
                betweenRequest={betweenRequest}
                measureRequest={measureRequest}
                onCameraChange={setCamera}
                onVisibleCenterChange={handleVisibleCenterChange}
                onSelectionChange={(next) => { setSelectedWallId(null); setSelection(next); }}
                onPreviewProject={setPreviewProject}
                onCommitProject={commitProject}
                onGroupSelection={handleGroup}
                onUngroupSelection={handleUngroup}
                onDeleteSelection={handleDelete}
                onEnterGroup={handleEnterGroup}
                onBetweenMessage={showStatus}
                onAddDimension={handleAddDimension}
                onMeasurementMessage={showStatus}
                onReady={(count) => showStatus(`Базовый план готов · ${count} подписей`)}
                onError={(message) => showStatus(`Ошибка базового плана: ${message}`)}
              />
            </div>
          ) : null}
          {workspaceMode !== "2d" ? (
            <div className="workspace-pane workspace-pane--3d">
              <Suspense fallback={<div className="three-loading">Загрузка локального 3D-модуля…</div>}>
                <LazyPlan3DView
                  project={project}
                  selection={selection}
                  selectedWallId={selectedWallId}
                  layoutWarnings={layoutWarnings}
                  onObjectSelect={handle3DObjectSelect}
                  onWallSelect={handle3DWallSelect}
                  onClearSelection={handleClear3DSelection}
                />
              </Suspense>
            </div>
          ) : null}
        </div>
        <div className="workspace-hud" aria-live="polite">
          <strong>{dirty ? "Есть несохранённые изменения" : "Проект сохранён"}</strong>
          <span>{project.objects.length} предметов · {project.groups.length} групп · выбрано {selection.objectIds.length}</span>
        </div>
      </main>
    </div>
  );
}
