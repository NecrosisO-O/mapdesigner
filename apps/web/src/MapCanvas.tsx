import {
  buildHexLine,
  createCellId,
  getNeighborCoords,
  type ActiveCell,
  type CellRange,
  type GridCoordinate,
  type MapRuntimeState,
  type MapOverview,
  type MapSummary,
  type MapStyle,
  type RiverFeature,
  type TagKey
} from "@mapdesigner/map-core";
import {
  buildMapScene,
  centerForCoord,
  renderCellSurface,
  renderCellAnnotations,
  renderRiverLayers,
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
  overview?: MapOverview | null;
  mapSummary?: MapSummary | null;
  selectedCell: ActiveCell | null;
  selectedCellId: string | null;
  onSelectCell: (cell: ActiveCell) => void;
  interactionMode?: "select" | "pan" | "brush" | "river-draw" | "batch-select";
  onBrushStroke?: (cells: ActiveCell[]) => void;
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
  showTerrain?: boolean;
  showBiomes?: boolean;
  showRivers?: boolean;
  showTags?: boolean;
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

function getViewportMetrics(
  width: number,
  height: number,
  sceneWidth: number,
  sceneHeight: number
): ViewportMetrics {
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

function boundsCoordsFromSummary(
  summary: MapSummary | null | undefined
): GridCoordinate[] | undefined {
  const bounds = summary?.render_bounds ?? summary?.bounds;
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

function scenePointToCoord(
  point: { x: number; y: number },
  scene: { minX: number; minY: number },
  size: number
): GridCoordinate {
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

function getNextCoordinateLabelMode(
  current: CoordinateLabelMode,
  scale: number
): CoordinateLabelMode {
  if (
    scale <= COORDINATE_LABEL_HIDE_SCALE ||
    (current === "hidden" && scale < COORDINATE_LABEL_SHOW_SCALE)
  ) {
    return "hidden";
  }
  if (
    scale >= COORDINATE_LABEL_FULL_SHOW_SCALE ||
    (current === "full" && scale >= COORDINATE_LABEL_FULL_HIDE_SCALE)
  ) {
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
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function getCellFromEventTarget(
  target: EventTarget | null,
  cellsById: Map<string, ActiveCell>
): ActiveCell | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const cellElement = target.closest("[data-cell-id]");
  const cellId = cellElement?.getAttribute("data-cell-id");
  return cellId ? (cellsById.get(cellId) ?? null) : null;
}

function CellGroup(props: {
  cell: ActiveCell;
  points: string;
  centerX: number;
  centerY: number;
  selected: boolean;
  batchSelected: boolean;
  hovered: boolean;
  showPattern: boolean;
  showGrid: boolean;
  dimmed: boolean;
  mapStyle: MapStyle;
  showTerrain: boolean;
  showSymbols: boolean;
  onSelect: () => void;
}) {
  const { cell } = props;
  const content = renderCellSurface(
    { cell, points: props.points, centerX: props.centerX, centerY: props.centerY },
    {
      mapStyle: props.mapStyle,
      includeGrid: props.showGrid,
      usePatternOverlays: props.showPattern,
      includeTerrain: props.showTerrain,
      includeTerrainSymbols: props.showSymbols
    }
  );
  return (
    <g
      className="hex-cell"
      data-cell-id={cell.id}
      data-batch-selected={props.batchSelected ? "true" : undefined}
      data-filter-match={props.dimmed ? "false" : "true"}
      aria-label={cell.display_coord + " " + (cell.status === "designed" ? "已设计" : "待设计")}
      onClick={props.onSelect}
      role="button"
      tabIndex={props.selected ? 0 : -1}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          props.onSelect();
        }
      }}
      opacity={props.dimmed ? 0.3 : 1}
      dangerouslySetInnerHTML={{ __html: content }}
    />
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
  const spacePan = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number; sceneX: number; sceneY: number } | null>(
    null
  );
  const stroke = useRef<Map<string, ActiveCell> | null>(null);
  const strokeLast = useRef<ActiveCell | null>(null);
  const [strokeIds, setStrokeIds] = useState<Set<string>>(new Set());
  const [keyboardCell, setKeyboardCell] = useState<ActiveCell | null>(null);
  const suppressNextCellClickRef = useRef(false);
  const lastReportedRangeKeyRef = useRef("");

  const riverDetail = camera.zoom >= 0.8 ? "high" : "low";
  const scene = useMemo(
    () =>
      buildMapScene(props.map, {
        includeCoordinates: props.showCoordinates,
        includeShorthand: props.showShorthand,
        includeGrid: props.showGrid,
        includeUndesigned: props.showUndesigned,
        includeTerrain: props.showTerrain,
        includeBiomes: props.showBiomes,
        includeRivers: props.showRivers,
        includeTags: props.showTags,
        previewRivers: props.riverPreview ? [props.riverPreview] : [],
        boundsCoords: boundsCoordsFromSummary(props.mapSummary),
        riverDetail
      }),
    [
      riverDetail,
      props.map,
      props.mapSummary,
      props.riverPreview,
      props.showCoordinates,
      props.showGrid,
      props.showShorthand,
      props.showUndesigned,
      props.showTerrain,
      props.showBiomes,
      props.showRivers,
      props.showTags
    ]
  );
  const sceneCellsById = useMemo(
    () => new Map(scene.layout.map((entry) => [entry.cell.id, entry.cell])),
    [scene.layout]
  );
  const [viewportSize, setViewportSize] = useState({ width: scene.width, height: scene.height });
  const viewportMetrics = getViewportMetrics(
    viewportSize.width,
    viewportSize.height,
    scene.width,
    scene.height
  );
  const effectiveScale = viewportMetrics.baseScale * camera.zoom;
  const effectiveShowShorthand =
    props.showShorthand && effectiveScale >= SHORTHAND_VISIBILITY_SCALE;
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
      const metrics = getViewportMetrics(
        viewport.width,
        viewport.height,
        scene.width,
        scene.height
      );
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
    if (props.interactionMode === "pan" || spacePan.current) return;
    if (props.interactionMode === "brush") {
      props.onBrushStroke?.([cell]);
      return;
    }
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
    pointers.current.delete(pointerId);
    if (pinch.current) {
      pinch.current = null;
      dragState.current = null;
      setIsDragging(false);
      return;
    }
    if (stroke.current) {
      const cells = [...stroke.current.values()];
      stroke.current = null;
      strokeLast.current = null;
      setStrokeIds(new Set());
      if (allowClickSelection && cells.length) props.onBrushStroke?.(cells);
      suppressNextCellClickRef.current = true;
      window.setTimeout(() => {
        suppressNextCellClickRef.current = false;
      }, 0);
      dragState.current = null;
      setIsDragging(false);
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
      return;
    }
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

  const shouldShowCoordinatesForEntry = (entry: {
    cell: ActiveCell;
    centerX: number;
    centerY: number;
  }) => {
    if (
      !props.showCoordinates ||
      coordinateLabelMode === "hidden" ||
      !isEntryInLabelViewport(entry)
    ) {
      return false;
    }
    const focused = entry.cell.id === props.selectedCellId || entry.cell.id === hoveredCellId;
    return focused || isCellInCoordinateDensity(entry.cell, coordinateLabelStep);
  };
  const doesCellMatchTagFilter = (cell: ActiveCell) =>
    tagFilter.length === 0 || tagFilter.some((tag) => cell.tags.includes(tag));

  function cellAtPoint(clientX: number, clientY: number): ActiveCell | null {
    const rect = containerRef.current!.getBoundingClientRect(),
      scale = viewportMetrics.baseScale * cameraRef.current.zoom;
    const point = {
      x: (clientX - rect.left - viewportMetrics.baseOffset.x - cameraRef.current.offset.x) / scale,
      y: (clientY - rect.top - viewportMetrics.baseOffset.y - cameraRef.current.offset.y) / scale
    };
    const coord = scenePointToCoord(point, scene, 36);
    return sceneCellsById.get(createCellId(coord.row, coord.col)) ?? null;
  }
  function addStrokeCell(cell: ActiveCell | null): void {
    if (!cell || !stroke.current) return;
    const points = strokeLast.current ? buildHexLine(strokeLast.current, cell) : [cell];
    for (const point of points) {
      const target = sceneCellsById.get(createCellId(point.row, point.col));
      if (target) stroke.current.set(target.id, target);
    }
    strokeLast.current = cell;
    setStrokeIds(new Set(stroke.current.keys()));
  }
  function zoomAtCenter(factor: number): void {
    const current = cameraRef.current,
      next = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = viewportSize.width / 2 - viewportMetrics.baseOffset.x,
      cy = viewportSize.height / 2 - viewportMetrics.baseOffset.y;
    setCamera({
      zoom: next,
      offset: {
        x: cx - ((cx - current.offset.x) * next) / current.zoom,
        y: cy - ((cy - current.offset.y) * next) / current.zoom
      }
    });
  }
  useEffect(() => {
    stroke.current = null;
    pointers.current.clear();
    pinch.current = null;
    setStrokeIds(new Set());
    setKeyboardCell(null);
  }, [props.map.document.meta.id]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="地图编辑区域"
      onBlur={() => {
        spacePan.current = false;
      }}
      onKeyUp={(event) => {
        if (event.key === " ") spacePan.current = false;
      }}
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).closest("button,input,select,textarea") ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const key = event.key;
        if (key === " ") {
          event.preventDefault();
          spacePan.current = true;
        }
        if (["+", "=", "-", "f", "F"].includes(key)) {
          event.preventDefault();
          if (key.toLowerCase() === "f") setCamera({ zoom: 1, offset: { x: 0, y: 0 } });
          else zoomAtCenter(key === "-" ? 0.8 : 1.25);
        }
        if (key.startsWith("Arrow")) {
          event.preventDefault();
          const current = keyboardCell ?? props.selectedCell ?? props.map.activeCells[0];
          if (!current) return;
          const delta =
            key === "ArrowRight"
              ? { row: 0, col: 1 }
              : key === "ArrowLeft"
                ? { row: 0, col: -1 }
                : key === "ArrowUp"
                  ? { row: 1, col: 0 }
                  : { row: -1, col: 0 };
          const next = sceneCellsById.get(
            createCellId(current.row + delta.row, current.col + delta.col)
          );
          if (next) {
            setKeyboardCell(next);
            setHoveredCellId(next.id);
            props.onHoverCellChange?.(next);
          }
        }
        if (key === "Enter") {
          event.preventDefault();
          if (isRiverDrawing && !event.shiftKey && riverDrawingPointCount >= 2)
            props.onFinishRiverDrawing?.();
          else {
            const cell = keyboardCell ?? props.selectedCell ?? props.map.activeCells[0];
            if (cell) handleCellAction(cell);
          }
        }
        if (key === "Escape") {
          stroke.current = null;
          strokeLast.current = null;
          setStrokeIds(new Set());
          dragState.current = null;
          pointers.current.clear();
          pinch.current = null;
          setIsDragging(false);
          if (isRiverDrawing) props.onCancelRiverDrawing?.();
        }
      }}
      className={[
        "map-canvas",
        isDragging ? "map-canvas-dragging" : "",
        isRiverDrawing ? "map-canvas-river-draw" : "",
        isBatchSelecting ? "map-canvas-batch-select" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.pointerType !== "touch") {
          return;
        }
        if (typeof event.currentTarget.setPointerCapture === "function") {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.currentTarget.focus({ preventScroll: true });
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2) {
          stroke.current = null;
          setStrokeIds(new Set());
          const [a, b] = [...pointers.current.values()],
            rect = event.currentTarget.getBoundingClientRect();
          const x = (a!.x + b!.x) / 2 - rect.left,
            y = (a!.y + b!.y) / 2 - rect.top;
          const scale = viewportMetrics.baseScale * cameraRef.current.zoom;
          pinch.current = {
            distance: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
            zoom: cameraRef.current.zoom,
            sceneX: (x - viewportMetrics.baseOffset.x - cameraRef.current.offset.x) / scale,
            sceneY: (y - viewportMetrics.baseOffset.y - cameraRef.current.offset.y) / scale
          };
          return;
        }
        if (props.interactionMode === "brush" && !spacePan.current) {
          stroke.current = new Map();
          strokeLast.current = null;
          addStrokeCell(
            getCellFromEventTarget(event.target, sceneCellsById) ??
              cellAtPoint(event.clientX, event.clientY)
          );
        }
        dragState.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startOffsetX: cameraRef.current.offset.x,
          startOffsetY: cameraRef.current.offset.y,
          moved: false,
          startCell:
            spacePan.current || props.interactionMode === "pan"
              ? null
              : getCellFromEventTarget(event.target, sceneCellsById)
        };
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        if (pointers.current.has(event.pointerId))
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinch.current && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()],
            rect = event.currentTarget.getBoundingClientRect();
          const zoom = clamp(
            (pinch.current.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch.current.distance,
            MIN_ZOOM,
            MAX_ZOOM
          );
          const scale = viewportMetrics.baseScale * zoom;
          setCamera({
            zoom,
            offset: {
              x:
                (a!.x + b!.x) / 2 -
                rect.left -
                viewportMetrics.baseOffset.x -
                pinch.current.sceneX * scale,
              y:
                (a!.y + b!.y) / 2 -
                rect.top -
                viewportMetrics.baseOffset.y -
                pinch.current.sceneY * scale
            }
          });
          return;
        }
        if (stroke.current) {
          addStrokeCell(cellAtPoint(event.clientX, event.clientY));
          return;
        }
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
      <div
        className="canvas-zoom-controls"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <button aria-label="缩小" onClick={() => zoomAtCenter(0.8)}>
          −
        </button>
        <output aria-label="缩放比例">
          {effectiveScale < 0.01 ? "<1" : Math.round(effectiveScale * 100)}%
        </output>
        <button aria-label="放大" onClick={() => zoomAtCenter(1.25)}>
          +
        </button>
        <button onClick={() => setCamera({ zoom: 1, offset: { x: 0, y: 0 } })}>适合画布</button>
      </div>
      <span className="sr-only" aria-live="polite">
        {keyboardCell
          ? "当前焦点 " + keyboardCell.display_coord
          : "使用方向键移动焦点，回车操作单元格"}
      </span>
      {props.selectedCell ? (
        <div className="canvas-selection-overlay" aria-label="当前选中信息">
          <span>
            {props.selectedCell.display_coord} |{" "}
            {props.selectedCell.status === "designed" ? "已设计" : "待设计"}
          </span>
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
        {props.overview
          ? "全图概览 · 放大后编辑单元格"
          : isRiverDrawing
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
        aria-label="地图画布"
        data-render-detail={renderDetail}
        data-coordinate-label-mode={coordinateLabelMode}
      >
        <defs dangerouslySetInnerHTML={{ __html: scene.defs.join("") }} />
        <rect width={viewportSize.width} height={viewportSize.height} fill={scene.background} />
        <g
          transform={`translate(${viewportMetrics.baseOffset.x + camera.offset.x} ${viewportMetrics.baseOffset.y + camera.offset.y}) scale(${viewportMetrics.baseScale * camera.zoom})`}
        >
          {props.overview && (
            <g aria-label="地图概览">
              {props.overview.tiles.map((tile) => {
                const step = props.overview!.bucket_size;
                const points = [
                  { row: tile.row, col: tile.col },
                  { row: tile.row + step, col: tile.col },
                  { row: tile.row + step, col: tile.col + step },
                  { row: tile.row, col: tile.col + step }
                ]
                  .map((coord) => {
                    const p = centerForCoord(coord, scene.options.size);
                    return p.x - scene.minX + "," + (p.y - scene.minY);
                  })
                  .join(" ");
                return (
                  <polygon
                    key={tile.row + "," + tile.col}
                    points={points}
                    fill={getTerrainColor(tile.terrain, scene.options.mapStyle)}
                    opacity={Math.max(0.28, Math.min(1, tile.count / (step * step)))}
                  >
                    <title>
                      {tile.count} 格{tile.river ? " · 河流" : ""}
                    </title>
                  </polygon>
                );
              })}
            </g>
          )}
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
                batchSelected={
                  batchSelectedCellIds.has(entry.cell.id) || strokeIds.has(entry.cell.id)
                }
                hovered={hoveredCellId === entry.cell.id}
                showPattern={effectiveShowPattern && props.showBiomes !== false}
                showSymbols={effectiveShowPattern}
                showTerrain={props.showTerrain !== false}
                mapStyle={scene.options.mapStyle}
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
          <g
            className="river-layer"
            pointerEvents="none"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: renderRiverLayers(scene) }}
          />
          <g className="map-annotation-layer" pointerEvents="none" aria-hidden="true">
            {scene.layout.filter(isEntryInLabelViewport).map((entry) => (
              <g
                key={entry.cell.id}
                opacity={doesCellMatchTagFilter(entry.cell) ? 1 : 0.3}
                dangerouslySetInnerHTML={{
                  __html: renderCellAnnotations(entry, {
                    ...scene.options,
                    includeCoordinates: shouldShowCoordinatesForEntry(entry),
                    includeShorthand: effectiveShowShorthand,
                    includeTags: effectiveShowPrimaryTag && props.showTags !== false
                  })
                }}
              />
            ))}
          </g>
          <g className="map-feedback-layer" pointerEvents="none" aria-hidden="true">
            {scene.layout
              .filter(
                (entry) =>
                  entry.cell.id === props.selectedCellId ||
                  entry.cell.id === hoveredCellId ||
                  entry.cell.id === keyboardCell?.id ||
                  batchSelectedCellIds.has(entry.cell.id) ||
                  strokeIds.has(entry.cell.id)
              )
              .map((entry) => {
                const selected = entry.cell.id === props.selectedCellId;
                const stroke = strokeIds.has(entry.cell.id);
                const batch = batchSelectedCellIds.has(entry.cell.id);
                const focused = entry.cell.id === keyboardCell?.id;
                return (
                  <g key={entry.cell.id}>
                    <polygon
                      points={entry.points}
                      fill={stroke ? "#E5A944" : batch ? "#337F9F" : "none"}
                      fillOpacity=".18"
                      stroke="#F8F8EE"
                      strokeWidth="4.5"
                    />
                    <polygon
                      points={entry.points}
                      fill="none"
                      stroke={
                        stroke ? "#986113" : selected ? "#164F41" : batch ? "#216A94" : "#54675D"
                      }
                      strokeWidth={selected || batch || stroke ? 2.5 : 1.5}
                      strokeDasharray={focused ? "2 3" : selected ? undefined : "6 3"}
                    />
                  </g>
                );
              })}
          </g>
        </g>
      </svg>
    </div>
  );
}
