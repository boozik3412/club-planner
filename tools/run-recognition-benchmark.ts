import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildRecognitionGraph, mergeCollinearLines } from "../src/editor/recognition/graph";
import { wallPointAtDistance } from "../src/editor/architecture/geometry";
import { detectRasterGeometry } from "../src/editor/recognition/opencv-detector";
import { DEFAULT_RECOGNITION_OPTIONS, type RecognitionQualityReport } from "../src/editor/recognition/types";
import type { ArchitecturalOpening, ArchitecturalWall, ArchitectureVertex, PlanSource, PointM } from "../src/editor/model/types";
import { invertMatrix3, perspectiveMatrix, transformSourcePoint } from "../src/editor/recognition/perspective";
import { decodePdfDrawPath } from "../src/editor/recognition/pdf-vector";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "tests/fixtures/recognition/manifest.json");
const outputDirectory = resolve(root, "output/recognition-benchmark");
const SYNTHETIC_ORIGIN_PX = { x: 120, y: 80 };
const SYNTHETIC_PIXELS_PER_METER = 80;

interface GroundTruthWall {
  kind: "line" | "arc";
  start: [number, number];
  through?: [number, number];
  end: [number, number];
}

interface GroundTruthOpening {
  kind: "door" | "window";
  hostWallIndex: number;
  offsetM: number;
  widthM: number;
}

interface CorpusCase {
  id: string;
  category: "vector" | "scan" | "photo";
  path: string;
  mimeType: string;
  groundTruth: {
    walls: GroundTruthWall[];
    openings: GroundTruthOpening[];
    sourceQuad?: [[number, number], [number, number], [number, number], [number, number]];
  };
}

interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

type AffineMatrix = [number, number, number, number, number, number];

function multiplyAffine(first: AffineMatrix, second: AffineMatrix): AffineMatrix {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function affinePoint(matrix: AffineMatrix, point: { x: number; y: number }) {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

async function extractVectorPdf(bytes: Uint8Array) {
  const standardFontDataUrl = `${resolve(root, "node_modules/pdfjs-dist/standard_fonts").replaceAll("\\", "/")}/`;
  const document = await getDocument({ data: bytes, disableWorker: true, standardFontDataUrl }).promise;
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const viewportTransform = viewport.transform as AffineMatrix;
  const operators = await page.getOperatorList();
  const stack: Array<{ transform: AffineMatrix; strokeColor: string }> = [];
  let transform: AffineMatrix = [1, 0, 0, 1, 0, 0];
  let strokeColor = "#000000";
  const lines: ReturnType<typeof decodePdfDrawPath>["lines"] = [];
  const openingLines: ReturnType<typeof decodePdfDrawPath>["lines"] = [];
  const arcs: ReturnType<typeof decodePdfDrawPath>["arcs"] = [];
  const point = (value: { x: number; y: number }) => affinePoint(viewportTransform, affinePoint(transform, value));
  operators.fnArray.forEach((operation, index) => {
    const args = operators.argsArray[index] as unknown[];
    if (operation === OPS.save) stack.push({ transform: [...transform], strokeColor });
    else if (operation === OPS.restore) {
      const restored = stack.pop();
      transform = restored?.transform ?? [1, 0, 0, 1, 0, 0];
      strokeColor = restored?.strokeColor ?? "#000000";
    }
    else if (operation === OPS.transform) transform = multiplyAffine(transform, args.slice(0, 6).map(Number) as AffineMatrix);
    else if (operation === OPS.setStrokeRGBColor) strokeColor = String(args[0] ?? "#000000");
    else if (operation === OPS.constructPath && typeof args[0] === "number") {
      const color = strokeColor.match(/[\da-f]{2}/gi)?.map((value) => Number.parseInt(value, 16)) ?? [0, 0, 0];
      const architectural = Math.max(...color) - Math.min(...color) < 40;
      const paths = Array.isArray(args[1]) ? args[1] : [];
      paths.forEach((path) => {
        if (!path || typeof path !== "object" || !("length" in path)) return;
        const decoded = decodePdfDrawPath(path as ArrayLike<number>);
        decoded.lines.forEach((line) => {
          const transformed = { ...line, start: point(line.start), end: point(line.end) };
          if (architectural) lines.push(transformed);
          else openingLines.push({ ...transformed, evidence: { coloredOpeningSupport: 1 } });
        });
        decoded.arcs.forEach((arc) => arcs.push({ ...arc, start: point(arc.start), through: point(arc.through), end: point(arc.end) }));
      });
    }
  });
  return { width: viewport.width, height: viewport.height, lines, openingLines, arcs };
}

interface CaseMetrics {
  id: string;
  category: string;
  durationMs: number;
  expectedWalls: number;
  detectedWalls: number;
  truePositiveWalls: number;
  precision: number;
  recall: number;
  f1: number;
  meanAxisErrorM: number | null;
  expectedOpenings: number;
  detectedOpenings: number;
  truePositiveOpenings: number;
  openingPrecision: number;
  openingRecall: number;
  openingF1: number;
  quality: RecognitionQualityReport | undefined;
}

function decodeImage(bytes: Uint8Array, extension: string): DecodedImage {
  if (extension === ".jpg" || extension === ".jpeg") {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: decoded.width, height: decoded.height, rgba: new Uint8ClampedArray(decoded.data) };
  }
  if (extension === ".png") {
    const decoded = PNG.sync.read(Buffer.from(bytes));
    return { width: decoded.width, height: decoded.height, rgba: new Uint8ClampedArray(decoded.data) };
  }
  throw new Error(`Неподдерживаемый raster benchmark format: ${extension}`);
}

function rectifyFixtureImage(
  source: DecodedImage,
  quad: NonNullable<CorpusCase["groundTruth"]["sourceQuad"]>,
): DecodedImage {
  const outputWidth = 1_200;
  const outputHeight = 800;
  const sourceQuad = quad.map(([x, y]) => ({ x, y })) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const destination = [
    { x: 0, y: 0 }, { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 }, { x: 0, y: outputHeight - 1 },
  ] as const;
  const rectifiedToSource = invertMatrix3(perspectiveMatrix(sourceQuad, destination));
  const rgba = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const sourcePoint = transformSourcePoint({ x, y }, rectifiedToSource);
      const sourceX = Math.max(0, Math.min(source.width - 1, Math.round(sourcePoint.x)));
      const sourceY = Math.max(0, Math.min(source.height - 1, Math.round(sourcePoint.y)));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      rgba.set(source.rgba.subarray(sourceOffset, sourceOffset + 4), (y * outputWidth + x) * 4);
    }
  }
  return { width: outputWidth, height: outputHeight, rgba };
}

