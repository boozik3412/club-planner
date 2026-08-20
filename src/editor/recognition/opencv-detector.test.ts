import { describe, expect, it } from "vitest";
import { createColoredAnnotationMask, createColoredOpeningMask, lineColoredOpeningSupport } from "./opencv-detector";

describe("raster semantic preprocessing", () => {
  it("masks red user annotations without erasing blue opening graphics", () => {
    const rgba = new Uint8ClampedArray([
      210, 35, 45, 255,
      25, 95, 175, 255,
      30, 30, 30, 255,
    ]);
    const mask = createColoredAnnotationMask(3, 1, rgba, 0);
    expect([...mask]).toEqual([1, 0, 0]);
    expect([...createColoredOpeningMask(3, 1, rgba)]).toEqual([0, 255, 0]);
  });

  it("separates a blue opening stroke from black wall lines", () => {
    const width = 20;
    const height = 3;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let x = 0; x < width; x += 1) {
      rgba.set([25, 95, 175, 255], (width + x) * 4);
    }
    const support = lineColoredOpeningSupport(
      { start: { x: 0, y: 1 }, end: { x: width - 1, y: 1 } },
      width,
      height,
      rgba,
    );
    expect(support).toBe(1);
  });

  it("dilates the annotation mask over antialiased neighbours", () => {
    const rgba = new Uint8ClampedArray(5 * 4).fill(255);
    rgba.set([190, 40, 50, 255], 2 * 4);
    const mask = createColoredAnnotationMask(5, 1, rgba, 1);
    expect([...mask]).toEqual([0, 1, 1, 1, 0]);
  });
});
