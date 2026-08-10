import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fitCamera,
  screenToPlanUnits,
  zoomCameraAtPoint,
  type ViewportSize,
} from "../editor/camera/camera";
import {
  replaceObjectsCommand,
  rotateSelectionCommand,
  updateObjectsCommand,
} from "../editor/commands/project-commands";
import {
  getObjectsBounds,
  isObjectInsideBounds,
  moveObjects,
  resizeObjectFromHandle,
  type ResizeHandle,
} from "../editor/geometry/geometry";
import { analyzeLayout, getClearanceBounds } from "../editor/analysis/layout-analysis";
import { loadBasePlan, type LoadedBasePlan } from "../editor/load-base-plan";
import { distanceMeters, formatMeters } from "../editor/measurement/measurement";
import { snapMeters } from "../editor/model/project";
import type {
  BoundsM,
  CameraState,
  ObjectId,
  PlanObject,
  PointM,
  ProjectState,
  SelectionState,
} from "../editor/model/types";
import {
  getGroupForObject,
  getSelectedObjects,
  getSelectionBounds,
  selectTarget,
} from "../editor/selection/selection";
import { getDoorSwingGeometry, getPlanOpenings } from "../editor/semantics/semantics";
import { alignObjectsBetweenBoundaries } from "../editor/snapping/between-boundaries";
import { getPlanBoundaries } from "../editor/snapping/boundaries";
import { resolveMoveSnap } from "../editor/snapping/snap-resolver";
import type {
  BetweenBoundariesMode,
  BetweenBoundariesRequest,
  PlanBoundary,
  SnapGuide,
} from "../editor/snapping/types";
import { ObjectShape } from "./ObjectShape";

interface BasePlanCanvasProps {
  project: ProjectState;
  selection: SelectionState;
  camera: CameraState;
  fitRequest: number;
  betweenRequest: BetweenBoundariesRequest | null;
  measureRequest: number | null;
  onCameraChange: (camera: CameraState) => void;
  onSelectionChange: (selection: SelectionState) => void;
  onPreviewProject: (project: ProjectState | null) => void;
  onCommitProject: (project: ProjectState, label: string) => void;
  onGroupSelection: () => void;
  onUngroupSelection: () => void;
  onDeleteSelection: () => void;
  onEnterGroup: (groupId: string) => void;
  onBetweenMessage: (message: string) => void;
  onAddDimension: (start: PointM, end: PointM) => void;
  onMeasurementMessage: (message: string) => void;
  onReady: (labelCount: number) => void;
  onError: (message: string) => void;
}

interface ScreenPoint {
  x: number;
  y: number;
}

type Gesture =
  | { mode: "pan"; pointerId: number; start: ScreenPoint; camera: CameraState }
  | { mode: "marquee"; pointerId: number; start: ScreenPoint; current: ScreenPoint; additive: boolean }
  | { mode: "move"; pointerId: number; startPlan: ScreenPoint; baseProject: ProjectState; startObjects: PlanObject[]; otherObjects: PlanObject[]; boundaries: PlanBoundary[]; preview: ProjectState | null; activeBoundaryId: string | null; candidateIndex: number; lastPlan: ScreenPoint | null; snappingDisabled: boolean }
  | { mode: "resize"; pointerId: number; startPlan: ScreenPoint; baseProject: ProjectState; object: PlanObject; handle: ResizeHandle; preview: ProjectState | null }
  | { mode: "rotate"; pointerId: number; center: ScreenPoint; startAngle: number; baseProject: ProjectState; objectId: ObjectId | null; groupId: string | null; startObjectAngle: number; preview: ProjectState | null };

type MoveGesture = Extract<Gesture, { mode: "move" }>;

interface BetweenSession {
  requestId: number;
  mode: BetweenBoundariesMode;
  baseProject: ProjectState;
  objectIds: ObjectId[];
  firstBoundaryId: string | null;
  secondBoundaryId: string | null;
  preview: ProjectState | null;
  availableM: number | null;
  gapM: number | null;
  error: string | null;
}

interface MeasurementSession {
  requestId: number;
  start: PointM | null;
  current: PointM | null;
}

function doorSweepPath(
  opening: ReturnType<typeof getPlanOpenings>[number],
  unitsPerMeter: number,
): string | null {
  const geometry = getDoorSwingGeometry(opening);
  if (!geometry) return null;
  const pivotX = geometry.pivot.xM * unitsPerMeter;
  const pivotY = geometry.pivot.yM * unitsPerMeter;
  const closedX = geometry.closedEnd.xM * unitsPerMeter;
  const closedY = geometry.closedEnd.yM * unitsPerMeter;
  const openX = geometry.openEnd.xM * unitsPerMeter;
  const openY = geometry.openEnd.yM * unitsPerMeter;
  const radius = geometry.radiusM * unitsPerMeter;
  const largeArc = (opening.openingAngleDeg ?? 90) > 180 ? 1 : 0;
  return `M ${pivotX} ${pivotY} L ${closedX} ${closedY} A ${radius} ${radius} 0 ${largeArc} ${geometry.clockwise ? 1 : 0} ${openX} ${openY} Z`;
}

