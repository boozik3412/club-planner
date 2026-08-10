import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fitCamera,
  screenToPlanUnits,
  zoomCameraAtPoint,
  type ViewportSize,
} from "../editor/camera/camera";
import {
  moveObjectsSnappedCommand,
  replaceObjectsCommand,
  rotateSelectionCommand,
  updateObjectsCommand,
} from "../editor/commands/project-commands";
import {
  getObjectsBounds,
  isObjectInsideBounds,
  resizeObjectFromHandle,
  type ResizeHandle,
} from "../editor/geometry/geometry";
import { loadBasePlan, type LoadedBasePlan } from "../editor/load-base-plan";
import { snapMeters } from "../editor/model/project";
import type {
  BoundsM,
  CameraState,
  ObjectId,
  PlanObject,
  ProjectState,
  SelectionState,
} from "../editor/model/types";
import {
  getGroupForObject,
  getSelectedObjects,
  getSelectionBounds,
  selectTarget,
} from "../editor/selection/selection";
import { ObjectShape } from "./ObjectShape";

interface BasePlanCanvasProps {
  project: ProjectState;
  selection: SelectionState;
  camera: CameraState;
  fitRequest: number;
  onCameraChange: (camera: CameraState) => void;
  onSelectionChange: (selection: SelectionState) => void;
  onPreviewProject: (project: ProjectState | null) => void;
  onCommitProject: (project: ProjectState, label: string) => void;
  onGroupSelection: () => void;
  onUngroupSelection: () => void;
  onDeleteSelection: () => void;
  onEnterGroup: (groupId: string) => void;
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
  | { mode: "move"; pointerId: number; startPlan: ScreenPoint; baseProject: ProjectState; objectIds: ObjectId[]; startObjects: PlanObject[]; preview: ProjectState | null }
  | { mode: "resize"; pointerId: number; startPlan: ScreenPoint; baseProject: ProjectState; object: PlanObject; handle: ResizeHandle; preview: ProjectState | null }
  | { mode: "rotate"; pointerId: number; center: ScreenPoint; startAngle: number; baseProject: ProjectState; objectId: ObjectId | null; groupId: string | null; startObjectAngle: number; preview: ProjectState | null };

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
  onCameraChange,
  onSelectionChange,
  onPreviewProject,
  onCommitProject,
  onGroupSelection,
  onUngroupSelection,
  onDeleteSelection,
  onEnterGroup,
  onReady,
  onError,
}: BasePlanCanvasProps) {
  const [plan, setPlan] = useState<LoadedBasePlan | null>(null);
  const [viewport, setViewport] = useState<ViewportSize>({ width: 1, height: 1 });
  const [marquee, setMarquee] = useState<{ start: ScreenPoint; current: ScreenPoint } | null>(null);
  const [contextMenu, setContextMenu] = useState<ScreenPoint | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const spacePressedRef = useRef(false);
  const lastFitKeyRef = useRef("");
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

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    setContextMenu(null);
    if (event.button !== 0 && event.button !== 1) return;
    const screen = localPoint(event.clientX, event.clientY);
    const target = event.target as Element;
    const handleElement = target.closest<SVGElement>("[data-handle]");
    const objectElement = target.closest<SVGElement>("[data-object-id]");

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
      gestureRef.current = {
        mode: "move",
        pointerId: event.pointerId,
        startPlan,
        baseProject: project,
        objectIds: nextSelection.objectIds,
        startObjects,
        preview: null,
      };
      capture(event.pointerId);
      return;
    }

    if (!event.shiftKey) onSelectionChange({ objectIds: [], groupIds: [], groupEditId: selection.groupEditId });
    gestureRef.current = { mode: "marquee", pointerId: event.pointerId, start: screen, current: screen, additive: event.shiftKey };
    setMarquee({ start: screen, current: screen });
    capture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const screen = localPoint(event.clientX, event.clientY);
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
      const preview = moveObjectsSnappedCommand(
        gesture.baseProject,
        gesture.objectIds,
        gesture.startObjects,
        currentPlan.x - gesture.startPlan.x,
        currentPlan.y - gesture.startPlan.y,
      );
      gesture.preview = preview;
      onPreviewProject(preview);
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
            <g className="objects-layer">
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
          </g>
        </g>
      </svg>

      {plan ? null : <div className="canvas-loading" role="status">Загружаем точный векторный план…</div>}
      {marquee ? <div className="selection-marquee" style={{ left: Math.min(marquee.start.x, marquee.current.x), top: Math.min(marquee.start.y, marquee.current.y), width: Math.abs(marquee.current.x - marquee.start.x), height: Math.abs(marquee.current.y - marquee.start.y) }} /> : null}
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
