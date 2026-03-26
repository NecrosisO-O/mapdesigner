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
import { useEffect, useMemo, useRef, useState } from "react";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.6;
const ZOOM_FACTOR = 1.1;

interface MapCanvasProps {
  map: MapRuntimeState;
  selectedCell: ActiveCell | null;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const offsetRef = useRef(offset);
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);

  const scene = useMemo(
    () =>
      buildMapScene(props.map, {
        includeCoordinates: props.showCoordinates,
        includeShorthand: props.showShorthand,
        includeGrid: props.showGrid,
        includeUndesigned: props.showUndesigned
      }),
    [props.map, props.showCoordinates, props.showGrid, props.showShorthand, props.showUndesigned]
  );
  const [viewportSize, setViewportSize] = useState({ width: scene.width, height: scene.height });

  const baseScale = Math.min(
    viewportSize.width / scene.width,
    viewportSize.height / scene.height
  );
  const baseOffset = {
    x: (viewportSize.width - scene.width * baseScale) / 2,
    y: 0
  };

  const updateViewportSize = () => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    setViewportSize({
      width: rect.width > 0 ? rect.width : scene.width,
      height: rect.height > 0 ? rect.height : scene.height
    });
  };

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);

    return () => {
      window.removeEventListener("resize", updateViewportSize);
    };
  }, [scene.height, scene.width]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const rect = node.getBoundingClientRect();
      const viewport = {
        width: rect.width > 0 ? rect.width : scene.width,
        height: rect.height > 0 ? rect.height : scene.height
      };
      const nextBaseScale = Math.min(
        viewport.width / scene.width,
        viewport.height / scene.height
      );
      const nextBaseOffset = {
        x: (viewport.width - scene.width * nextBaseScale) / 2,
        y: 0
      };
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const currentZoom = zoomRef.current;
      const currentOffset = offsetRef.current;
      const nextZoom = Number(
        Math.max(
          MIN_ZOOM,
          Math.min(
            MAX_ZOOM,
            currentZoom * (event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)
          )
        ).toFixed(3)
      );

      if (nextZoom === currentZoom) {
        return;
      }

      setViewportSize(viewport);

      const currentScale = nextBaseScale * currentZoom;
      const sceneX = (pointerX - nextBaseOffset.x - currentOffset.x) / currentScale;
      const sceneY = (pointerY - nextBaseOffset.y - currentOffset.y) / currentScale;
      const nextScale = nextBaseScale * nextZoom;
      const nextOffset = {
        x: Number((pointerX - nextBaseOffset.x - sceneX * nextScale).toFixed(2)),
        y: Number((pointerY - nextBaseOffset.y - sceneY * nextScale).toFixed(2))
      };

      zoomRef.current = nextZoom;
      offsetRef.current = nextOffset;
      setZoom(nextZoom);
      setOffset(nextOffset);
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, [scene.height, scene.width]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
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
      {props.selectedCell ? (
        <div className="canvas-selection-overlay" aria-label="当前选中信息">
          <span>
            {props.selectedCell.display_coord} | {props.selectedCell.status}
          </span>
        </div>
      ) : null}
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
        preserveAspectRatio="none"
        aria-label="Map canvas"
      >
        <defs dangerouslySetInnerHTML={{ __html: scene.defs.join("") }} />
        <rect width={viewportSize.width} height={viewportSize.height} fill={scene.background} />
        <g
          transform={`translate(${Number((baseOffset.x + offset.x).toFixed(2))} ${Number(
            (baseOffset.y + offset.y).toFixed(2)
          )}) scale(${Number((baseScale * zoom).toFixed(3))})`}
        >
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
