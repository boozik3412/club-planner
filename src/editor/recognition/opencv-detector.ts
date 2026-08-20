import type { DetectedArc, DetectedLine, RecognitionProgress } from "./types";
import { consolidateWallLines } from "./raster-lines";
import { deduplicateDetectedArcs, isMeaningfulRasterArc } from "./raster-arcs";

type ProgressCallback = (progress: RecognitionProgress) => void;

export interface RasterDetectionResult {
  lines: DetectedLine[];
  arcs: DetectedArc[];
  rawLines: DetectedLine[];
  openingLines: DetectedLine[];
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

function closeSmallCircularGaps(values: readonly boolean[], maximumGap = 2): boolean[] {
  if (values.length === 0) return [];
  const result = [...values];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]) continue;
    let gapLength = 0;
    while (gapLength <= maximumGap && !values[(index + gapLength) % values.length]) gapLength += 1;
    const before = values[(index - 1 + values.length) % values.length];
    const after = values[(index + gapLength) % values.length];
    if (before && after && gapLength <= maximumGap) {
      for (let offset = 0; offset < gapLength; offset += 1) result[(index + offset) % values.length] = true;
    }
  }
  return result;
}

export function createColoredAnnotationMask(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  dilationRadius = 2,
): Uint8Array {
  const base = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    if (red >= 90 && red >= green * 1.25 && red >= blue * 1.18 && red - Math.min(green, blue) >= 35) {
      base[index] = 1;
    }
  }
  if (dilationRadius <= 0) return base;
  const horizontal = new Uint8Array(base.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let offset = -dilationRadius; offset <= dilationRadius; offset += 1) {
        const candidateX = x + offset;
        if (candidateX >= 0 && candidateX < width && base[y * width + candidateX]) {
          horizontal[y * width + x] = 1;
          break;
        }
      }
    }
  }
  const result = new Uint8Array(base.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let offset = -dilationRadius; offset <= dilationRadius; offset += 1) {
        const candidateY = y + offset;
        if (candidateY >= 0 && candidateY < height && horizontal[candidateY * width + x]) {
          result[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return result;
}

function isColoredOpeningPixel(red: number, green: number, blue: number): boolean {
  return blue >= 70
    && blue >= red + 28
    && (blue >= green + 12 || green >= red + 28);
}

export function createColoredOpeningMask(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const result = new Uint8Array(width * height);
  for (let index = 0; index < result.length; index += 1) {
    const offset = index * 4;
    if (isColoredOpeningPixel(rgba[offset], rgba[offset + 1], rgba[offset + 2])) result[index] = 255;
  }
  return result;
}

function removeSmallTextLikeComponents(
  cv: Awaited<ReturnType<typeof loadOpenCv>>,
  binary: { rows: number; cols: number },
  width: number,
  height: number,
): void {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const maximumGlyphSize = Math.max(18, Math.min(width, height) * 0.045);
    const maximumGlyphArea = maximumGlyphSize * maximumGlyphSize * 0.7;
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      try {
        const bounds = cv.boundingRect(contour);
        const area = cv.contourArea(contour);
        const textLike = bounds.width >= 2 && bounds.height >= 3
          && bounds.width <= maximumGlyphSize && bounds.height <= maximumGlyphSize
          && area <= maximumGlyphArea;
        if (textLike) cv.drawContours(binary, contours, index, new cv.Scalar(0), -1);
      } finally {
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

export function lineColoredOpeningSupport(
  line: Pick<DetectedLine, "start" | "end">,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): number {
  const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
  const samples = Math.max(12, Math.min(72, Math.ceil(length / 3)));
  let supported = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const ratio = samples === 1 ? 0 : sample / (samples - 1);
    const centerX = Math.round(line.start.x + (line.end.x - line.start.x) * ratio);
    const centerY = Math.round(line.start.y + (line.end.y - line.start.y) * ratio);
    let found = false;
    for (let yOffset = -1; yOffset <= 1 && !found; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        const x = centerX + xOffset;
        const y = centerY + yOffset;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const offset = (y * width + x) * 4;
        if (isColoredOpeningPixel(rgba[offset], rgba[offset + 1], rgba[offset + 2])) {
          found = true;
          break;
        }
      }
    }
    if (found) supported += 1;
  }
  return supported / samples;
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
    const openingLines: DetectedLine[] = [];
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
        openingLines.push(...detected.openingLines.map((line) => ({
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
    return { lines, arcs: deduplicateDetectedArcs(arcs), rawLines, openingLines };
  }
  onProgress({ stage: "raster", progress: 0.05, message: "Загрузка локального OpenCV" });
  const cv = await loadOpenCv();
  const source = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const lineMatrix = new cv.Mat();
  const circles = new cv.Mat();
  const gradientX = new cv.Mat();
  const gradientY = new cv.Mat();
  const coloredOpeningBinary = cv.matFromArray(height, width, cv.CV_8UC1, createColoredOpeningMask(width, height, rgba));
  const coloredLineMatrix = new cv.Mat();
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    const annotationMask = createColoredAnnotationMask(width, height, rgba);
    for (let index = 0; index < annotationMask.length; index += 1) {
      if (annotationMask[index]) gray.data[index] = 255;
    }
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 9);
    // Geometry must stay independent from the user's OCR-content setting. A
    // lightweight CV pass removes digit/glyph components before Hough voting;
    // Tesseract still runs later only to produce editable text hints.
    removeSmallTextLikeComponents(cv, binary, width, height);
    onProgress({ stage: "raster", progress: 0.3, message: "Поиск прямых и контуров стен" });
    const minimumLineLengthPx = Math.max(minimumWallLengthPx, Math.round(Math.min(width, height) * 0.025));
    cv.HoughLinesP(binary, lineMatrix, 1, Math.PI / 360, 28, minimumLineLengthPx, Math.max(12, Math.round(minimumLineLengthPx * 0.45)));
    const rawLines: DetectedLine[] = [];
    const openingLines: DetectedLine[] = [];
    const lineCount = lineMatrix.rows * lineMatrix.cols;
    for (let index = 0; index < lineCount; index += 1) {
      const offset = index * 4;
      const x1 = lineMatrix.data32S[offset];
      const y1 = lineMatrix.data32S[offset + 1];
      const x2 = lineMatrix.data32S[offset + 2];
      const y2 = lineMatrix.data32S[offset + 3];
      const normalizedLength = Math.hypot(x2 - x1, y2 - y1) / Math.max(width, height);
      const line: DetectedLine = {
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        confidence: Math.min(0.98, 0.55 + normalizedLength * 1.5),
      };
      const coloredOpeningSupport = lineColoredOpeningSupport(line, width, height, rgba);
      if (coloredOpeningSupport >= 0.3) {
        openingLines.push({
          ...line,
          evidence: { ...line.evidence, coloredOpeningSupport },
        });
      } else {
        rawLines.push(line);
      }
    }
    const lines = consolidateWallLines(rawLines, width, height, minimumLineLengthPx);
    const coloredMinimumLength = Math.max(14, Math.round(Math.min(width, height) * 0.015));
    cv.HoughLinesP(coloredOpeningBinary, coloredLineMatrix, 1, Math.PI / 360, 14, coloredMinimumLength, 12);
    const coloredLineCount = coloredLineMatrix.rows * coloredLineMatrix.cols;
    for (let index = 0; index < coloredLineCount; index += 1) {
      const offset = index * 4;
      const line: DetectedLine = {
        start: { x: coloredLineMatrix.data32S[offset], y: coloredLineMatrix.data32S[offset + 1] },
        end: { x: coloredLineMatrix.data32S[offset + 2], y: coloredLineMatrix.data32S[offset + 3] },
        confidence: 0.9,
        evidence: { coloredOpeningSupport: 1 },
      };
      if (lineColoredOpeningSupport(line, width, height, rgba) >= 0.65) openingLines.push(line);
    }

    const arcs: DetectedArc[] = [];
    if (detectArcs) {
      onProgress({ stage: "raster", progress: 0.65, message: "Поиск дуговых стен и дуг открывания" });
      cv.Sobel(gray, gradientX, cv.CV_32F, 1, 0, 3);
      cv.Sobel(gray, gradientY, cv.CV_32F, 0, 1, 3);
      cv.HoughCircles(gray, circles, cv.HOUGH_GRADIENT, 1.5, Math.max(24, Math.min(width, height) * 0.05), 120, 42, 10, Math.round(Math.min(width, height) * 0.45));
      const samples = 180;
      for (let index = 0; index < circles.cols; index += 1) {
        const offset = index * 3;
        const centerX = circles.data32F[offset];
        const centerY = circles.data32F[offset + 1];
        const radius = circles.data32F[offset + 2];
        const support = Array.from({ length: samples }, (_, sample) => {
          const angle = sample / samples * Math.PI * 2;
          let best = 0;
          for (let radialOffset = -3; radialOffset <= 3; radialOffset += 1) {
            const x = Math.round(centerX + Math.cos(angle) * (radius + radialOffset));
            const y = Math.round(centerY + Math.sin(angle) * (radius + radialOffset));
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const pixelIndex = y * width + x;
            const gx = gradientX.data32F[pixelIndex];
            const gy = gradientY.data32F[pixelIndex];
            const magnitude = Math.hypot(gx, gy);
            if (magnitude < 45) continue;
            const radialAlignment = Math.abs((gx * Math.cos(angle) + gy * Math.sin(angle)) / magnitude);
            best = Math.max(best, radialAlignment * Math.min(1, magnitude / 180));
          }
          return best;
        });
        const occupied = support.map((value) => value >= 0.58);
        const run = longestCircularRun(closeSmallCircularGaps(occupied));
        if (!run || run.length > samples * 0.92 || !isMeaningfulRasterArc(radius, run.length, samples, Math.min(width, height))) continue;
        const meanGradientSupport = Array.from({ length: run.length }, (_, offsetIndex) => support[(run.start + offsetIndex) % samples])
          .reduce((sum, value) => sum + value, 0) / run.length;
        if (meanGradientSupport < 0.58) continue;
        const point = (sample: number) => {
          const angle = sample / samples * Math.PI * 2;
          return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
        };
        arcs.push({
          start: point(run.start),
          through: point(run.start + run.length / 2),
          end: point(run.start + run.length),
          confidence: Math.min(0.94, 0.34 + run.length / samples * 0.38 + meanGradientSupport * 0.42),
          evidence: { gradientSupport: meanGradientSupport },
        });
      }
    }
    onProgress({ stage: "raster", progress: 0.95, message: `Найдено линий: ${lines.length}, дуг: ${arcs.length}` });
    return {
      lines,
      arcs: deduplicateDetectedArcs(arcs)
        .sort((first, second) => second.confidence - first.confidence)
        .slice(0, 24),
      rawLines,
      openingLines,
    };
  } finally {
    source.delete();
    gray.delete();
    binary.delete();
    lineMatrix.delete();
    circles.delete();
    gradientX.delete();
    gradientY.delete();
    coloredOpeningBinary.delete();
    coloredLineMatrix.delete();
  }
}
