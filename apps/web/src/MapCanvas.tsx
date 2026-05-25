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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1_048_576;
const WHEEL_ZOOM_SENSITIVITY = 0.0014;
const COORDINATE_VISIBILITY_SCALE = 0.78;
const COORDINATE_LABEL_SHOW_SCALE = 0.95;
const COORDINATE_LABEL_HIDE_SCALE = 0.78;
const COORDINATE_LABEL_MEDIUM_SHOW_SCALE = 1.75;
const COORDINATE_LABEL_MEDIUM_HIDE_SCALE = 1.4;
const COORDINATE_LABEL_FULL_SHOW_SCALE = 3.0;
const COORDINATE_LABEL_FULL_HIDE_SCALE = 2.4;
const SHORTHAND_VISIBILITY_SCALE = 1.12;
const TAG_VISIBILITY_SCALE = 1.12;
const PATTERN_VISIBILITY_SCALE = 0.42;
const DRAG_CLICK_THRESHOLD = 4;
const LABEL_VIEWPORT_MARGIN_PX = 120;

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

interface CanvasCamera {
  zoom: number;
  offset: {
    x: number;
    y: number;
  };
}

interface ViewportMetrics {
  width: number;
  height: number;
  baseScale: number;
  baseOffset: {
    x: number;
    y: number;
  };
}

interface SceneBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type CoordinateLabelMode = "hidden" | "sparse" | "medium" | "full";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getViewportMetrics(width: number, height: number, sceneWidth: number, sceneHeight: number): ViewportMetrics {
  const baseScale = Math.min(width / sceneWidth, height / sceneHeight);
  return {
    width,
    height,
    baseScale,
    baseOffset: {
      x: (width - sceneWidth * baseScale) / 2,
      y: 0
    }
  };
}

function getNextCoordinateLabelMode(current: CoordinateLabelMode, scale: number): CoordinateLabelMode {
  if (scale <= COORDINATE_LABEL_HIDE_SCALE || (current === "hidden" && scale < COORDINATE_LABEL_SHOW_SCALE)) {
    return "hidden";
  }
  if (scale >= COORDINATE_LABEL_FULL_SHOW_SCALE || (current === "full" && scale >= COORDINATE_LABEL_FULL_HIDE_SCALE)) {
    return "full";
  }
  if (
    scale >= COORDINATE_LABEL_MEDIUM_SHOW_SCALE ||
    ((current === "medium" || current === "full") && scale >= COORDINATE_LABEL_MEDIUM_HIDE_SCALE)
  ) {
    return "medium";
  }
  return "sparse";
}

function getCoordinateLabelStep(mode: CoordinateLabelMode): number {
  switch (mode) {
    case "full":
      return 1;
    case "medium":
      return 2;
    case "sparse":
      return 3;
    case "hidden":
      return Number.POSITIVE_INFINITY;
  }
}

function isCellInCoordinateDensity(cell: ActiveCell, step: number): boolean {
  if (step <= 1) {
    return true;
  }
  return cell.row % step === 0 && cell.col % step === 0;
}

