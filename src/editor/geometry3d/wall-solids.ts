import type {
  ResolvedArchitecturalOpening,
  ResolvedArchitecturalWall,
} from "../architecture/types";
import { arcFromBulge } from "../architecture/geometry";

export interface WallSolid {
  id: string;
  wallId: string;
  centerXM: number;
  centerYM: number;
  centerZM: number;
  lengthM: number;
  heightM: number;
  depthM: number;
  rotationYRad: number;
  kind: ResolvedArchitecturalWall["kind"];
}

interface VerticalRange {
  bottomM: number;
  topM: number;
}

function createSolids(
  wall: ResolvedArchitecturalWall,
  startM: number,
  endM: number,
  range: VerticalRange,
  suffix: string,
): WallSolid[] {
  const intervalLengthM = endM - startM;
  const heightM = range.topM - range.bottomM;
  if (intervalLengthM <= 0.001 || heightM <= 0.001) return [];
  const dx = wall.end.xM - wall.start.xM;
  const dz = wall.end.yM - wall.start.yM;
  const wallLengthM = Math.hypot(dx, dz);
  const arc = wall.curve?.kind === "arc" ? arcFromBulge(wall.start, wall.end, wall.curve.bulge) : null;
  if (arc) {
    const maxChordErrorM = 0.01;
    const maxStepRad = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - Math.min(maxChordErrorM, arc.radiusM) / arc.radiusM)));
    const intervalSweepRad = intervalLengthM / arc.radiusM;
    const segmentCount = Math.max(1, Math.ceil(intervalSweepRad / Math.max(maxStepRad, Math.PI / 180)));
    return Array.from({ length: segmentCount }, (_, index): WallSolid => {
      const segmentStartM = startM + intervalLengthM * index / segmentCount;
      const segmentEndM = startM + intervalLengthM * (index + 1) / segmentCount;
      const startAngle = arc.startAngleRad + arc.sweepRad * segmentStartM / (Math.abs(arc.sweepRad) * arc.radiusM);
      const endAngle = arc.startAngleRad + arc.sweepRad * segmentEndM / (Math.abs(arc.sweepRad) * arc.radiusM);
      const middleAngle = (startAngle + endAngle) / 2;
      const segmentChordM = 2 * arc.radiusM * Math.sin(Math.abs(endAngle - startAngle) / 2);
      const direction = Math.sign(arc.sweepRad) || 1;
      const tangentX = -Math.sin(middleAngle) * direction;
      const tangentZ = Math.cos(middleAngle) * direction;
      return {
        id: `${wall.id}:${suffix}:arc-${index}`,
        wallId: wall.id,
        centerXM: arc.center.xM + Math.cos(middleAngle) * arc.radiusM,
        centerYM: wall.baseElevationM + range.bottomM + heightM / 2,
        centerZM: arc.center.yM + Math.sin(middleAngle) * arc.radiusM,
        lengthM: segmentChordM + 0.002,
        heightM,
        depthM: wall.thicknessM,
        rotationYRad: -Math.atan2(tangentZ, tangentX),
        kind: wall.kind,
      };
    });
  }
  const tangentX = dx / wallLengthM;
  const tangentZ = dz / wallLengthM;
  const middleM = (startM + endM) / 2;
  return [{
    id: `${wall.id}:${suffix}`,
    wallId: wall.id,
    centerXM: wall.start.xM + tangentX * middleM,
    centerYM: wall.baseElevationM + range.bottomM + heightM / 2,
    centerZM: wall.start.yM + tangentZ * middleM,
    lengthM: intervalLengthM,
    heightM,
    depthM: wall.thicknessM,
    rotationYRad: -Math.atan2(dz, dx),
    kind: wall.kind,
  }];
}

function openingInterval(
  wall: ResolvedArchitecturalWall,
  opening: ResolvedArchitecturalOpening,
): { startM: number; endM: number; opening: ResolvedArchitecturalOpening } | null {
  if (opening.hostWallId === wall.id && opening.offsetM !== undefined && opening.widthM !== undefined) {
    const wallLengthM = wall.curve?.kind === "arc"
      ? (() => {
          const arc = arcFromBulge(wall.start, wall.end, wall.curve.bulge);
          return arc ? Math.abs(arc.sweepRad) * arc.radiusM : 0;
        })()
      : Math.hypot(wall.end.xM - wall.start.xM, wall.end.yM - wall.start.yM);
    const startM = Math.max(0, opening.offsetM);
    const endM = Math.min(wallLengthM, opening.offsetM + opening.widthM);
    return endM - startM > 0.001 ? { startM, endM, opening } : null;
  }
  const dx = wall.end.xM - wall.start.xM;
  const dz = wall.end.yM - wall.start.yM;
  const wallLengthM = Math.hypot(dx, dz);
  if (wallLengthM <= Number.EPSILON) return null;
  const tangentX = dx / wallLengthM;
  const tangentZ = dz / wallLengthM;
  const project = (point: { xM: number; yM: number }) =>
    (point.xM - wall.start.xM) * tangentX + (point.yM - wall.start.yM) * tangentZ;
  const first = project(opening.start);
  const second = project(opening.end);
  const startM = Math.max(0, Math.min(first, second));
  const endM = Math.min(wallLengthM, Math.max(first, second));
  return endM - startM > 0.001 ? { startM, endM, opening } : null;
}

export function buildWallSolids(
  wall: ResolvedArchitecturalWall,
  openings: readonly ResolvedArchitecturalOpening[],
): WallSolid[] {
  const wallLengthM = Math.hypot(
    wall.end.xM - wall.start.xM,
    wall.end.yM - wall.start.yM,
  );
  const effectiveWallLengthM = wall.curve?.kind === "arc"
    ? (() => {
        const arc = arcFromBulge(wall.start, wall.end, wall.curve.bulge);
        return arc ? Math.abs(arc.sweepRad) * arc.radiusM : wallLengthM;
      })()
    : wallLengthM;
  const intervals = openings
    .filter((opening) => opening.hostWallId === wall.id)
    .flatMap((opening) => {
      const interval = openingInterval(wall, opening);
      return interval ? [interval] : [];
    })
    .sort((first, second) => first.startM - second.startM);

  if (intervals.length === 0) {
    return createSolids(wall, 0, effectiveWallLengthM, { bottomM: 0, topM: wall.heightM }, "full");
  }

  const solids: WallSolid[] = [];
  let cursorM = 0;
  intervals.forEach((interval, index) => {
    solids.push(...createSolids(wall, cursorM, interval.startM, { bottomM: 0, topM: wall.heightM }, `pier-${index}`));

    const openingBottomM = Math.max(0, interval.opening.sillHeightM);
    const openingTopM = Math.min(
      wall.heightM,
      openingBottomM + interval.opening.openingHeightM,
    );
    solids.push(...createSolids(wall, interval.startM, interval.endM, { bottomM: 0, topM: openingBottomM }, `lower-${index}`));
    solids.push(...createSolids(wall, interval.startM, interval.endM, { bottomM: openingTopM, topM: wall.heightM }, `lintel-${index}`));
    cursorM = Math.max(cursorM, interval.endM);
  });
  solids.push(...createSolids(wall, cursorM, effectiveWallLengthM, { bottomM: 0, topM: wall.heightM }, "tail"));
  return solids;
}
