import { describe, expect, it } from "vitest";
import { moveObjects } from "../geometry/geometry";
import { createObjectFromTemplate } from "../model/templates";
import type { PlanBoundary } from "./types";
import { getObjectSupportRadius, resolveMoveSnap } from "./snap-resolver";

const horizontalWall: PlanBoundary = {
  id: "wall",
  kind: "wall",
  start: { xM: 0, yM: 0 },
  end: { xM: 10, yM: 0 },
  thicknessM: 0,
  source: "base-plan",
};

function resolve(rawDeltaYM: number, zoom = 0.05, activeBoundaryId: string | null = null) {
  const object = {
    ...createObjectFromTemplate("custom-rectangle", 2, 1, "object"),
    widthM: 1,
    depthM: 1,
  };
  return resolveMoveSnap({
    objects: [object],
    rawDeltaXM: 0,
    rawDeltaYM,
    boundaries: [horizontalWall],
    snapEnabled: true,
    snapStepM: 0.1,
    unitsPerMeter: 377.952755906,
    zoom,
    activeBoundaryId,
  });
}

describe("wall snap resolver", () => {
  it("snaps a footprint edge to a wall and exposes a guide", () => {
    const result = resolve(-0.45);
    expect(result.deltaYM).toBeCloseTo(-0.5);
    expect(result.activeBoundaryId).toBe("wall");
    expect(result.guide?.boundary?.id).toBe("wall");
  });

  it("uses a screen-space threshold with metric limits", () => {
    expect(resolve(-0.45, 1).activeBoundaryId).toBeNull();
    expect(resolve(-0.45, 0.05).activeBoundaryId).toBe("wall");
  });

  it("keeps an active wall until the larger release threshold is crossed", () => {
    expect(resolve(-0.2, 0.01).activeBoundaryId).toBeNull();
    expect(resolve(-0.2, 0.01, "wall").activeBoundaryId).toBe("wall");
  });

  it("preserves every relative offset in a multi-object move", () => {
    const first = createObjectFromTemplate("table", 1.03, 1.02, "first");
    const second = createObjectFromTemplate("table", 2.27, 1.02, "second");
    const result = resolveMoveSnap({
      objects: [first, second],
      rawDeltaXM: 0.06,
      rawDeltaYM: 0.06,
      boundaries: [],
      snapEnabled: true,
      snapStepM: 0.1,
      unitsPerMeter: 377.952755906,
      zoom: 0.1,
    });
    const moved = moveObjects([first, second], result.deltaXM, result.deltaYM);
    expect(moved[1].xM - moved[0].xM).toBeCloseTo(second.xM - first.xM);
    expect(moved[1].yM - moved[0].yM).toBeCloseTo(second.yM - first.yM);
  });

  it("computes ellipse support on an arbitrary axis", () => {
    const oval = {
      ...createObjectFromTemplate("custom-oval", 0, 0, "oval"),
      widthM: 4,
      depthM: 2,
      rotationDeg: 90,
    };
    expect(getObjectSupportRadius(oval, { xM: 1, yM: 0 })).toBeCloseTo(1);
    expect(getObjectSupportRadius(oval, { xM: 0, yM: 1 })).toBeCloseTo(2);
  });

  it("keeps a configured wall offset and reports it in the guide", () => {
    const object = {
      ...createObjectFromTemplate("custom-rectangle", 2, 1, "offset-object"),
      widthM: 1,
      depthM: 1,
    };
    const result = resolveMoveSnap({
      objects: [object],
      rawDeltaXM: 0,
      rawDeltaYM: -0.35,
      boundaries: [horizontalWall],
      snapEnabled: true,
      snapStepM: 0.1,
      wallOffsetM: 0.1,
      unitsPerMeter: 377.952755906,
      zoom: 0.05,
    });
    expect(result.deltaYM).toBeCloseTo(-0.4);
    expect(result.guide?.distanceM).toBeCloseTo(0.1);
  });

  it("auto-rotates a single furniture object parallel to the wall when enabled", () => {
    const object = {
      ...createObjectFromTemplate("table", 2, 1, "table"),
      widthM: 2,
      depthM: 1,
      rotationDeg: 30,
    };
    const result = resolveMoveSnap({
      objects: [object],
      rawDeltaXM: 0,
      rawDeltaYM: -0.45,
      boundaries: [horizontalWall],
      snapEnabled: true,
      snapStepM: 0.1,
      autoRotateFurniture: true,
      unitsPerMeter: 377.952755906,
      zoom: 0.05,
    });
    expect(result.rotations.table).toBe(0);
    expect(result.guide?.snapType).toBe("parallel");
  });

  it("cycles to center and corner candidates without losing the wall contact", () => {
    const centered = {
      ...createObjectFromTemplate("custom-rectangle", 4.9, 1, "centered"),
      widthM: 1,
      depthM: 1,
    };
    const centerResult = resolveMoveSnap({
      objects: [centered],
      rawDeltaXM: 0,
      rawDeltaYM: -0.45,
      boundaries: [horizontalWall],
      snapEnabled: true,
      snapStepM: 0.1,
      candidateIndex: 1,
      unitsPerMeter: 377.952755906,
      zoom: 0.05,
    });
    expect(centerResult.guide?.snapType).toBe("center");

    const atCorner = { ...centered, id: "corner", xM: 0.55 };
    const first = resolveMoveSnap({
      objects: [atCorner],
      rawDeltaXM: 0,
      rawDeltaYM: -0.45,
      boundaries: [horizontalWall],
      snapEnabled: true,
      snapStepM: 0.1,
      unitsPerMeter: 377.952755906,
      zoom: 0.05,
    });
    const kinds = Array.from({ length: first.guide?.candidateCount ?? 0 }, (_, candidateIndex) =>
      resolveMoveSnap({
        objects: [atCorner],
        rawDeltaXM: 0,
        rawDeltaYM: -0.45,
        boundaries: [horizontalWall],
        snapEnabled: true,
        snapStepM: 0.1,
        candidateIndex,
        unitsPerMeter: 377.952755906,
        zoom: 0.05,
      }).guide?.snapType);
    expect(kinds).toContain("corner");
  });

  it("snaps to vertical and diagonal walls in plan coordinates", () => {
    const object = {
      ...createObjectFromTemplate("custom-circle", 1, 2, "circle"),
      widthM: 1,
      depthM: 1,
    };
    const vertical: PlanBoundary = {
      ...horizontalWall,
      id: "vertical",
      end: { xM: 0, yM: 10 },
    };
    const verticalResult = resolveMoveSnap({
      objects: [object],
      rawDeltaXM: -0.45,
      rawDeltaYM: 0,
      boundaries: [vertical],
      snapEnabled: true,
      snapStepM: 0.1,
      unitsPerMeter: 377.952755906,
      zoom: 0.05,
    });
    expect(verticalResult.deltaXM).toBeCloseTo(-0.5);

    const inverseSqrtTwo = 1 / Math.sqrt(2);
    const diagonal: PlanBoundary = {
      ...horizontalWall,
      id: "diagonal",
      end: { xM: 10, yM: 10 },
    };
    const diagonalObject = {
      ...object,
      xM: 4 * inverseSqrtTwo,
      yM: 6 * inverseSqrtTwo,
    };
    const diagonalResult = resolveMoveSnap({
      objects: [diagonalObject],
      rawDeltaXM: 0.45 * inverseSqrtTwo,
      rawDeltaYM: -0.45 * inverseSqrtTwo,
      boundaries: [diagonal],
      snapEnabled: true,
      snapStepM: 0.1,
      unitsPerMeter: 377.952755906,
      zoom: 0.05,
    });
    const finalX = diagonalObject.xM + diagonalResult.deltaXM;
    const finalY = diagonalObject.yM + diagonalResult.deltaYM;
    expect((-finalX + finalY) * inverseSqrtTwo).toBeCloseTo(0.5);
  });

  it("uses the rotated rectangle footprint instead of an axis-aligned box", () => {
    const rectangle = {
      ...createObjectFromTemplate("custom-rectangle", 0, 0, "rotated"),
      widthM: 2,
      depthM: 1,
      rotationDeg: 45,
    };
    expect(getObjectSupportRadius(rectangle, { xM: 0, yM: 1 })).toBeCloseTo(
      1.5 / Math.sqrt(2),
    );
  });
});
