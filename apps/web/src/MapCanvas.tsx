import {
  type ActiveCell,
  type MapRuntimeState,
  type TagKey
} from "@mapdesigner/map-core";
import {
  buildMapScene,
  buildCellOpacity,
  buildCellStroke,
  buildPatternOverlay,
  getCellShorthand,
  getPrimaryTag,
  getPrimaryTagSymbol,
  getTerrainColor
} from "@mapdesigner/map-render";
import { useMemo, useRef, useState } from "react";

interface MapCanvasProps {
  map: MapRuntimeState;
  selectedCellId: string | null;
  onSelectCell: (cell: ActiveCell) => void;
  onHoverCellChange?: (cell: ActiveCell | null) => void;
  showCoordinates: boolean;
  showShorthand: boolean;
  showGrid: boolean;
  showUndesigned: boolean;
}

function CellGroup(props: {
  cell: ActiveCell;
  points: string;
  centerX: number;
  centerY: number;
  selected: boolean;
  hovered: boolean;
  showCoordinates: boolean;
  showShorthand: boolean;
  showGrid: boolean;
  onSelect: () => void;
}) {
  const { cell } = props;
  const patternFill = buildPatternOverlay(cell.biome);
  const shorthand = props.showShorthand ? getCellShorthand(cell) : null;
  const primaryTag = getPrimaryTag(cell);
  const primaryTagText = getPrimaryTagSymbol(primaryTag as TagKey | null);
  const stroke = buildCellStroke(cell, props.selected, props.hovered);
  const opacity = buildCellOpacity(cell);
  const textFill = cell.status === "designed" ? "#1D1B18" : "#6F675D";

  return (
    <g
      className="hex-cell"
      data-cell-id={cell.id}
      onClick={props.onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect();
        }
      }}
    >
      <polygon
        points={props.points}
        fill={getTerrainColor(cell.terrain)}
        stroke={stroke}
        strokeWidth={props.showGrid ? 1.2 : 0.6}
        opacity={opacity}
      />
      {patternFill ? <polygon points={props.points} fill={patternFill} opacity={cell.status === "designed" ? 0.9 : 0.5} /> : null}
      {primaryTagText ? (
        <text x={props.centerX} y={props.centerY - 16} textAnchor="middle" fontSize="9" fontWeight="700" fill="#6B2F18">
          {primaryTagText}
        </text>
      ) : null}
      {props.showCoordinates ? (
        <text x={props.centerX} y={props.centerY - 3} textAnchor="middle" fontSize="9" fontWeight="600" fill={textFill}>
          {cell.display_coord}
        </text>
      ) : null}
      {shorthand && cell.status === "designed" ? (
        <text x={props.centerX} y={props.centerY + 11} textAnchor="middle" fontSize="8.5" fontWeight="500" fill={textFill}>
          {shorthand}
        </text>
      ) : null}
    </g>
  );
}

export function MapCanvas(props: MapCanvasProps) {
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);

  const scene = useMemo(
    () =>
      buildMapScene(props.map, {
        includeCoordinates: props.showCoordinates,
        includeShorthand: props.showShorthand,
        includeGrid: props.showGrid,
        includeUndesigned: props.showUndesigned,
        selectedCellId: props.selectedCellId,
        hoveredCellId
      }),
    [hoveredCellId, props.map, props.selectedCellId, props.showCoordinates, props.showGrid, props.showShorthand, props.showUndesigned]
  );

  return (
    <div
      className="map-canvas"
      onWheel={(event) => {
        event.preventDefault();
        const next = zoom + (event.deltaY < 0 ? 0.1 : -0.1);
        setZoom(Math.max(0.5, Math.min(2.6, Number(next.toFixed(2)))));
      }}
      onMouseDown={(event) => {
        dragState.current = { dragging: true, startX: event.clientX - offset.x, startY: event.clientY - offset.y };
      }}
      onMouseMove={(event) => {
        if (!dragState.current?.dragging) {
          return;
        }
        setOffset({
          x: event.clientX - dragState.current.startX,
          y: event.clientY - dragState.current.startY
        });
      }}
      onMouseUp={() => {
        dragState.current = null;
      }}
      onMouseLeave={() => {
        dragState.current = null;
        setHoveredCellId(null);
        props.onHoverCellChange?.(null);
      }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${scene.width} ${scene.height}`} aria-label="Map canvas">
        <defs dangerouslySetInnerHTML={{ __html: scene.defs.join("") }} />
        <rect width="100%" height="100%" fill={scene.background} />
        <g transform={`translate(${offset.x} ${offset.y}) scale(${zoom})`}>
          {scene.layout.map((entry) => (
            <g
              key={entry.cell.id}
              onMouseEnter={() => {
                setHoveredCellId(entry.cell.id);
                props.onHoverCellChange?.(entry.cell);
              }}
              onMouseLeave={() => {
                setHoveredCellId((current) => (current === entry.cell.id ? null : current));
                props.onHoverCellChange?.(null);
              }}
            >
              <CellGroup
                cell={entry.cell}
                points={entry.points}
                centerX={entry.centerX}
                centerY={entry.centerY}
                selected={props.selectedCellId === entry.cell.id}
                hovered={hoveredCellId === entry.cell.id}
                showCoordinates={props.showCoordinates}
                showShorthand={props.showShorthand}
                showGrid={props.showGrid}
                onSelect={() => props.onSelectCell(entry.cell)}
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
