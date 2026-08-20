import type { ArchitectureSettings, PointM } from "../model/types";
import { architectureVertexMap, wallPolyline } from "./geometry";

export interface ComputedRoom {
  id: string;
  polygon: PointM[];
  areaM2: number;
}

interface HalfEdge {
  id: string;
  from: string;
  to: string;
  fromPoint: PointM;
  toPoint: PointM;
  reverseId: string;
  angle: number;
}

function key(point: PointM): string {
  return `${point.xM.toFixed(5)}:${point.yM.toFixed(5)}`;
}

function signedArea(points: readonly PointM[]): number {
  let area = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    area += point.xM * next.yM - next.xM * point.yM;
  });
  return area / 2;
}

export function computeRooms(architecture: ArchitectureSettings, maxChordErrorM = 0.01): ComputedRoom[] {
  const vertices = architectureVertexMap(architecture);
  const halfEdges: HalfEdge[] = [];
  architecture.walls.filter((wall) => wall.reviewStatus === "accepted").forEach((wall) => {
    const points = wallPolyline(wall, vertices, maxChordErrorM);
    for (let index = 0; index < points.length - 1; index += 1) {
      const first = points[index];
      const second = points[index + 1];
      if (Math.hypot(second.xM - first.xM, second.yM - first.yM) < 1e-6) continue;
      const forwardId = `${wall.id}:${index}:f`;
      const reverseId = `${wall.id}:${index}:r`;
      halfEdges.push({ id: forwardId, from: key(first), to: key(second), fromPoint: first, toPoint: second, reverseId, angle: Math.atan2(second.yM - first.yM, second.xM - first.xM) });
      halfEdges.push({ id: reverseId, from: key(second), to: key(first), fromPoint: second, toPoint: first, reverseId: forwardId, angle: Math.atan2(first.yM - second.yM, first.xM - second.xM) });
    }
  });
  const outgoing = new Map<string, HalfEdge[]>();
  halfEdges.forEach((edge) => {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  });
  outgoing.forEach((list) => list.sort((first, second) => first.angle - second.angle));
  const visited = new Set<string>();
  const rooms: ComputedRoom[] = [];
  for (const initial of halfEdges) {
    if (visited.has(initial.id)) continue;
    const polygon: PointM[] = [];
    let current: HalfEdge | undefined = initial;
    const local = new Set<string>();
    while (current && !local.has(current.id) && polygon.length <= halfEdges.length) {
      local.add(current.id);
      polygon.push(current.fromPoint);
      const currentEdge = current;
      const candidates: HalfEdge[] = outgoing.get(currentEdge.to) ?? [];
      const reverseIndex = candidates.findIndex((candidate: HalfEdge) => candidate.id === currentEdge.reverseId);
      if (reverseIndex < 0 || candidates.length < 2) {
        current = undefined;
        break;
      }
      const nextEdge = candidates[(reverseIndex - 1 + candidates.length) % candidates.length];
      current = nextEdge;
      if (nextEdge.id === initial.id) break;
    }
    local.forEach((id) => visited.add(id));
    if (!current || current.id !== initial.id || polygon.length < 3) continue;
    const areaM2 = signedArea(polygon);
    if (areaM2 <= 0.01) continue;
    rooms.push({ id: `room-${rooms.length + 1}`, polygon, areaM2 });
  }
  return rooms;
}
