import { describe, expect, it } from "vitest";
import { createObjectFromTemplate } from "../model/templates";
import { alignObjectsBetweenBoundaries } from "./between-boundaries";
import type { PlanBoundary } from "./types";

function verticalBoundary(id: string, xM: number): PlanBoundary {
  return {
    id,
    kind: "partition",
    start: { xM, yM: 5 },
    end: { xM, yM: 0 },
    thicknessM: 0,
    source: "project-object",
  };
}

describe("alignment between partitions", () => {
  it("centers one object between the inner faces", () => {
    const object = {
      ...createObjectFromTemplate("table", 2, 2, "table"),
      widthM: 2,
      depthM: 1,
    };
    const result = alignObjectsBetweenBoundaries(
      [object],
      verticalBoundary("left", 0),
      verticalBoundary("right", 10),
      "center",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects[0].xM).toBeCloseTo(5);
    expect(result.gapM).toBeCloseTo(4);
  });

  it("distributes differently sized objects with equal edge gaps", () => {
    const first = { ...createObjectFromTemplate("table", 1, 2, "first"), widthM: 1 };
    const second = { ...createObjectFromTemplate("table", 7, 2, "second"), widthM: 2 };
    const result = alignObjectsBetweenBoundaries(
      [first, second],
      verticalBoundary("left", 0),
      verticalBoundary("right", 10),
      "distribute",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gapM).toBeCloseTo(7 / 3);
    const ordered = [...result.objects].sort((left, right) => left.xM - right.xM);
    expect(ordered[0].xM - ordered[0].widthM / 2).toBeCloseTo(result.gapM);
    expect(ordered[1].xM - ordered[1].widthM / 2 - (ordered[0].xM + ordered[0].widthM / 2)).toBeCloseTo(result.gapM);
    expect(10 - (ordered[1].xM + ordered[1].widthM / 2)).toBeCloseTo(result.gapM);
  });

  it("rejects non-parallel boundaries and insufficient space", () => {
    const object = { ...createObjectFromTemplate("table", 1, 2, "table"), widthM: 4 };
    const diagonal = {
      ...verticalBoundary("diagonal", 2),
      end: { xM: 3, yM: 0 },
    };
    expect(alignObjectsBetweenBoundaries(
      [object],
      verticalBoundary("left", 0),
      diagonal,
      "center",
    )).toMatchObject({ ok: false, message: "Перегородки должны быть параллельны" });
    expect(alignObjectsBetweenBoundaries(
      [object],
      verticalBoundary("left", 0),
      verticalBoundary("right", 3),
      "center",
    )).toMatchObject({ ok: false, message: "Выборка не помещается между перегородками" });
  });

  it("fills an opening with one rectangular object and explicit side offsets", () => {
    const object = {
      ...createObjectFromTemplate("table", 2, 2, "table"),
      widthM: 2,
      depthM: 1,
    };
    const result = alignObjectsBetweenBoundaries(
      [object],
      verticalBoundary("left", 0),
      verticalBoundary("right", 10),
      "fill",
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects[0].xM).toBeCloseTo(5);
    expect(result.objects[0].widthM).toBeCloseTo(8);
    expect(result.gapM).toBe(1);
  });
});
