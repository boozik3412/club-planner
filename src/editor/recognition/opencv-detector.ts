import type { DetectedArc, DetectedLine, RecognitionProgress } from "./types";
import { consolidateWallLines } from "./raster-lines";
import { deduplicateDetectedArcs, isMeaningfulRasterArc } from "./raster-arcs";

type ProgressCallback = (progress: RecognitionProgress) => void;

export interface RasterDetectionResult {
  lines: DetectedLine[];
  arcs: DetectedArc[];
  rawLines: DetectedLine[];
}

async function loadOpenCv() {
  const imported = await import("@techstark/opencv-js");
  const module = imported.default;
  if (module instanceof Promise) return module;
  if (module.Mat) return module;
  await new Promise<void>((resolve) => {
    module.onRuntimeInitialized = () => resolve();
  });
  return module;
}

function longestCircularRun(values: readonly boolean[]): { start: number; length: number } | null {
  if (values.length === 0 || values.every(Boolean)) return null;
  const doubled = [...values, ...values];
  let bestStart = 0;
  let bestLength = 0;
  let currentStart = 0;
  let currentLength = 0;
  doubled.forEach((active, index) => {
    if (active) {
      if (currentLength === 0) currentStart = index;
      currentLength = Math.min(values.length, currentLength + 1);
      if (currentLength > bestLength && currentStart < values.length) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
    } else {
      currentLength = 0;
    }
  });
  return bestLength > 0 ? { start: bestStart % values.length, length: bestLength } : null;
}

export async function detectRasterGeometry(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  detectArcs: boolean,
  onProgress: ProgressCallback,
  minimumWallLengthPx = 24,
): Promise<RasterDetectionResult> {
  const tileSize = 2_200;
  const overlap = 160;
  if (width > tileSize || height > tileSize) {
    const lines: DetectedLine[] = [];
    const arcs: DetectedArc[] = [];
    const rawLines: DetectedLine[] = [];
    const xStarts: number[] = [];
    const yStarts: number[] = [];
    for (let x = 0; x < width; x += tileSize - overlap) xStarts.push(Math.min(x, Math.max(0, width - tileSize)));
    for (let y = 0; y < height; y += tileSize - overlap) yStarts.push(Math.min(y, Math.max(0, height - tileSize)));
    const uniqueX = [...new Set(xStarts)];
    const uniqueY = [...new Set(yStarts)];
    const total = uniqueX.length * uniqueY.length;
    let tileIndex = 0;
    for (const startY of uniqueY) {
      for (const startX of uniqueX) {
        const tileWidth = Math.min(tileSize, width - startX);
        const tileHeight = Math.min(tileSize, height - startY);
        const tile = new Uint8ClampedArray(tileWidth * tileHeight * 4);
        for (let y = 0; y < tileHeight; y += 1) {
          const sourceOffset = ((startY + y) * width + startX) * 4;
          tile.set(rgba.subarray(sourceOffset, sourceOffset + tileWidth * 4), y * tileWidth * 4);
        }
        tileIndex += 1;
        onProgress({ stage: "raster", progress: tileIndex / total * 0.9, message: `Анализ фрагмента ${tileIndex} из ${total}` });
        const detected = await detectRasterGeometry(tileWidth, tileHeight, tile, detectArcs, () => {}, minimumWallLengthPx);
        lines.push(...detected.lines.map((line) => ({
          ...line,
          start: { x: line.start.x + startX, y: line.start.y + startY },
          end: { x: line.end.x + startX, y: line.end.y + startY },
        })));
        rawLines.push(...detected.rawLines.map((line) => ({
          ...line,
          start: { x: line.start.x + startX, y: line.start.y + startY },
          end: { x: line.end.x + startX, y: line.end.y + startY },
        })));
        arcs.push(...detected.arcs.map((arc) => ({
          ...arc,
          start: { x: arc.start.x + startX, y: arc.start.y + startY },
          through: { x: arc.through.x + startX, y: arc.through.y + startY },
          end: { x: arc.end.x + startX, y: arc.end.y + startY },
        })));
      }
    }
    return { lines, arcs: deduplicateDetectedArcs(arcs), rawLines };
  }
  onProgress({ stage: "raster", progress: 0.05, message: "Загрузка локального OpenCV" });
  const cv = await loadOpenCv();
  const source = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const lineMatrix = new cv.Mat();
  const circles = new cv.Mat();
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 9);
    onProgress({ stage: "raster", progress: 0.3, message: "Поиск прямых и контуров стен" });
    const minimumLineLengthPx = Math.max(minimumWallLengthPx, Math.round(Math.min(width, height) * 0.025));
    cv.HoughLinesP(binary, lineMatrix, 1, Math.PI / 360, 28, minimumLineLengthPx, Math.max(12, Math.round(minimumLineLengthPx * 0.45)));
    const rawLines: DetectedLine[] = [];
    const lineCount = lineMatrix.rows * lineMatrix.cols;
    for (let index = 0; index < lineCount; index += 1) {
      const offset = index * 4;
      const x1 = lineMatrix.data32S[offset];
      const y1 = lineMatrix.data32S[offset + 1];
      const x2 = lineMatrix.data32S[offset + 2];
      const y2 = lineMatrix.data32S[offset + 3];
      const normalizedLength = Math.hypot(x2 - x1, y2 - y1) / Math.max(width, height);
      rawLines.push({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        confidence: Math.min(0.98, 0.55 + normalizedLength * 1.5),
      });
    }
    const lines = consolidateWallLines(rawLines, width, height, minimumLineLengthPx);

    const arcs: DetectedArc[] = [];
    if (detectArcs) {
      onProgress({ stage: "raster", progress: 0.65, message: "Поиск дуговых стен и дуг открывания" });
      cv.HoughCircles(gray, circles, cv.HOUGH_GRADIENT, 1.5, Math.max(20, Math.min(width, height) * 0.04), 110, 35, 10, Math.round(Math.min(width, height) * 0.45));
      const samples = 180;
      for (let index = 0; index < circles.cols; index += 1) {
        const offset = index * 3;
        const centerX = circles.data32F[offset];
        const centerY = circles.data32F[offset + 1];
        const radius = circles.data32F[offset + 2];
        const occupied = Array.from({ length: samples }, (_, sample) => {
          const angle = sample / samples * Math.PI * 2;
          for (let radialOffset = -2; radialOffset <= 2; radialOffset += 1) {
            const x = Math.round(centerX + Math.cos(angle) * (radius + radialOffset));
            const y = Math.round(centerY + Math.sin(angle) * (radius + radialOffset));
            if (x >= 0 && y >= 0 && x < width && y < height && gray.data[y * width + x] < 165) return true;
          }
          return false;
        });
        const run = longestCircularRun(occupied);
        if (!run || run.length > samples * 0.92 || !isMeaningfulRasterArc(radius, run.length, samples, Math.min(width, height))) continue;
        const point = (sample: number) => {
          const angle = sample / samples * Math.PI * 2;
          return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
        };
        arcs.push({
          start: point(run.start),
          through: point(run.start + run.length / 2),
          end: point(run.start + run.length),
          confidence: Math.min(0.9, 0.45 + run.length / samples * 0.7),
        });
      }
    }
    onProgress({ stage: "raster", progress: 0.95, message: `Найдено линий: ${lines.length}, дуг: ${arcs.length}` });
    return { lines, arcs: deduplicateDetectedArcs(arcs), rawLines };
  } finally {
    source.delete();
    gray.delete();
    binary.delete();
    lineMatrix.delete();
    circles.delete();
  }
}