function pointDistance(first: PointM, second: PointM): number {
  return Math.hypot(first.xM - second.xM, first.yM - second.yM);
}

function lineAngle(start: PointM, end: PointM): number {
  return Math.atan2(end.yM - start.yM, end.xM - start.xM);
}

function angleDifference(first: number, second: number): number {
  const delta = Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
  return Math.min(delta, Math.abs(Math.PI - delta));
}

function pointToSegmentDistance(point: PointM, start: PointM, end: PointM): number {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= 1e-12) return pointDistance(point, start);
  const projection = Math.max(0, Math.min(1, ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / squaredLength));
  return pointDistance(point, { xM: start.xM + dx * projection, yM: start.yM + dy * projection });
}

function lineMatchError(
  expected: { start: PointM; end: PointM },
  actual: { start: PointM; end: PointM },
): number | null {
  if (angleDifference(lineAngle(expected.start, expected.end), lineAngle(actual.start, actual.end)) > Math.PI / 18) return null;
  const expectedLength = pointDistance(expected.start, expected.end);
  const actualLength = pointDistance(actual.start, actual.end);
  const endpointError = (
    pointToSegmentDistance(expected.start, actual.start, actual.end)
    + pointToSegmentDistance(expected.end, actual.start, actual.end)
    + pointToSegmentDistance(actual.start, expected.start, expected.end)
    + pointToSegmentDistance(actual.end, expected.start, expected.end)
  ) / 4;
  const lengthRatio = Math.min(expectedLength, actualLength) / Math.max(expectedLength, actualLength, 1e-9);
  if (lengthRatio < 0.42) return null;
  return endpointError;
}

