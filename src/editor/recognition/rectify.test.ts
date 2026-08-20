import { describe, expect, it } from "vitest";
import { rotateImageData90, suggestDocumentQuad } from "./rectify";

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
    }
  }
}

Object.defineProperty(globalThis, "ImageData", { value: TestImageData, configurable: true });

describe("image preparation", () => {
  it("rotates RGBA pixels without changing them", () => {
    const image = new ImageData(new Uint8ClampedArray([
      1, 0, 0, 255, 2, 0, 0, 255,
      3, 0, 0, 255, 4, 0, 0, 255,
      5, 0, 0, 255, 6, 0, 0, 255,
    ]), 2, 3);
    const rotated = rotateImageData90(image, true);
    expect([rotated.width, rotated.height]).toEqual([3, 2]);
    expect([rotated.data[0], rotated.data[4], rotated.data[8]]).toEqual([5, 3, 1]);
  });

  it("suggests the contrasting document bounds", () => {
    const image = new ImageData(100, 80);
    image.data.fill(20);
    for (let y = 10; y <= 70; y += 1) for (let x = 15; x <= 85; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = image.data[offset + 3] = 255;
    }
    const quad = suggestDocumentQuad(image);
    expect(quad[0].x).toBeLessThanOrEqual(15);
    expect(quad[0].y).toBeLessThanOrEqual(10);
    expect(quad[2].x).toBeGreaterThanOrEqual(85);
    expect(quad[2].y).toBeGreaterThanOrEqual(70);
  });
});
