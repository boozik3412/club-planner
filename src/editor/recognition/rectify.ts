import type { SourcePoint } from "../model/types";
import { invertMatrix3, perspectiveMatrix, transformSourcePoint, type Matrix3 } from "./perspective";

export interface RectifiedImage {
  imageData: ImageData;
  sourceToRectified: Matrix3;
}

export function rotateImageData90(source: ImageData, clockwise: boolean): ImageData {
  const result = new ImageData(source.height, source.width);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const targetX = clockwise ? source.height - 1 - y : y;
      const targetY = clockwise ? x : source.width - 1 - x;
      const sourceOffset = (y * source.width + x) * 4;
      const targetOffset = (targetY * result.width + targetX) * 4;
      result.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return result;
}

export function suggestDocumentQuad(source: ImageData): [SourcePoint, SourcePoint, SourcePoint, SourcePoint] {
  const cornerSamples = [
    0,
    (source.width - 1) * 4,
    (source.height - 1) * source.width * 4,
    (source.height * source.width - 1) * 4,
  ];
  const background = cornerSamples.reduce((sum, offset) => sum + (source.data[offset] + source.data[offset + 1] + source.data[offset + 2]) / 3, 0) / cornerSamples.length;
  const step = Math.max(1, Math.floor(Math.min(source.width, source.height) / 500));
  let minX = source.width - 1;
  let minY = source.height - 1;
  let maxX = 0;
  let maxY = 0;
  let matches = 0;
  for (let y = 0; y < source.height; y += step) {
    for (let x = 0; x < source.width; x += step) {
      const offset = (y * source.width + x) * 4;
      const luminance = (source.data[offset] + source.data[offset + 1] + source.data[offset + 2]) / 3;
      if (Math.abs(luminance - background) < 28) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      matches += 1;
    }
  }
  if (matches < 20 || maxX - minX < source.width * 0.25 || maxY - minY < source.height * 0.25) {
    return [{ x: 0, y: 0 }, { x: source.width - 1, y: 0 }, { x: source.width - 1, y: source.height - 1 }, { x: 0, y: source.height - 1 }];
  }
  const margin = Math.max(2, step * 2);
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(source.width - 1, maxX + margin);
  maxY = Math.min(source.height - 1, maxY + margin);
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

export function rectifyImageData(
  source: ImageData,
  quad: readonly [SourcePoint, SourcePoint, SourcePoint, SourcePoint],
  outputWidth: number,
  outputHeight: number,
): RectifiedImage {
  const destination = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ] as const;
  const sourceToRectified = perspectiveMatrix(quad, destination);
  const inverse = invertMatrix3(sourceToRectified);
  const result = new ImageData(outputWidth, outputHeight);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const sourcePoint = transformSourcePoint({ x, y }, inverse);
      const sourceX = Math.max(0, Math.min(source.width - 1, Math.round(sourcePoint.x)));
      const sourceY = Math.max(0, Math.min(source.height - 1, Math.round(sourcePoint.y)));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const resultOffset = (y * outputWidth + x) * 4;
      result.data[resultOffset] = source.data[sourceOffset];
      result.data[resultOffset + 1] = source.data[sourceOffset + 1];
      result.data[resultOffset + 2] = source.data[sourceOffset + 2];
      result.data[resultOffset + 3] = source.data[sourceOffset + 3];
    }
  }
  return { imageData: result, sourceToRectified };
}
