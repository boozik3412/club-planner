import { getDocument, GlobalWorkerOptions, OPS, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import pdfWorkerPath from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { BinaryFilePayload, ProjectAssetPayload } from "../persistence/desktop-files";
import { decodePdfDrawPath } from "./pdf-vector";
import type { DetectedArc, DetectedLine } from "./types";

GlobalWorkerOptions.workerSrc = pdfWorkerPath;

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function safeEmbeddedSourceName(fileName: string, hash: string): string {
  const extension = fileName.toLowerCase().match(/\.(pdf|png|jpe?g)$/)?.[1]?.replace("jpeg", "jpg") ?? "bin";
  return `sources/${hash.slice(0, 16)}.${extension}`;
}

export async function openPdfDocument(file: BinaryFilePayload): Promise<PDFDocumentProxy> {
  return getDocument({ data: base64ToBytes(file.dataBase64) }).promise;
}

export interface RenderedPlanPage {
  imageData: ImageData;
  previewUrl: string;
  pageCount: number;
  pageIndex: number;
  vectorLines: DetectedLine[];
  vectorArcs: DetectedArc[];
}

type AffineMatrix = [number, number, number, number, number, number];

function multiply(first: AffineMatrix, second: AffineMatrix): AffineMatrix {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function affinePoint(matrix: AffineMatrix, x: number, y: number): { x: number; y: number } {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

async function extractVectorGeometry(page: PDFPageProxy, viewportTransform: AffineMatrix): Promise<{ lines: DetectedLine[]; arcs: DetectedArc[] }> {
  const operators = await page.getOperatorList();
  const stack: AffineMatrix[] = [];
  let transform: AffineMatrix = [1, 0, 0, 1, 0, 0];
  let current: { x: number; y: number } | null = null;
  const lines: DetectedLine[] = [];
  const arcs: DetectedArc[] = [];
  const transformedPoint = (point: { x: number; y: number }) => {
    const local = affinePoint(transform, point.x, point.y);
    return affinePoint(viewportTransform, local.x, local.y);
  };
  const emit = (x1: number, y1: number, x2: number, y2: number) => {
    const localStart = affinePoint(transform, x1, y1);
    const localEnd = affinePoint(transform, x2, y2);
    const start = affinePoint(viewportTransform, localStart.x, localStart.y);
    const end = affinePoint(viewportTransform, localEnd.x, localEnd.y);
    if (Math.hypot(end.x - start.x, end.y - start.y) >= 4) lines.push({ start, end, confidence: 0.98 });
  };
  const emitArc = (arc: DetectedArc) => {
    const transformed = {
      start: transformedPoint(arc.start),
      through: transformedPoint(arc.through),
      end: transformedPoint(arc.end),
      confidence: arc.confidence,
    };
    if (Math.hypot(transformed.end.x - transformed.start.x, transformed.end.y - transformed.start.y) >= 4) arcs.push(transformed);
  };
  operators.fnArray.forEach((fn, index) => {
    const args = operators.argsArray[index] as unknown[];
    if (fn === OPS.save) stack.push([...transform]);
    else if (fn === OPS.restore) transform = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) transform = multiply(transform, args.slice(0, 6).map(Number) as AffineMatrix);
    else if (fn === OPS.moveTo) current = { x: Number(args[0]), y: Number(args[1]) };
    else if (fn === OPS.lineTo && current) {
      const next = { x: Number(args[0]), y: Number(args[1]) };
      emit(current.x, current.y, next.x, next.y);
      current = next;
    } else if (fn === OPS.rectangle) {
      const [x, y, width, height] = args.slice(0, 4).map(Number);
      emit(x, y, x + width, y);
      emit(x + width, y, x + width, y + height);
      emit(x + width, y + height, x, y + height);
      emit(x, y + height, x, y);
    } else if (fn === OPS.constructPath) {
      if (typeof args[0] === "number") {
        const paths = Array.isArray(args[1]) ? args[1] : [];
        paths.forEach((path) => {
          if (!path || typeof path !== "object" || !("length" in path)) return;
          const decoded = decodePdfDrawPath(path as ArrayLike<number>);
          decoded.lines.forEach((line) => emit(line.start.x, line.start.y, line.end.x, line.end.y));
          decoded.arcs.forEach(emitArc);
        });
      } else {
        const pathOps = args[0] as ArrayLike<number> | undefined;
        const coordinates = args[1] as ArrayLike<number> | undefined;
        if (!pathOps || !coordinates) return;
        let coordinateIndex = 0;
        let pathCurrent: { x: number; y: number } | null = null;
        for (let pathIndex = 0; pathIndex < pathOps.length; pathIndex += 1) {
          const pathOp = pathOps[pathIndex];
          if (pathOp === OPS.moveTo) {
            pathCurrent = { x: coordinates[coordinateIndex], y: coordinates[coordinateIndex + 1] };
            coordinateIndex += 2;
          } else if (pathOp === OPS.lineTo && pathCurrent) {
            const next = { x: coordinates[coordinateIndex], y: coordinates[coordinateIndex + 1] };
            emit(pathCurrent.x, pathCurrent.y, next.x, next.y);
            pathCurrent = next;
            coordinateIndex += 2;
          } else if (pathOp === OPS.rectangle) {
            const x = coordinates[coordinateIndex];
            const y = coordinates[coordinateIndex + 1];
            const width = coordinates[coordinateIndex + 2];
            const height = coordinates[coordinateIndex + 3];
            emit(x, y, x + width, y);
            emit(x + width, y, x + width, y + height);
            emit(x + width, y + height, x, y + height);
            emit(x, y + height, x, y);
            coordinateIndex += 4;
          } else {
            coordinateIndex += pathOp === OPS.curveTo ? 6 : pathOp === OPS.curveTo2 || pathOp === OPS.curveTo3 ? 4 : 0;
          }
        }
      }
    }
  });
  return { lines, arcs };
}

async function canvasPreview(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) reject(new Error("Не удалось сформировать превью плана"));
    else resolve(URL.createObjectURL(blob));
  }, "image/png"));
}

export async function renderPdfPage(pdfDocument: PDFDocumentProxy, pageIndex: number): Promise<RenderedPlanPage> {
  const page = await pdfDocument.getPage(pageIndex + 1);
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 6_000 / Math.max(natural.width, natural.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Не удалось создать холст для PDF");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const vectorGeometry = await extractVectorGeometry(page, viewport.transform as AffineMatrix);
  return {
    imageData: context.getImageData(0, 0, canvas.width, canvas.height),
    previewUrl: await canvasPreview(canvas),
    pageCount: pdfDocument.numPages,
    pageIndex,
    vectorLines: vectorGeometry.lines,
    vectorArcs: vectorGeometry.arcs,
  };
}

export async function renderImage(file: BinaryFilePayload): Promise<RenderedPlanPage> {
  const bytes = base64ToBytes(file.dataBase64);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.mimeType }));
  const scale = Math.min(1, 6_000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Не удалось создать холст для изображения");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    imageData: context.getImageData(0, 0, canvas.width, canvas.height),
    previewUrl: await canvasPreview(canvas),
    pageCount: 1,
    pageIndex: 0,
    vectorLines: [],
    vectorArcs: [],
  };
}

export function sourceAsset(file: BinaryFilePayload, embeddedPath: string): ProjectAssetPayload {
  return { path: embeddedPath, mimeType: file.mimeType, dataBase64: file.dataBase64 };
}
