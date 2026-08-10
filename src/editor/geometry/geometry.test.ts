import { describe, expect, it } from "vitest";
import { createObjectFromTemplate } from "../model/templates";
import { resizeObjectFromHandle } from "./geometry";

describe("object resizing", () => {
  it("keeps a circle round when a side handle changes its diameter", () => {
    const circle = createObjectFromTemplate("custom-circle", 4, 3, "circle");
    const resized = resizeObjectFromHandle(circle, "e", 0.8, 0, true, (value) => value);

    expect(resized.widthM).toBeCloseTo(2);
    expect(resized.depthM).toBeCloseTo(2);
    expect(resized.xM).toBeCloseTo(4.4);
    expect(resized.yM).toBeCloseTo(3);
  });
});
