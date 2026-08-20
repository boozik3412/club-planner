import { createWorker, OEM, PSM } from "tesseract.js";
import workerPath from "tesseract.js/dist/worker.min.js?url";
import corePath from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import engDataPath from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";
import rusDataPath from "@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz?url";
import { createStableId } from "../model/templates";
import type { RecognitionProgress, RecognizedTextHint } from "./types";

type ProgressCallback = (progress: RecognitionProgress) => void;

function parseSuggestedDistance(text: string): number | undefined {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  const match = cleaned.match(/(?:^|[^\d])(\d{1,5}(?:\.\d{1,3})?)(?:мм|см|м)?(?:$|[^а-яa-z\d])/iu)
    ?? cleaned.match(/^(\d{1,5}(?:\.\d{1,3})?)(?:мм|см|м)?$/iu);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (/мм/iu.test(cleaned) || value >= 100) return value / 1000;
  if (/см/iu.test(cleaned) || value >= 20) return value / 100;
  return value;
}

function parseSuggestedWallHeight(text: string): number | undefined {
  const match = text.replace(",", ".").match(/(?:h|н|выс(?:ота)?)[=:\s-]*(\d+(?:\.\d+)?)/iu);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value > 20 ? value / 1000 : value;
}

export function parseTesseractTsv(tsv: string): RecognizedTextHint[] {
  const lines = tsv.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  return lines.slice(1).flatMap((line) => {
    const fields = line.split("\t");
    const text = fields.slice(11).join("\t").trim();
    const confidence = Number(fields[10]);
    if (!text || !Number.isFinite(confidence) || confidence < 20) return [];
    return [{
      id: createStableId("text"),
      text,
      confidence: Math.min(1, Math.max(0, confidence / 100)),
      bounds: {
        x: Number(fields[6]) || 0,
        y: Number(fields[7]) || 0,
        width: Number(fields[8]) || 0,
        height: Number(fields[9]) || 0,
      },
      suggestedDistanceM: parseSuggestedDistance(text),
      suggestedWallHeightM: parseSuggestedWallHeight(text),
    }];
  });
}

async function fetchLanguage(code: string, url: string): Promise<{ code: string; data: Uint8Array }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить встроенную OCR-модель ${code}`);
  return { code, data: new Uint8Array(await response.arrayBuffer()) };
}

export async function recognizeText(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  onProgress: ProgressCallback,
): Promise<RecognizedTextHint[]> {
  onProgress({ stage: "ocr", progress: 0.02, message: "Загрузка локальных OCR-моделей rus+eng" });
  const languages = await Promise.all([
    fetchLanguage("rus", rusDataPath),
    fetchLanguage("eng", engDataPath),
  ]);
  const worker = await createWorker(languages, OEM.LSTM_ONLY, {
    workerPath,
    corePath,
    workerBlobURL: false,
    cacheMethod: "readOnly",
    logger: (message) => {
      onProgress({
        stage: "ocr",
        progress: Math.min(0.98, Math.max(0.05, message.progress)),
        message: message.status === "recognizing text" ? "Распознавание размеров и подписей" : "Подготовка OCR",
      });
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("OCR недоступен: не удалось создать локальный холст");
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    const result = await worker.recognize(canvas, {}, { text: true, tsv: true });
    return parseTesseractTsv(result.data.tsv ?? "");
  } finally {
    await worker.terminate();
  }
}
