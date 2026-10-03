import { useRef, type PointerEvent } from "react";
import { type RiverFeature, type RiverPoint } from "@mapdesigner/map-core";
import { centerForCoord, coordForPoint, riverGeometry } from "@mapdesigner/map-render";

interface Props {
  river: RiverFeature;
  selectedNode: number;
  scale: number;
  minX: number;
  minY: number;
  disabled: boolean;
  toWorld: (x: number, y: number) => { x: number; y: number };
  onSelectNode: (index: number) => void;
  onPreview: (river: RiverFeature | null) => void;
  onCommit: (points: RiverPoint[]) => void;
}
export function RiverEditingLayer(props: Props) {
  const gesture = useRef<{
    pointerId: number;
    index: number;
    kind: "node" | "width";
    original: RiverFeature;
    next: RiverFeature;
    startX: number;
    startY: number;
    changed: boolean;
  } | null>(null);
  const points = props.river.points,
    geometry = riverGeometry(props.river);
  const controls = geometry.filter((p) => p.controlIndex !== undefined);
  const scale = Math.max(0.01, props.scale),
    radius = 6 / scale;
  function start(event: PointerEvent<SVGGElement>, index: number, kind: "node" | "width") {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    event.stopPropagation();
    props.onSelectNode(index);
    if (props.disabled) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      index,
      kind,
      original: props.river,
      next: props.river,
      startX: event.clientX,
      startY: event.clientY,
      changed: false
    };
  }
  function cancel() {
    gesture.current = null;
    props.onPreview(null);
  }
  return (
    <g
      aria-label="河流节点编辑"
      className="river-editing-layer"
      onPointerMove={(event) => {
        const g = gesture.current;
        if (!g || g.pointerId !== event.pointerId) return;
        event.stopPropagation();
        if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 3 && !g.changed)
          return;
        const p = props.toWorld(event.clientX, event.clientY),
          source = g.original.points[g.index]!;
        let point: RiverPoint;
        if (g.kind === "width") {
          const center = centerForCoord(source, 36);
          point = {
            ...source,
            width: Math.max(
              0.5,
              Math.min(
                64,
                Math.round(
                  Math.max(0.25, Math.hypot(p.x - center.x, p.y - center.y) - 18 / scale) * 20
                ) / 10
              )
            )
          };
        } else {
          point = { ...source, ...coordForPoint(p) };
        }
        if (
          g.original.points.some(
            (v, i) => i !== g.index && v.row === point.row && v.col === point.col
          )
        )
          return;
        g.next = {
          ...g.original,
          points: g.original.points.map((v, i) => (i === g.index ? point : v))
        };
        g.changed = true;
        props.onPreview(g.next);
      }}
      onPointerUp={(event) => {
        const g = gesture.current;
        if (!g || g.pointerId !== event.pointerId) return;
        event.stopPropagation();
        gesture.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        props.onPreview(null);
        if (g.changed) props.onCommit(g.next.points);
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        cancel();
      }}
      onLostPointerCapture={() => {
        if (gesture.current) cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <path
        d={geometry
          .map((p, i) => (i ? "L " : "M ") + (p.x - props.minX) + " " + (p.y - props.minY))
          .join(" ")}
        stroke="#164F41"
        strokeWidth={1.5 / scale}
        strokeDasharray={5 / scale + " " + 4 / scale}
        fill="none"
        pointerEvents="none"
      />
      {points.map((point, index) => {
        const p = centerForCoord(point, 36),
          x = p.x - props.minX,
          y = p.y - props.minY,
          selected = index === props.selectedNode;
        const width = controls.find((c) => c.controlIndex === index)?.width ?? 4;
        const before = centerForCoord(points[Math.max(0, index - 1)]!, 36),
          after = centerForCoord(points[Math.min(points.length - 1, index + 1)]!, 36);
        const length = Math.hypot(after.x - before.x, after.y - before.y) || 1,
          nx = -(after.y - before.y) / length,
          ny = (after.x - before.x) / length;
        return (
          <g key={index}>
            {selected &&
              [-1, 1].map((side) => {
                const hx = x + nx * (width / 2 + 18 / scale) * side,
                  hy = y + ny * (width / 2 + 18 / scale) * side;
                return (
                  <g
                    key={side}
                    role="slider"
                    tabIndex={0}
                    aria-label={"节点 " + (index + 1) + " " + (side === 1 ? "左" : "右") + "侧宽度"}
                    aria-valuemin={0.5}
                    aria-valuemax={64}
                    aria-valuenow={width}
                    onPointerDown={(event) => start(event, index, "width")}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (props.disabled) return;
                        const value = Math.max(
                          0.5,
                          Math.min(
                            64,
                            width + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -0.5 : 0.5)
                          )
                        );
                        props.onCommit(
                          points.map((p, i) => (i === index ? { ...p, width: value } : p))
                        );
                      }
                    }}
                  >
                    <line
                      x1={x}
                      y1={y}
                      x2={hx}
                      y2={hy}
                      stroke="#164F41"
                      strokeWidth={1 / scale}
                      pointerEvents="none"
                    />
                    <rect
                      x={hx - 9 / scale}
                      y={hy - 9 / scale}
                      width={18 / scale}
                      height={18 / scale}
                      fill="transparent"
                    />
                    <rect
                      x={hx - 3 / scale}
                      y={hy - 3 / scale}
                      width={6 / scale}
                      height={6 / scale}
                      fill="#FFFBE9"
                      stroke="#164F41"
                      strokeWidth={1.5 / scale}
                    />
                  </g>
                );
              })}
            <g
              role="button"
              tabIndex={0}
              aria-label={"河流节点 " + (index + 1) + (point.junction_id ? " 已连接" : "")}
              aria-pressed={selected}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelectNode(index);
              }}
              onPointerDown={(event) => start(event, index, "node")}
              onKeyDown={(event) => {
                if (
                  event.key === "Delete" &&
                  !props.disabled &&
                  points.length > 2 &&
                  !point.junction_id
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onCommit(points.filter((_, i) => i !== index));
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  props.onSelectNode(index);
                }
                if (["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (props.disabled) return;
                  props.onCommit(
                    points.map((p, i) =>
                      i === index
                        ? {
                            ...p,
                            row:
                              p.row +
                              (event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0),
                            col:
                              p.col +
                              (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)
                          }
                        : p
                    )
                  );
                }
              }}
            >
              <circle cx={x} cy={y} r={Math.max(radius, 10 / scale)} fill="transparent" />
              <circle
                cx={x}
                cy={y}
                r={radius}
                fill={selected ? "#164F41" : "#FFFDF4"}
                stroke={point.junction_id ? "#AA6A12" : "#164F41"}
                strokeWidth={2 / scale}
                strokeDasharray={
                  point.width === undefined ? 2 / scale + " " + 2 / scale : undefined
                }
              />
              <text
                x={x + 10 / scale}
                y={y - 10 / scale}
                fontSize={12 / scale}
                stroke="#FFFDF4"
                strokeWidth={3 / scale}
                paintOrder="stroke"
                fill="#164F41"
                pointerEvents="none"
              >
                {index + 1}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
