import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arcFromBulge, openingEndpoints, wallSvgPath } from "../editor/architecture/geometry";
import type { ArchitecturalWall, SourcePoint } from "../editor/model/types";
import { bulgeFromThreePoints } from "../editor/recognition/graph";
import { addManualWallToDraft, deleteReviewWallFromDraft, type ManualWallProperties, type ReviewDraftCommandResult } from "../editor/recognition/review-commands";
import { resolveReviewSnap, type ReviewSnapResult } from "../editor/recognition/review-snap";
import type { RecognitionDraft } from "../editor/recognition/types";

export type ReviewManualTool = "none" | "line" | "arc" | "region";

interface ViewBoxState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RecognitionReviewCanvasProps {
  draft: RecognitionDraft;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  metersPerSourceUnit: number;
  visibleWalls: ArchitecturalWall[];
  visibleVertexIds: ReadonlySet<string>;
  selectedWallId: string | null;
  manualTool: ReviewManualTool;
  manualWallProperties: ManualWallProperties;
  onSelectWall: (wallId: string | null) => void;
  onSetManualTool: (tool: ReviewManualTool) => void;
  onApplyCommand: (command: (current: RecognitionDraft) => ReviewDraftCommandResult) => void;
  onPreviewDraft: (draft: RecognitionDraft) => void;
  onCommitPreview: (before: RecognitionDraft) => void;
  onAnalyzeRegion: (first: SourcePoint, second: SourcePoint) => void;
  onUndo: () => void;
  onRedo: () => void;
  onError: (message: string | null) => void;
}

function confidenceColor(confidence = 0): string {
  return confidence >= 0.86 ? "#22c55e" : confidence >= 0.65 ? "#f59e0b" : "#ef4444";
}

type SvgClientEvent = React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>;

function eventSourcePoint(event: SvgClientEvent): SourcePoint {
  const matrix = typeof event.currentTarget.getScreenCTM === "function" ? event.currentTarget.getScreenCTM() : null;
  if (matrix && typeof DOMPoint !== "undefined") {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  const bounds = event.currentTarget.getBoundingClientRect();
  const attribute = event.currentTarget.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? [];
  const base = event.currentTarget.viewBox?.baseVal;
  const viewBox = base && base.width > 0
    ? base
    : { x: attribute[0] ?? 0, y: attribute[1] ?? 0, width: attribute[2] ?? 1, height: attribute[3] ?? 1 };
  return {
    x: viewBox.x + (event.clientX - bounds.left) / bounds.width * viewBox.width,
    y: viewBox.y + (event.clientY - bounds.top) / bounds.height * viewBox.height,
  };
}

function sourceScale(svg: SVGSVGElement | null, viewBox: ViewBoxState): number {
  if (!svg) return 1;
  const bounds = svg.getBoundingClientRect();
  return Math.max(0.001, Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height));
}

function targetFromSnap(snap: ReviewSnapResult, metersPerSourceUnit: number) {
  return {
    point: { xM: snap.point.x * metersPerSourceUnit, yM: snap.point.y * metersPerSourceUnit },
    vertexId: snap.vertexId,
    wallId: snap.wallId,
    alongM: snap.alongM,
  };
}

function arcPath(start: SourcePoint, through: SourcePoint, end: SourcePoint): { path: string; bulge: number; radius: number } | null {
  const bulge = bulgeFromThreePoints(
    { xM: start.x, yM: start.y },
    { xM: through.x, yM: through.y },
    { xM: end.x, yM: end.y },
  );
  if (!bulge) return null;
  const arc = arcFromBulge(
    { xM: start.x, yM: start.y },
    { xM: end.x, yM: end.y },
    bulge,
  );
  if (!arc) return null;
  return {
    path: `M ${start.x} ${start.y} A ${arc.radiusM} ${arc.radiusM} 0 ${Math.abs(arc.sweepRad) > Math.PI ? 1 : 0} ${arc.sweepRad > 0 ? 1 : 0} ${end.x} ${end.y}`,
    bulge,
    radius: arc.radiusM,
  };
}

