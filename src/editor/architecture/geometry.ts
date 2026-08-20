import type {
  ArchitectureSettings,
  ArchitecturalOpening,
  ArchitecturalWall,
  ArchitectureVertex,
  PointM,
} from "../model/types";

export interface WallArc {
  center: PointM;
  radiusM: number;
  startAngleRad: number;
  sweepRad: number;
}

export function architectureVertexMap(architecture: ArchitectureSettings): Map<string, ArchitectureVertex> {
  return new Map(architecture.vertices.map((vertex) => [vertex.id, vertex]));
}

export function wallEndpoints(
  wall: ArchitecturalWall,
  vertices: ReadonlyMap<string, ArchitectureVertex>,
): { start: PointM; end: PointM } | null {
  const start = vertices.get(wall.startVertexId);
  const end = vertices.get(wall.endVertexId);
  return start && end
    ? { start: { xM: start.xM, yM: start.yM }, end: { xM: end.xM, yM: end.yM } }
    : null;
}

export function arcFromBulge(start: PointM, end: PointM, bulge: number): WallArc | null {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-8) return null;
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const chordM = Math.hypot(dx, dy);
  if (chordM <= 1e-8) return null;
  const midpoint = { xM: (start.xM + end.xM) / 2, yM: (start.yM + end.yM) / 2 };
  const centerOffsetM = chordM * (1 - bulge * bulge) / (4 * bulge);
  const normal = { xM: -dy / chordM, yM: dx / chordM };
  const center = {
    xM: midpoint.xM + normal.xM * centerOffsetM,
    yM: midpoint.yM + normal.yM * centerOffsetM,
  };
  return {
    center,
    radiusM: chordM * (1 + bulge * bulge) / (4 * Math.abs(bulge)),
    startAngleRad: Math.atan2(start.yM - center.yM, start.xM - center.xM),
    sweepRad: 4 * Math.atan(bulge),
  };
}

export function wallLengthM(wall: ArchitecturalWall, vertices: ReadonlyMap<string, ArchitectureVertex>): number {
  const endpoints = wallEndpoints(wall, vertices);
  if (!endpoints) return 0;
  if (wall.curve.kind === "arc") {
    const arc = arcFromBulge(endpoints.start, endpoints.end, wall.curve.bulge);
    if (arc) return Math.abs(arc.sweepRad) * arc.radiusM;
  }
  return Math.hypot(endpoints.end.xM - endpoints.start.xM, endpoints.end.yM - endpoints.start.yM);
}

export function wallPointAtDistance(
  wall: ArchitecturalWall,
  vertices: ReadonlyMap<string, ArchitectureVertex>,
  distanceM: number,
): PointM | null {
  const endpoints = wallEndpoints(wall, vertices);
  if (!endpoints) return null;
  const lengthM = wallLengthM(wall, vertices);
  const t = lengthM > 0 ? Math.min(1, Math.max(0, distanceM / lengthM)) : 0;
  if (wall.curve.kind === "arc") {
    const arc = arcFromBulge(endpoints.start, endpoints.end, wall.curve.bulge);
    if (arc) {
      const angle = arc.startAngleRad + arc.sweepRad * t;
      return {
        xM: arc.center.xM + Math.cos(angle) * arc.radiusM,
        yM: arc.center.yM + Math.sin(angle) * arc.radiusM,
      };
    }
  }
  return {
    xM: endpoints.start.xM + (endpoints.end.xM - endpoints.start.xM) * t,
    yM: endpoints.start.yM + (endpoints.end.yM - endpoints.start.yM) * t,
  };
}

export function wallTangentAtDistance(
  wall: ArchitecturalWall,
  vertices: ReadonlyMap<string, ArchitectureVertex>,
  distanceM: number,
): PointM | null {
  const endpoints = wallEndpoints(wall, vertices);
  if (!endpoints) return null;
  if (wall.curve.kind === "arc") {
    const arc = arcFromBulge(endpoints.start, endpoints.end, wall.curve.bulge);
    if (arc) {
      const lengthM = Math.abs(arc.sweepRad) * arc.radiusM;
      const t = lengthM > 0 ? Math.min(1, Math.max(0, distanceM / lengthM)) : 0;
      const angle = arc.startAngleRad + arc.sweepRad * t;
      const direction = Math.sign(arc.sweepRad) || 1;
      return { xM: -Math.sin(angle) * direction, yM: Math.cos(angle) * direction };
    }
  }
  const dx = endpoints.end.xM - endpoints.start.xM;
  const dy = endpoints.end.yM - endpoints.start.yM;
  const lengthM = Math.hypot(dx, dy);
  return lengthM > 0 ? { xM: dx / lengthM, yM: dy / lengthM } : null;
}

export function openingEndpoints(
  opening: ArchitecturalOpening,
  wall: ArchitecturalWall,
  vertices: ReadonlyMap<string, ArchitectureVertex>,
): { start: PointM; end: PointM } | null {
  const start = wallPointAtDistance(wall, vertices, opening.offsetM);
  const end = wallPointAtDistance(wall, vertices, opening.offsetM + opening.widthM);
  return start && end ? { start, end } : null;
}

export function wallPolyline(
  wall: ArchitecturalWall,
  vertices: ReadonlyMap<string, ArchitectureVertex>,
  maxChordErrorM = 0.01,
): PointM[] {
  const endpoints = wallEndpoints(wall, vertices);
  if (!endpoints) return [];
  if (wall.curve.kind !== "arc") return [endpoints.start, endpoints.end];
  const arc = arcFromBulge(endpoints.start, endpoints.end, wall.curve.bulge);
  if (!arc) return [endpoints.start, endpoints.end];
  const safeError = Math.max(0.001, Math.min(maxChordErrorM, arc.radiusM));
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - safeError / arc.radiusM)));
  const segments = Math.max(2, Math.ceil(Math.abs(arc.sweepRad) / Math.max(maxStep, Math.PI / 180)));
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = arc.startAngleRad + arc.sweepRad * index / segments;
    return {
      xM: arc.center.xM + Math.cos(angle) * arc.radiusM,
      yM: arc.center.yM + Math.sin(angle) * arc.radiusM,
    };
  });
}

export function wallSvgPath(
  wall: ArchitecturalWall,
  vertices: ReadonlyMap<string, ArchitectureVertex>,
  unitsPerMeter: number,
): string | null {
  const endpoints = wallEndpoints(wall, vertices);
  if (!endpoints) return null;
  const start = `${endpoints.start.xM * unitsPerMeter} ${endpoints.start.yM * unitsPerMeter}`;
  const end = `${endpoints.end.xM * unitsPerMeter} ${endpoints.end.yM * unitsPerMeter}`;
  if (wall.curve.kind !== "arc") return `M ${start} L ${end}`;
  const arc = arcFromBulge(endpoints.start, endpoints.end, wall.curve.bulge);
  if (!arc) return `M ${start} L ${end}`;
  const radius = arc.radiusM * unitsPerMeter;
  return `M ${start} A ${radius} ${radius} 0 ${Math.abs(arc.sweepRad) > Math.PI ? 1 : 0} ${arc.sweepRad > 0 ? 1 : 0} ${end}`;
}
