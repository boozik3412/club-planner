import type { ResolvedArchitecture, ArchitectureValidationIssue } from "./types";

function projectOnWall(
  point: { xM: number; yM: number },
  wall: ResolvedArchitecture["walls"][number],
): { alongM: number; distanceM: number; lengthM: number } {
  const dx = wall.end.xM - wall.start.xM;
  const dy = wall.end.yM - wall.start.yM;
  const lengthM = Math.hypot(dx, dy);
  const tx = dx / lengthM;
  const ty = dy / lengthM;
  const relativeX = point.xM - wall.start.xM;
  const relativeY = point.yM - wall.start.yM;
  return {
    alongM: relativeX * tx + relativeY * ty,
    distanceM: Math.abs(relativeX * -ty + relativeY * tx),
    lengthM,
  };
}

export function validateArchitecture(architecture: ResolvedArchitecture): ArchitectureValidationIssue[] {
  const issues: ArchitectureValidationIssue[] = [];
  const wallMap = new Map(architecture.walls.map((wall) => [wall.id, wall]));
  const intervalsByWall = new Map<string, Array<{ start: number; end: number; openingId: string }>>();

  for (const wall of architecture.walls) {
    if (wall.heightM <= 0 || wall.thicknessM <= 0) {
      issues.push({ id: `wall-size:${wall.id}`, severity: "error", wallId: wall.id, message: `Стена «${wall.id}» имеет некорректную высоту или толщину` });
    }
  }

  for (const opening of architecture.openings) {
    if (!opening.hostWallId) continue;
    const wall = wallMap.get(opening.hostWallId);
    if (!wall) {
      issues.push({ id: `opening-host:${opening.id}`, severity: "error", openingId: opening.id, message: `Проём «${opening.id}» не привязан к существующей стене` });
      continue;
    }
    const first = projectOnWall(opening.start, wall);
    const second = projectOnWall(opening.end, wall);
    const start = Math.min(first.alongM, second.alongM);
    const end = Math.max(first.alongM, second.alongM);
    if (Math.max(first.distanceM, second.distanceM) > Math.max(0.03, wall.thicknessM)) {
      issues.push({ id: `opening-distance:${opening.id}`, severity: "error", wallId: wall.id, openingId: opening.id, message: `Проём «${opening.id}» находится вне своей стены` });
    }
    if (start < -0.01 || end > first.lengthM + 0.01 || end - start < 0.1) {
      issues.push({ id: `opening-interval:${opening.id}`, severity: "error", wallId: wall.id, openingId: opening.id, message: `Проём «${opening.id}» выходит за границы стены` });
    }
    if (opening.sillHeightM < 0 || opening.openingHeightM <= 0
      || opening.sillHeightM + opening.openingHeightM > wall.heightM + 0.01) {
      issues.push({ id: `opening-height:${opening.id}`, severity: "error", wallId: wall.id, openingId: opening.id, message: `Вертикальные размеры проёма «${opening.id}» не помещаются в стене` });
    }
    const intervals = intervalsByWall.get(wall.id) ?? [];
    if (intervals.some((interval) => interval.start < end - 0.01 && interval.end > start + 0.01)) {
      issues.push({ id: `opening-overlap:${opening.id}`, severity: "error", wallId: wall.id, openingId: opening.id, message: `Проём «${opening.id}» пересекается с другим проёмом` });
    }
    intervals.push({ start, end, openingId: opening.id });
    intervalsByWall.set(wall.id, intervals);
  }
  return issues;
}
