import { describe, expect, it } from "vitest";
import { invertMatrix3, perspectiveMatrix, rectangleForQuad, transformSourcePoint } from "./perspective";

describe("perspective", () => {
  it("maps four source corners and returns through the inverse", () => {
    const source = [{ x: 10, y: 20 }, { x: 220, y: 5 }, { x: 200, y: 150 }, { x: 0, y: 140 }] as const;
    const destination = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }] as const;
    const matrix = perspectiveMatrix(source, destination);
    source.forEach((point, index) => {
      const mapped = transformSourcePoint(point, matrix);
      expect(mapped.x).toBeCloseTo(destination[index].x, 6);
      expect(mapped.y).toBeCloseTo(destination[index].y, 6);
      const restored = transformSourcePoint(mapped, invertMatrix3(matrix));
      expect(restored.x).toBeCloseTo(point.x, 6);
      expect(restored.y).toBeCloseTo(point.y, 6);
    });
  });

  it("calculates a useful rectified raster size", () => {
    expect(rectangleForQuad([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }])).toEqual({ width: 100, height: 50 });
  });
});