function snapInstruction(tool: ReviewManualTool, count: number): string {
  if (tool === "line") return count === 0 ? "Укажите начало стены" : "Укажите конец стены";
  if (tool === "arc") {
    if (count === 0) return "Укажите начало дуги";
    if (count === 1) return "Укажите конец хорды";
    return "Задайте кривизну третьей точкой";
  }
  if (tool === "region") return count === 0 ? "Укажите первый угол области" : "Укажите противоположный угол";
  return "ЛКМ — выбрать · ПКМ/средняя кнопка — переместить холст";
}

export function RecognitionReviewCanvas({
  draft,
  imageUrl,
  imageWidth,
  imageHeight,
  metersPerSourceUnit,
  visibleWalls,
  visibleVertexIds,
  selectedWallId,
  manualTool,
  manualWallProperties,
  onSelectWall,
  onSetManualTool,
  onApplyCommand,
  onPreviewDraft,
  onCommitPreview,
  onAnalyzeRegion,
  onUndo,
  onRedo,
  onError,
}: RecognitionReviewCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeSnapIdRef = useRef<string | null>(null);
  const dragVertexRef = useRef<{ id: string; before: RecognitionDraft } | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; viewBox: ViewBoxState } | null>(null);
  const didPanRef = useRef(false);
  const [placements, setPlacements] = useState<ReviewSnapResult[]>([]);
  const [hoverSnap, setHoverSnap] = useState<ReviewSnapResult | null>(null);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [exactLengthText, setExactLengthText] = useState("");
  const [viewBox, setViewBox] = useState<ViewBoxState>({ x: 0, y: 0, width: imageWidth, height: imageHeight });
  const [underlayVisible, setUnderlayVisible] = useState(true);
  const [underlayOpacity, setUnderlayOpacity] = useState(0.58);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [candidatesVisible, setCandidatesVisible] = useState(true);
  const [acceptedVisible, setAcceptedVisible] = useState(true);
  const [manualVisible, setManualVisible] = useState(true);
  const [openingsVisible, setOpeningsVisible] = useState(true);

  const vertices = useMemo(() => new Map(draft.vertices.map((vertex) => [vertex.id, vertex])), [draft.vertices]);
  const pixelsPerSourceUnit = sourceScale(svgRef.current, viewBox);
  const markerRadius = 6 / pixelsPerSourceUnit;

  useEffect(() => {
    setViewBox({ x: 0, y: 0, width: imageWidth, height: imageHeight });
  }, [imageHeight, imageWidth]);

  useEffect(() => {
    setPlacements([]);
    setHoverSnap(null);
    activeSnapIdRef.current = null;
    setCycleIndex(0);
    setExactLengthText("");
  }, [manualTool]);

  const deleteSelected = useCallback(() => {
    if (!selectedWallId) return;
    onApplyCommand((current) => deleteReviewWallFromDraft(current, selectedWallId));
    onSelectWall(null);
  }, [onApplyCommand, onSelectWall, selectedWallId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof Element && target.matches("input, textarea, select, [contenteditable=true]");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        event.stopPropagation();
        onRedo();
        return;
      }
      if (editing) return;
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.code === "KeyW") {
        event.preventDefault();
        onSetManualTool("line");
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.code === "KeyA") {
        event.preventDefault();
        onSetManualTool("arc");
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (placements.length > 0) setPlacements([]);
        else onSetManualTool("none");
      } else if (event.key === "Tab" && (manualTool === "line" || manualTool === "arc")) {
        event.preventDefault();
        setCycleIndex((index) => index + 1);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedWallId) {
        event.preventDefault();
        deleteSelected();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [deleteSelected, manualTool, onRedo, onSetManualTool, onUndo, placements.length, selectedWallId]);

  const resolveAt = useCallback((rawPoint: SourcePoint, event: SvgClientEvent): ReviewSnapResult => {
    if (manualTool === "region") {
      return { id: "free", kind: "free", label: "свободная точка", point: rawPoint, distancePx: 0, priority: 99 };
    }
    const result = resolveReviewSnap(rawPoint, {
      draft,
      guides: guidesVisible ? draft.guides : undefined,
      metersPerSourceUnit,
      screenPxPerSourceUnit: sourceScale(svgRef.current, viewBox),
      startPoint: placements[0]?.point,
      activeCandidateId: activeSnapIdRef.current,
      modifiers: { disabled: event.altKey || !snappingEnabled, constrainAngle: event.shiftKey, cycleIndex },
    });
    activeSnapIdRef.current = result.id === "free" ? null : result.id;
    return result;
  }, [cycleIndex, draft, guidesVisible, manualTool, metersPerSourceUnit, placements, snappingEnabled, viewBox]);

  const commitPlacement = useCallback((snap: ReviewSnapResult) => {
    onError(null);
    const points = [...placements, snap];
    if (manualTool === "region") {
      if (points.length < 2) {
        setPlacements(points);
        return;
      }
      onAnalyzeRegion(points[0].point, points[1].point);
      setPlacements([]);
      onSetManualTool("none");
      return;
    }
    if (manualTool === "line") {
      if (points.length < 2) {
        setPlacements(points);
        return;
      }
      onApplyCommand((current) => addManualWallToDraft(
        current,
        targetFromSnap(points[0], metersPerSourceUnit),
        targetFromSnap(points[1], metersPerSourceUnit),
        { kind: "line" },
        manualWallProperties,
      ));
      setPlacements([points[1]]);
      return;
    }
    if (manualTool === "arc") {
      if (points.length < 3) {
        setPlacements(points);
        return;
      }
      const start = points[0];
      const end = points[1];
      const through = points[2];
      const curve = arcPath(start.point, through.point, end.point);
      if (!curve) {
        onError("Три точки лежат почти на одной прямой — задайте более заметную кривизну.");
        setPlacements(points.slice(0, 2));
        return;
      }
      onApplyCommand((current) => addManualWallToDraft(
        current,
        targetFromSnap(start, metersPerSourceUnit),
        targetFromSnap(end, metersPerSourceUnit),
        { kind: "arc", bulge: curve.bulge },
        manualWallProperties,
      ));
      setPlacements([end]);
    }
  }, [manualTool, manualWallProperties, metersPerSourceUnit, onAnalyzeRegion, onApplyCommand, onError, onSetManualTool, placements]);

  const preview = useMemo(() => {
    if (!hoverSnap || placements.length === 0) return null;
    const first = placements[0].point;
    if (manualTool === "region") {
      return { kind: "region" as const, first, end: hoverSnap.point };
    }
    if (manualTool === "line") {
      const lengthM = Math.hypot(hoverSnap.point.x - first.x, hoverSnap.point.y - first.y) * metersPerSourceUnit;
      const angleDeg = Math.atan2(hoverSnap.point.y - first.y, hoverSnap.point.x - first.x) * 180 / Math.PI;
      return { kind: "line" as const, first, end: hoverSnap.point, lengthM, angleDeg };
    }
    if (manualTool === "arc" && placements.length === 1) {
      return { kind: "chord" as const, first, end: hoverSnap.point };
    }
    if (manualTool === "arc" && placements.length >= 2) {
      const end = placements[1].point;
      const curve = arcPath(first, hoverSnap.point, end);
      if (!curve) return { kind: "chord" as const, first, end };
      const arc = arcFromBulge({ xM: first.x, yM: first.y }, { xM: end.x, yM: end.y }, curve.bulge)!;
      return {
        kind: "arc" as const,
        path: curve.path,
        end,
        lengthM: Math.abs(arc.sweepRad) * arc.radiusM * metersPerSourceUnit,
        radiusM: curve.radius * metersPerSourceUnit,
      };
    }
    return null;
  }, [hoverSnap, manualTool, metersPerSourceUnit, placements]);

  const exactEndpoint = useCallback(() => {
    if (manualTool !== "line" || placements.length !== 1 || !hoverSnap) return;
    const lengthM = Number(exactLengthText.replace(",", "."));
    if (!(lengthM > 0.02)) {
      onError("Введите длину стены больше 0,02 м.");
      return;
    }
    const start = placements[0].point;
    const dx = hoverSnap.point.x - start.x;
    const dy = hoverSnap.point.y - start.y;
    const sourceDirectionLength = Math.hypot(dx, dy);
    if (sourceDirectionLength <= Number.EPSILON) {
      onError("Сначала укажите направление стены курсором.");
      return;
    }
    const sourceLength = lengthM / metersPerSourceUnit;
    commitPlacement({
      id: "exact-length",
      kind: "free",
      label: "точная длина",
      point: { x: start.x + dx / sourceDirectionLength * sourceLength, y: start.y + dy / sourceDirectionLength * sourceLength },
      distancePx: 0,
      priority: 0,
    });
    setExactLengthText("");
  }, [commitPlacement, exactLengthText, hoverSnap, manualTool, metersPerSourceUnit, onError, placements]);

  const displayedWalls = useMemo(() => visibleWalls.filter((wall) => {
    if (wall.provenance === "manual") return manualVisible;
    if (wall.reviewStatus === "accepted") return acceptedVisible;
    return candidatesVisible;
  }), [acceptedVisible, candidatesVisible, manualVisible, visibleWalls]);
  const displayedVertexIds = useMemo(() => new Set(displayedWalls.flatMap((wall) => [wall.startVertexId, wall.endVertexId])), [displayedWalls]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const ratioX = (clientX - bounds.left) / Math.max(1, bounds.width);
    const ratioY = (clientY - bounds.top) / Math.max(1, bounds.height);
    setViewBox((current) => {
      const width = Math.max(imageWidth * 0.04, Math.min(imageWidth * 2, current.width * factor));
      const height = Math.max(imageHeight * 0.04, Math.min(imageHeight * 2, current.height * factor));
      return {
        x: current.x + (current.width - width) * ratioX,
        y: current.y + (current.height - height) * ratioY,
        width,
        height,
      };
    });
  }, [imageHeight, imageWidth]);

  const zoomFromCenter = useCallback((factor: number) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (bounds) zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, factor);
  }, [zoomAt]);

  return (
    <div className="import-preview-stage review-canvas">
      <div className="review-canvas__toolbar">
        <button type="button" title="Вписать план" onClick={() => setViewBox({ x: 0, y: 0, width: imageWidth, height: imageHeight })}>Вписать</button>
        <button type="button" title="Увеличить" onClick={() => zoomFromCenter(0.8)}>＋</button>
        <button type="button" title="Уменьшить" onClick={() => zoomFromCenter(1.25)}>−</button>
        <label><input type="checkbox" checked={underlayVisible} onChange={(event) => setUnderlayVisible(event.target.checked)} /> Подложка</label>
        <label><input type="checkbox" checked={snappingEnabled} onChange={(event) => setSnappingEnabled(event.target.checked)} /> Магниты</label>
        <label><input type="checkbox" checked={guidesVisible} onChange={(event) => setGuidesVisible(event.target.checked)} /> Направляющие</label>
        <label><input type="checkbox" checked={candidatesVisible} onChange={(event) => setCandidatesVisible(event.target.checked)} /> Кандидаты</label>
        <label><input type="checkbox" checked={acceptedVisible} onChange={(event) => setAcceptedVisible(event.target.checked)} /> Принятые</label>
        <label><input type="checkbox" checked={manualVisible} onChange={(event) => setManualVisible(event.target.checked)} /> Ручные</label>
        <label><input type="checkbox" checked={openingsVisible} onChange={(event) => setOpeningsVisible(event.target.checked)} /> Проёмы</label>
        {manualTool === "line" && placements.length === 1 ? <label className="review-exact-length">Длина, м <input aria-label="Точная длина новой стены, м" type="text" inputMode="decimal" placeholder="по курсору" value={exactLengthText} onChange={(event) => setExactLengthText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") exactEndpoint(); }} /></label> : null}
        <label className="review-opacity">Прозрачность <input aria-label="Прозрачность подложки" type="range" min="0.1" max="1" step="0.05" value={underlayOpacity} onChange={(event) => setUnderlayOpacity(Number(event.target.value))} /></label>
      </div>
      <div className="review-canvas__status" role="status">
        <strong>{snapInstruction(manualTool, placements.length)}</strong>
        {manualTool === "line" || manualTool === "arc" ? <span>Магнит: {hoverSnap?.label ?? "наведите на план"} · Alt отключает · Shift фиксирует угол · Tab меняет вариант · Esc отменяет</span> : null}
      </div>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Проверка и ручное исправление распознанной планировки"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!didPanRef.current && placements.length > 0) setPlacements([]);
        }}
        onWheel={(event) => {
          event.preventDefault();
          zoomAt(event.clientX, event.clientY, event.deltaY > 0 ? 1.12 : 0.89);
        }}
        onPointerDown={(event) => {
          if (event.button !== 1 && event.button !== 2) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          didPanRef.current = false;
          panRef.current = { clientX: event.clientX, clientY: event.clientY, viewBox };
        }}
        onPointerMove={(event) => {
          const panning = panRef.current;
          if (panning) {
            const scale = sourceScale(svgRef.current, panning.viewBox);
            const dx = (event.clientX - panning.clientX) / scale;
            const dy = (event.clientY - panning.clientY) / scale;
            if (Math.hypot(dx, dy) > 1) didPanRef.current = true;
            setViewBox({ ...panning.viewBox, x: panning.viewBox.x - dx, y: panning.viewBox.y - dy });
            return;
          }
          const dragging = dragVertexRef.current;
          const rawPoint = eventSourcePoint(event);
          if (dragging) {
            const next = structuredClone(draft);
            const vertex = next.vertices.find((candidate) => candidate.id === dragging.id);
            if (vertex) {
              vertex.xM = rawPoint.x * metersPerSourceUnit;
              vertex.yM = rawPoint.y * metersPerSourceUnit;
              vertex.provenance = "manual";
              onPreviewDraft(next);
            }
            return;
          }
          if (manualTool !== "none") setHoverSnap(resolveAt(rawPoint, event));
        }}
        onPointerUp={(event) => {
          if (panRef.current) {
            panRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }
          const dragging = dragVertexRef.current;
          if (dragging) {
            dragVertexRef.current = null;
            onCommitPreview(dragging.before);
          }
        }}
        onPointerLeave={() => setHoverSnap(null)}
        onClick={(event) => {
          if (didPanRef.current) {
            didPanRef.current = false;
            return;
          }
          if (manualTool === "none") {
            onSelectWall(null);
            return;
          }
          commitPlacement(resolveAt(eventSourcePoint(event), event));
        }}
      >
        {underlayVisible ? <image href={imageUrl} width={imageWidth} height={imageHeight} opacity={underlayOpacity} /> : null}
        {guidesVisible ? <g className="review-guides" aria-hidden="true">
          {draft.guides?.lines.slice(0, 260).map((guide) => <line key={guide.id} x1={guide.start.x} y1={guide.start.y} x2={guide.end.x} y2={guide.end.y} className={`review-guide review-guide--${guide.source}`} />)}
          {draft.guides?.arcs.slice(0, 72).map((guide) => {
            const path = arcPath(guide.start, guide.through, guide.end)?.path;
            return path ? <path key={guide.id} d={path} className="review-guide review-guide--arc" /> : null;
          })}
        </g> : null}
        {displayedWalls.map((wall) => {
          const path = wallSvgPath(wall, vertices, 1 / metersPerSourceUnit);
          return path ? <path key={wall.id} d={path} stroke={confidenceColor(wall.confidence)} className={`review-wall${wall.id === selectedWallId ? " is-selected" : ""}`} onClick={(event) => { if (manualTool !== "none") return; event.stopPropagation(); onSelectWall(wall.id); }} /> : null;
        })}
        {openingsVisible ? draft.openings.filter((opening) => opening.reviewStatus !== "rejected").map((opening) => {
          const wall = draft.walls.find((candidate) => candidate.id === opening.hostWallId);
          const endpoints = wall ? openingEndpoints(opening, wall, vertices) : null;
          return endpoints ? <line key={opening.id} x1={endpoints.start.xM / metersPerSourceUnit} y1={endpoints.start.yM / metersPerSourceUnit} x2={endpoints.end.xM / metersPerSourceUnit} y2={endpoints.end.yM / metersPerSourceUnit} className={`review-opening review-opening--${opening.kind}`} /> : null;
        }) : null}
        {draft.vertices.filter((vertex) => vertex.reviewStatus !== "rejected" && visibleVertexIds.has(vertex.id) && displayedVertexIds.has(vertex.id)).map((vertex) => <circle
          key={vertex.id}
          cx={vertex.xM / metersPerSourceUnit}
          cy={vertex.yM / metersPerSourceUnit}
          r={markerRadius * 0.62}
          className="review-vertex"
          onPointerDown={(event) => {
            if (manualTool !== "none" || event.button !== 0) return;
            event.stopPropagation();
            (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
            dragVertexRef.current = { id: vertex.id, before: structuredClone(draft) };
          }}
        />)}
        {placements.map((placement, index) => <g key={`${placement.id}:${index}`} className="manual-anchor"><circle cx={placement.point.x} cy={placement.point.y} r={markerRadius} /><text x={placement.point.x + markerRadius * 1.4} y={placement.point.y - markerRadius * 1.4}>{index + 1}</text></g>)}
        {preview?.kind === "region" ? <rect x={Math.min(preview.first.x, preview.end.x)} y={Math.min(preview.first.y, preview.end.y)} width={Math.abs(preview.end.x - preview.first.x)} height={Math.abs(preview.end.y - preview.first.y)} className="manual-region-preview" /> : null}
        {preview?.kind === "line" ? <g className="manual-wall-preview">
          <line x1={preview.first.x} y1={preview.first.y} x2={preview.end.x} y2={preview.end.y} className="manual-wall-preview__band" style={{ strokeWidth: manualWallProperties.thicknessM / metersPerSourceUnit }} />
          <line x1={preview.first.x} y1={preview.first.y} x2={preview.end.x} y2={preview.end.y} />
          <text x={preview.end.x + markerRadius * 1.4} y={preview.end.y - markerRadius * 1.4}>{preview.lengthM.toFixed(2)} м · {Math.round(preview.angleDeg)}°</text>
        </g> : null}
        {preview?.kind === "chord" ? <line x1={preview.first.x} y1={preview.first.y} x2={preview.end.x} y2={preview.end.y} className="manual-chord-preview" /> : null}
        {preview?.kind === "arc" ? <g className="manual-wall-preview">
          <path d={preview.path} className="manual-wall-preview__band" style={{ strokeWidth: manualWallProperties.thicknessM / metersPerSourceUnit }} />
          <path d={preview.path} />
          <text x={preview.end.x + markerRadius * 1.4} y={preview.end.y - markerRadius * 1.4}>{preview.lengthM.toFixed(2)} м · R {preview.radiusM.toFixed(2)} м</text>
        </g> : null}
        {hoverSnap && manualTool !== "none" ? <g className={`review-snap review-snap--${hoverSnap.kind}`}>
          <circle cx={hoverSnap.point.x} cy={hoverSnap.point.y} r={markerRadius} />
          <text x={hoverSnap.point.x + markerRadius * 1.5} y={hoverSnap.point.y + markerRadius * 2.8}>{hoverSnap.label}</text>
        </g> : null}
      </svg>
    </div>
  );
}
