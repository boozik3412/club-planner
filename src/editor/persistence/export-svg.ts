import { getRotatedViewBox } from "../base-plan";
import type { LoadedBasePlan } from "../load-base-plan";
import { BASE_PLAN_ID, type PlanObject, type ProjectState } from "../model/types";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] as string);
}

function objectMarkup(object: PlanObject, unitsPerMeter: number, canvasRotation: number): string {
  const x = object.xM * unitsPerMeter;
  const y = object.yM * unitsPerMeter;
  const width = object.widthM * unitsPerMeter;
  const depth = object.depthM * unitsPerMeter;
  const fill = escapeXml(object.style?.fill ?? "#d9e5ed");
  const dash = object.kind === "zone" ? ' stroke-dasharray="24 16" fill-opacity="0.42"' : "";
  const shape = object.kind === "custom-circle" || object.kind === "custom-oval"
    ? `<ellipse cx="0" cy="0" rx="${width / 2}" ry="${depth / 2}" fill="${fill}" stroke="#26313a" stroke-width="3" vector-effect="non-scaling-stroke"/>`
    : `<rect x="${-width / 2}" y="${-depth / 2}" width="${width}" height="${depth}" rx="${Math.min(width, depth) * 0.06}" fill="${fill}" stroke="#26313a" stroke-width="3" vector-effect="non-scaling-stroke"${dash}/>`;
  const label = object.labelVisible
    ? `<g transform="rotate(${-canvasRotation} ${x} ${y})"><text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI,Arial,sans-serif" font-size="83" fill="#111820" stroke="#fff" stroke-width="15" paint-order="stroke">${escapeXml(object.name)}</text></g>`
    : "";
  const scaleX = object.flipX ? -1 : 1;
  const scaleY = object.flipY ? -1 : 1;
  return `<g data-object-id="${escapeXml(object.id)}"><g transform="translate(${x} ${y}) rotate(${object.rotationDeg}) scale(${scaleX} ${scaleY})">${shape}</g>${label}</g>`;
}

export function buildProjectSvg(project: ProjectState, plan: LoadedBasePlan): string {
  const unitsPerMeter = project.basePlan.unitsPerMeter;
  const widthUnits = project.basePlan.widthM * unitsPerMeter;
  const heightUnits = project.basePlan.heightM * unitsPerMeter;
  const [viewX, viewY, viewWidth, viewHeight] = getRotatedViewBox(project.canvas.rotationDeg, widthUnits, heightUnits);
  const gridStepUnits = project.canvas.gridStepM * unitsPerMeter;
  const visibleLayerIds = new Set(project.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const grid = project.canvas.gridVisible
    ? `<rect x="0" y="0" width="${project.basePlan.widthM * unitsPerMeter}" height="${project.basePlan.heightM * unitsPerMeter}" fill="url(#club-export-grid)"/>`
    : "";
  const base = project.canvas.basePlanVisible && project.activePlanSourceId === BASE_PLAN_ID
    ? `<g opacity="${project.canvas.basePlanOpacity}"><g>${plan.geometryMarkup}</g>${project.canvas.planLabelsVisible
      ? plan.labels.map((label) => `<g transform="rotate(${-project.canvas.rotationDeg} ${label.cx} ${label.cy})">${label.markup}</g>`).join("")
      : ""}</g>`
    : "";
  const objects = project.objects
    .filter((object) => visibleLayerIds.has(object.layerId))
    .map((object) => objectMarkup(object, unitsPerMeter, project.canvas.rotationDeg))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${viewWidth}" height="${viewHeight}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}"><defs><pattern id="club-export-grid" width="${gridStepUnits}" height="${gridStepUnits}" patternUnits="userSpaceOnUse"><path d="M ${gridStepUnits} 0 L 0 0 0 ${gridStepUnits}" fill="none" stroke="#cfd7dd" stroke-width="1.4" vector-effect="non-scaling-stroke"/></pattern>${plan.defsMarkup}</defs><rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" fill="#fff"/><g transform="rotate(${project.canvas.rotationDeg} ${widthUnits / 2} ${heightUnits / 2})">${grid}${base}${objects}</g></svg>\n`;
}

export function buildProjectPdfSvg(project: ProjectState, plan: LoadedBasePlan): string {
  const source = buildProjectSvg(project, plan);
  const unitsPerMeter = project.basePlan.unitsPerMeter;
  const [viewX, viewY, viewWidth, viewHeight] = getRotatedViewBox(
    project.canvas.rotationDeg,
    project.basePlan.widthM * unitsPerMeter,
    project.basePlan.heightM * unitsPerMeter,
  );
  const pageWidth = 1122;
  const pageHeight = 793;
  const margin = 28;
  const availableWidth = pageWidth - 2 * margin;
  const availableHeight = pageHeight - 2 * margin;
  const scale = Math.min(availableWidth / viewWidth, availableHeight / viewHeight);
  const contentWidth = viewWidth * scale;
  const contentHeight = viewHeight * scale;
  const contentX = (pageWidth - contentWidth) / 2;
  const contentY = (pageHeight - contentHeight) / 2;
  const inner = source.slice(source.indexOf("<defs>"), source.lastIndexOf("</svg>"));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}"><rect width="${pageWidth}" height="${pageHeight}" fill="#fff"/><svg x="${contentX}" y="${contentY}" width="${contentWidth}" height="${contentHeight}" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet">${inner}</svg></svg>\n`;
}
