import { describe, expect, it } from "vitest";
import { PLAN_CENTER_X, PLAN_CENTER_Y } from "../base-plan";
import { fitCamera, screenToPlanUnits, zoomCameraAtPoint } from "./camera";

describe("camera", () => {
  it("fits horizontal and vertical plan rotations", () => {
    const horizontal = fitCamera({ width: 1200, height: 700 }, 0);
    const vertical = fitCamera({ width: 1200, height: 700 }, 90);
    expect(horizontal.zoom).toBeGreaterThan(vertical.zoom);
  });

  it("keeps the point under the cursor stable while zooming", () => {
    const camera = { x: 20, y: 30, zoom: 0.05 };
    const before = screenToPlanUnits(500, 300, camera, 0);
    const zoomed = zoomCameraAtPoint(camera, 500, 300, 1.5);
    expect(screenToPlanUnits(500, 300, zoomed, 0)).toEqual(before);
  });

  it("inverts the canvas rotation", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const point = screenToPlanUnits(PLAN_CENTER_X, PLAN_CENTER_Y + 100, camera, 90);
    expect(point.x).toBeCloseTo(PLAN_CENTER_X + 100);
    expect(point.y).toBeCloseTo(PLAN_CENTER_Y);
  });
});
