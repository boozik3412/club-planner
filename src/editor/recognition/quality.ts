import type { ArchitectureVertex, ArchitecturalWall } from "../model/types";
import type { RecognitionQualityReport } from "./types";

interface QualityInput {
  vertices: readonly ArchitectureVertex[];
  walls: readonly ArchitecturalWall[];
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

/**
 * Fail-safe assessment for the review UI. This deliberately prefers a visible
 * refusal over presenting a candidate explosion as a successful recognition.
 * Thresholds are conservative safety limits; the benchmark will calibrate the
 * green/yellow confidence bands separately.
 */
export function assessRecognitionQuality(input: QualityInput): RecognitionQualityReport {
  const walls = input.walls.filter((wall) => wall.reviewStatus !== "rejected");
  const usedVertexIds = new Set(walls.flatMap((wall) => [wall.startVertexId, wall.endVertexId]));
  const degree = new Map<string, number>();
  walls.forEach((wall) => {
    degree.set(wall.startVertexId, (degree.get(wall.startVertexId) ?? 0) + 1);
    degree.set(wall.endVertexId, (degree.get(wall.endVertexId) ?? 0) + 1);
  });
  const danglingEndpointCount = [...usedVertexIds].filter((id) => degree.get(id) === 1).length;
  const isolatedWallCount = walls.filter((wall) => degree.get(wall.startVertexId) === 1 && degree.get(wall.endVertexId) === 1).length;
  const arcCount = walls.filter((wall) => wall.curve.kind === "arc").length;
  const danglingEndpointRatio = ratio(danglingEndpointCount, usedVertexIds.size);
  const isolatedWallRatio = ratio(isolatedWallCount, walls.length);
  const candidateExplosion = walls.length > 160
    || arcCount > 24
    || (walls.length > 24 && arcCount / walls.length > 0.4);
  const reasons: string[] = [];
  let score = 100;

  if (candidateExplosion) {
    reasons.push("Обнаружено слишком много несвязанных геометрических кандидатов");
    score -= 65;
  }
  if (walls.length > 16 && danglingEndpointRatio > 0.7) {
    reasons.push("Большинство концов стен не образует архитектурные соединения");
    score -= 30;
  } else if (walls.length > 12 && danglingEndpointRatio > 0.5) {
    reasons.push("В графе много свободных концов");
    score -= 15;
  }
  if (walls.length > 16 && isolatedWallRatio > 0.55) {
    reasons.push("Большая часть стен изолирована от остального плана");
    score -= 30;
  } else if (walls.length > 12 && isolatedWallRatio > 0.35) {
    reasons.push("Найдены изолированные фрагменты, требующие проверки");
    score -= 15;
  } else if (walls.length > 6 && isolatedWallRatio > 0.15) {
    reasons.push("Есть изолированные фрагменты, поэтому пакетное принятие небезопасно");
    score -= 10;
  }
  if (arcCount > 12) {
    reasons.push("Число дуг нетипично велико для архитектурного плана");
    score -= Math.min(35, arcCount - 8);
  }
  if (walls.length === 0) {
    reasons.push("Стены не найдены");
    score = 0;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const severeTopologyFailure = walls.length > 16 && danglingEndpointRatio > 0.7 && isolatedWallRatio > 0.45;
  const status = candidateExplosion || severeTopologyFailure || score < 45
    ? "unreliable"
    : reasons.length > 0 || score < 80 ? "review" : "reliable";
  return {
    status,
    score,
    wallCount: walls.length,
    arcCount,
    danglingEndpointCount,
    danglingEndpointRatio,
    isolatedWallCount,
    isolatedWallRatio,
    candidateExplosion,
    allowBatchAccept: status === "reliable",
    reasons,
  };
}
