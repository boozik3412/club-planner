import type {
  ResolvedArchitecturalOpening,
  ResolvedArchitecturalWall,
} from "../architecture/types";

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

function createSolid(
  wall: ResolvedArchitecturalWall,
  startM: number,
  endM: number,
  range: VerticalRange,
  suffix: string,
): WallSolid | null {
  const lengthM = endM - startM;
  const heightM = range.topM - range.bottomM;
  if (lengthM <= 0.001 || heightM <= 0.001) return null;
  const dx = wall.end.xM - wall.start.xM;
  const dz = wall.end.yM - wall.start.yM;
  const wallLengthM = Math.hypot(dx, dz);
  const tangentX = dx / wallLengthM;
  const tangentZ = dz / wallLengthM;
  const middleM = (startM + endM) / 2;
  return {
    id: `${wall.id}:${suffix}`,
    wallId: wall.id,
    centerXM: wall.start.xM + tangentX * middleM,
    centerYM: wall.baseElevationM + range.bottomM + heightM / 2,
    centerZM: wall.start.yM + tangentZ * middleM,
    lengthM,
    heightM,
    depthM: wall.thicknessM,
    rotationYRad: -Math.atan2(dz, dx),
    kind: wall.kind,
  };
}

function openingInterval(
  wall: ResolvedArchitecturalWall,
  opening: ResolvedArchitecturalOpening,
): { startM: number; endM: number; opening: ResolvedArchitecturalOpening } | null {
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
  const intervals = openings
    .filter((opening) => opening.hostWallId === wall.id)
    .flatMap((opening) => {
      const interval = openingInterval(wall, opening);
      return interval ? [interval] : [];
    })
    .sort((first, second) => first.startM - second.startM);

  if (intervals.length === 0) {
    const solid = createSolid(wall, 0, wallLengthM, { bottomM: 0, topM: wall.heightM }, "full");
    return solid ? [solid] : [];
  }

  const solids: WallSolid[] = [];
  let cursorM = 0;
  intervals.forEach((interval, index) => {
    const pier = createSolid(wall, cursorM, interval.startM, { bottomM: 0, topM: wall.heightM }, `pier-${index}`);
    if (pier) solids.push(pier);

    const openingBottomM = Math.max(0, interval.opening.sillHeightM);
    const openingTopM = Math.min(
      wall.heightM,
      openingBottomM + interval.opening.openingHeightM,
    );
    const lower = createSolid(wall, interval.startM, interval.endM, { bottomM: 0, topM: openingBottomM }, `lower-${index}`);
    const lintel = createSolid(wall, interval.startM, interval.endM, { bottomM: openingTopM, topM: wall.heightM }, `lintel-${index}`);
    if (lower) solids.push(lower);
    if (lintel) solids.push(lintel);
    cursorM = Math.max(cursorM, interval.endM);
  });
  const tail = createSolid(wall, cursorM, wallLengthM, { bottomM: 0, topM: wall.heightM }, "tail");
  if (tail) solids.push(tail);
  return solids;
}
