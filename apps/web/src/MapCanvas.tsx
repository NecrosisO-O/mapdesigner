import {
  type ActiveCell,
  type CellRange,
  type GridCoordinate,
  type MapRuntimeState,
  type MapSummary,
  type RiverFeature,
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
  mapSummary?: MapSummary | null;
  selectedCell: ActiveCell | null;
  selectedCellId: string | null;
  onSelectCell: (cell: ActiveCell) => void;
  interactionMode?: "select" | "river-draw" | "batch-select";
  batchSelectedCellIds?: Set<string>;
  onBatchCellToggle?: (cell: ActiveCell) => void;
  riverPreview?: RiverFeature | null;
  riverDrawingPointCount?: number;
  onRiverPointAdd?: (cell: ActiveCell) => void;
  onFinishRiverDrawing?: () => void;
  onCancelRiverDrawing?: () => void;
  onHoverCellChange?: (cell: ActiveCell | null) => void;
  onVisibleRangeChange?: (range: CellRange) => void;
  showCoordinates: boolean;
  showShorthand: boolean;
  showGrid: boolean;
  showUndesigned: boolean;
  tagFilter?: TagKey[];
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

function boundsCoordsFromSummary(summary: MapSummary | null | undefined): GridCoordinate[] | undefined {
  const bounds = summary?.bounds;
  if (
    !bounds ||
    bounds.min_row === null ||
    bounds.max_row === null ||
    bounds.min_col === null ||
    bounds.max_col === null
  ) {
    return undefined;
  }
  return [
    { row: bounds.min_row, col: bounds.min_col },
    { row: bounds.min_row, col: bounds.max_col },
    { row: bounds.max_row, col: bounds.min_col },
    { row: bounds.max_row, col: bounds.max_col }
  ];
}

function scenePointToCoord(point: { x: number; y: number }, scene: { minX: number; minY: number }, size: number): GridCoordinate {
  const worldX = point.x + scene.minX;
  const worldY = point.y + scene.minY;
  const col = Math.round(worldX / (size * 1.5));
  const row = Math.round(-worldY / (Math.sqrt(3) * size) - col / 2);
  return { row, col };
}

function getVisibleCoordRange(input: {
  viewportSize: { width: number; height: number };
  viewportMetrics: ViewportMetrics;
  camera: CanvasCamera;
  scene: { minX: number; minY: number };
  size: number;
}): CellRange {
  const scale = input.viewportMetrics.baseScale * input.camera.zoom;
  const translateX = input.viewportMetrics.baseOffset.x + input.camera.offset.x;
  const translateY = input.viewportMetrics.baseOffset.y + input.camera.offset.y;
  const corners = [
    { x: 0, y: 0 },
    { x: input.viewportSize.width, y: 0 },
    { x: 0, y: input.viewportSize.height },
    { x: input.viewportSize.width, y: input.viewportSize.height }
  ].map((point) =>
    scenePointToCoord(
      {
        x: (point.x - translateX) / scale,
        y: (point.y - translateY) / scale
      },
      input.scene,
      input.size
    )
  );
  return {
    minRow: Math.min(...corners.map((coord) => coord.row)) - 2,
    maxRow: Math.max(...corners.map((coord) => coord.row)) + 2,
    minCol: Math.min(...corners.map((coord) => coord.col)) - 2,
    maxCol: Math.max(...corners.map((coord) => coord.col)) + 2
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

function getCellFromEventTarget(target: EventTarget | null, cellsById: Map<string, ActiveCell>): ActiveCell | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const cellElement = target.closest("[data-cell-id]");
  const cellId = cellElement?.getAttribute("data-cell-id");
  return cellId ? cellsById.get(cellId) ?? null : null;
}

function CellGroup(props: {
  cell: ActiveCell;
  points: string;
  centerX: number;
  centerY: number;
  selected: boolean;
  batchSelected: boolean;
  hovered: boolean;
  showCoordinates: boolean;
  showShorthand: boolean;
  showPattern: boolean;
  showPrimaryTag: boolean;
  showGrid: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const { cell } = props;
  const patternFill = props.showPattern ? buildPatternOverlay(cell.biome) : null;
  const shorthand = props.showShorthand ? getCellShorthand(cell) : null;
  const primaryTag = getPrimaryTag(cell);
  const primaryTagText = props.showPrimaryTag ? getPrimaryTagSymbol(primaryTag as TagKey | null) : null;
  const stroke = props.batchSelected ? "#B66219" : buildCellStroke(cell, props.selected, props.hovered);
  const opacity = buildCellOpacity(cell);
  const textFill = cell.status === "designed" ? "#1D1B18" : "#6F675D";

  return (
    <g
      className="hex-cell"
      data-cell-id={cell.id}
      data-batch-selected={props.batchSelected ? "true" : undefined}
      data-filter-match={props.dimmed ? "false" : "true"}
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
        strokeWidth={props.batchSelected ? 2.6 : props.showGrid ? 1.2 : 0.6}
        opacity={props.dimmed ? opacity * 0.32 : opacity}
      />
      {props.batchSelected ? (
        <polygon
          points={props.points}
          fill="none"
          stroke="#FFF4CC"
          strokeWidth="0.9"
          opacity={props.dimmed ? 0.45 : 0.95}
        />
      ) : null}
      {patternFill ? (
        <polygon
          points={props.points}
          fill={patternFill}
          opacity={props.dimmed ? 0.2 : cell.status === "designed" ? 0.9 : 0.5}
        />
      ) : null}
      {primaryTagText ? (
        <text
          x={props.centerX}
          y={props.centerY - 16}
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="#6B2F18"
          opacity={props.dimmed ? 0.35 : 1}
        >
          {primaryTagText}
        </text>
      ) : null}
      {props.showCoordinates ? (
        <text
          x={props.centerX}
          y={props.centerY - 3}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill={textFill}
          opacity={props.dimmed ? 0.35 : 1}
        >
          {cell.display_coord}
        </text>
      ) : null}
      {shorthand && cell.status === "designed" ? (
        <text
          x={props.centerX}
          y={props.centerY + 11}
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="500"
          fill={textFill}
          opacity={props.dimmed ? 0.35 : 1}
        >
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
    startCell: ActiveCell | null;
  } | null>(null);
  const suppressNextCellClickRef = useRef(false);
  const lastReportedRangeKeyRef = useRef("");

  const scene = useMemo(
    () =>
      buildMapScene(props.map, {
        includeCoordinates: props.showCoordinates,
        includeShorthand: props.showShorthand,
        includeGrid: props.showGrid,
        includeUndesigned: props.showUndesigned,
        previewRivers: props.riverPreview ? [props.riverPreview] : [],
        boundsCoords: boundsCoordsFromSummary(props.mapSummary),
        riverDetail: camera.zoom >= 0.8 ? "high" : "low"
      }),
    [
      camera.zoom,
      props.map,
      props.mapSummary,
      props.riverPreview,
      props.showCoordinates,
      props.showGrid,
      props.showShorthand,
      props.showUndesigned
    ]
  );
  const sceneCellsById = useMemo(
    () => new Map(scene.layout.map((entry) => [entry.cell.id, entry.cell])),
    [scene.layout]
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
  const isRiverDrawing = props.interactionMode === "river-draw";
  const isBatchSelecting = props.interactionMode === "batch-select";
  const riverDrawingPointCount = props.riverDrawingPointCount ?? 0;
  const tagFilter = props.tagFilter ?? [];
  const batchSelectedCellIds = props.batchSelectedCellIds ?? new Set<string>();

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
    if (!props.onVisibleRangeChange || effectiveScale <= 0) {
      return;
    }
    const range = getVisibleCoordRange({
      viewportSize,
      viewportMetrics,
      camera,
      scene: {
        minX: scene.minX,
        minY: scene.minY
      },
      size: scene.options.size
    });
    const key = `${range.minRow}:${range.maxRow}:${range.minCol}:${range.maxCol}`;
    if (key === lastReportedRangeKeyRef.current) {
      return;
    }
    lastReportedRangeKeyRef.current = key;
    props.onVisibleRangeChange(range);
  }, [
    camera,
    effectiveScale,
    props.onVisibleRangeChange,
    scene.minX,
    scene.minY,
    scene.options.size,
    viewportMetrics,
    viewportSize
  ]);

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

  const handleCellAction = (cell: ActiveCell) => {
    if (props.interactionMode === "river-draw") {
      props.onRiverPointAdd?.(cell);
      return;
    }
    if (props.interactionMode === "batch-select") {
      props.onBatchCellToggle?.(cell);
      return;
    }
    props.onSelectCell(cell);
  };

  const finishDrag = (pointerId: number, target: HTMLDivElement, allowClickSelection = true) => {
    const currentDrag = dragState.current;
    const isCurrentPointer = currentDrag?.pointerId === pointerId;
    const clickedCell =
      allowClickSelection && isCurrentPointer && !currentDrag.moved ? currentDrag.startCell : null;
    const shouldSuppressClick = Boolean(isCurrentPointer && (currentDrag.moved || clickedCell));
    if (typeof target.hasPointerCapture === "function" && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    dragState.current = null;
    setIsDragging(false);
    suppressNextCellClickRef.current = Boolean(shouldSuppressClick);
    window.setTimeout(() => {
      suppressNextCellClickRef.current = false;
    }, 0);
    if (clickedCell) {
      handleCellAction(clickedCell);
    }
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
  const doesCellMatchTagFilter = (cell: ActiveCell) =>
    tagFilter.length === 0 || tagFilter.some((tag) => cell.tags.includes(tag));

  return (
    <div
      ref={containerRef}
      className={[
        "map-canvas",
        isDragging ? "map-canvas-dragging" : "",
        isRiverDrawing ? "map-canvas-river-draw" : "",
        isBatchSelecting ? "map-canvas-batch-select" : ""
      ].filter(Boolean).join(" ")}
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
          moved: false,
          startCell: getCellFromEventTarget(event.target, sceneCellsById)
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
        finishDrag(event.pointerId, event.currentTarget, false);
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
      {isRiverDrawing ? (
        <div
          className="canvas-river-toolbar"
          aria-label="河流绘制工具"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span>河流绘制</span>
          <strong>路径点 {riverDrawingPointCount}</strong>
          <button
            type="button"
            className="primary-button"
            onClick={props.onFinishRiverDrawing}
            disabled={riverDrawingPointCount < 2}
          >
            完成
          </button>
          <button type="button" onClick={props.onCancelRiverDrawing}>
            取消
          </button>
        </div>
      ) : null}
      <div className="canvas-help-overlay" aria-hidden="true">
        {isRiverDrawing
          ? "河流绘制 · 点击单元格添加路径点"
          : isBatchSelecting
            ? "批量选择 · 点击单元格加入或移除"
            : "滚轮缩放 · 拖拽平移"}
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
                batchSelected={batchSelectedCellIds.has(entry.cell.id)}
                hovered={hoveredCellId === entry.cell.id}
                showCoordinates={shouldShowCoordinatesForEntry(entry)}
                showShorthand={effectiveShowShorthand && isEntryInLabelViewport(entry)}
                showPattern={effectiveShowPattern}
                showPrimaryTag={effectiveShowPrimaryTag && isEntryInLabelViewport(entry)}
                showGrid={props.showGrid}
                dimmed={!doesCellMatchTagFilter(entry.cell)}
                onSelect={() => {
                  if (suppressNextCellClickRef.current) {
                    suppressNextCellClickRef.current = false;
                    return;
                  }
                  handleCellAction(entry.cell);
                }}
              />
            </g>
          ))}
          {scene.riverSegments.length > 0 ? (
            <g className="river-layer" pointerEvents="none" aria-hidden="true">
              {scene.riverSegments.map((segment) => (
                <g
                  key={segment.id}
                  data-river-id={segment.riverId}
                  data-river-preview={segment.preview ? "true" : undefined}
                >
                  <line
                    x1={segment.x1}
                    y1={segment.y1}
                    x2={segment.x2}
                    y2={segment.y2}
                    stroke="#EAF8FC"
                    strokeWidth={segment.width + 2.2}
                    strokeLinecap="round"
                    opacity={Math.min(0.9, segment.opacity)}
                    strokeDasharray={segment.preview ? "7 5" : undefined}
                  />
                  <line
                    x1={segment.x1}
                    y1={segment.y1}
                    x2={segment.x2}
                    y2={segment.y2}
                    stroke={segment.color}
                    strokeWidth={segment.width}
                    strokeLinecap="round"
                    opacity={segment.opacity}
                    strokeDasharray={segment.preview ? "7 5" : undefined}
                  />
                </g>
              ))}
              {scene.riverEndpoints.map((endpoint) => (
                <circle
                  key={endpoint.id}
                  data-river-endpoint={endpoint.kind}
                  data-river-id={endpoint.riverId}
                  data-river-preview={endpoint.preview ? "true" : undefined}
                  cx={endpoint.x}
                  cy={endpoint.y}
                  r={endpoint.radius}
                  fill={endpoint.color}
                  stroke="#EAF8FC"
                  strokeWidth="2"
                  opacity={Math.min(1, endpoint.opacity + 0.08)}
                />
              ))}
              {scene.riverControlPoints.map((point) => (
                <g
                  key={point.id}
                  data-river-control-point={point.position}
                  data-river-id={point.riverId}
                  data-river-preview={point.preview ? "true" : undefined}
                >
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={point.radius}
                    fill="#F7FBFC"
                    stroke={point.color}
                    strokeWidth="1.8"
                    opacity={Math.min(1, point.opacity + 0.08)}
                  />
                  <text
                    x={point.x}
                    y={point.y + 2.5}
                    textAnchor="middle"
                    fontSize="7"
                    fontWeight="800"
                    fill={point.color}
                  >
                    {point.label}
                  </text>
                </g>
              ))}
            </g>
          ) : null}
        </g>
      </svg>
    </div>
  );
}
