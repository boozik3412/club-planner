import { getRotatedViewBox, GRID_STEP_UNITS } from "../base-plan";
import type { LoadedBasePlan } from "../load-base-plan";
import type { PlanObject, ProjectState } from "../model/types";

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
  return `<g data-object-id="${escapeXml(object.id)}"><g transform="translate(${x} ${y}) rotate(${object.rotationDeg})">${shape}</g>${label}</g>`;
}

export function buildProjectSvg(project: ProjectState, plan: LoadedBasePlan): string {
  const [viewX, viewY, viewWidth, viewHeight] = getRotatedViewBox(project.canvas.rotationDeg);
  const unitsPerMeter = project.basePlan.unitsPerMeter;
  const visibleLayerIds = new Set(project.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const grid = project.canvas.gridVisible
    ? `<rect x="0" y="0" width="${project.basePlan.widthM * unitsPerMeter}" height="${project.basePlan.heightM * unitsPerMeter}" fill="url(#club-export-grid)"/>`
    : "";
  const base = project.canvas.basePlanVisible
    ? `<g opacity="${project.canvas.basePlanOpacity}"><g>${plan.geometryMarkup}</g>${project.canvas.planLabelsVisible
      ? plan.labels.map((label) => `<g transform="rotate(${-project.canvas.rotationDeg} ${label.cx} ${label.cy})">${label.markup}</g>`).join("")
      : ""}</g>`
    : "";
  const objects = project.objects
    .filter((object) => visibleLayerIds.has(object.layerId))
    .map((object) => objectMarkup(object, unitsPerMeter, project.canvas.rotationDeg))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}"><defs><pattern id="club-export-grid" width="${GRID_STEP_UNITS}" height="${GRID_STEP_UNITS}" patternUnits="userSpaceOnUse"><path d="M ${GRID_STEP_UNITS} 0 L 0 0 0 ${GRID_STEP_UNITS}" fill="none" stroke="#cfd7dd" stroke-width="1.4" vector-effect="non-scaling-stroke"/></pattern>${plan.defsMarkup}</defs><rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" fill="#fff"/><g transform="rotate(${project.canvas.rotationDeg} ${project.basePlan.widthM * unitsPerMeter / 2} ${project.basePlan.heightM * unitsPerMeter / 2})">${grid}${base}${objects}</g></svg>\n`;
}
