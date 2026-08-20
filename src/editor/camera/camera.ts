import { PLAN_HEIGHT_UNITS, PLAN_WIDTH_UNITS } from "../base-plan";
import type { CameraState, PointM } from "../model/types";

export interface ViewportSize {
  width: number;
  height: number;
}

interface UnitBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function rotatedBounds(
  rotationDeg: number,
  widthUnits = PLAN_WIDTH_UNITS,
  heightUnits = PLAN_HEIGHT_UNITS,
): UnitBounds {
  const centerX = widthUnits / 2;
  const centerY = heightUnits / 2;
  const normalized = ((rotationDeg % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) {
    return {
      minX: centerX - heightUnits / 2,
      minY: centerY - widthUnits / 2,
      width: heightUnits,
      height: widthUnits,
    };
  }
  return { minX: 0, minY: 0, width: widthUnits, height: heightUnits };
}

export function fitCamera(
  viewport: ViewportSize,
  rotationDeg: number,
  margin = 36,
  widthUnits = PLAN_WIDTH_UNITS,
  heightUnits = PLAN_HEIGHT_UNITS,
): CameraState {
  const bounds = rotatedBounds(rotationDeg, widthUnits, heightUnits);
  const availableWidth = Math.max(1, viewport.width - margin * 2);
  const availableHeight = Math.max(1, viewport.height - margin * 2);
  const zoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  return {
    zoom,
    x: (viewport.width - bounds.width * zoom) / 2 - bounds.minX * zoom,
    y: (viewport.height - bounds.height * zoom) / 2 - bounds.minY * zoom,
  };
}

export function zoomCameraAtPoint(
  camera: CameraState,
  screenX: number,
  screenY: number,
  factor: number,
): CameraState {
  const zoom = Math.min(4, Math.max(0.005, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return {
    zoom,
    x: screenX - (screenX - camera.x) * ratio,
    y: screenY - (screenY - camera.y) * ratio,
  };
}

export function screenToPlanUnits(
  screenX: number,
  screenY: number,
  camera: CameraState,
  rotationDeg: number,
  widthUnits = PLAN_WIDTH_UNITS,
  heightUnits = PLAN_HEIGHT_UNITS,
): { x: number; y: number } {
  const rotatedX = (screenX - camera.x) / camera.zoom;
  const rotatedY = (screenY - camera.y) / camera.zoom;
  const radians = (-rotationDeg * Math.PI) / 180;
  const centerX = widthUnits / 2;
  const centerY = heightUnits / 2;
  const dx = rotatedX - centerX;
  const dy = rotatedY - centerY;
  return {
    x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

export function viewportCenterToPlanMeters(
  viewport: ViewportSize,
  camera: CameraState,
  rotationDeg: number,
  unitsPerMeter: number,
  widthUnits = PLAN_WIDTH_UNITS,
  heightUnits = PLAN_HEIGHT_UNITS,
): PointM {
  const center = screenToPlanUnits(
    viewport.width / 2,
    viewport.height / 2,
    camera,
    rotationDeg,
    widthUnits,
    heightUnits,
  );
  return {
    xM: center.x / unitsPerMeter,
    yM: center.y / unitsPerMeter,
  };
}