function predictedLines(
  vertices: readonly ArchitectureVertex[],
  walls: readonly ArchitecturalWall[],
) {
  const vertexMap = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const fragments = walls.flatMap((wall) => {
    if (wall.curve.kind !== "line") return [];
    const start = vertexMap.get(wall.startVertexId);
    const end = vertexMap.get(wall.endVertexId);
    if (!start || !end) return [];
    return [{
      start: { x: start.xM, y: start.yM },
      end: { x: end.xM, y: end.yM },
      confidence: wall.confidence ?? 0,
    }];
  });
  return mergeCollinearLines(fragments, 0.08, 0.04).map((line) => ({
    start: { xM: line.start.x, yM: line.start.y },
    end: { xM: line.end.x, yM: line.end.y },
    confidence: line.confidence,
  }));
}

function expectedScanLines(walls: readonly GroundTruthWall[], metersPerPixel: number) {
  const point = (value: [number, number]): PointM => ({
    xM: (SYNTHETIC_ORIGIN_PX.x + value[0] * SYNTHETIC_PIXELS_PER_METER) * metersPerPixel,
    yM: (SYNTHETIC_ORIGIN_PX.y + value[1] * SYNTHETIC_PIXELS_PER_METER) * metersPerPixel,
  });
  return walls.filter((wall) => wall.kind === "line").map((wall) => ({ start: point(wall.start), end: point(wall.end) }));
}

function expectedOpenings(fixture: CorpusCase): Array<{ kind: "door" | "window"; center: PointM; widthM: number }> {
  return fixture.groundTruth.openings.flatMap((opening) => {
    const host = fixture.groundTruth.walls[opening.hostWallIndex];
    if (!host || host.kind !== "line") return [];
    const dx = host.end[0] - host.start[0];
    const dy = host.end[1] - host.start[1];
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return [];
    const alongM = opening.offsetM + opening.widthM / 2;
    return [{
      kind: opening.kind,
      widthM: opening.widthM,
      center: {
        xM: (SYNTHETIC_ORIGIN_PX.x + (host.start[0] + dx / length * alongM) * SYNTHETIC_PIXELS_PER_METER) / SYNTHETIC_PIXELS_PER_METER,
        yM: (SYNTHETIC_ORIGIN_PX.y + (host.start[1] + dy / length * alongM) * SYNTHETIC_PIXELS_PER_METER) / SYNTHETIC_PIXELS_PER_METER,
      },
    }];
  });
}

function actualOpenings(
  vertices: readonly ArchitectureVertex[],
  walls: readonly ArchitecturalWall[],
  openings: readonly ArchitecturalOpening[],
) {
  const vertexMap = new Map(vertices.map((vertex) => [vertex.id, vertex]));
  const wallMap = new Map(walls.map((wall) => [wall.id, wall]));
  return openings.flatMap((opening) => {
    const wall = wallMap.get(opening.hostWallId);
    if (!wall) return [];
    const center = wallPointAtDistance(wall, vertexMap, opening.offsetM + opening.widthM / 2);
    return center ? [{ kind: opening.kind, center, widthM: opening.widthM }] : [];
  });
}

function scoreOpenings(
  expected: readonly { kind: "door" | "window"; center: PointM; widthM: number }[],
  actual: readonly { kind: "door" | "window"; center: PointM; widthM: number }[],
) {
  const candidates = expected.flatMap((expectedOpening, expectedIndex) => actual.flatMap((actualOpening, actualIndex) => {
    if (expectedOpening.kind !== actualOpening.kind || Math.abs(expectedOpening.widthM - actualOpening.widthM) > 0.45) return [];
    const error = pointDistance(expectedOpening.center, actualOpening.center);
    return error <= 0.4 ? [{ expectedIndex, actualIndex, error }] : [];
  })).sort((first, second) => first.error - second.error);
  const usedExpected = new Set<number>();
  const usedActual = new Set<number>();
  let matches = 0;
  candidates.forEach((candidate) => {
    if (usedExpected.has(candidate.expectedIndex) || usedActual.has(candidate.actualIndex)) return;
    usedExpected.add(candidate.expectedIndex);
    usedActual.add(candidate.actualIndex);
    matches += 1;
  });
  const precision = actual.length > 0 ? matches / actual.length : 0;
  const recall = expected.length > 0 ? matches / expected.length : 0;
  return { matches, precision, recall, f1: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0 };
}

