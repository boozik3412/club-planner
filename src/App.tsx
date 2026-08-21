import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BasePlanCanvas } from "./components/BasePlanCanvas";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceToolbar, type WorkspaceTool } from "./components/WorkspaceToolbar";
import { analyzeLayout } from "./editor/analysis/layout-analysis";
import { resolveArchitecture } from "./editor/architecture/resolve-architecture";
import {
  addArchitecturalOpeningCommand,
  createRectangularRoomCommand,
  detachWallEndpointCommand,
  mergeArchitecturalWallsCommand,
  removeArchitecturalOpeningCommand,
  resizeArchitecturalWallCommand,
  setArchitectureReviewStatusCommand,
  splitArchitecturalWallCommand,
  updateArchitecturalOpeningCommand,
} from "./editor/architecture/commands";
import type { DoorPlacement } from "./editor/architecture/door-placement";
import { summarizeProject } from "./editor/analysis/project-summary";
import {
  addDimensionCommand,
  createObjectArrayCommand,
  deleteCompositeTemplateCommand,
  deleteDimensionCommand,
  instantiateCompositeTemplateCommand,
  saveCompositeTemplateCommand,
  updateDimensionCommand,
} from "./editor/commands/advanced-commands";
import {
  addObjectCommand,
  copySelectionToClipboard,
  deleteSelectionCommand,
  duplicateSelectionCommand,
  groupObjectsCommand,
  insertDoorIntoPartitionCommand,
  mirrorSelectionCommand,
  moveObjectsCommand,
  pasteObjectClipboardCommand,
  rotateSelectionCommand,
  rotateGroupToAngleCommand,
  setGroupsLockedCommand,
  splitPartitionCommand,
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
import { resolveEditorShortcut } from "./editor/keyboard/shortcuts";
import { loadBasePlan } from "./editor/load-base-plan";
import { translateDimension } from "./editor/measurement/measurement";
import { createEmptyProject, normalizeAngle, updateProject } from "./editor/model/project";
import { EMPTY_SELECTION, type ArchitecturalOpening, type CameraState, type CanvasSettings, type ObjectType, type PointM, type ProjectState, type SelectionState } from "./editor/model/types";
import {
  chooseAndOpenProject,
  choosePlanSource,
  clearRecovery,
  confirmAction,
  exitApplication,
  isTauriRuntime,
  openProjectAtPath,
  readRecovery,
  saveProjectContents,
  savePdfContents,
  saveSvgContents,
  showError,
  writeRecovery,
  type FilePayload,
  type BinaryFilePayload,
  type ProjectAssetPayload,
} from "./editor/persistence/desktop-files";
import { buildProjectPdfSvg, buildProjectSvg } from "./editor/persistence/export-svg";
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
import {
  checkForAppUpdate,
  EMPTY_DOWNLOAD_PROGRESS,
  type AppUpdateCandidate,
  type UpdaterViewState,
} from "./editor/updater/app-updater";

const RECENT_KEY = "club-planner.recent-projects.v1";
const LazyPlan3DView = lazy(() => import("./components/Plan3DView").then((module) => ({ default: module.Plan3DView })));
const LazyPlanImportWizard = lazy(() => import("./components/PlanImportWizard").then((module) => ({ default: module.PlanImportWizard })));
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
  const [workspaceTool, setWorkspaceTool] = useState<WorkspaceTool>("select");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("2d");
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [projectAssets, setProjectAssets] = useState<ProjectAssetPayload[]>([]);
  const [importFile, setImportFile] = useState<BinaryFilePayload | null>(null);
  const [recentPaths, setRecentPaths] = useState(readRecentPaths);
  const [status, setStatus] = useState("Готово · локальный режим");
  const [updaterState, setUpdaterState] = useState<UpdaterViewState>(
    () => isTauriRuntime() ? { phase: "idle" } : { phase: "unavailable" },
  );
  const statusTimerRef = useRef<number | null>(null);
  const visiblePlanCenterRef = useRef<PointM>({
    xM: history.present.project.basePlan.widthM / 2,
    yM: history.present.project.basePlan.heightM / 2,
  });
  const objectClipboardRef = useRef<{ contents: ObjectClipboard; pasteCount: number } | null>(null);
  const recoveryCheckedRef = useRef(false);
  const measureSequenceRef = useRef(0);
  const updaterCandidateRef = useRef<AppUpdateCandidate | null>(null);
  const updaterBusyRef = useRef(false);
  const automaticUpdateCheckStartedRef = useRef(false);
  const project = previewProject ?? history.present.project;
  const dirty = isHistoryDirty(history);
  const selectedObjects = useMemo(() => getSelectedObjects(project, selection), [project, selection]);
  const layoutWarnings = useMemo(() => analyzeLayout(project), [project]);
  const projectSummary = useMemo(() => summarizeProject(project, layoutWarnings), [layoutWarnings, project]);
  const architecture = useMemo(() => resolveArchitecture(project), [project]);
  const activePlanSource = useMemo(
    () => project.planSources.find((source) => source.id === project.activePlanSourceId) ?? null,
    [project.activePlanSourceId, project.planSources],
  );
  const sourceImageUrl = useMemo(() => {
    if (!activePlanSource || activePlanSource.kind === "bundled-svg" || !activePlanSource.previewPath) return undefined;
    const asset = projectAssets.find((candidate) => candidate.path === activePlanSource.previewPath);
    return asset ? `data:${asset.mimeType};base64,${asset.dataBase64}` : undefined;
  }, [activePlanSource, projectAssets]);
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

  const checkForUpdates = useCallback(async (manual: boolean) => {
    if (!isTauriRuntime() || updaterBusyRef.current) return;
    updaterBusyRef.current = true;
    setUpdaterState({ phase: "checking" });
    try {
      const previous = updaterCandidateRef.current;
      updaterCandidateRef.current = null;
      if (previous) await previous.dispose();
      const candidate = await checkForAppUpdate();
      updaterCandidateRef.current = candidate;
      setUpdaterState(candidate
        ? { phase: "available", info: candidate.info }
        : manual ? { phase: "current" } : { phase: "idle" });
    } catch {
      if (manual) setUpdaterState({ phase: "error", message: "Не удалось связаться с сервером обновлений. Проверьте интернет и повторите попытку." });
      else setUpdaterState({ phase: "idle" });
    } finally {
      updaterBusyRef.current = false;
    }
  }, []);

  useEffect(() => () => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || automaticUpdateCheckStartedRef.current) return;
    automaticUpdateCheckStartedRef.current = true;
    void checkForUpdates(false);
  }, [checkForUpdates]);

  useEffect(() => () => {
    const candidate = updaterCandidateRef.current;
    updaterCandidateRef.current = null;
    if (candidate) void candidate.dispose();
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
    setWorkspaceTool("select");
    setSelection(EMPTY_SELECTION);
    setSelectedWallId(null);
    setSelectedDimensionId(null);
    const projectPath = decoded.legacy ? null : payload.path;
    setCurrentPath(projectPath);
    setProjectAssets(payload.assets);
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
    setWorkspaceTool("select");
    setSelection(EMPTY_SELECTION);
    setSelectedWallId(null);
    setSelectedDimensionId(null);
    setCurrentPath(null);
    setProjectAssets([]);
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

  const handleImportPlan = useCallback(async () => {
    if (!(await confirmDiscardIfNeeded())) return;
    try {
      const file = await choosePlanSource();
      if (file) setImportFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showError(`Не удалось открыть исходный план: ${message}`);
      showStatus(`Ошибка импорта: ${message}`);
    }
  }, [confirmDiscardIfNeeded, showStatus]);

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
      const path = await saveProjectContents(encodeProject(history.present.project), currentPath, forceChoose, projectAssets);
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
  }, [currentPath, history.present.project, projectAssets, rememberPath, showStatus]);

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

  const handleExportPdf = useCallback(async () => {
    try {
      const plan = await loadBasePlan();
      const path = await savePdfContents(buildProjectPdfSvg(history.present.project, plan));
      if (path) showStatus("PDF экспортирован");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await showError(`Не удалось экспортировать PDF: ${message}`);
      showStatus(`Ошибка экспорта PDF: ${message}`);
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
      const wall = draft.architecture.walls.find((candidate) => candidate.id === wallId);
      if (!wall) return;
      if (patch.heightM !== undefined) {
        wall.heightM = patch.heightM;
        wall.heightSource = "user";
      }
      if (patch.thicknessM !== undefined) {
        wall.thicknessM = patch.thicknessM;
        wall.thicknessSource = "user";
      }
      if (patch.baseElevationM !== undefined) wall.baseElevationM = patch.baseElevationM;
    });
  }, [commitMutation]);

  const handleResetWallOverride = useCallback((wallId: string) => {
    commitMutation("Сброс параметров стены", (draft) => {
      const wall = draft.architecture.walls.find((candidate) => candidate.id === wallId);
      if (!wall?.reference) return;
      wall.heightM = wall.reference.heightM;
      wall.thicknessM = wall.reference.thicknessM;
      wall.baseElevationM = wall.reference.baseElevationM;
      wall.heightSource = wall.reference.heightSource;
      wall.thicknessSource = wall.reference.thicknessSource;
    });
  }, [commitMutation]);

  const handleResizeArchitecturalWall = useCallback((wallId: string, patch: { lengthM?: number; angleDeg?: number; radiusM?: number }, label: string) => {
    const next = resizeArchitecturalWallCommand(history.present.project, wallId, patch);
    if (next === history.present.project) {
      showStatus("Не удалось изменить стену: проверьте геометрию или блокировку");
      return;
    }
    commitProject(next, label);
  }, [commitProject, history.present.project, showStatus]);

  const handleSplitArchitecturalWall = useCallback((wallId: string, distanceM?: number) => {
    const result = splitArchitecturalWallCommand(history.present.project, wallId, distanceM);
    if (!result) {
      showStatus("Разделение невозможно: точка попала в проём, стену или край заблокирован");
      return;
    }
    commitProject(result.project, "Разделение архитектурной стены");
    setSelectedWallId(result.wallIds?.[0] ?? wallId);
  }, [commitProject, history.present.project, showStatus]);

  const handleMergeArchitecturalWalls = useCallback((firstWallId: string, secondWallId: string) => {
    const result = mergeArchitecturalWallsCommand(history.present.project, firstWallId, secondWallId);
    if (!result) {
      showStatus("Стены несовместимы: нужен общий узел и одна прямая или окружность");
      return;
    }
    commitProject(result.project, "Объединение архитектурных стен");
    setSelectedWallId(result.wallIds?.[0] ?? firstWallId);
  }, [commitProject, history.present.project, showStatus]);

  const handleDetachWallEndpoint = useCallback((wallId: string, endpoint: "start" | "end") => {
    const result = detachWallEndpointCommand(history.present.project, wallId, endpoint);
    if (!result) {
      showStatus("Не удалось отделить узел заблокированной стены");
      return;
    }
    commitProject(result.project, "Отделение стены от общего узла");
  }, [commitProject, history.present.project, showStatus]);

  const handleAddArchitecturalOpening = useCallback((wallId: string, kind: "door" | "window") => {
    const result = addArchitecturalOpeningCommand(history.present.project, wallId, kind);
    if (!result) {
      showStatus("Проём не помещается на стене или стена заблокирована");
      return;
    }
    commitProject(result.project, kind === "door" ? "Добавление двери" : "Добавление окна");
  }, [commitProject, history.present.project, showStatus]);

  const handleAddRoom = useCallback((first: PointM, second: PointM) => {
    const result = createRectangularRoomCommand(history.present.project, first, second);
    if (!result) {
      showStatus("Помещение должно быть не меньше 0,20 × 0,20 м");
      return;
    }
    commitProject(result.project, "Добавление помещения");
    setSelection(EMPTY_SELECTION);
    setSelectedDimensionId(null);
    setSelectedWallId(result.wallIds?.[0] ?? null);
  }, [commitProject, history.present.project, showStatus]);

  const handlePlaceDoor = useCallback((placement: DoorPlacement) => {
    if (placement.source === "project-object") {
      if (!placement.sourceObjectId) return;
      const result = insertDoorIntoPartitionCommand(
        history.present.project,
        placement.sourceObjectId,
        placement.alongM,
      );
      if (!result) {
        showStatus("Дверь не помещается: оставьте не менее 0,10 м перегородки с каждой стороны");
        return;
      }
      commitProject(result.project, "Установка двери в перегородку");
      setSelectedWallId(null);
      setSelection({ objectIds: [result.doorId], groupIds: [], groupEditId: null });
      return;
    }
    const result = addArchitecturalOpeningCommand(
      history.present.project,
      placement.boundaryId,
      "door",
      0.9,
      placement.alongM,
    );
    if (!result) {
      showStatus("Дверь не помещается или пересекает существующий проём");
      return;
    }
    commitProject(result.project, "Установка двери на стену");
    setSelection(EMPTY_SELECTION);
    setSelectedWallId(placement.boundaryId);
  }, [commitProject, history.present.project, showStatus]);

  const handleUpdateArchitecturalOpening = useCallback((
    openingId: string,
    patch: Partial<Pick<ArchitecturalOpening, "offsetM" | "widthM" | "sillHeightM" | "openingHeightM" | "swing" | "openingAngleDeg" | "reviewStatus">>,
    label: string,
  ) => {
    const next = updateArchitecturalOpeningCommand(history.present.project, openingId, patch);
    if (next === history.present.project) {
      showStatus("Не удалось изменить проём: проверьте его положение и высоту");
      return;
    }
    commitProject(next, label);
  }, [commitProject, history.present.project, showStatus]);

  const handleRemoveArchitecturalOpening = useCallback((openingId: string) => {
    const next = removeArchitecturalOpeningCommand(history.present.project, openingId);
    if (next !== history.present.project) commitProject(next, "Удаление архитектурного проёма");
  }, [commitProject, history.present.project]);

  const handleArchitectureReviewStatus = useCallback((wallId: string, status: "candidate" | "accepted" | "rejected") => {
    commitProject(setArchitectureReviewStatusCommand(history.present.project, [wallId], status), status === "accepted" ? "Принятие стены" : "Отклонение стены");
  }, [commitProject, history.present.project]);

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

  const handleMirrorSelection = useCallback((axis: "horizontal" | "vertical") => {
    const next = mirrorSelectionCommand(history.present.project, selection, axis);
    if (next === history.present.project) {
      showStatus("Сначала выберите незаблокированный предмет");
      return;
    }
    commitProject(next, axis === "horizontal" ? "Отражение слева направо" : "Отражение сверху вниз");
  }, [commitProject, history.present.project, selection, showStatus]);

  const handleToggleLock = useCallback(() => {
    if (selection.objectIds.length === 0) {
      showStatus("Сначала выберите предметы");
      return;
    }
    const selectedGroups = history.present.project.groups.filter((group) => selection.groupIds.includes(group.id));
    const shouldLock = selectedObjects.some((object) => !object.locked)
      || selectedGroups.some((group) => !group.locked);
    let next = updateObjectsCommand(history.present.project, selection.objectIds, { locked: shouldLock });
    if (selection.groupIds.length > 0) {
      next = setGroupsLockedCommand(next, selection.groupIds, shouldLock);
    }
    commitProject(next, shouldLock ? "Блокировка выборки" : "Разблокировка выборки");
  }, [commitProject, history.present.project, selectedObjects, selection.groupIds, selection.objectIds, showStatus]);

  const handleSplitPartition = useCallback((passageWidthM: number) => {
    const source = selectedObjects.length === 1 ? selectedObjects[0] : null;
    if (!source || source.kind !== "partition") {
      showStatus("Выберите одну перегородку");
      return;
    }
    const result = splitPartitionCommand(history.present.project, source.id, passageWidthM);
    if (!result) {
      showStatus("Не удалось разделить: уменьшите ширину прохода или разблокируйте перегородку");
      return;
    }
    commitProject(result.project, `Проход ${passageWidthM.toFixed(2)} м в перегородке`);
    setSelection({ objectIds: result.partIds, groupIds: [], groupEditId: selection.groupEditId });
  }, [commitProject, history.present.project, selectedObjects, selection.groupEditId, showStatus]);

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
    setSelectedDimensionId(null);
    measureSequenceRef.current += 1;
    setMeasureRequest(measureSequenceRef.current);
    setWorkspaceTool("measure");
    showStatus("Укажите первую точку размера");
  }, [showStatus]);

  const handleCancelMeasure = useCallback(() => {
    setMeasureRequest(null);
    setWorkspaceTool("select");
  }, []);

  const handleWorkspaceToolChange = useCallback((tool: WorkspaceTool) => {
    if (tool === "measure") {
      handleStartMeasure();
      return;
    }
    setPreviewProject(null);
    setBetweenRequest(null);
    setMeasureRequest(null);
    setWorkspaceTool(tool);
  }, [handleStartMeasure]);

  const handleAddDimension = useCallback((start: PointM, end: PointM) => {
    const next = addDimensionCommand(history.present.project, start, end);
    setMeasureRequest(null);
    setWorkspaceTool("select");
    if (next === history.present.project) {
      showStatus("Размер не создан: точки совпадают");
      return;
    }
    commitProject(next, "Добавление размера");
    setSelectedDimensionId(next.dimensions[next.dimensions.length - 1]?.id ?? null);
  }, [commitProject, history.present.project, showStatus]);

  const handleDeleteDimension = useCallback((dimensionId: string) => {
    commitProject(deleteDimensionCommand(history.present.project, dimensionId), "Удаление размера");
    setSelectedDimensionId((current) => current === dimensionId ? null : current);
  }, [commitProject, history.present.project]);

  const handleSelectDimension = useCallback((dimensionId: string | null) => {
    setSelectedDimensionId(dimensionId);
    if (!dimensionId) return;
    setSelection(EMPTY_SELECTION);
    setSelectedWallId(null);
    const dimension = project.dimensions.find((candidate) => candidate.id === dimensionId);
    if (dimension) showStatus(`${dimension.name} выбран`);
  }, [project.dimensions, showStatus]);

  const handleInstallUpdate = useCallback(async () => {
    const candidate = updaterCandidateRef.current;
    if (!candidate || updaterBusyRef.current) return;
    const confirmed = await confirmAction(
      `Установить Club Planner ${candidate.info.version} и перезапустить приложение?${dirty ? " Несохранённый проект будет помещён в автосохранение." : ""}`,
      "Обновление Club Planner",
    );
    if (!confirmed) return;

    updaterBusyRef.current = true;
    try {
      if (dirty) await writeRecovery(createRecoveryEnvelope(history.present.project, currentPath, projectAssets));
      setUpdaterState({ phase: "installing", info: candidate.info, progress: EMPTY_DOWNLOAD_PROGRESS });
      await candidate.downloadAndInstall((progress) => {
        setUpdaterState({ phase: "installing", info: candidate.info, progress });
      });
      setUpdaterState({ phase: "restarting", info: candidate.info });
      await candidate.relaunch();
    } catch {
      setUpdaterState({ phase: "error", message: "Не удалось загрузить или установить обновление. Повторите попытку — проект сохранён в recovery." });
    } finally {
      updaterBusyRef.current = false;
    }
  }, [currentPath, dirty, history.present.project, projectAssets]);

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
      const shortcut = resolveEditorShortcut(event);
      if (!shortcut) return;
      if (shortcut === "block-browser") {
        event.preventDefault();
        return;
      }
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      switch (shortcut) {
        case "new": void handleNew(); break;
        case "open": void handleOpen(); break;
        case "save": void saveProject(false); break;
        case "save-as": void saveProject(true); break;
        case "export-svg": void handleExportSvg(); break;
        case "export-pdf": void handleExportPdf(); break;
        case "undo": handleUndo(); break;
        case "redo": handleRedo(); break;
        case "duplicate": handleDuplicate(); break;
        case "copy": handleCopy(); break;
        case "paste": handlePaste(); break;
        case "group": handleGroup(); break;
        case "ungroup": handleUngroup(); break;
        case "select-all": setSelection(selectAllEditable(history.present.project)); break;
        case "toggle-lock": handleToggleLock(); break;
        case "fit": setFitRequest((value) => value + 1); break;
        case "view-2d": setWorkspaceMode("2d"); break;
        case "view-3d": setWorkspaceMode("3d"); break;
        case "view-split": setWorkspaceMode("split"); break;
        case "select-tool": handleWorkspaceToolChange("select"); break;
        case "pan-tool": handleWorkspaceToolChange("pan"); break;
        case "measure": handleStartMeasure(); break;
        case "room-tool": handleWorkspaceToolChange("room"); break;
        case "door-tool": handleWorkspaceToolChange("door"); break;
        case "mirror-horizontal": handleMirrorSelection("horizontal"); break;
        case "mirror-vertical": handleMirrorSelection("vertical"); break;
        case "delete":
          if (selectedDimensionId) handleDeleteDimension(selectedDimensionId);
          else handleDelete();
          break;
        case "escape":
          if (workspaceTool !== "select") handleWorkspaceToolChange("select");
          else if (selectedDimensionId) setSelectedDimensionId(null);
          else if (selection.groupEditId) handleExitGroup();
          else setSelection(EMPTY_SELECTION);
          break;
        case "rotate-clockwise": handleRotateSelection(90); break;
        case "rotate-counterclockwise": handleRotateSelection(-90); break;
        case "move-left":
        case "move-right":
        case "move-up":
        case "move-down": {
          const step = event.shiftKey ? 0.01 : history.present.project.canvas.snapStepM;
          const deltaX = shortcut === "move-left" ? -step : shortcut === "move-right" ? step : 0;
          const deltaY = shortcut === "move-up" ? -step : shortcut === "move-down" ? step : 0;
          if (selectedDimensionId) {
            const dimension = history.present.project.dimensions.find((candidate) => candidate.id === selectedDimensionId);
            if (!dimension) break;
            const moved = translateDimension(dimension, deltaX, deltaY);
            commitProject(updateDimensionCommand(history.present.project, dimension.id, moved), "Перемещение размера клавишами");
            break;
          }
          if (selection.objectIds.length === 0) break;
          commitProject(moveObjectsCommand(history.present.project, selection.objectIds, deltaX, deltaY), "Перемещение клавишами");
          break;
        }
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
  }, [commitProject, handleCopy, handleDelete, handleDeleteDimension, handleDuplicate, handleExitGroup, handleExportPdf, handleExportSvg, handleGroup, handleMirrorSelection, handleNew, handleOpen, handlePaste, handleRedo, handleRotateSelection, handleStartMeasure, handleToggleLock, handleUndo, handleUngroup, handleWorkspaceToolChange, history.present.project, saveProject, selectedDimensionId, selection, workspaceTool]);

  useEffect(() => {
    if (selection.objectIds.length > 0 || selection.groupIds.length > 0) setSelectedDimensionId(null);
  }, [selection.groupIds.length, selection.objectIds.length]);

  useEffect(() => {
    if (selectedDimensionId && !project.dimensions.some((dimension) => dimension.id === selectedDimensionId)) {
      setSelectedDimensionId(null);
    }
  }, [project.dimensions, selectedDimensionId]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void writeRecovery(createRecoveryEnvelope(history.present.project, currentPath, projectAssets)).catch((error) => {
        showStatus(`Ошибка автосохранения: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [currentPath, dirty, history.present.project, projectAssets, showStatus]);

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
          setProjectAssets(recovered.assets);
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
          await writeRecovery(createRecoveryEnvelope(history.present.project, currentPath, projectAssets));
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
  }, [currentPath, dirty, history.present.project, projectAssets, showStatus]);

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
        selectedDimensionId={selectedDimensionId}
        updaterState={updaterState}
        onNew={() => { void handleNew(); }}
        onOpen={() => { void handleOpen(); }}
        onImportPlan={() => { void handleImportPlan(); }}
        onOpenRecent={(path) => { void handleOpenRecent(path); }}
        onSave={() => { void saveProject(false); }}
        onSaveAs={() => { void saveProject(true); }}
        onExportSvg={() => { void handleExportSvg(); }}
        onExportPdf={() => { void handleExportPdf(); }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onFit={() => setFitRequest((value) => value + 1)}
        onCanvasChange={handleCanvasChange}
        onWorkspaceModeChange={setWorkspaceMode}
        onSelectedWallChange={setSelectedWallId}
        onArchitectureDefaultsChange={handleArchitectureDefaultsChange}
        onWallOverrideChange={handleWallOverrideChange}
        onResetWallOverride={handleResetWallOverride}
        onResizeArchitecturalWall={handleResizeArchitecturalWall}
        onSplitArchitecturalWall={handleSplitArchitecturalWall}
        onMergeArchitecturalWalls={handleMergeArchitecturalWalls}
        onDetachWallEndpoint={handleDetachWallEndpoint}
        onAddArchitecturalOpening={handleAddArchitecturalOpening}
        onUpdateArchitecturalOpening={handleUpdateArchitecturalOpening}
        onRemoveArchitecturalOpening={handleRemoveArchitecturalOpening}
        onArchitectureReviewStatus={handleArchitectureReviewStatus}
        onSelectDimension={handleSelectDimension}
        onCheckForUpdates={() => { void checkForUpdates(true); }}
        onInstallUpdate={() => { void handleInstallUpdate(); }}
        onAddObject={handleAddObject}
        onMassPatch={handleMassPatch}
        onRotateSelection={handleRotateSelection}
        onMirrorSelection={handleMirrorSelection}
        onSplitPartition={handleSplitPartition}
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
        <WorkspaceToolbar
          activeTool={workspaceTool}
          workspaceMode={workspaceMode}
          canUndo={canUndo(history)}
          canRedo={canRedo(history)}
          snapEnabled={project.canvas.snapEnabled}
          gridVisible={project.canvas.gridVisible}
          basePlanVisible={project.canvas.basePlanVisible}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onToolChange={handleWorkspaceToolChange}
          onFit={() => setFitRequest((value) => value + 1)}
          onSnapToggle={() => handleCanvasChange({ snapEnabled: !project.canvas.snapEnabled }, project.canvas.snapEnabled ? "Привязки выключены" : "Привязки включены")}
          onGridToggle={() => handleCanvasChange({ gridVisible: !project.canvas.gridVisible }, project.canvas.gridVisible ? "Сетка скрыта" : "Сетка показана")}
          onBasePlanToggle={() => handleCanvasChange({ basePlanVisible: !project.canvas.basePlanVisible }, project.canvas.basePlanVisible ? "Подложка скрыта" : "Подложка показана")}
          onWorkspaceModeChange={setWorkspaceMode}
        />
        <div className={`workspace-content workspace-content--${workspaceMode}`}>
          {workspaceMode !== "3d" ? (
            <div className="workspace-pane workspace-pane--2d">
              <BasePlanCanvas
                project={project}
                sourceImageUrl={sourceImageUrl}
                selectedWallId={selectedWallId}
                selection={selection}
                camera={camera}
                fitRequest={fitRequest}
                betweenRequest={betweenRequest}
                measureRequest={measureRequest}
                selectedDimensionId={selectedDimensionId}
                panToolActive={workspaceTool === "pan"}
                roomToolActive={workspaceTool === "room"}
                doorToolActive={workspaceTool === "door"}
                onCameraChange={setCamera}
                onVisibleCenterChange={handleVisibleCenterChange}
                onSelectionChange={(next) => { setSelectedWallId(null); setSelection(next); }}
                onWallSelect={(wallId) => { setSelection(EMPTY_SELECTION); setSelectedWallId(wallId); }}
                onPreviewProject={setPreviewProject}
                onCommitProject={commitProject}
                onGroupSelection={handleGroup}
                onUngroupSelection={handleUngroup}
                onDeleteSelection={handleDelete}
                onEnterGroup={handleEnterGroup}
                onBetweenMessage={showStatus}
                onAddDimension={handleAddDimension}
                onDimensionSelect={handleSelectDimension}
                onMeasurementCancel={handleCancelMeasure}
                onMeasurementMessage={showStatus}
                onAddRoom={handleAddRoom}
                onPlaceDoor={handlePlaceDoor}
                onReady={(count) => showStatus(project.activePlanSourceId === "blank-canvas" ? "Пустой лист готов" : `Базовый план готов · ${count} подписей`)}
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
      {importFile ? (
        <Suspense fallback={<div className="modal-backdrop"><div className="import-loading">Загрузка локального модуля импорта…</div></div>}>
          <LazyPlanImportWizard
            file={importFile}
            defaultWallHeightM={history.present.project.architecture.defaultWallHeightM}
            defaultWallThicknessM={history.present.project.architecture.defaultWallThicknessM}
            onCancel={() => setImportFile(null)}
            onComplete={(nextProject, assets) => {
              setHistory(createHistory(nextProject, false));
              setPreviewProject(null);
              setSelection(EMPTY_SELECTION);
              setSelectedWallId(null);
              setCurrentPath(null);
              setProjectAssets(assets);
              setImportFile(null);
              setFitRequest((value) => value + 1);
              const acceptedWalls = nextProject.architecture.walls.filter((wall) => wall.reviewStatus === "accepted");
              const wallCount = acceptedWalls.filter((wall) => wall.kind === "wall").length;
              const partitionCount = acceptedWalls.length - wallCount;
              const openingCount = nextProject.architecture.openings.filter((opening) => opening.reviewStatus === "accepted").length;
              showStatus(`Создано: ${wallCount} стен, ${partitionCount} перегородок, ${openingCount} проёмов · сохраните проект`);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