const BasePlanLayer = memo(function BasePlanLayer({
  plan,
  project,
}: {
  plan: LoadedBasePlan;
  project: ProjectState;
}) {
  const width = project.basePlan.widthM * project.basePlan.unitsPerMeter;
  const height = project.basePlan.heightM * project.basePlan.unitsPerMeter;
  const gridStep = project.canvas.gridStepM * project.basePlan.unitsPerMeter;
  return (
    <>
      <defs>
        <pattern id="club-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#cfd7dd" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </pattern>
        <g dangerouslySetInnerHTML={{ __html: plan.defsMarkup }} />
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="#fff" />
      {project.canvas.gridVisible ? <rect x="0" y="0" width={width} height={height} fill="url(#club-grid)" pointerEvents="none" /> : null}
      {project.canvas.basePlanVisible ? (
        <g opacity={project.canvas.basePlanOpacity} pointerEvents="none">
          <g dangerouslySetInnerHTML={{ __html: plan.geometryMarkup }} />
          {project.canvas.planLabelsVisible ? plan.labels.map((label) => (
            <g key={label.id} transform={`rotate(${-project.canvas.rotationDeg} ${label.cx} ${label.cy})`} dangerouslySetInnerHTML={{ __html: label.markup }} />
          )) : null}
        </g>
      ) : null}
    </>
  );
});