function scoreLines(
  expected: readonly { start: PointM; end: PointM }[],
  actual: readonly { start: PointM; end: PointM }[],
  toleranceM: number,
) {
  const candidates = expected.flatMap((expectedLine, expectedIndex) => actual.flatMap((actualLine, actualIndex) => {
    const error = lineMatchError(expectedLine, actualLine);
    return error !== null && error <= toleranceM ? [{ expectedIndex, actualIndex, error }] : [];
  })).sort((first, second) => first.error - second.error);
  const usedExpected = new Set<number>();
  const usedActual = new Set<number>();
  const matches: typeof candidates = [];
  candidates.forEach((candidate) => {
    if (usedExpected.has(candidate.expectedIndex) || usedActual.has(candidate.actualIndex)) return;
    usedExpected.add(candidate.expectedIndex);
    usedActual.add(candidate.actualIndex);
    matches.push(candidate);
  });
  const precision = actual.length > 0 ? matches.length / actual.length : expected.length === 0 ? 1 : 0;
  const recall = expected.length > 0 ? matches.length / expected.length : actual.length === 0 ? 1 : 0;
  return {
    truePositives: matches.length,
    precision,
    recall,
    f1: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0,
    meanErrorM: matches.length > 0 ? matches.reduce((sum, match) => sum + match.error, 0) / matches.length : null,
  };
}

function sourceFor(id: string, image: DecodedImage, metersPerPixel: number): PlanSource {
  return {
    id: `benchmark-${id}`,
    kind: "image",
    name: id,
    mimeType: "image/png",
    sha256: "0".repeat(64),
    embeddedPath: `benchmark/${id}`,
    widthM: image.width * metersPerPixel,
    heightM: image.height * metersPerPixel,
    rotationDeg: 0,
    sourceWidth: image.width,
    sourceHeight: image.height,
    metersPerSourceUnit: metersPerPixel,
    locked: true,
  };
}

