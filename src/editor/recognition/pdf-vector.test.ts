import { describe, expect, it } from "vitest";
import { decodePdfDrawPath } from "./pdf-vector";

describe("PDF.js DrawOPS decoder", () => {
  it("extracts lines and a closed subpath", () => {
    const result = decodePdfDrawPath(new Float32Array([
      0, 10, 20,
      1, 110, 20,
      1, 110, 80,
      4,
    ]));
    expect(result.lines).toHaveLength(3);
    expect(result.lines[2]).toMatchObject({ start: { x: 110, y: 80 }, end: { x: 10, y: 20 } });
  });

  it("keeps a circular Bezier as a true arc candidate", () => {
    const kappa = 0.55228475;
    const result = decodePdfDrawPath(new Float32Array([
      0, 100, 0,
      2, 100, 100 * kappa, 100 * kappa, 100, 0, 100,
    ]));
    expect(result.lines).toHaveLength(0);
    expect(result.arcs).toHaveLength(1);
    expect(result.arcs[0].through.x).toBeCloseTo(Math.SQRT1_2 * 100, 0);
    expect(result.arcs[0].through.y).toBeCloseTo(Math.SQRT1_2 * 100, 0);
  });

  it("segments a non-circular Bezier instead of inventing an arc", () => {
    const result = decodePdfDrawPath(new Float32Array([
      0, 0, 0,
      2, 20, 100, 80, -100, 100, 0,
    ]));
    expect(result.arcs).toHaveLength(0);
    expect(result.lines).toHaveLength(8);
  });
});
