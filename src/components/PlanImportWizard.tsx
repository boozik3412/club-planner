import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { wallLengthM, wallSvgPath } from "../editor/architecture/geometry";
import { createStableId } from "../editor/model/templates";
import type {
  ArchitectureVertex,
  ArchitecturalOpening,
  ArchitecturalWall,
  PlanSource,
  PointM,
  SourcePoint,
} from "../editor/model/types";
import {
  bytesToBase64,
  type BinaryFilePayload,
  type ProjectAssetPayload,
} from "../editor/persistence/desktop-files";
import { bulgeFromThreePoints } from "../editor/recognition/graph";
import { assessRecognitionQuality } from "../editor/recognition/quality";
import { createProjectFromRecognitionDraft } from "../editor/recognition/import-project";
import { startRecognition } from "../editor/recognition/client";
import { rectangleForQuad, transformSourcePoint } from "../editor/recognition/perspective";
import { cropRecognitionImage, mergeRegionRecognition, normalizedPixelRegion } from "../editor/recognition/region";
import { rectifyImageData, rotateImageData90, suggestDocumentQuad } from "../editor/recognition/rectify";
import {
  base64ToBytes,
  openPdfDocument,
  renderImage,
  renderPdfPage,
  safeEmbeddedSourceName,
  sha256Hex,
  sourceAsset,
  type RenderedPlanPage,
} from "../editor/recognition/source";
import {
  DEFAULT_RECOGNITION_OPTIONS,
  type RecognitionDraft,
  type RecognitionOptions,
  type RecognitionProgress,
  type RecognitionIssue,
} from "../editor/recognition/types";

interface PlanImportWizardProps {
  file: BinaryFilePayload;
  defaultWallHeightM: number;
  defaultWallThicknessM: number;
  onCancel: () => void;
  onComplete: (project: ReturnType<typeof createProjectFromRecognitionDraft>, assets: ProjectAssetPayload[]) => void;
}

type WizardStep = "prepare" | "calibrate" | "options" | "analyze" | "review";
type ManualTool = "none" | "line" | "arc" | "region";

interface PreparedPage {
  imageData: ImageData;
  previewUrl: string;
  vectorLines: RenderedPlanPage["vectorLines"];
  vectorOpeningLines: RenderedPlanPage["vectorOpeningLines"];
  vectorArcs: RenderedPlanPage["vectorArcs"];
  sourceToRectified: PlanSource["perspectiveMatrix"];
}

function imageDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось подготовить изображение");
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

async function imageDataPngAsset(imageData: ImageData, path: string, maxDimension?: number): Promise<ProjectAssetPayload> {
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(imageData.width, imageData.height)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imageData.width * scale));
  canvas.height = Math.max(1, Math.round(imageData.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось сформировать растровую подложку");
  if (scale === 1) context.putImageData(imageData, 0, 0);
  else {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = imageData.width;
    sourceCanvas.height = imageData.height;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("Не удалось сформировать миниатюру");
    sourceContext.putImageData(imageData, 0, 0);
    context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
    if (value) resolve(value);
    else reject(new Error("Не удалось сжать растровую подложку"));
  }, "image/png"));
  return { path, mimeType: "image/png", dataBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
}

function confidenceColor(confidence = 0): string {
  return confidence >= 0.86 ? "#22c55e" : confidence >= 0.65 ? "#f59e0b" : "#ef4444";
}

function svgPoint(event: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>, width: number, height: number): SourcePoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(width, (event.clientX - bounds.left) / bounds.width * width)),
    y: Math.max(0, Math.min(height, (event.clientY - bounds.top) / bounds.height * height)),
  };
}

function wallVertexMap(draft: RecognitionDraft): Map<string, ArchitectureVertex> {
  return new Map(draft.vertices.map((vertex) => [vertex.id, vertex]));
}

function reviewBlockingIssues(draft: RecognitionDraft): RecognitionIssue[] {
  const issues = draft.issues.filter((issue) => issue.severity === "error" && issue.id !== "no-walls");
  const vertices = wallVertexMap(draft);
  const acceptedWalls = draft.walls.filter((wall) => wall.reviewStatus === "accepted");
  const acceptedWallIds = new Set(acceptedWalls.map((wall) => wall.id));
  acceptedWalls.forEach((wall) => {
    if (!(wallLengthM(wall, vertices) > 0.02) || wall.heightM <= 0 || wall.thicknessM <= 0) {
      issues.push({ id: `review-wall:${wall.id}`, severity: "error", wallId: wall.id, message: "Принятая стена имеет некорректную геометрию или размеры" });
    }
  });
  draft.openings.filter((opening) => opening.reviewStatus === "accepted").forEach((opening) => {
    const wall = draft.walls.find((candidate) => candidate.id === opening.hostWallId);
    const lengthM = wall ? wallLengthM(wall, vertices) : 0;
    if (!wall || !acceptedWallIds.has(wall.id) || opening.offsetM < 0 || opening.widthM <= 0 || opening.offsetM + opening.widthM > lengthM + 0.001) {
      issues.push({ id: `review-opening:${opening.id}`, severity: "error", openingId: opening.id, wallId: opening.hostWallId, message: "Принятый проём находится вне принятой несущей стены" });
    }
  });
  return issues;
}

