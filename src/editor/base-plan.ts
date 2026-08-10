export const PLAN_WIDTH_UNITS = 23_569.5996;
export const PLAN_HEIGHT_UNITS = 2_752.6399;
export const PLAN_UNITS_PER_METER = 377.952755906;
export const PLAN_CENTER_X = PLAN_WIDTH_UNITS / 2;
export const PLAN_CENTER_Y = PLAN_HEIGHT_UNITS / 2;
export const GRID_STEP_UNITS = PLAN_UNITS_PER_METER * 0.5;

export type ViewBox = readonly [x: number, y: number, width: number, height: number];

export function normalizeQuarterTurn(rotationDeg: number): number {
  const normalized = ((rotationDeg % 360) + 360) % 360;
  return Math.round(normalized / 90) * 90 % 360;
}

export function getRotatedViewBox(rotationDeg: number): ViewBox {
  const rotation = normalizeQuarterTurn(rotationDeg);

  if (rotation === 90 || rotation === 270) {
    return [
      PLAN_CENTER_X - PLAN_HEIGHT_UNITS / 2,
      PLAN_CENTER_Y - PLAN_WIDTH_UNITS / 2,
      PLAN_HEIGHT_UNITS,
      PLAN_WIDTH_UNITS,
    ];
  }

  return [0, 0, PLAN_WIDTH_UNITS, PLAN_HEIGHT_UNITS];
}
