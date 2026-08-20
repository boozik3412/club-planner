/// <reference lib="webworker" />
import { buildRecognitionGraph } from "./graph";
import { detectRasterGeometry } from "./opencv-detector";
import { recognizeText } from "./ocr";
import { buildRecognitionGuideSet } from "./review-guides";
import type { RecognizedTextHint, RecognizerRequest, RecognizerResponse } from "./types";

const cancelled = new Set<string>();

function post(message: RecognizerResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<RecognizerRequest>) => {
  const request = event.data;
  if (request.type === "cancel") {
    cancelled.add(request.id);
    return;
  }
  void (async () => {
    const progress = (value: RecognizerResponse & { type: "progress" }) => {
      if (!cancelled.has(request.id)) post(value);
    };
    try {
      progress({ id: request.id, type: "progress", progress: { stage: "preparing", progress: 0, message: "Подготовка изображения" } });
      const hasVectorArchitecture = (request.image.vectorLines?.length ?? 0) >= 4;
      const raster = hasVectorArchitecture
        ? { lines: [], arcs: [], rawLines: [], openingLines: [] }
        : await detectRasterGeometry(
          request.image.width,
          request.image.height,
          request.image.rgba,
          request.options.detectArcs,
          (value) => progress({ id: request.id, type: "progress", progress: value }),
          Math.max(16, request.options.minimumWallLengthM / Math.max(request.image.metersPerPixel, 1e-6)),
        );
      if (hasVectorArchitecture) {
        progress({
          id: request.id,
          type: "progress",
          progress: {
            stage: "vector",
            progress: 1,
            message: `Векторный PDF · линий: ${request.image.vectorLines?.length ?? 0}, дуг: ${request.image.vectorArcs?.length ?? 0}`,
          },
        });
      }
      const detected = {
        lines: hasVectorArchitecture
          ? request.image.vectorLines ?? []
          : [...(request.image.vectorLines ?? []), ...raster.lines],
        arcs: [...(request.image.vectorArcs ?? []), ...raster.arcs],
      };
      if (cancelled.has(request.id)) {
        post({ id: request.id, type: "cancelled" });
        return;
      }
      let textHints: RecognizedTextHint[] = [];
      if (request.options.recognizeText) {
        try {
          textHints = await recognizeText(request.image.width, request.image.height, request.image.rgba, (value) => progress({ id: request.id, type: "progress", progress: value }));
        } catch {
          progress({ id: request.id, type: "progress", progress: { stage: "ocr", progress: 1, message: "OCR недоступен · геометрический анализ продолжается" } });
        }
      }
      if (cancelled.has(request.id)) {
        post({ id: request.id, type: "cancelled" });
        return;
      }
      progress({ id: request.id, type: "progress", progress: { stage: "graph", progress: 0.5, message: "Построение архитектурного графа" } });
      const draft = buildRecognitionGraph({
        source: request.source,
        lines: request.options.detectWalls ? detected.lines : [],
        openingLines: hasVectorArchitecture ? request.image.vectorOpeningLines ?? [] : raster.openingLines,
        arcs: request.options.detectArcs ? detected.arcs : [],
        textHints,
        options: request.options,
        engineVersion: "local-hybrid-3",
        geometrySource: hasVectorArchitecture ? "vector" : "raster",
      });
      draft.guides = buildRecognitionGuideSet({
        axes: detected.lines,
        rawLines: hasVectorArchitecture ? request.image.vectorLines ?? [] : raster.rawLines,
        arcs: detected.arcs,
        vector: hasVectorArchitecture,
        minimumLengthPx: Math.max(12, request.options.minimumWallLengthM / Math.max(request.image.metersPerPixel, 1e-6) * 0.45),
      });
      post({ id: request.id, type: "result", draft });
    } catch (error) {
      post({ id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      cancelled.delete(request.id);
    }
  })();
};

export {};
