import type { SourcePoint } from "../model/types";

export type Matrix3 = [number, number, number, number, number, number, number, number, number];

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) throw new Error("Невозможно вычислить перспективу: точки вырождены");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function perspectiveMatrix(
  source: readonly [SourcePoint, SourcePoint, SourcePoint, SourcePoint],
  destination: readonly [SourcePoint, SourcePoint, SourcePoint, SourcePoint],
): Matrix3 {
  const matrix: number[][] = [];
  const values: number[] = [];
  source.forEach((point, index) => {
    const target = destination[index];
    matrix.push([point.x, point.y, 1, 0, 0, 0, -target.x * point.x, -target.x * point.y]);
    values.push(target.x);
    matrix.push([0, 0, 0, point.x, point.y, 1, -target.y * point.x, -target.y * point.y]);
    values.push(target.y);
  });
  const result = solveLinearSystem(matrix, values);
  return [...result, 1] as Matrix3;
}

export function transformSourcePoint(point: SourcePoint, matrix: Matrix3): SourcePoint {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denominator) < 1e-12) throw new Error("Точка находится на бесконечности перспективного преобразования");
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

export function invertMatrix3(matrix: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) throw new Error("Матрица перспективы необратима");
  return [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
}

export function rectangleForQuad(quad: readonly SourcePoint[]): { width: number; height: number } {
  const distance = (first: SourcePoint, second: SourcePoint) => Math.hypot(second.x - first.x, second.y - first.y);
  return {
    width: Math.max(1, Math.round(Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2])))),
    height: Math.max(1, Math.round(Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2])))),
  };
}
