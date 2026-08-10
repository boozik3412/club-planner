import { useEffect, useMemo, useState } from "react";
import type { PlanControls } from "../App";
import {
  GRID_STEP_UNITS,
  PLAN_CENTER_X,
  PLAN_CENTER_Y,
  PLAN_HEIGHT_UNITS,
  PLAN_WIDTH_UNITS,
  getRotatedViewBox,
} from "../editor/base-plan";
import { loadBasePlan, type LoadedBasePlan } from "../editor/load-base-plan";

interface BasePlanCanvasProps {
  controls: PlanControls;
  onReady: (labelCount: number) => void;
  onError: (message: string) => void;
}

export function BasePlanCanvas({ controls, onReady, onError }: BasePlanCanvasProps) {
  const [plan, setPlan] = useState<LoadedBasePlan | null>(null);
  const viewBox = useMemo(
    () => getRotatedViewBox(controls.rotationDeg).join(" "),
    [controls.rotationDeg],
  );

  useEffect(() => {
    let active = true;

    loadBasePlan()
      .then((loadedPlan) => {
        if (!active) return;
        setPlan(loadedPlan);
        onReady(loadedPlan.labels.length);
      })
      .catch((error: unknown) => {
        if (!active) return;
        onError(error instanceof Error ? error.message : "неизвестная ошибка");
      });

    return () => {
      active = false;
    };
  }, [onError, onReady]);

  return (
    <div className="canvas-frame">
      <svg
        className="plan-canvas"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Актуальная планировка компьютерного клуба"
        xmlns="http://www.w3.org/2000/svg"
        xmlnsXlink="http://www.w3.org/1999/xlink"
      >
        <defs>
          <pattern
            id="club-grid"
            width={GRID_STEP_UNITS}
            height={GRID_STEP_UNITS}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${GRID_STEP_UNITS} 0 L 0 0 0 ${GRID_STEP_UNITS}`}
              fill="none"
              stroke="#cfd7dd"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
          {plan ? <g dangerouslySetInnerHTML={{ __html: plan.defsMarkup }} /> : null}
        </defs>

        <g transform={`rotate(${controls.rotationDeg} ${PLAN_CENTER_X} ${PLAN_CENTER_Y})`}>
          <rect
            x="0"
            y="0"
            width={PLAN_WIDTH_UNITS}
            height={PLAN_HEIGHT_UNITS}
            fill="#ffffff"
          />
          {controls.gridVisible ? (
            <rect
              x="0"
              y="0"
              width={PLAN_WIDTH_UNITS}
              height={PLAN_HEIGHT_UNITS}
              fill="url(#club-grid)"
            />
          ) : null}

          {plan ? (
            <g opacity={controls.opacity} pointerEvents="none">
              <g dangerouslySetInnerHTML={{ __html: plan.geometryMarkup }} />
              {controls.labelsVisible ? (
                <g>
                  {plan.labels.map((label) => (
                    <g
                      key={label.id}
                      transform={`rotate(${-controls.rotationDeg} ${label.cx} ${label.cy})`}
                      dangerouslySetInnerHTML={{ __html: label.markup }}
                    />
                  ))}
                </g>
              ) : null}
            </g>
          ) : null}
        </g>
      </svg>

      {plan ? null : (
        <div className="canvas-loading" role="status">
          Загружаем точный векторный план…
        </div>
      )}
    </div>
  );
}