function addManualWall(draft: RecognitionDraft, points: readonly PointM[], curve: ArchitecturalWall["curve"]): RecognitionDraft {
  const next = structuredClone(draft);
  const start: ArchitectureVertex = {
    id: createStableId("vertex"), xM: points[0].xM, yM: points[0].yM,
    provenance: "manual", reviewStatus: "accepted", locked: false, confidence: 1,
  };
  const end: ArchitectureVertex = {
    id: createStableId("vertex"), xM: points[points.length - 1]?.xM ?? points[0].xM, yM: points[points.length - 1]?.yM ?? points[0].yM,
    provenance: "manual", reviewStatus: "accepted", locked: false, confidence: 1,
  };
  next.vertices.push(start, end);
  next.walls.push({
    id: createStableId("wall"), kind: "wall", startVertexId: start.id, endVertexId: end.id, curve,
    thicknessM: next.walls[0]?.thicknessM ?? 0.15,
    heightM: next.walls[0]?.heightM ?? 3,
    baseElevationM: 0, heightSource: "user", thicknessSource: "user",
    provenance: "manual", reviewStatus: "accepted", locked: false, confidence: 1,
  });
  return next;
}

export function PlanImportWizard({
  file,
  defaultWallHeightM,
  defaultWallThicknessM,
  onCancel,
  onComplete,
}: PlanImportWizardProps) {
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const recognitionRef = useRef<ReturnType<typeof startRecognition> | null>(null);
  const dragCornerRef = useRef<number | null>(null);
  const dragVertexRef = useRef<{ id: string; before: RecognitionDraft } | null>(null);
  const [step, setStep] = useState<WizardStep>("prepare");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<RenderedPlanPage | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [quad, setQuad] = useState<[SourcePoint, SourcePoint, SourcePoint, SourcePoint] | null>(null);
  const [prepared, setPrepared] = useState<PreparedPage | null>(null);
  const [calibrationPoints, setCalibrationPoints] = useState<SourcePoint[]>([]);
  const [knownDistanceM, setKnownDistanceM] = useState(1);
  const [options, setOptions] = useState<RecognitionOptions>({
    ...DEFAULT_RECOGNITION_OPTIONS,
    defaultWallHeightM,
    defaultWallThicknessM,
  });
  const [source, setSource] = useState<PlanSource | null>(null);
  const [progress, setProgress] = useState<RecognitionProgress | null>(null);
  const [draft, setDraft] = useState<RecognitionDraft | null>(null);
  const [undoStack, setUndoStack] = useState<RecognitionDraft[]>([]);
  const [redoStack, setRedoStack] = useState<RecognitionDraft[]>([]);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [manualTool, setManualTool] = useState<ManualTool>("none");
  const [manualPoints, setManualPoints] = useState<SourcePoint[]>([]);
  const [dimensionHintIds, setDimensionHintIds] = useState<string[]>([]);

  const loadPage = useCallback(async (index: number, pdf = pdfRef.current) => {
    setLoading(true);
    setError(null);
    try {
      const next = file.mimeType === "application/pdf"
        ? await renderPdfPage(pdf ?? await openPdfDocument(file), index)
        : await renderImage(file);
      setRendered((current) => {
        if (current?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(current.previewUrl);
        return next;
      });
      setPageIndex(index);
      setRotationDeg(0);
      setQuad(file.mimeType === "application/pdf" ? [
        { x: 0, y: 0 }, { x: next.imageData.width - 1, y: 0 },
        { x: next.imageData.width - 1, y: next.imageData.height - 1 }, { x: 0, y: next.imageData.height - 1 },
      ] : suggestDocumentQuad(next.imageData));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [file]);

  const rotatePage = useCallback((clockwise: boolean) => {
    setRendered((current) => {
      if (!current) return current;
      const oldWidth = current.imageData.width;
      const oldHeight = current.imageData.height;
      const imageData = rotateImageData90(current.imageData, clockwise);
      const rotatePoint = (point: SourcePoint): SourcePoint => clockwise
        ? { x: oldHeight - 1 - point.y, y: point.x }
        : { x: point.y, y: oldWidth - 1 - point.x };
      const next = {
        ...current,
        imageData,
        previewUrl: imageDataUrl(imageData),
        vectorLines: current.vectorLines.map((line) => ({ ...line, start: rotatePoint(line.start), end: rotatePoint(line.end) })),
        vectorOpeningLines: current.vectorOpeningLines.map((line) => ({ ...line, start: rotatePoint(line.start), end: rotatePoint(line.end) })),
        vectorArcs: current.vectorArcs.map((arc) => ({
          ...arc,
          start: rotatePoint(arc.start),
          through: rotatePoint(arc.through),
          end: rotatePoint(arc.end),
        })),
      };
      setQuad(file.mimeType === "application/pdf" ? [
        { x: 0, y: 0 }, { x: imageData.width - 1, y: 0 },
        { x: imageData.width - 1, y: imageData.height - 1 }, { x: 0, y: imageData.height - 1 },
      ] : suggestDocumentQuad(imageData));
      setRotationDeg((value) => (value + (clockwise ? 90 : -90) + 360) % 360);
      return next;
    });
  }, [file.mimeType]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (file.mimeType === "application/pdf") {
          const pdf = await openPdfDocument(file);
          if (!active) {
            await pdf.cleanup();
            return;
          }
          pdfRef.current = pdf;
          await loadPage(0, pdf);
        } else {
          await loadPage(0, null);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      recognitionRef.current?.cancel();
      const pdf = pdfRef.current;
      pdfRef.current = null;
      if (pdf) void pdf.cleanup();
    };
  }, [file, loadPage]);

  const prepareCrop = useCallback(() => {
    if (!rendered || !quad) return;
    try {
      const size = rectangleForQuad(quad);
      const scale = Math.min(1, 5_000 / Math.max(size.width, size.height));
      const result = rectifyImageData(rendered.imageData, quad, Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale)));
      const transformedLines = rendered.vectorLines.map((line) => ({
        ...line,
        start: transformSourcePoint(line.start, result.sourceToRectified),
        end: transformSourcePoint(line.end, result.sourceToRectified),
      }));
      const transformedOpeningLines = rendered.vectorOpeningLines.map((line) => ({
        ...line,
        start: transformSourcePoint(line.start, result.sourceToRectified),
        end: transformSourcePoint(line.end, result.sourceToRectified),
      }));
      const transformedArcs = rendered.vectorArcs.map((arc) => ({
        ...arc,
        start: transformSourcePoint(arc.start, result.sourceToRectified),
        through: transformSourcePoint(arc.through, result.sourceToRectified),
        end: transformSourcePoint(arc.end, result.sourceToRectified),
      }));
      setPrepared({
        imageData: result.imageData,
        previewUrl: imageDataUrl(result.imageData),
        vectorLines: transformedLines,
        vectorOpeningLines: transformedOpeningLines,
        vectorArcs: transformedArcs,
        sourceToRectified: result.sourceToRectified,
      });
      setCalibrationPoints([]);
      setStep("calibrate");
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : String(cropError));
    }
  }, [quad, rendered]);

  const calibrationScale = calibrationPoints.length === 2
    ? knownDistanceM / Math.hypot(calibrationPoints[1].x - calibrationPoints[0].x, calibrationPoints[1].y - calibrationPoints[0].y)
    : 0;

  const confirmCalibration = useCallback(async () => {
    if (!prepared || !quad || !(calibrationScale > 0)) return;
    const bytes = base64ToBytes(file.dataBase64);
    const hash = await sha256Hex(bytes);
    const embeddedPath = safeEmbeddedSourceName(file.name, hash);
    const nextSource: PlanSource = {
      id: createStableId("source"),
      kind: file.mimeType === "application/pdf" ? "pdf" : "image",
      name: file.name,
      mimeType: file.mimeType,
      sha256: hash,
      embeddedPath,
      previewPath: `previews/${hash.slice(0, 16)}-p${pageIndex + 1}.png`,
      thumbnailPath: `previews/${hash.slice(0, 16)}-p${pageIndex + 1}-thumb.png`,
      pageIndex,
      pageCount: rendered?.pageCount ?? 1,
      sourceWidth: prepared.imageData.width,
      sourceHeight: prepared.imageData.height,
      widthM: prepared.imageData.width * calibrationScale,
      heightM: prepared.imageData.height * calibrationScale,
      cropQuad: quad,
      rotationDeg,
      perspectiveMatrix: prepared.sourceToRectified,
      metersPerSourceUnit: calibrationScale,
      locked: true,
      recognizer: {
        engineVersion: "local-hybrid-2",
        pdfEngine: "pdf.js 6.2.108",
        cvEngine: "OpenCV.js 5.0.0",
        ocrEngine: "Tesseract.js 7.0.0 rus+eng",
      },
    };
    setSource(nextSource);
    setStep("options");
  }, [calibrationScale, file, pageIndex, prepared, quad, rendered?.pageCount, rotationDeg]);

  const runRecognition = useCallback(() => {
    if (!prepared || !source) return;
    setStep("analyze");
    setError(null);
    const task = startRecognition({
      width: prepared.imageData.width,
      height: prepared.imageData.height,
      rgba: new Uint8ClampedArray(prepared.imageData.data),
      cropQuad: source.cropQuad ?? quad!,
      outputWidth: prepared.imageData.width,
      outputHeight: prepared.imageData.height,
      metersPerPixel: source.metersPerSourceUnit ?? 0,
      vectorLines: prepared.vectorLines,
      vectorOpeningLines: prepared.vectorOpeningLines,
      vectorArcs: prepared.vectorArcs,
    }, source, options, setProgress);
    recognitionRef.current = task;
    void task.result.then((result) => {
      recognitionRef.current = null;
      setDraft(result);
      setUndoStack([]);
      setRedoStack([]);
      setStep("review");
    }).catch((recognitionError) => {
      recognitionRef.current = null;
      if (recognitionError instanceof DOMException && recognitionError.name === "AbortError") setStep("options");
      else {
        setError(recognitionError instanceof Error ? recognitionError.message : String(recognitionError));
        setStep("options");
      }
    });
  }, [options, prepared, quad, source]);

  const runRegionRecognition = useCallback((first: SourcePoint, second: SourcePoint) => {
    if (!prepared || !source || !draft || !source.metersPerSourceUnit) return;
    const region = normalizedPixelRegion(first, second, prepared.imageData.width, prepared.imageData.height);
    if (region.width < 16 || region.height < 16) {
      setError("Выделенная область слишком мала для повторного анализа");
      return;
    }
    const before = structuredClone(draft);
    const regionImage = cropRecognitionImage(prepared.imageData, region, source.metersPerSourceUnit, prepared.vectorLines, prepared.vectorArcs, prepared.vectorOpeningLines);
    const regionSource: PlanSource = {
      ...source,
      sourceWidth: region.width,
      sourceHeight: region.height,
      widthM: region.width * source.metersPerSourceUnit,
      heightM: region.height * source.metersPerSourceUnit,
    };
    setStep("analyze");
    setError(null);
    const task = startRecognition(regionImage, regionSource, options, setProgress);
    recognitionRef.current = task;
    void task.result.then((result) => {
      recognitionRef.current = null;
      setUndoStack((stack) => [...stack, before].slice(-100));
      setRedoStack([]);
      setDraft(mergeRegionRecognition(before, result, region, source));
      setStep("review");
    }).catch((recognitionError) => {
      recognitionRef.current = null;
      if (!(recognitionError instanceof DOMException && recognitionError.name === "AbortError")) {
        setError(recognitionError instanceof Error ? recognitionError.message : String(recognitionError));
      }
      setStep("review");
    });
  }, [draft, options, prepared, source]);

  const applyDraft = useCallback((change: (current: RecognitionDraft) => RecognitionDraft) => {
    setDraft((current) => {
      if (!current) return current;
      setUndoStack((stack) => [...stack, structuredClone(current)].slice(-100));
      setRedoStack([]);
      const next = change(structuredClone(current));
      next.quality = assessRecognitionQuality(next);
      return next;
    });
  }, []);

  const undoReview = useCallback(() => {
    if (!draft || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, structuredClone(draft)]);
    setDraft(previous);
  }, [draft, undoStack]);

  const redoReview = useCallback(() => {
    if (!draft || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, structuredClone(draft)]);
    setDraft(next);
  }, [draft, redoStack]);

  const reviewVertices = useMemo(() => draft ? wallVertexMap(draft) : new Map<string, ArchitectureVertex>(), [draft]);
  const selectedWall = draft?.walls.find((wall) => wall.id === selectedWallId) ?? null;
  const acceptedCount = draft?.walls.filter((wall) => wall.reviewStatus === "accepted").length ?? 0;
  const blockingIssues = useMemo(() => draft ? reviewBlockingIssues(draft) : [], [draft]);
  const reviewQuality = useMemo(() => draft ? draft.quality ?? assessRecognitionQuality(draft) : null, [draft]);
  const visibleReviewWalls = useMemo(() => {
    if (!draft) return [];
    const candidates = draft.walls.filter((wall) => wall.reviewStatus !== "rejected");
    if (!reviewQuality?.candidateExplosion || candidates.length <= 120) return candidates;
    return [...candidates]
      .sort((first, second) => (second.confidence ?? 0) - (first.confidence ?? 0))
      .slice(0, 120);
  }, [draft, reviewQuality?.candidateExplosion]);
  const visibleReviewVertexIds = useMemo(() => new Set(visibleReviewWalls.flatMap((wall) => [wall.startVertexId, wall.endVertexId])), [visibleReviewWalls]);

  const addOpening = useCallback((kind: ArchitecturalOpening["kind"]) => {
    if (!selectedWallId) return;
    applyDraft((next) => {
      const vertices = wallVertexMap(next);
      const wall = next.walls.find((candidate) => candidate.id === selectedWallId);
      if (!wall) return next;
      const lengthM = wallLengthM(wall, vertices);
      const widthM = Math.min(kind === "door" ? 0.9 : 1.2, Math.max(0.2, lengthM * 0.5));
      next.openings.push({
        id: createStableId("opening"), kind, hostWallId: wall.id, offsetM: Math.max(0, (lengthM - widthM) / 2), widthM,
        sillHeightM: kind === "door" ? 0 : 0.9, openingHeightM: kind === "door" ? 2.1 : 1.2,
        verticalSource: "user", swing: kind === "door" ? "right" : undefined, openingAngleDeg: kind === "door" ? 90 : undefined,
        provenance: "manual", reviewStatus: "accepted", confidence: 1, locked: false,
      });
      return next;
    });
  }, [applyDraft, selectedWallId]);

  const finish = useCallback(async () => {
    if (!draft || !prepared || acceptedCount === 0 || blockingIssues.length > 0) return;
    const project = createProjectFromRecognitionDraft(draft);
    dimensionHintIds.forEach((hintId) => {
      const hint = draft.textHints.find((candidate) => candidate.id === hintId);
      if (!hint || !source?.metersPerSourceUnit) return;
      const yM = (hint.bounds.y + hint.bounds.height / 2) * source.metersPerSourceUnit;
      project.dimensions.push({
        id: createStableId("dimension"),
        name: `Распознанный размер ${hint.text}`,
        start: { xM: hint.bounds.x * source.metersPerSourceUnit, yM },
        end: { xM: hint.bounds.x * source.metersPerSourceUnit + (hint.suggestedDistanceM ?? hint.bounds.width * source.metersPerSourceUnit), yM },
        labelVisible: true,
      });
    });
    const assets = [
      sourceAsset(file, draft.source.embeddedPath),
      await imageDataPngAsset(prepared.imageData, draft.source.previewPath!),
      await imageDataPngAsset(prepared.imageData, draft.source.thumbnailPath!, 360),
    ];
    onComplete(project, assets);
  }, [acceptedCount, blockingIssues.length, dimensionHintIds, draft, file, onComplete, prepared, source?.metersPerSourceUnit]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Импорт планировки">
      <div className="import-wizard">
        <header className="import-wizard__header">
          <div><h2>Импортировать план</h2><p>{file.name} · полностью локальная обработка</p></div>
          <button type="button" onClick={onCancel} aria-label="Закрыть">×</button>
        </header>
        <ol className="import-steps" aria-label="Этапы импорта">
          <li className={step === "prepare" ? "is-active" : ""}>1. Страница и область</li>
          <li className={step === "calibrate" ? "is-active" : ""}>2. Масштаб</li>
          <li className={step === "options" || step === "analyze" ? "is-active" : ""}>3. Анализ</li>
          <li className={step === "review" ? "is-active" : ""}>4. Проверка</li>
        </ol>
        {error ? <div className="import-error" role="alert">{error}</div> : null}

        {step === "prepare" ? (
          <div className="import-wizard__body">
            <aside className="import-controls">
              <h3>Страница и коррекция</h3>
              {rendered && rendered.pageCount > 1 ? (
                <label><span>Страница PDF</span><select value={pageIndex} onChange={(event) => { void loadPage(Number(event.target.value)); }}>{Array.from({ length: rendered.pageCount }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label>
              ) : <p>Одна страница</p>}
              <p className="hint">Перетащите четыре маркера на углы листа. Для PDF без перспективы оставьте их по краям.</p>
              <div className="button-grid"><button type="button" onClick={() => rotatePage(false)}>↺ 90°</button><button type="button" onClick={() => rotatePage(true)}>90° ↻</button></div>
              <button type="button" onClick={() => rendered && setQuad([{ x: 0, y: 0 }, { x: rendered.imageData.width - 1, y: 0 }, { x: rendered.imageData.width - 1, y: rendered.imageData.height - 1 }, { x: 0, y: rendered.imageData.height - 1 }])}>Сбросить область</button>
              <button className="button--primary" type="button" disabled={!rendered || !quad || loading} onClick={prepareCrop}>Продолжить</button>
            </aside>
            <div className="import-preview-stage">
              {loading ? <div className="import-loading">Подготовка страницы…</div> : null}
              {rendered && quad ? (
                <svg
                  viewBox={`0 0 ${rendered.imageData.width} ${rendered.imageData.height}`}
                  onPointerMove={(event) => {
                    if (dragCornerRef.current === null) return;
                    const point = svgPoint(event, rendered.imageData.width, rendered.imageData.height);
                    setQuad((current) => current ? current.map((candidate, index) => index === dragCornerRef.current ? point : candidate) as typeof current : current);
                  }}
                  onPointerUp={() => { dragCornerRef.current = null; }}
                  onPointerLeave={() => { dragCornerRef.current = null; }}
                >
                  <image href={rendered.previewUrl} width={rendered.imageData.width} height={rendered.imageData.height} />
                  <polygon points={quad.map((point) => `${point.x},${point.y}`).join(" ")} className="crop-polygon" />
                  {quad.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={Math.max(8, rendered.imageData.width / 220)} className="crop-handle" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragCornerRef.current = index; }} />)}
                </svg>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "calibrate" && prepared ? (
          <div className="import-wizard__body">
            <aside className="import-controls">
              <h3>Обязательная калибровка</h3>
              <p>Укажите две точки известного размера на чертеже.</p>
              <label><span>Известное расстояние, м</span><input type="number" min="0.001" step="0.01" value={knownDistanceM} onChange={(event) => setKnownDistanceM(Number(event.target.value))} /></label>
              <p>{calibrationPoints.length}/2 точек · {calibrationScale > 0 ? `масштаб ${calibrationScale.toFixed(6)} м/пикс.` : "масштаб не задан"}</p>
              <button type="button" onClick={() => setCalibrationPoints([])}>Выбрать точки заново</button>
              <div className="import-actions"><button type="button" onClick={() => setStep("prepare")}>Назад</button><button className="button--primary" type="button" disabled={!(calibrationScale > 0)} onClick={() => { void confirmCalibration(); }}>Подтвердить масштаб</button></div>
            </aside>
            <div className="import-preview-stage">
              <svg viewBox={`0 0 ${prepared.imageData.width} ${prepared.imageData.height}`} onClick={(event) => {
                const point = svgPoint(event, prepared.imageData.width, prepared.imageData.height);
                setCalibrationPoints((points) => points.length >= 2 ? [point] : [...points, point]);
              }}>
                <image href={prepared.previewUrl} width={prepared.imageData.width} height={prepared.imageData.height} />
                {calibrationPoints.length === 2 ? <line x1={calibrationPoints[0].x} y1={calibrationPoints[0].y} x2={calibrationPoints[1].x} y2={calibrationPoints[1].y} className="calibration-line" /> : null}
                {calibrationPoints.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r={Math.max(7, prepared.imageData.width / 250)} className="calibration-point" /><text x={point.x + 10} y={point.y - 10}>{index + 1}</text></g>)}
              </svg>
            </div>
          </div>
        ) : null}

        {step === "options" ? (
          <div className="import-options">
            <h3>Параметры локального распознавания</h3>
            <div className="check-grid">
              <label className="check-row"><input type="checkbox" checked={options.detectWalls} onChange={(event) => setOptions({ ...options, detectWalls: event.target.checked })} />Стены и перегородки</label>
              <label className="check-row"><input type="checkbox" checked={options.detectOpenings} onChange={(event) => setOptions({ ...options, detectOpenings: event.target.checked })} />Двери и окна</label>
              <label className="check-row"><input type="checkbox" checked={options.detectArcs} onChange={(event) => setOptions({ ...options, detectArcs: event.target.checked })} />Настоящие дуги</label>
              <label className="check-row"><input type="checkbox" checked={options.recognizeText} onChange={(event) => setOptions({ ...options, recognizeText: event.target.checked })} />Размеры и подписи rus+eng</label>
            </div>
            <div className="property-grid">
              <label><span>Высота стен, м</span><input type="number" min="0.1" step="0.1" value={options.defaultWallHeightM} onChange={(event) => setOptions({ ...options, defaultWallHeightM: Number(event.target.value) })} /></label>
              <label><span>Толщина стен, м</span><input type="number" min="0.01" step="0.01" value={options.defaultWallThicknessM} onChange={(event) => setOptions({ ...options, defaultWallThicknessM: Number(event.target.value) })} /></label>
              <label><span>Слияние узлов, м</span><input type="number" min="0.01" step="0.01" value={options.joinToleranceM} onChange={(event) => setOptions({ ...options, joinToleranceM: Number(event.target.value) })} /></label>
              <label><span>Мин. стена, м</span><input type="number" min="0.1" step="0.05" value={options.minimumWallLengthM} onChange={(event) => setOptions({ ...options, minimumWallLengthM: Number(event.target.value) })} /></label>
            </div>
            <p className="hint">Векторный PDF разбирается по его геометрическим операциям; скан и фото — OpenCV. OCR только предлагает размеры и высоты, калибровка всегда подтверждается человеком.</p>
            <div className="import-actions"><button type="button" onClick={() => setStep("calibrate")}>Назад</button><button className="button--primary" type="button" onClick={runRecognition}>Начать анализ</button></div>
          </div>
        ) : null}

        {step === "analyze" ? (
          <div className="recognition-progress">
            <div className="recognition-progress__spinner" />
            <h3>{progress?.message ?? "Запуск локального распознавателя"}</h3>
            <progress max={1} value={progress?.progress ?? 0} />
            <p>Интернет не используется. Сбой анализатора не изменит текущий проект.</p>
            <button type="button" onClick={() => recognitionRef.current?.cancel()}>Отменить анализ</button>
          </div>
        ) : null}

        {step === "review" && draft && prepared && source ? (
          <div className="review-layout">
            <aside className="review-controls">
              <h3>Проверка результата</h3>
              <p>{draft.walls.length} стен · принято {acceptedCount} · {draft.openings.length} проёмов</p>
              {reviewQuality ? <div className={`recognition-quality recognition-quality--${reviewQuality.status}`} role={reviewQuality.status === "unreliable" ? "alert" : "status"}>
                <strong>{reviewQuality.status === "reliable" ? "Результат устойчив" : reviewQuality.status === "review" ? "Нужна внимательная проверка" : "Распознавание ненадёжно"} · {reviewQuality.score}/100</strong>
                {reviewQuality.reasons.length > 0 ? <ul>{reviewQuality.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <span>Катастрофических признаков не найдено.</span>}
                {reviewQuality.candidateExplosion && visibleReviewWalls.length < draft.walls.length ? <span>На холсте показаны 120 наиболее уверенных кандидатов из {draft.walls.length}.</span> : null}
              </div> : null}
              <div className="button-grid button-grid--three"><button type="button" disabled={!undoStack.length} onClick={undoReview}>↶</button><button type="button" disabled={!redoStack.length} onClick={redoReview}>↷</button><button type="button" disabled={!reviewQuality?.allowBatchAccept} title={reviewQuality?.allowBatchAccept ? "Принять только кандидаты с высокой измеренной уверенностью" : "Пакетное принятие заблокировано оценкой качества"} onClick={() => applyDraft((next) => { next.walls.forEach((wall) => { if ((wall.confidence ?? 0) >= 0.86) wall.reviewStatus = "accepted"; }); return next; })}>Принять надёжные</button></div>
              <div className="button-grid"><button type="button" disabled={!selectedWall} onClick={() => applyDraft((next) => { const wall = next.walls.find((candidate) => candidate.id === selectedWallId); if (wall) wall.reviewStatus = "accepted"; return next; })}>Принять</button><button type="button" disabled={!selectedWall} onClick={() => applyDraft((next) => { const wall = next.walls.find((candidate) => candidate.id === selectedWallId); if (wall) wall.reviewStatus = "rejected"; return next; })}>Отклонить</button></div>
              <div className="button-grid"><button type="button" className={manualTool === "line" ? "is-active" : ""} onClick={() => { setManualTool("line"); setManualPoints([]); }}>Стена · 2 точки</button><button type="button" className={manualTool === "arc" ? "is-active" : ""} onClick={() => { setManualTool("arc"); setManualPoints([]); }}>Дуга · 3 точки</button></div>
              <button className={manualTool === "region" ? "button button--wide is-active" : "button button--wide"} type="button" onClick={() => { setManualTool("region"); setManualPoints([]); }}>Повторить анализ области · 2 угла</button>
              {selectedWall ? <div className="review-wall-fields">
                <strong>{selectedWall.id}</strong>
                <label><span>Тип</span><select value={selectedWall.kind} onChange={(event) => applyDraft((next) => { const wall = next.walls.find((candidate) => candidate.id === selectedWall.id); if (wall) wall.kind = event.target.value as ArchitecturalWall["kind"]; return next; })}><option value="wall">Стена</option><option value="partition">Перегородка</option></select></label>
                <label><span>Толщина, м</span><input type="number" min="0.01" step="0.01" value={selectedWall.thicknessM} onChange={(event) => applyDraft((next) => { const wall = next.walls.find((candidate) => candidate.id === selectedWall.id); if (wall) { wall.thicknessM = Number(event.target.value); wall.thicknessSource = "user"; } return next; })} /></label>
                <label><span>Высота, м</span><input type="number" min="0.1" step="0.1" value={selectedWall.heightM} onChange={(event) => applyDraft((next) => { const wall = next.walls.find((candidate) => candidate.id === selectedWall.id); if (wall) { wall.heightM = Number(event.target.value); wall.heightSource = "user"; } return next; })} /></label>
                <label><span>Основание, м</span><input type="number" min="0" step="0.1" value={selectedWall.baseElevationM} onChange={(event) => applyDraft((next) => { const wall = next.walls.find((candidate) => candidate.id === selectedWall.id); if (wall) wall.baseElevationM = Number(event.target.value); return next; })} /></label>
                <div className="button-grid"><button type="button" onClick={() => addOpening("door")}>Добавить дверь</button><button type="button" onClick={() => addOpening("window")}>Добавить окно</button></div>
              </div> : <p className="hint">Щёлкните стену. Перетаскивание общего узла изменяет все подключённые стены.</p>}
              <details open={blockingIssues.length > 0}><summary>Проблемы · {draft.issues.length}</summary><ul className="issue-list">{draft.issues.map((issue) => <li key={issue.id} className={`issue--${issue.severity}`}><button type="button" onClick={() => { if (issue.wallId) setSelectedWallId(issue.wallId); }}>{issue.message}</button></li>)}</ul></details>
              {draft.textHints.length > 0 ? <details><summary>Распознанный текст · {draft.textHints.length}</summary>{draft.textHints.map((hint) => <div className="recognized-hint" key={hint.id}>
                {hint.suggestedDistanceM ? <label className="check-row"><input type="checkbox" checked={dimensionHintIds.includes(hint.id)} onChange={(event) => setDimensionHintIds((ids) => event.target.checked ? [...ids, hint.id] : ids.filter((id) => id !== hint.id))} />{hint.text} → постоянный размер {hint.suggestedDistanceM.toFixed(2)} м</label> : <span>{hint.text}</span>}
                {hint.suggestedWallHeightM && selectedWall ? <button type="button" onClick={() => applyDraft((next) => { const wall = next.walls.find((candidate) => candidate.id === selectedWall.id); if (wall) { wall.heightM = hint.suggestedWallHeightM!; wall.heightSource = "user"; } return next; })}>Применить высоту {hint.suggestedWallHeightM.toFixed(2)} м к стене</button> : null}
              </div>)}</details> : null}
              <div className="import-actions"><button type="button" onClick={() => setStep("options")}>Повторить анализ</button><button className="button--primary" type="button" disabled={acceptedCount === 0 || blockingIssues.length > 0} onClick={() => { void finish(); }}>Создать проект</button></div>
              {acceptedCount === 0 ? <p className="blocking-hint">Примите хотя бы одну стену.</p> : null}
            </aside>
            <div className="import-preview-stage review-canvas">
              <svg
                viewBox={`0 0 ${prepared.imageData.width} ${prepared.imageData.height}`}
                onPointerMove={(event) => {
                  const dragging = dragVertexRef.current;
                  if (!dragging) return;
                  const point = svgPoint(event, prepared.imageData.width, prepared.imageData.height);
                  setDraft((current) => {
                    if (!current) return current;
                    const next = structuredClone(current);
                    const vertex = next.vertices.find((candidate) => candidate.id === dragging.id);
                    if (vertex) { vertex.xM = point.x * source.metersPerSourceUnit!; vertex.yM = point.y * source.metersPerSourceUnit!; vertex.provenance = "manual"; }
                    return next;
                  });
                }}
                onPointerUp={() => {
                  const dragging = dragVertexRef.current;
                  if (dragging) {
                    setUndoStack((stack) => [...stack, dragging.before].slice(-100));
                    setRedoStack([]);
                    dragVertexRef.current = null;
                  }
                }}
                onClick={(event) => {
                  if (manualTool === "none") return;
                  const point = svgPoint(event, prepared.imageData.width, prepared.imageData.height);
                  const points = [...manualPoints, point];
                  const required = manualTool === "arc" ? 3 : 2;
                  if (points.length < required) { setManualPoints(points); return; }
                  if (manualTool === "region") {
                    setManualPoints([]);
                    setManualTool("none");
                    runRegionRecognition(points[0], points[1]);
                    return;
                  }
                  const meterPoints = points.map((candidate) => ({ xM: candidate.x * source.metersPerSourceUnit!, yM: candidate.y * source.metersPerSourceUnit! }));
                  const curve = manualTool === "arc" ? (() => { const bulge = bulgeFromThreePoints(meterPoints[0], meterPoints[1], meterPoints[2]); return bulge ? { kind: "arc" as const, bulge } : null; })() : { kind: "line" as const };
                  if (curve) applyDraft((current) => addManualWall(current, manualTool === "arc" ? [meterPoints[0], meterPoints[2]] : meterPoints, curve));
                  setManualPoints([]);
                  setManualTool("none");
                }}
              >
                <image href={prepared.previewUrl} width={prepared.imageData.width} height={prepared.imageData.height} opacity="0.48" />
                {visibleReviewWalls.map((wall) => {
                  const path = wallSvgPath(wall, reviewVertices, 1 / source.metersPerSourceUnit!);
                  return path ? <path key={wall.id} d={path} stroke={confidenceColor(wall.confidence)} className={`review-wall${wall.id === selectedWallId ? " is-selected" : ""}`} onClick={(event) => { if (manualTool !== "none") return; event.stopPropagation(); setSelectedWallId(wall.id); }} /> : null;
                })}
                {draft.vertices.filter((vertex) => vertex.reviewStatus !== "rejected" && visibleReviewVertexIds.has(vertex.id)).map((vertex) => <circle key={vertex.id} cx={vertex.xM / source.metersPerSourceUnit!} cy={vertex.yM / source.metersPerSourceUnit!} r={Math.max(3, prepared.imageData.width / 500)} className="review-vertex" onPointerDown={(event) => { if (manualTool !== "none") return; event.stopPropagation(); dragVertexRef.current = { id: vertex.id, before: structuredClone(draft) }; }} />)}
                {manualPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={Math.max(5, prepared.imageData.width / 400)} className="manual-point" />)}
              </svg>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