async function benchmarkRasterCase(fixture: CorpusCase): Promise<CaseMetrics> {
  const bytes = new Uint8Array(await readFile(resolve(root, fixture.path)));
  const decoded = decodeImage(bytes, extname(fixture.path).toLowerCase());
  const image = fixture.category === "photo" && fixture.groundTruth.sourceQuad
    ? rectifyFixtureImage(decoded, fixture.groundTruth.sourceQuad)
    : decoded;
  const metersPerPixel = 1 / SYNTHETIC_PIXELS_PER_METER;
  const startedAt = performance.now();
  const detected = await detectRasterGeometry(
    image.width,
    image.height,
    image.rgba,
    false,
    () => {},
    DEFAULT_RECOGNITION_OPTIONS.minimumWallLengthM / metersPerPixel,
  );
  const draft = buildRecognitionGraph({
    source: sourceFor(fixture.id, image, metersPerPixel),
    lines: detected.lines,
    openingLines: detected.openingLines,
    arcs: [],
    options: { ...DEFAULT_RECOGNITION_OPTIONS, detectArcs: false, recognizeText: false },
    geometrySource: "raster",
    engineVersion: "local-hybrid-2-safety",
  });
  const actual = predictedLines(draft.vertices, draft.walls);
  const expected = expectedScanLines(fixture.groundTruth.walls, metersPerPixel);
  const score = scoreLines(expected, actual, fixture.category === "photo" ? 0.1 : 0.05);
  const expectedOpeningCandidates = expectedOpenings(fixture);
  const actualOpeningCandidates = actualOpenings(draft.vertices, draft.walls, draft.openings);
  const openingScore = scoreOpenings(expectedOpeningCandidates, actualOpeningCandidates);
  const toPixel = (point: PointM) => ({ x: point.xM / metersPerPixel, y: point.yM / metersPerPixel });
  const expectedSvg = expected.map((line) => {
    const start = toPixel(line.start);
    const end = toPixel(line.end);
    return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" class="expected"/>`;
  }).join("\n");
  const actualSvg = actual.map((line) => {
    const start = toPixel(line.start);
    const end = toPixel(line.end);
    return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" class="actual"/>`;
  }).join("\n");
  const background = fixture.category === "scan"
    ? `<image width="${image.width}" height="${image.height}" href="data:${fixture.mimeType};base64,${Buffer.from(bytes).toString("base64")}" opacity="0.55"/>`
    : "";
  await writeFile(resolve(outputDirectory, `${fixture.id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">
${background}
<style>.expected{stroke:#16a34a;stroke-width:8;fill:none}.actual{stroke:#dc2626;stroke-width:3;fill:none}</style>
${expectedSvg}
${actualSvg}
</svg>\n`, "utf8");
  await writeFile(resolve(outputDirectory, `${fixture.id}.debug.json`), `${JSON.stringify({
    rawLines: detected.rawLines,
    openingLines: detected.openingLines,
    consolidatedLines: detected.lines,
    graphLines: actual.map((line) => ({ start: line.start, end: line.end, confidence: line.confidence })),
    openings: actualOpeningCandidates,
  }, null, 2)}\n`, "utf8");
  return {
    id: fixture.id,
    category: fixture.category,
    durationMs: Math.round(performance.now() - startedAt),
    expectedWalls: expected.length,
    detectedWalls: actual.length,
    truePositiveWalls: score.truePositives,
    precision: score.precision,
    recall: score.recall,
    f1: score.f1,
    meanAxisErrorM: score.meanErrorM,
    expectedOpenings: expectedOpeningCandidates.length,
    detectedOpenings: actualOpeningCandidates.length,
    truePositiveOpenings: openingScore.matches,
    openingPrecision: openingScore.precision,
    openingRecall: openingScore.recall,
    openingF1: openingScore.f1,
    quality: draft.quality,
  };
}

async function benchmarkVectorCase(fixture: CorpusCase): Promise<CaseMetrics> {
  const bytes = new Uint8Array(await readFile(resolve(root, fixture.path)));
  const startedAt = performance.now();
  const extracted = await extractVectorPdf(bytes);
  const metersPerUnit = 1 / SYNTHETIC_PIXELS_PER_METER;
  const draft = buildRecognitionGraph({
    source: sourceFor(fixture.id, { width: extracted.width, height: extracted.height, rgba: new Uint8ClampedArray() }, metersPerUnit),
    lines: extracted.lines,
    openingLines: extracted.openingLines,
    arcs: extracted.arcs,
    options: { ...DEFAULT_RECOGNITION_OPTIONS, detectArcs: true, recognizeText: false },
    geometrySource: "vector",
    engineVersion: "local-hybrid-2-vector",
  });
  const actual = predictedLines(draft.vertices, draft.walls);
  const expected = expectedScanLines(fixture.groundTruth.walls, metersPerUnit);
  const score = scoreLines(expected, actual, 0.02);
  const expectedOpeningCandidates = expectedOpenings(fixture);
  const actualOpeningCandidates = actualOpenings(draft.vertices, draft.walls, draft.openings);
  const openingScore = scoreOpenings(expectedOpeningCandidates, actualOpeningCandidates);
  return {
    id: fixture.id, category: fixture.category, durationMs: Math.round(performance.now() - startedAt),
    expectedWalls: expected.length, detectedWalls: actual.length, truePositiveWalls: score.truePositives,
    precision: score.precision, recall: score.recall, f1: score.f1, meanAxisErrorM: score.meanErrorM,
    expectedOpenings: expectedOpeningCandidates.length, detectedOpenings: actualOpeningCandidates.length,
    truePositiveOpenings: openingScore.matches, openingPrecision: openingScore.precision,
    openingRecall: openingScore.recall, openingF1: openingScore.f1, quality: draft.quality,
  };
}

function aggregate(cases: readonly CaseMetrics[]) {
  const totals = cases.reduce((result, item) => ({
    expected: result.expected + item.expectedWalls,
    detected: result.detected + item.detectedWalls,
    truePositives: result.truePositives + item.truePositiveWalls,
    durationMs: result.durationMs + item.durationMs,
    expectedOpenings: result.expectedOpenings + item.expectedOpenings,
    detectedOpenings: result.detectedOpenings + item.detectedOpenings,
    truePositiveOpenings: result.truePositiveOpenings + item.truePositiveOpenings,
  }), { expected: 0, detected: 0, truePositives: 0, durationMs: 0, expectedOpenings: 0, detectedOpenings: 0, truePositiveOpenings: 0 });
  const precision = totals.detected > 0 ? totals.truePositives / totals.detected : 0;
  const recall = totals.expected > 0 ? totals.truePositives / totals.expected : 0;
  const openingPrecision = totals.detectedOpenings > 0 ? totals.truePositiveOpenings / totals.detectedOpenings : 0;
  const openingRecall = totals.expectedOpenings > 0 ? totals.truePositiveOpenings / totals.expectedOpenings : 0;
  return {
    ...totals,
    precision,
    recall,
    f1: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0,
    openingPrecision,
    openingRecall,
    openingF1: openingPrecision + openingRecall > 0 ? 2 * openingPrecision * openingRecall / (openingPrecision + openingRecall) : 0,
    meanAxisErrorM: (() => {
      const measured = cases.filter((item) => item.meanAxisErrorM !== null);
      return measured.length > 0 ? measured.reduce((sum, item) => sum + item.meanAxisErrorM!, 0) / measured.length : null;
    })(),
  };
}

function markdownReport(
  cases: readonly CaseMetrics[],
  summaries: { vector: ReturnType<typeof aggregate>; scan: ReturnType<typeof aggregate>; photo: ReturnType<typeof aggregate> },
): string {
  const percent = (value: number) => (value * 100).toFixed(1);
  const lines = [
    "# Recognition benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Scan straight-wall F1: **${percent(summaries.scan.f1)}%** (precision ${percent(summaries.scan.precision)}%, recall ${percent(summaries.scan.recall)}%)`,
    `Scan opening F1: **${percent(summaries.scan.openingF1)}%** (precision ${percent(summaries.scan.openingPrecision)}%, recall ${percent(summaries.scan.openingRecall)}%)`,
    `Scan mean axis error: **${summaries.scan.meanAxisErrorM === null ? "n/a" : `${(summaries.scan.meanAxisErrorM * 100).toFixed(2)} cm`}**`,
    `Rectified photo straight-wall F1: **${percent(summaries.photo.f1)}%** (precision ${percent(summaries.photo.precision)}%, recall ${percent(summaries.photo.recall)}%)`,
    `Rectified photo opening F1: **${percent(summaries.photo.openingF1)}%**`,
    `Vector PDF straight-wall F1: **${percent(summaries.vector.f1)}%**; mean axis error **${summaries.vector.meanAxisErrorM === null ? "n/a" : `${(summaries.vector.meanAxisErrorM * 100).toFixed(2)} cm`}**`,
    `Runtime: **${summaries.vector.durationMs + summaries.scan.durationMs + summaries.photo.durationMs} ms**`,
    "",
    "| Case | Expected | Detected | TP | Precision | Recall | F1 | Quality |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...cases.map((item) => `| ${item.id} | ${item.expectedWalls} | ${item.detectedWalls} | ${item.truePositiveWalls} | ${percent(item.precision)}% | ${percent(item.recall)}% | ${percent(item.f1)}% | ${item.quality?.status ?? "n/a"} ${item.quality?.score ?? ""} |`),
    "",
    "> Photo cases are measured after applying their known four-corner calibration, matching the import wizard workflow. Handwritten plans and uncalibrated raw photographs are outside this gate.",
    "",
  ];
  return lines.join("\n");
}

async function inspectManualImage(path: string, metersPerPixel: number): Promise<void> {
  const absolutePath = resolve(path);
  const bytes = new Uint8Array(await readFile(absolutePath));
  const image = decodeImage(bytes, extname(absolutePath).toLowerCase());
  const detected = await detectRasterGeometry(image.width, image.height, image.rgba, true, () => {}, DEFAULT_RECOGNITION_OPTIONS.minimumWallLengthM / metersPerPixel);
  const draft = buildRecognitionGraph({
    source: sourceFor("manual-image", image, metersPerPixel),
    lines: detected.lines,
    openingLines: detected.openingLines,
    arcs: detected.arcs,
    options: { ...DEFAULT_RECOGNITION_OPTIONS, detectArcs: true, recognizeText: false },
    geometrySource: "raster",
    engineVersion: "local-hybrid-2-safety",
  });
  await mkdir(outputDirectory, { recursive: true });
  const graphLines = predictedLines(draft.vertices, draft.walls);
  const sourceDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
  const wallAxes = detected.lines.map((line) => `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}" class="candidate"/>`).join("\n");
  const acceptedAxes = graphLines.map((line) => `<line x1="${line.start.xM / metersPerPixel}" y1="${line.start.yM / metersPerPixel}" x2="${line.end.xM / metersPerPixel}" y2="${line.end.yM / metersPerPixel}" class="accepted"/>`).join("\n");
  await writeFile(resolve(outputDirectory, "manual.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">
<image width="${image.width}" height="${image.height}" href="${sourceDataUrl}" opacity="0.72"/>
<style>.candidate{stroke:#f59e0b;stroke-width:5;fill:none;opacity:.7}.accepted{stroke:#16a34a;stroke-width:2.5;fill:none}</style>
${wallAxes}
${acceptedAxes}
</svg>\n`, "utf8");
  await writeFile(resolve(outputDirectory, "manual.debug.json"), `${JSON.stringify({
    wallAxes: detected.lines,
    openingLines: detected.openingLines,
    arcs: detected.arcs,
    graphLines,
    openings: actualOpenings(draft.vertices, draft.walls, draft.openings),
    quality: draft.quality,
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    file: absolutePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    image: { width: image.width, height: image.height },
    rawLines: detected.rawLines.length,
    wallAxes: detected.lines.length,
    rawArcs: detected.arcs.length,
    graphWalls: draft.walls.length,
    graphOpenings: draft.openings.length,
    quality: draft.quality,
    overlay: resolve(outputDirectory, "manual.svg"),
  }, null, 2)}\n`);
}

const manualIndex = process.argv.indexOf("--image");
if (manualIndex >= 0) {
  const path = process.argv[manualIndex + 1];
  const scaleIndex = process.argv.indexOf("--meters-per-pixel");
  const metersPerPixel = scaleIndex >= 0 ? Number(process.argv[scaleIndex + 1]) : 0.01;
  if (!path || !(metersPerPixel > 0)) throw new Error("Usage: --image <path> --meters-per-pixel <number>");
  await inspectManualImage(path, metersPerPixel);
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { cases: CorpusCase[] };
  const benchmarkCases = manifest.cases;
  const cases: CaseMetrics[] = [];
  await mkdir(outputDirectory, { recursive: true });
  for (const fixture of benchmarkCases) {
    process.stdout.write(`Benchmark ${fixture.id}...\n`);
    cases.push(fixture.category === "vector" ? await benchmarkVectorCase(fixture) : await benchmarkRasterCase(fixture));
  }
  const summaries = {
    vector: aggregate(cases.filter((item) => item.category === "vector")),
    scan: aggregate(cases.filter((item) => item.category === "scan")),
    photo: aggregate(cases.filter((item) => item.category === "photo")),
  };
  await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), summaries, cases }, null, 2)}\n`, "utf8");
  await writeFile(resolve(outputDirectory, "report.md"), markdownReport(cases, summaries), "utf8");
  process.stdout.write(`${JSON.stringify(summaries, null, 2)}\nReport: ${resolve(outputDirectory, "report.md")}\n`);
  const failures = [
    summaries.vector.f1 < 0.98 ? `vector wall F1 ${summaries.vector.f1.toFixed(3)} < 0.98` : null,
    summaries.vector.meanAxisErrorM !== null && summaries.vector.meanAxisErrorM > 0.02 ? `vector axis error ${summaries.vector.meanAxisErrorM.toFixed(3)} m > 0.02 m` : null,
    summaries.scan.f1 < 0.9 ? `scan wall F1 ${summaries.scan.f1.toFixed(3)} < 0.90` : null,
    summaries.scan.openingF1 < 0.75 ? `scan opening F1 ${summaries.scan.openingF1.toFixed(3)} < 0.75` : null,
    summaries.photo.f1 < 0.8 ? `photo wall F1 ${summaries.photo.f1.toFixed(3)} < 0.80` : null,
    summaries.photo.openingF1 < 0.6 ? `photo opening F1 ${summaries.photo.openingF1.toFixed(3)} < 0.60` : null,
  ].filter((value): value is string => Boolean(value));
  if (failures.length > 0) throw new Error(`Recognition release gate failed:\n- ${failures.join("\n- ")}`);
}