export function BasePlanCanvas({
  project,
  selection,
  camera,
  fitRequest,
  betweenRequest,
  measureRequest,
  onCameraChange,
  onSelectionChange,
  onPreviewProject,
  onCommitProject,
  onGroupSelection,
  onUngroupSelection,
  onDeleteSelection,
  onEnterGroup,
  onBetweenMessage,
  onAddDimension,
  onMeasurementMessage,
  onReady,
  onError,
}: BasePlanCanvasProps) {
  const [plan, setPlan] = useState<LoadedBasePlan | null>(null);
  const [viewport, setViewport] = useState<ViewportSize>({ width: 1, height: 1 });
  const [marquee, setMarquee] = useState<{ start: ScreenPoint; current: ScreenPoint } | null>(null);
  const [contextMenu, setContextMenu] = useState<ScreenPoint | null>(null);
  const [snapGuide, setSnapGuide] = useState<SnapGuide | null>(null);
  const [movePreviewActive, setMovePreviewActive] = useState(false);
  const [betweenSession, setBetweenSession] = useState<BetweenSession | null>(null);
  const [measurementSession, setMeasurementSession] = useState<MeasurementSession | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const spacePressedRef = useRef(false);
  const lastFitKeyRef = useRef("");
  const lastBetweenRequestRef = useRef(0);
  const lastMeasureRequestRef = useRef(0);
  const selectedSet = useMemo(() => new Set(selection.objectIds), [selection.objectIds]);
  const selectedObjects = useMemo(() => getSelectedObjects(project, selection), [project, selection]);
  const selectionBounds = useMemo(() => getSelectionBounds(project, selection), [project, selection]);
  const groupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of project.groups) for (const id of group.objectIds) map.set(id, group.id);
    return map;
  }, [project.groups]);
  const visibleLayers = useMemo(
    () => new Set(project.layers.filter((layer) => layer.visible).map((layer) => layer.id)),
    [project.layers],
  );
  const semanticBoundaries = useMemo(() => getPlanBoundaries(project), [project]);
  const semanticOpenings = useMemo(() => getPlanOpenings(project), [project]);
  const layoutWarnings = useMemo(() => analyzeLayout(project), [project]);
  const warningObjectIds = useMemo(
    () => new Set(layoutWarnings.flatMap((warning) => warning.objectIds)),
    [layoutWarnings],
  );
  const betweenBoundaries = useMemo(
    () => betweenSession
      ? getPlanBoundaries(betweenSession.baseProject).filter((boundary) => boundary.kind === "partition")
      : [],
    [betweenSession],
  );

  useEffect(() => {
    let active = true;
    loadBasePlan().then((loadedPlan) => {
      if (!active) return;
      setPlan(loadedPlan);
      onReady(loadedPlan.labels.length);
    }).catch((error: unknown) => {
      if (!active) return;
      onError(error instanceof Error ? error.message : "неизвестная ошибка");
    });
    return () => { active = false; };
  }, [onError, onReady]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fitKey = `${viewport.width}:${viewport.height}:${project.canvas.rotationDeg}:${fitRequest}`;
    if (viewport.width <= 1 || viewport.height <= 1 || lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;
    onCameraChange(fitCamera(viewport, project.canvas.rotationDeg));
  }, [fitRequest, onCameraChange, project.canvas.rotationDeg, viewport]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = true;
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = false;
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []);

  const localPoint = useCallback((clientX: number, clientY: number): ScreenPoint => {
    const rect = frameRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const planPoint = useCallback((screen: ScreenPoint): ScreenPoint => {
    const units = screenToPlanUnits(screen.x, screen.y, camera, project.canvas.rotationDeg);
    return { x: units.x / project.basePlan.unitsPerMeter, y: units.y / project.basePlan.unitsPerMeter };
  }, [camera, project.basePlan.unitsPerMeter, project.canvas.rotationDeg]);

  const capture = (pointerId: number) => {
    try { svgRef.current?.setPointerCapture(pointerId); } catch { /* pointer capture is best-effort */ }
  };

  useEffect(() => {
    if (!betweenRequest || lastBetweenRequestRef.current === betweenRequest.id) return;
    lastBetweenRequestRef.current = betweenRequest.id;
    onPreviewProject(null);
    setSnapGuide(null);
    setBetweenSession({
      requestId: betweenRequest.id,
      mode: betweenRequest.mode,
      baseProject: project,
      objectIds: [...selection.objectIds],
      firstBoundaryId: null,
      secondBoundaryId: null,
      preview: null,
      availableM: null,
      gapM: null,
      error: null,
    });
  }, [betweenRequest, onPreviewProject, project, selection.objectIds]);

  useEffect(() => {
    if (betweenRequest || !betweenSession) return;
    onPreviewProject(null);
    setBetweenSession(null);
  }, [betweenRequest, betweenSession, onPreviewProject]);

  useEffect(() => {
    if (!measureRequest || lastMeasureRequestRef.current === measureRequest) return;
    lastMeasureRequestRef.current = measureRequest;
    onPreviewProject(null);
    setBetweenSession(null);
    setSnapGuide(null);
    setMeasurementSession({ requestId: measureRequest, start: null, current: null });
    onMeasurementMessage("Укажите первую точку размера");
  }, [measureRequest, onMeasurementMessage, onPreviewProject]);

  useEffect(() => {
    if (measureRequest || !measurementSession) return;
    setMeasurementSession(null);
  }, [measureRequest, measurementSession]);

  useEffect(() => {
    if (!measurementSession) return;
    const onMeasureKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setMeasurementSession(null);
      onMeasurementMessage("Измерение отменено");
    };
    window.addEventListener("keydown", onMeasureKeyDown, true);
    return () => window.removeEventListener("keydown", onMeasureKeyDown, true);
  }, [measurementSession, onMeasurementMessage]);

  const cancelBetween = useCallback(() => {
    onPreviewProject(null);
    setBetweenSession(null);
    onBetweenMessage("Выравнивание отменено");
  }, [onBetweenMessage, onPreviewProject]);

  const applyBetween = useCallback(() => {
    if (!betweenSession?.preview) return;
    onCommitProject(betweenSession.preview, "Выравнивание между перегородками");
    setBetweenSession(null);
  }, [betweenSession, onCommitProject]);

  const selectBetweenBoundary = useCallback((boundaryId: string) => {
    const current = betweenSession;
    if (!current) return;
    if (current.firstBoundaryId === boundaryId) {
      onBetweenMessage("Выберите другую перегородку");
      return;
    }
    if (!current.firstBoundaryId) {
      onBetweenMessage("Укажите вторую перегородку");
      setBetweenSession({ ...current, firstBoundaryId: boundaryId, error: null });
      return;
    }
    const first = betweenBoundaries.find((boundary) => boundary.id === current.firstBoundaryId);
    const second = betweenBoundaries.find((boundary) => boundary.id === boundaryId);
    if (!first || !second) {
      setBetweenSession({ ...current, error: "Перегородка недоступна" });
      return;
    }
    const targets = current.baseProject.objects.filter(
      (object) => current.objectIds.includes(object.id) && !object.locked,
    );
    const result = alignObjectsBetweenBoundaries(
      targets,
      first,
      second,
      current.mode,
      current.baseProject.canvas.wallSnapOffsetM,
    );
    if (!result.ok) {
      onPreviewProject(null);
      onBetweenMessage(result.message);
      setBetweenSession({
        ...current,
        secondBoundaryId: boundaryId,
        preview: null,
        availableM: null,
        gapM: null,
        error: result.message,
      });
      return;
    }
    const preview = replaceObjectsCommand(current.baseProject, result.objects);
    onPreviewProject(preview);
    onBetweenMessage("Проверьте результат и нажмите «Применить»");
    setBetweenSession({
      ...current,
      secondBoundaryId: boundaryId,
      preview,
      availableM: result.availableM,
      gapM: result.gapM,
      error: null,
    });
  }, [betweenBoundaries, betweenSession, onBetweenMessage, onPreviewProject]);

  useEffect(() => {
    if (!betweenSession) return;
    const onBetweenKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") cancelBetween();
      else applyBetween();
    };
    window.addEventListener("keydown", onBetweenKeyDown, true);
    return () => window.removeEventListener("keydown", onBetweenKeyDown, true);
  }, [applyBetween, betweenSession, cancelBetween]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    setContextMenu(null);
    if (event.button !== 0 && event.button !== 1) return;
    const screen = localPoint(event.clientX, event.clientY);
    const target = event.target as Element;
    const handleElement = target.closest<SVGElement>("[data-handle]");
    const objectElement = target.closest<SVGElement>("[data-object-id]");
    const boundaryElement = target.closest<SVGElement>("[data-boundary-id]");

    if (measurementSession && event.button === 0) {
      event.preventDefault();
      const raw = planPoint(screen);
      const point = {
        xM: snapMeters(raw.x, project.canvas.snapEnabled, project.canvas.snapStepM),
        yM: snapMeters(raw.y, project.canvas.snapEnabled, project.canvas.snapStepM),
      };
      if (!measurementSession.start) {
        setMeasurementSession({ ...measurementSession, start: point, current: point });
        onMeasurementMessage("Укажите вторую точку размера");
      } else if (distanceMeters(measurementSession.start, point) > 0.001) {
        onAddDimension(measurementSession.start, point);
        setMeasurementSession(null);
      } else {
        onMeasurementMessage("Вторая точка должна отличаться от первой");
      }
      return;
    }

    if (betweenSession) {
      event.preventDefault();
      const boundaryId = boundaryElement?.dataset.boundaryId;
      if (boundaryId) selectBetweenBoundary(boundaryId);
      else onBetweenMessage("Укажите перегородку на плане");
      return;
    }

    if (event.button === 1 || (event.button === 0 && spacePressedRef.current)) {
      event.preventDefault();
      gestureRef.current = { mode: "pan", pointerId: event.pointerId, start: screen, camera };
      capture(event.pointerId);
      return;
    }

    if (handleElement) {
      event.preventDefault();
      const handle = handleElement.dataset.handle;
      const objectId = handleElement.dataset.objectId ?? null;
      const groupId = handleElement.dataset.groupId ?? null;
      const start = planPoint(screen);
      if (handle === "rotate" || handle === "group-rotate") {
        const objects = groupId
          ? project.objects.filter((object) => project.groups.find((group) => group.id === groupId)?.objectIds.includes(object.id))
          : project.objects.filter((object) => object.id === objectId);
        const bounds = getObjectsBounds(objects);
        if (!bounds) return;
        const center = { x: bounds.centerXM, y: bounds.centerYM };
        gestureRef.current = {
          mode: "rotate",
          pointerId: event.pointerId,
          center,
          startAngle: Math.atan2(start.y - center.y, start.x - center.x),
          baseProject: project,
          objectId,
          groupId,
          startObjectAngle: objects[0]?.rotationDeg ?? 0,
          preview: null,
        };
      } else if (objectId) {
        const object = project.objects.find((candidate) => candidate.id === objectId);
        if (!object) return;
        gestureRef.current = { mode: "resize", pointerId: event.pointerId, startPlan: start, baseProject: project, object, handle: handle as ResizeHandle, preview: null };
      }
      capture(event.pointerId);
      return;
    }

    if (objectElement) {
      event.preventDefault();
      const objectId = objectElement.dataset.objectId;
      if (!objectId) return;
      const group = getGroupForObject(project, objectId);
      if (event.detail >= 2 && group) {
        onEnterGroup(group.id);
        return;
      }
      const alreadySelected = selection.objectIds.includes(objectId);
      const nextSelection = alreadySelected && !event.shiftKey
        ? selection
        : selectTarget(project, selection, objectId, event.shiftKey);
      onSelectionChange(nextSelection);
      if (!nextSelection.objectIds.includes(objectId)) return;
      const startPlan = planPoint(screen);
      const startObjects = project.objects.filter((object) => nextSelection.objectIds.includes(object.id));
      const nextSelectedSet = new Set(nextSelection.objectIds);
      const otherObjects = project.objects.filter((object) => !nextSelectedSet.has(object.id));
      const boundaries = getPlanBoundaries(project, new Set(nextSelection.objectIds));
      gestureRef.current = {
        mode: "move",
        pointerId: event.pointerId,
        startPlan,
        baseProject: project,
        startObjects,
        otherObjects,
        boundaries,
        preview: null,
        activeBoundaryId: null,
        candidateIndex: 0,
        lastPlan: null,
        snappingDisabled: false,
      };
      capture(event.pointerId);
      return;
    }

    if (!event.shiftKey) onSelectionChange({ objectIds: [], groupIds: [], groupEditId: selection.groupEditId });
    gestureRef.current = { mode: "marquee", pointerId: event.pointerId, start: screen, current: screen, additive: event.shiftKey };
    setMarquee({ start: screen, current: screen });
    capture(event.pointerId);
  };

  const previewMoveGesture = useCallback((
    gesture: MoveGesture,
    currentPlan: ScreenPoint,
    snappingDisabled: boolean,
  ) => {
    const movable = gesture.startObjects.filter((object) => !object.locked);
    const resolution = resolveMoveSnap({
      objects: movable,
      otherObjects: gesture.otherObjects,
      rawDeltaXM: currentPlan.x - gesture.startPlan.x,
      rawDeltaYM: currentPlan.y - gesture.startPlan.y,
      boundaries: gesture.boundaries,
      snapEnabled: gesture.baseProject.canvas.snapEnabled,
      snapStepM: gesture.baseProject.canvas.snapStepM,
      wallOffsetM: gesture.baseProject.canvas.wallSnapOffsetM,
      autoRotateFurniture: gesture.baseProject.canvas.autoRotateFurnitureToWall,
      autoRotatePartitions: gesture.baseProject.canvas.autoRotatePartitionsToWall,
      unitsPerMeter: gesture.baseProject.basePlan.unitsPerMeter,
      zoom: camera.zoom,
      candidateIndex: gesture.candidateIndex,
      activeBoundaryId: gesture.activeBoundaryId,
      snappingDisabled,
    });
    gesture.activeBoundaryId = resolution.activeBoundaryId;
    gesture.lastPlan = currentPlan;
    gesture.snappingDisabled = snappingDisabled;
    setSnapGuide(resolution.guide);
    setMovePreviewActive(true);
    const oriented = movable.map((object) => resolution.rotations[object.id] === undefined
      ? object
      : { ...object, rotationDeg: resolution.rotations[object.id] });
    const preview = replaceObjectsCommand(
      gesture.baseProject,
      moveObjects(oriented, resolution.deltaXM, resolution.deltaYM),
    );
    gesture.preview = preview;
    onPreviewProject(preview);
  }, [camera.zoom, onPreviewProject]);

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const screen = localPoint(event.clientX, event.clientY);
    if (measurementSession?.start && !gestureRef.current) {
      const raw = planPoint(screen);
      setMeasurementSession((current) => current ? {
        ...current,
        current: {
          xM: snapMeters(raw.x, project.canvas.snapEnabled, project.canvas.snapStepM),
          yM: snapMeters(raw.y, project.canvas.snapEnabled, project.canvas.snapStepM),
        },
      } : current);
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.mode === "pan") {
      onCameraChange({ ...gesture.camera, x: gesture.camera.x + screen.x - gesture.start.x, y: gesture.camera.y + screen.y - gesture.start.y });
      return;
    }
    if (gesture.mode === "marquee") {
      gesture.current = screen;
      setMarquee({ start: gesture.start, current: screen });
      return;
    }
    const currentPlan = planPoint(screen);
    if (gesture.mode === "move") {
      previewMoveGesture(gesture, currentPlan, event.altKey);
      return;
    }
    if (gesture.mode === "resize") {
      const resized = resizeObjectFromHandle(
        gesture.object,
        gesture.handle,
        currentPlan.x - gesture.startPlan.x,
        currentPlan.y - gesture.startPlan.y,
        event.shiftKey || gesture.object.type === "custom-circle",
        (value) => snapMeters(value, project.canvas.snapEnabled, project.canvas.snapStepM),
      );
      const preview = replaceObjectsCommand(gesture.baseProject, [resized]);
      gesture.preview = preview;
      onPreviewProject(preview);
      return;
    }
    const pointerAngle = Math.atan2(currentPlan.y - gesture.center.y, currentPlan.x - gesture.center.x);
    let deltaDeg = (pointerAngle - gesture.startAngle) * 180 / Math.PI;
    if (event.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;
    const preview = gesture.groupId
      ? rotateSelectionCommand(gesture.baseProject, {
          objectIds: gesture.baseProject.groups.find((group) => group.id === gesture.groupId)?.objectIds ?? [],
          groupIds: [gesture.groupId],
          groupEditId: null,
        }, deltaDeg)
      : updateObjectsCommand(gesture.baseProject, gesture.objectId ? [gesture.objectId] : [], { rotationDeg: gesture.startObjectAngle + deltaDeg });
    gesture.preview = preview;
    onPreviewProject(preview);
  };

  useEffect(() => {
    const onSnapKeyDown = (event: KeyboardEvent) => {
      const gesture = gestureRef.current;
      if (event.key !== "Tab" || gesture?.mode !== "move" || !gesture.lastPlan) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      gesture.candidateIndex += event.shiftKey ? -1 : 1;
      previewMoveGesture(gesture, gesture.lastPlan, gesture.snappingDisabled);
    };
    window.addEventListener("keydown", onSnapKeyDown, true);
    return () => window.removeEventListener("keydown", onSnapKeyDown, true);
  }, [previewMoveGesture]);

  const finishGesture = (event: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    try { svgRef.current?.releasePointerCapture(event.pointerId); } catch { /* no active capture */ }
    if (gesture.mode === "marquee") {
      const start = planPoint(gesture.start);
      const end = planPoint(gesture.current);
      const bounds: BoundsM = {
        minXM: Math.min(start.x, end.x),
        minYM: Math.min(start.y, end.y),
        maxXM: Math.max(start.x, end.x),
        maxYM: Math.max(start.y, end.y),
        widthM: Math.abs(end.x - start.x),
        heightM: Math.abs(end.y - start.y),
        centerXM: (start.x + end.x) / 2,
        centerYM: (start.y + end.y) / 2,
      };
      const nextObjectIds = new Set(gesture.additive ? selection.objectIds : []);
      const nextGroupIds = new Set(gesture.additive ? selection.groupIds : []);
      for (const object of project.objects) {
        if (!isObjectInsideBounds(object, bounds)) continue;
        const group = getGroupForObject(project, object.id);
        if (group && selection.groupEditId !== group.id) {
          group.objectIds.forEach((id) => nextObjectIds.add(id));
          nextGroupIds.add(group.id);
        } else {
          nextObjectIds.add(object.id);
        }
      }
      onSelectionChange({
        objectIds: [...nextObjectIds],
        groupIds: [...nextGroupIds],
        groupEditId: selection.groupEditId,
      });
      setMarquee(null);
      return;
    }
    if (gesture.mode === "move" || gesture.mode === "resize" || gesture.mode === "rotate") {
      setSnapGuide(null);
      setMovePreviewActive(false);
      if (gesture.preview) onCommitProject(gesture.preview, gesture.mode === "move" ? "Перемещение выборки" : gesture.mode === "resize" ? "Изменение размера" : "Поворот");
      else onPreviewProject(null);
    }
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = localPoint(event.clientX, event.clientY);
    onCameraChange(zoomCameraAtPoint(camera, point.x, point.y, Math.exp(-event.deltaY * 0.0012)));
  };

  const onContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (event.shiftKey && selection.objectIds.length >= 2) {
      onGroupSelection();
      return;
    }
    setContextMenu(localPoint(event.clientX, event.clientY));
  };

  const showSingleHandles = selection.objectIds.length === 1 && selection.groupIds.length === 0;
  const showGroupHandle = selection.groupIds.length === 1 && selectionBounds;
  const zoomPercent = Math.round(camera.zoom * 1000) / 10;
  const unitsPerMeter = project.basePlan.unitsPerMeter;

  return (
    <div className="canvas-frame" ref={frameRef}>
      <svg
        ref={svgRef}
        className={`plan-canvas${gestureRef.current?.mode === "pan" ? " is-panning" : ""}`}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Актуальная планировка компьютерного клуба"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      >
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
          <g transform={`rotate(${project.canvas.rotationDeg} ${project.basePlan.widthM * project.basePlan.unitsPerMeter / 2} ${project.basePlan.heightM * project.basePlan.unitsPerMeter / 2})`}>
            {plan ? <BasePlanLayer plan={plan} project={project} /> : null}
            {project.canvas.semanticLayerVisible ? (
              <g className="semantic-layer" pointerEvents="none">
                {semanticBoundaries.map((boundary) => (
                  <line
                    key={boundary.id}
                    className={`semantic-boundary semantic-boundary--${boundary.kind}`}
                    x1={boundary.start.xM * unitsPerMeter}
                    y1={boundary.start.yM * unitsPerMeter}
                    x2={boundary.end.xM * unitsPerMeter}
                    y2={boundary.end.yM * unitsPerMeter}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {semanticOpenings.map((opening) => {
                  const sweepPath = opening.kind === "door"
                    ? doorSweepPath(opening, unitsPerMeter)
                    : null;
                  return (
                    <g key={opening.id} className={`semantic-opening semantic-opening--${opening.kind}`}>
                      {sweepPath ? <path className="door-exclusion-zone" d={sweepPath} vectorEffect="non-scaling-stroke" /> : null}
                      <line
                        x1={opening.start.xM * unitsPerMeter}
                        y1={opening.start.yM * unitsPerMeter}
                        x2={opening.end.xM * unitsPerMeter}
                        y2={opening.end.yM * unitsPerMeter}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })}
              </g>
            ) : null}
            {project.canvas.clearanceWarningsVisible ? (
              <g className="clearance-layer" pointerEvents="none">
                {project.objects.filter((object) => !["zone", "door", "window"].includes(object.kind)).map((object) => {
                  const bounds = getClearanceBounds(object, project.canvas.minimumPassageWidthM);
                  if (!bounds) return null;
                  return (
                    <rect
                      key={object.id}
                      className={`clearance-zone${warningObjectIds.has(object.id) ? " has-warning" : ""}`}
                      x={bounds.minXM * unitsPerMeter}
                      y={bounds.minYM * unitsPerMeter}
                      width={bounds.widthM * unitsPerMeter}
                      height={bounds.heightM * unitsPerMeter}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </g>
            ) : null}
            <g className={`objects-layer${movePreviewActive || betweenSession?.preview ? " is-previewing" : ""}`}>
              {project.objects.filter((object) => visibleLayers.has(object.layerId)).map((object) => (
                <ObjectShape
                  key={object.id}
                  object={object}
                  unitsPerMeter={project.basePlan.unitsPerMeter}
                  canvasRotationDeg={project.canvas.rotationDeg}
                  zoom={camera.zoom}
                  selected={selectedSet.has(object.id)}
                  showHandles={showSingleHandles && selectedSet.has(object.id)}
                  labelsVisible={project.canvas.objectLabelsVisible}
                  groupId={groupMap.get(object.id)}
                />
              ))}
              {selectionBounds && selection.objectIds.length > 1 ? (
                <g className="selection-group-overlay" pointerEvents="none">
                  <rect
                    x={selectionBounds.minXM * project.basePlan.unitsPerMeter}
                    y={selectionBounds.minYM * project.basePlan.unitsPerMeter}
                    width={selectionBounds.widthM * project.basePlan.unitsPerMeter}
                    height={selectionBounds.heightM * project.basePlan.unitsPerMeter}
                    className="selection-multi-box"
                    vectorEffect="non-scaling-stroke"
                  />
                  {showGroupHandle ? <>
                    <line className="rotation-line" x1={selectionBounds.centerXM * project.basePlan.unitsPerMeter} y1={selectionBounds.minYM * project.basePlan.unitsPerMeter} x2={selectionBounds.centerXM * project.basePlan.unitsPerMeter} y2={selectionBounds.minYM * project.basePlan.unitsPerMeter - 30 / camera.zoom} vectorEffect="non-scaling-stroke" />
                    <circle className="rotation-handle" data-handle="group-rotate" data-group-id={selection.groupIds[0]} cx={selectionBounds.centerXM * project.basePlan.unitsPerMeter} cy={selectionBounds.minYM * project.basePlan.unitsPerMeter - 30 / camera.zoom} r={7 / camera.zoom} vectorEffect="non-scaling-stroke" pointerEvents="all" />
                  </> : null}
                </g>
              ) : null}
            </g>
            <g className="dimensions-layer" pointerEvents="none">
              {project.dimensions.map((dimension) => {
                const midX = (dimension.start.xM + dimension.end.xM) / 2 * unitsPerMeter;
                const midY = (dimension.start.yM + dimension.end.yM) / 2 * unitsPerMeter;
                return (
                  <g key={dimension.id}>
                    <line className="dimension-line" x1={dimension.start.xM * unitsPerMeter} y1={dimension.start.yM * unitsPerMeter} x2={dimension.end.xM * unitsPerMeter} y2={dimension.end.yM * unitsPerMeter} vectorEffect="non-scaling-stroke" />
                    <circle className="dimension-point" cx={dimension.start.xM * unitsPerMeter} cy={dimension.start.yM * unitsPerMeter} r={3.5 / camera.zoom} vectorEffect="non-scaling-stroke" />
                    <circle className="dimension-point" cx={dimension.end.xM * unitsPerMeter} cy={dimension.end.yM * unitsPerMeter} r={3.5 / camera.zoom} vectorEffect="non-scaling-stroke" />
                    {dimension.labelVisible ? (
                      <text
                        className="dimension-label"
                        x={midX}
                        y={midY - 8 / camera.zoom}
                        fontSize={13 / camera.zoom}
                        transform={`rotate(${-project.canvas.rotationDeg} ${midX} ${midY})`}
                      >
                        {dimension.name || formatMeters(distanceMeters(dimension.start, dimension.end))}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {measurementSession?.start && measurementSession.current ? (
                <g className="measurement-preview">
                  <line className="dimension-line" x1={measurementSession.start.xM * unitsPerMeter} y1={measurementSession.start.yM * unitsPerMeter} x2={measurementSession.current.xM * unitsPerMeter} y2={measurementSession.current.yM * unitsPerMeter} vectorEffect="non-scaling-stroke" />
                  <circle className="dimension-point" cx={measurementSession.start.xM * unitsPerMeter} cy={measurementSession.start.yM * unitsPerMeter} r={4 / camera.zoom} vectorEffect="non-scaling-stroke" />
                  <text className="dimension-label" x={(measurementSession.start.xM + measurementSession.current.xM) / 2 * unitsPerMeter} y={(measurementSession.start.yM + measurementSession.current.yM) / 2 * unitsPerMeter - 8 / camera.zoom} fontSize={13 / camera.zoom}>
                    {formatMeters(distanceMeters(measurementSession.start, measurementSession.current))}
                  </text>
                </g>
              ) : null}
            </g>
            {snapGuide ? (
              <g className="snap-guide" pointerEvents="none">
                {snapGuide.boundary ? <line
                  className="snap-guide__boundary"
                  x1={snapGuide.boundary.start.xM * project.basePlan.unitsPerMeter}
                  y1={snapGuide.boundary.start.yM * project.basePlan.unitsPerMeter}
                  x2={snapGuide.boundary.end.xM * project.basePlan.unitsPerMeter}
                  y2={snapGuide.boundary.end.yM * project.basePlan.unitsPerMeter}
                  vectorEffect="non-scaling-stroke"
                /> : null}
                <line
                  className="snap-guide__distance"
                  x1={snapGuide.from.xM * project.basePlan.unitsPerMeter}
                  y1={snapGuide.from.yM * project.basePlan.unitsPerMeter}
                  x2={snapGuide.to.xM * project.basePlan.unitsPerMeter}
                  y2={snapGuide.to.yM * project.basePlan.unitsPerMeter}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  className="snap-guide__point"
                  cx={snapGuide.to.xM * project.basePlan.unitsPerMeter}
                  cy={snapGuide.to.yM * project.basePlan.unitsPerMeter}
                  r={5 / camera.zoom}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : null}
            {betweenSession ? (
              <g className="between-boundaries-layer">
                {betweenBoundaries.map((boundary) => {
                  const active = boundary.id === betweenSession.firstBoundaryId
                    || boundary.id === betweenSession.secondBoundaryId;
                  const startX = boundary.start.xM * project.basePlan.unitsPerMeter;
                  const startY = boundary.start.yM * project.basePlan.unitsPerMeter;
                  const endX = boundary.end.xM * project.basePlan.unitsPerMeter;
                  const endY = boundary.end.yM * project.basePlan.unitsPerMeter;
                  const hitLength = Math.hypot(endX - startX, endY - startY);
                  const hitAngle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;
                  const hitSize = 18 / camera.zoom;
                  return (
                    <g key={boundary.id}>
                      <line
                        className={`between-boundary${active ? " is-active" : ""}`}
                        x1={startX}
                        y1={startY}
                        x2={endX}
                        y2={endY}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                      <rect
                        className="between-boundary-hit"
                        data-boundary-id={boundary.id}
                        role="button"
                        aria-label="Перегородка для выравнивания"
                        x="0"
                        y={-hitSize / 2}
                        width={hitLength}
                        height={hitSize}
                        transform={`translate(${startX} ${startY}) rotate(${hitAngle})`}
                      />
                    </g>
                  );
                })}
              </g>
            ) : null}
          </g>
        </g>
      </svg>

      {plan ? null : <div className="canvas-loading" role="status">Загружаем точный векторный план…</div>}
      {marquee ? <div className="selection-marquee" style={{ left: Math.min(marquee.start.x, marquee.current.x), top: Math.min(marquee.start.y, marquee.current.y), width: Math.abs(marquee.current.x - marquee.start.x), height: Math.abs(marquee.current.y - marquee.start.y) }} /> : null}
      {snapGuide ? (
        <div className="snap-guide-badge">
          {{
            wall: "К стене",
            center: "Центр",
            corner: "Угол",
            parallel: "Параллельно",
            "object-edge": "Край–край",
            "object-center": "Центр–центр",
            "equal-gap": "Равные промежутки",
          }[snapGuide.snapType]}
          {snapGuide.snapType === "equal-gap"
            ? ` · промежуток ${snapGuide.distanceM.toFixed(2)} м`
            : snapGuide.snapType === "object-edge" || snapGuide.snapType === "object-center"
              ? ""
              : ` · отступ ${snapGuide.distanceM.toFixed(2)} м`}
          {snapGuide.candidateCount > 1
            ? ` · ${snapGuide.candidateIndex + 1}/${snapGuide.candidateCount} · Tab — вариант`
            : ""}
          {" · Alt — отключить"}
        </div>
      ) : null}
      {measurementSession ? (
        <div className="measurement-toolbar" role="dialog" aria-label="Инструмент Линейка">
          <strong>Линейка</strong>
          <span>{measurementSession.start ? "Укажите вторую точку · Esc — отмена" : "Укажите первую точку · Esc — отмена"}</span>
        </div>
      ) : null}
      {betweenSession ? (
        <div className="between-toolbar" role="dialog" aria-label="Выравнивание между перегородками">
          <strong>{betweenSession.mode === "center"
            ? "По центру между перегородками"
            : betweenSession.mode === "distribute"
              ? "Равные промежутки"
              : "Заполнить проём"}</strong>
          <span>
            {!betweenSession.firstBoundaryId
              ? "Укажите первую перегородку"
              : !betweenSession.secondBoundaryId
                ? "Укажите вторую перегородку"
                : betweenSession.error ?? (betweenSession.availableM !== null && betweenSession.gapM !== null
                  ? `Свободно ${betweenSession.availableM.toFixed(2)} м · ${betweenSession.mode === "distribute" ? "промежуток" : "отступ"} ${betweenSession.gapM.toFixed(2)} м`
                  : "Проверьте результат")}
          </span>
          <div className="between-toolbar__actions">
            <button type="button" className="button--primary" disabled={!betweenSession.preview} onClick={applyBetween}>Применить</button>
            <button type="button" onClick={cancelBetween}>Отмена</button>
          </div>
        </div>
      ) : null}
      <div className="canvas-zoom-hud">{zoomPercent}% · {project.canvas.rotationDeg}°</div>
      {selection.groupEditId ? <div className="group-edit-badge">Редактирование группы · Esc — выйти</div> : null}
      {contextMenu ? (
        <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
          <button type="button" onClick={() => { onGroupSelection(); setContextMenu(null); }} disabled={selection.objectIds.length < 2 || selection.groupIds.length > 0}>Сгруппировать</button>
          <button type="button" onClick={() => { onUngroupSelection(); setContextMenu(null); }} disabled={selection.groupIds.length === 0}>Разгруппировать</button>
          <button type="button" onClick={() => { onDeleteSelection(); setContextMenu(null); }} disabled={selection.objectIds.length === 0}>Удалить</button>
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">Выбрано предметов: {selectedObjects.length}</span>
    </div>
  );
}
