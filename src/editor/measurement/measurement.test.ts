import { describe, expect, it } from "vitest";
import {
  constrainDimensionPoint,
  dimensionMidpoint,
  distanceMeters,
  formatMeters,
  resolveDimensionSnap,
  translateDimension,
} from "./measurement";

describe("measurement geometry", () => {
  it("measures, formats and centers a dimension", () => {
    expect(distanceMeters({ xM: 1, yM: 2 }, { xM: 4, yM: 6 })).toBe(5);
    expect(formatMeters(5)).toBe("5.00 м");
    expect(dimensionMidpoint({ start: { xM: 1, yM: 2 }, end: { xM: 4, yM: 6 } }))
      .toEqual({ xM: 2.5, yM: 4 });
  });

  it("moves a dimension without changing its length and constrains an endpoint", () => {
    const dimension = {
      id: "dimension-1",
      name: "Размер 1",
      start: { xM: 1, yM: 2 },
      end: { xM: 4, yM: 6 },
      labelVisible: true,
    };
    const moved = translateDimension(dimension, 3, -1);
    expect(distanceMeters(moved.start, moved.end)).toBeCloseTo(5);
    expect(moved.start).toEqual({ xM: 4, yM: 1 });
    expect(constrainDimensionPoint({ xM: 5, yM: 2.4 }, { xM: 1, yM: 2 })).toEqual({ xM: 5, yM: 2 });
    expect(constrainDimensionPoint({ xM: 1.2, yM: 6 }, { xM: 1, yM: 2 })).toEqual({ xM: 1, yM: 6 });
  });

  it("prefers nearby architecture and object points over the grid", () => {
    const result = resolveDimensionSnap({ xM: 2.04, yM: 1.03 }, {
      enabled: true,
      gridStepM: 0.1,
      unitsPerMeter: 100,
      zoom: 1,
      boundaries: [{
        id: "wall",
        kind: "wall",
        start: { xM: 2, yM: 1 },
        end: { xM: 4, yM: 1 },
        thicknessM: 0.15,
        source: "project-architecture",
      }],
      openings: [],
      objects: [],
    });
    expect(result.point).toEqual({ xM: 2, yM: 1 });
    expect(result.guide?.kind).toBe("vertex");

    const grid = resolveDimensionSnap({ xM: 8.14, yM: 7.16 }, {
      enabled: true,
      gridStepM: 0.1,
      unitsPerMeter: 100,
      zoom: 1,
      boundaries: [],
      openings: [],
      objects: [],
    });
    expect(grid.point.xM).toBeCloseTo(8.1);
    expect(grid.point.yM).toBeCloseTo(7.2);
    expect(grid.guide?.kind).toBe("grid");
  });

  it("can temporarily disable all dimension snapping", () => {
    const raw = { xM: 1.04, yM: 2.06 };
    expect(resolveDimensionSnap(raw, {
      enabled: true,
      disabled: true,
      gridStepM: 0.1,
      unitsPerMeter: 100,
      zoom: 1,
      boundaries: [],
      openings: [],
      objects: [],
    })).toEqual({ point: raw, guide: null });
  });
});
