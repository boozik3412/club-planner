import {
  PLAN_CENTER_X,
  PLAN_CENTER_Y,
  PLAN_HEIGHT_UNITS,
  PLAN_WIDTH_UNITS,
} from "../base-plan";
import type { CameraState } from "../model/types";

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

function rotatedBounds(rotationDeg: number): UnitBounds {
  const normalized = ((rotationDeg % 360) + 360) % 360;
  if (normalized === 90 || normalized === 270) {
    return {
      minX: PLAN_CENTER_X - PLAN_HEIGHT_UNITS / 2,
      minY: PLAN_CENTER_Y - PLAN_WIDTH_UNITS / 2,
      width: PLAN_HEIGHT_UNITS,
      height: PLAN_WIDTH_UNITS,
    };
  }
  return { minX: 0, minY: 0, width: PLAN_WIDTH_UNITS, height: PLAN_HEIGHT_UNITS };
}

export function fitCamera(
  viewport: ViewportSize,
  rotationDeg: number,
  margin = 36,
): CameraState {
  const bounds = rotatedBounds(rotationDeg);
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
): { x: number; y: number } {
  const rotatedX = (screenX - camera.x) / camera.zoom;
  const rotatedY = (screenY - camera.y) / camera.zoom;
  const radians = (-rotationDeg * Math.PI) / 180;
  const dx = rotatedX - PLAN_CENTER_X;
  const dy = rotatedY - PLAN_CENTER_Y;
  return {
    x: PLAN_CENTER_X + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: PLAN_CENTER_Y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}