function isPointInSceneBounds(point: { x: number; y: number }, bounds: SceneBounds): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
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
  showPattern: boolean;
  showPrimaryTag: boolean;
  showGrid: boolean;
  onSelect: () => void;
}) {
  const { cell } = props;
  const patternFill = props.showPattern ? buildPatternOverlay(cell.biome) : null;
  const shorthand = props.showShorthand ? getCellShorthand(cell) : null;
  const primaryTag = getPrimaryTag(cell);
  const primaryTagText = props.showPrimaryTag ? getPrimaryTagSymbol(primaryTag as TagKey | null) : null;
  const stroke = buildCellStroke(cell, props.selected, props.hovered);
  const opacity = buildCellOpacity(cell);
  const textFill = cell.status === "designed" ? "#1D1B18" : "#6F675D";

  return (
    <g
      className="hex-cell"
      data-cell-id={cell.id}
      aria-label={`${cell.display_coord} ${cell.status}`}
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
  const [isDragging, setIsDragging] = useState(false);
  const [coordinateLabelMode, setCoordinateLabelMode] = useState<CoordinateLabelMode>("hidden");
  const [camera, setCameraState] = useState<CanvasCamera>({
    zoom: 1,
    offset: { x: 0, y: 0 }
  });
  const cameraRef = useRef(camera);
  const dragState = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextCellClickRef = useRef(false);

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
  const viewportMetrics = getViewportMetrics(viewportSize.width, viewportSize.height, scene.width, scene.height);
  const effectiveScale = viewportMetrics.baseScale * camera.zoom;
  const effectiveShowShorthand = props.showShorthand && effectiveScale >= SHORTHAND_VISIBILITY_SCALE;
  const effectiveShowPrimaryTag = effectiveScale >= TAG_VISIBILITY_SCALE;
  const effectiveShowPattern = effectiveScale >= PATTERN_VISIBILITY_SCALE;
  const coordinateLabelStep = getCoordinateLabelStep(coordinateLabelMode);
  const labelViewportBounds = useMemo(() => {
    const translateX = viewportMetrics.baseOffset.x + camera.offset.x;
    const translateY = viewportMetrics.baseOffset.y + camera.offset.y;
    const margin = LABEL_VIEWPORT_MARGIN_PX / Math.max(effectiveScale, 0.0001);
    return {
      left: (0 - translateX) / effectiveScale - margin,
      right: (viewportSize.width - translateX) / effectiveScale + margin,
      top: (0 - translateY) / effectiveScale - margin,
      bottom: (viewportSize.height - translateY) / effectiveScale + margin
    };
  }, [
    camera.offset.x,
    camera.offset.y,
    effectiveScale,
    viewportMetrics.baseOffset.x,
    viewportMetrics.baseOffset.y,
    viewportSize.height,
    viewportSize.width
  ]);
  const renderDetail =
    effectiveScale >= SHORTHAND_VISIBILITY_SCALE
      ? "near"
      : effectiveScale >= COORDINATE_VISIBILITY_SCALE
        ? "mid"
        : effectiveScale >= PATTERN_VISIBILITY_SCALE
          ? "far"
          : "extreme-far";

  const setCamera = useCallback((nextCamera: CanvasCamera) => {
    const normalizedCamera = {
      zoom: clamp(nextCamera.zoom, MIN_ZOOM, MAX_ZOOM),
      offset: {
        x: Number.isFinite(nextCamera.offset.x) ? nextCamera.offset.x : 0,
        y: Number.isFinite(nextCamera.offset.y) ? nextCamera.offset.y : 0
      }
    };
    cameraRef.current = normalizedCamera;
    setCameraState(normalizedCamera);
  }, []);

  const updateViewportSize = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    setViewportSize({
      width: rect.width > 0 ? rect.width : scene.width,
      height: rect.height > 0 ? rect.height : scene.height
    });
  }, [scene.height, scene.width]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    setCoordinateLabelMode((current) => {
      if (!props.showCoordinates) {
        return "hidden";
      }
      return getNextCoordinateLabelMode(current, effectiveScale);
    });
  }, [effectiveScale, props.showCoordinates]);

  useEffect(() => {
    const node = containerRef.current;
    updateViewportSize();

    if (!node || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportSize);
      return () => {
        window.removeEventListener("resize", updateViewportSize);
      };
    }

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [updateViewportSize]);

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
      const metrics = getViewportMetrics(viewport.width, viewport.height, scene.width, scene.height);
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const currentCamera = cameraRef.current;
      const zoomMultiplier = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const nextZoom = clamp(currentCamera.zoom * zoomMultiplier, MIN_ZOOM, MAX_ZOOM);

      setViewportSize(viewport);

      if (nextZoom === currentCamera.zoom) {
        return;
      }

      const currentScale = metrics.baseScale * currentCamera.zoom;
      const sceneX = (pointerX - metrics.baseOffset.x - currentCamera.offset.x) / currentScale;
      const sceneY = (pointerY - metrics.baseOffset.y - currentCamera.offset.y) / currentScale;
      const nextScale = metrics.baseScale * nextZoom;
      setCamera({
        zoom: nextZoom,
        offset: {
          x: pointerX - metrics.baseOffset.x - sceneX * nextScale,
          y: pointerY - metrics.baseOffset.y - sceneY * nextScale
        }
      });
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, [scene.height, scene.width, setCamera]);

  const clearHover = () => {
    setHoveredCellId(null);
    props.onHoverCellChange?.(null);
  };

  const finishDrag = (pointerId: number, target: HTMLDivElement) => {
    const shouldSuppressClick = dragState.current?.pointerId === pointerId && dragState.current.moved;
    if (typeof target.hasPointerCapture === "function" && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    dragState.current = null;
    setIsDragging(false);
    suppressNextCellClickRef.current = Boolean(shouldSuppressClick);
    window.setTimeout(() => {
      suppressNextCellClickRef.current = false;
    }, 0);
  };

  const isEntryInLabelViewport = (entry: { centerX: number; centerY: number }) =>
    isPointInSceneBounds({ x: entry.centerX, y: entry.centerY }, labelViewportBounds);

  const shouldShowCoordinatesForEntry = (entry: { cell: ActiveCell; centerX: number; centerY: number }) => {
    if (!props.showCoordinates || coordinateLabelMode === "hidden" || !isEntryInLabelViewport(entry)) {
      return false;
    }
    const focused = entry.cell.id === props.selectedCellId || entry.cell.id === hoveredCellId;
    return focused || isCellInCoordinateDensity(entry.cell, coordinateLabelStep);
  };

  return (
    <div
      ref={containerRef}
      className={isDragging ? "map-canvas map-canvas-dragging" : "map-canvas"}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        if (typeof event.currentTarget.setPointerCapture === "function") {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        dragState.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startOffsetX: cameraRef.current.offset.x,
          startOffsetY: cameraRef.current.offset.y,
          moved: false
        };
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        const currentDrag = dragState.current;
        if (!currentDrag || currentDrag.pointerId !== event.pointerId) {
          return;
        }
        const deltaX = event.clientX - currentDrag.startClientX;
        const deltaY = event.clientY - currentDrag.startClientY;
        const moved = currentDrag.moved || Math.hypot(deltaX, deltaY) > DRAG_CLICK_THRESHOLD;
        currentDrag.moved = moved;
        if (moved) {
          suppressNextCellClickRef.current = true;
        }
        setCamera({
          zoom: cameraRef.current.zoom,
          offset: {
            x: currentDrag.startOffsetX + deltaX,
            y: currentDrag.startOffsetY + deltaY
          }
        });
      }}
      onPointerUp={(event) => {
        finishDrag(event.pointerId, event.currentTarget);
      }}
      onPointerCancel={(event) => {
        finishDrag(event.pointerId, event.currentTarget);
        clearHover();
      }}
      onPointerLeave={() => {
        clearHover();
      }}
    >
      {props.selectedCell ? (
        <div className="canvas-selection-overlay" aria-label="当前选中信息">
          <span>{props.selectedCell.display_coord} | {props.selectedCell.status}</span>
        </div>
      ) : null}
      <div className="canvas-help-overlay" aria-hidden="true">
        滚轮缩放 · 拖拽平移
      </div>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
        preserveAspectRatio="none"
        aria-label="Map canvas"
        data-render-detail={renderDetail}
        data-coordinate-label-mode={coordinateLabelMode}
      >
        <defs dangerouslySetInnerHTML={{ __html: scene.defs.join("") }} />
        <rect width={viewportSize.width} height={viewportSize.height} fill={scene.background} />
        <g
          transform={`translate(${viewportMetrics.baseOffset.x + camera.offset.x} ${viewportMetrics.baseOffset.y + camera.offset.y}) scale(${viewportMetrics.baseScale * camera.zoom})`}
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
                showCoordinates={shouldShowCoordinatesForEntry(entry)}
                showShorthand={effectiveShowShorthand && isEntryInLabelViewport(entry)}
                showPattern={effectiveShowPattern}
                showPrimaryTag={effectiveShowPrimaryTag && isEntryInLabelViewport(entry)}
                showGrid={props.showGrid}
                onSelect={() => {
                  if (suppressNextCellClickRef.current) {
                    suppressNextCellClickRef.current = false;
                    return;
                  }
                  props.onSelectCell(entry.cell);
                }}
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
