import { memo } from "react";
import type { PlanObject } from "../editor/model/types";

interface ObjectShapeProps {
  object: PlanObject;
  unitsPerMeter: number;
  canvasRotationDeg: number;
  zoom: number;
  selected: boolean;
  showHandles: boolean;
  labelsVisible: boolean;
  groupId?: string;
}

const resizeHandles = [
  ["nw", -0.5, -0.5],
  ["n", 0, -0.5],
  ["ne", 0.5, -0.5],
  ["e", 0.5, 0],
  ["se", 0.5, 0.5],
  ["s", 0, 0.5],
  ["sw", -0.5, 0.5],
  ["w", -0.5, 0],
] as const;

function KindDetails({ object, width, depth }: { object: PlanObject; width: number; depth: number }) {
  const strokeWidth = 2;
  if (object.kind === "pc") {
    const seats = Math.max(1, object.properties?.seats ?? 1);
    const cell = width / seats;
    return Array.from({ length: seats }, (_, index) => {
      const centerX = -width / 2 + cell * (index + 0.5);
      return (
        <g key={index}>
          <rect x={centerX - cell * 0.22} y={-depth * 0.26} width={cell * 0.44} height={depth * 0.18} rx={depth * 0.025} fill="#27333d" />
          <line x1={centerX} y1={-depth * 0.08} x2={centerX} y2={depth * 0.05} stroke="#27333d" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
          <path d={`M ${centerX - cell * 0.18} ${depth * 0.28} Q ${centerX} ${depth * 0.42} ${centerX + cell * 0.18} ${depth * 0.28}`} fill="none" stroke="#48535e" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
          {index < seats - 1 ? <line x1={-width / 2 + cell * (index + 1)} y1={-depth / 2} x2={-width / 2 + cell * (index + 1)} y2={depth / 2} stroke="#8ba2b2" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /> : null}
        </g>
      );
    });
  }
  if (object.kind === "computer") {
    return <><rect x={-width * 0.34} y={-depth * 0.34} width={width * 0.68} height={depth * 0.48} rx={depth * 0.04} fill="#27333d" /><line x1="0" y1={depth * 0.14} x2="0" y2={depth * 0.34} stroke="#27333d" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></>;
  }
  if (object.kind === "sofa" || object.kind === "armchair" || object.kind === "gaming-chair") {
    return <rect x={-width * 0.34} y={-depth * 0.31} width={width * 0.68} height={depth * 0.62} rx={depth * 0.18} fill="none" stroke="#756b60" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
  }
  if (object.kind === "console") {
    return <><rect x={-width * 0.3} y={-depth * 0.38} width={width * 0.6} height={depth * 0.12} rx={depth * 0.02} fill="#29333c" /><rect x={-width * 0.32} y={depth * 0.08} width={width * 0.64} height={depth * 0.22} rx={depth * 0.06} fill="none" stroke="#736d80" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" /></>;
  }
  if (object.kind === "server") {
    return Array.from({ length: 5 }, (_, index) => <line key={index} x1={-width * 0.34} y1={-depth / 2 + depth * (index + 1) / 6} x2={width * 0.34} y2={-depth / 2 + depth * (index + 1) / 6} stroke="#68727b" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />);
  }
  if (object.kind === "reception") {
    return <path d={`M ${-width * 0.38} ${depth * 0.16} Q 0 ${-depth * 0.08} ${width * 0.38} ${depth * 0.16}`} fill="none" stroke="#527061" strokeWidth={2.4} vectorEffect="non-scaling-stroke" />;
  }
  if (object.kind === "bar") {
    return Array.from({ length: 4 }, (_, index) => <circle key={index} cx={-width / 2 + width * (index + 1) / 5} cy={depth * 0.3} r={Math.min(width / 20, depth * 0.1)} fill="none" stroke="#78684e" strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />);
  }
  return null;
}

export const ObjectShape = memo(function ObjectShape({
  object,
  unitsPerMeter,
  canvasRotationDeg,
  zoom,
  selected,
  showHandles,
  labelsVisible,
  groupId,
}: ObjectShapeProps) {
  const x = object.xM * unitsPerMeter;
  const y = object.yM * unitsPerMeter;
  const width = object.widthM * unitsPerMeter;
  const depth = object.depthM * unitsPerMeter;
  const handleSize = 11 / zoom;
  const rotationOffset = 30 / zoom;
  const isZone = object.kind === "zone";
  const isPartition = object.kind === "partition";
  const isEllipse = object.kind === "custom-circle" || object.kind === "custom-oval";
  const radius = isPartition ? 0 : Math.min(width, depth) * 0.06;

  return (
    <g
      className={`plan-object${selected ? " is-selected" : ""}${object.locked ? " is-locked" : ""}`}
      data-object-id={object.id}
      data-group-id={groupId}
      transform={`translate(${x} ${y})`}
    >
      <g data-object-id={object.id} transform={`rotate(${object.rotationDeg})`}>
        {isEllipse ? (
          <ellipse
            className="object-hit-area"
            data-object-id={object.id}
            cx="0"
            cy="0"
            rx={width / 2}
            ry={depth / 2}
            fill={object.style?.fill ?? "#d9e5ed"}
            stroke="#26313a"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <rect
            className="object-hit-area"
            data-object-id={object.id}
            x={-width / 2}
            y={-depth / 2}
            width={width}
            height={depth}
            rx={radius}
            fill={object.style?.fill ?? "#d9e5ed"}
            fillOpacity={isZone ? 0.42 : 1}
            stroke={isZone ? "#478d68" : "#26313a"}
            strokeDasharray={isZone ? `${12 / zoom} ${8 / zoom}` : undefined}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <KindDetails object={object} width={width} depth={depth} />

        {showHandles ? (
          <g className="object-handles">
            <rect className="selection-box" x={-width / 2} y={-depth / 2} width={width} height={depth} vectorEffect="non-scaling-stroke" />
            {resizeHandles.map(([handle, xFactor, yFactor]) => (
              <rect
                key={handle}
                className="resize-handle"
                data-handle={handle}
                data-object-id={object.id}
                x={width * xFactor - handleSize / 2}
                y={depth * yFactor - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={handleSize * 0.18}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line className="rotation-line" x1="0" y1={-depth / 2} x2="0" y2={-depth / 2 - rotationOffset} vectorEffect="non-scaling-stroke" />
            <circle
              className="rotation-handle"
              data-handle="rotate"
              data-object-id={object.id}
              cx="0"
              cy={-depth / 2 - rotationOffset}
              r={handleSize * 0.62}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </g>

      {labelsVisible && object.labelVisible ? (
        <g className="object-label-wrap" transform={`rotate(${-canvasRotationDeg})`} pointerEvents="none">
          <text className="object-label" fontSize={12 / zoom} strokeWidth={3 / zoom}>{object.name}</text>
        </g>
      ) : null}
      {object.locked ? <text className="object-lock" x={width / 2} y={-depth / 2} fontSize={13 / zoom}>●</text> : null}
    </g>
  );
});
