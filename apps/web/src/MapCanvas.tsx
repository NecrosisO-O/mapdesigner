import { RiverEditingLayer } from "./RiverEditingLayer.js";
import type { InteractionMode } from "./TopToolbar.js";
import { materialForCell, type Material } from "./useMaterialBrush.js";
import type { LegendHighlight } from "./LegendPanel.js";
import {
  TAG_ENTRIES,
  TERRAIN_ENTRIES,
  BIOME_ENTRIES,
  buildHexLine,
  propagateRiverJunctions,
  type RiverPoint,
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
  escapeXml,
  buildMapScene,
  centerForCoord,
  coordForPoint,
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
  interactionMode?: InteractionMode;
  brushRadius?: number;
  brushMaterial?: Material;
  brushFields?: { terrain: boolean; biome: boolean };
  focusRequest?: { coord: GridCoordinate; token: number } | null;
  legendHighlight?: LegendHighlight | null;
  onBrushStroke?: (cells: ActiveCell[]) => void;
  batchSelectedCellIds?: Set<string>;
  onBatchCellToggle?: (cell: ActiveCell) => void;
  riverPreview?: RiverFeature | null;
  selectedRiver?: RiverFeature | null;
  selectedRiverNode?: number;
  riverEditingDisabled?: boolean;
  onSelectRiver?: (river: RiverFeature) => void;
  onSelectRiverNode?: (index: number) => void;
  onCommitRiverPoints?: (points: RiverPoint[]) => void;
  snapRiverConnections?: boolean;
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
  return coordForPoint({ x: point.x + scene.minX, y: point.y + scene.minY }, size);
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
  preview?: ActiveCell;
  showTerrain: boolean;
  showSymbols: boolean;
  onSelect: () => void;
}) {
  const { cell } = props;
  const content = renderCellSurface(
    {
      cell: props.preview ?? cell,
      points: props.points,
      centerX: props.centerX,
      centerY: props.centerY
    },
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
      dangerouslySetInnerHTML={{
        __html:
          "<title>" +
          escapeXml(
            [
              cell.display_coord,
              cell.terrain ? TERRAIN_ENTRIES[cell.terrain].label : "待设计",
              cell.biome ? BIOME_ENTRIES[cell.biome].label : "",
              ...cell.tags.map((tag) => TAG_ENTRIES[tag].label)
            ]
              .filter(Boolean)
              .join(" · ")
          ) +
          "</title>" +
          content
      }}
    />
  );
}

export function MapCanvas(props: MapCanvasProps) {
  const [visualDetail, setVisualDetail] = useState(1);
  const [gestureRiver, setGestureRiver] = useState<RiverFeature | null>(null);
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

  const preview = gestureRiver ?? props.riverPreview;
  const displayMap = useMemo(() => {
    if (!preview || props.interactionMode === "river-draw") return props.map;
    const original = props.map.document.features.rivers.find((r) => r.id === preview.id);
    if (!original) return props.map;
    const rivers = props.map.document.features.rivers.map((r) =>
      r.id === preview.id ? preview : { ...r, points: r.points.map((p) => ({ ...p })) }
    );
    propagateRiverJunctions(rivers, original, preview);
    return {
      ...props.map,
      document: { ...props.map.document, features: { ...props.map.document.features, rivers } }
    };
  }, [props.map, preview, props.interactionMode]);
  const riverDetail = visualDetail >= 2 ? "high" : "low";
  const scene = useMemo(
    () =>
      buildMapScene(displayMap, {
        includeCoordinates: props.showCoordinates,
        includeShorthand: props.showShorthand,
        includeGrid: props.showGrid,
        includeUndesigned: props.showUndesigned,
        includeTerrain: props.showTerrain,
        includeBiomes: props.showBiomes,
        includeRivers: props.showRivers,
        includeTags: props.showTags,
        previewRivers:
          props.interactionMode === "river-draw" && props.riverPreview ? [props.riverPreview] : [],
        boundsCoords: boundsCoordsFromSummary(props.mapSummary),
        riverDetail
      }),
    [
      riverDetail,
      displayMap,
      props.interactionMode,
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
  const effectiveShowPrimaryTag = visualDetail >= 3;
  const effectiveShowPattern = visualDetail >= 2;
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
  const renderDetail = ["extreme-far", "far", "mid", "near"][visualDetail];
  useEffect(() => {
    setVisualDetail((current) => {
      let level = current;
      const show = [0.28, 0.78, 1.12],
        hide = [0.22, 0.66, 0.98];
      while (level < 3 && effectiveScale >= show[level]!) level++;
      while (level > 0 && effectiveScale < hide[level - 1]!) level--;
      return level;
    });
  }, [effectiveScale]);
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
    if (props.interactionMode === "brush" || props.interactionMode === "format-brush") {
      props.onBrushStroke?.(brushCells(cell));
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
  const doesCellMatchTagFilter = (cell: ActiveCell) => {
    const highlight = props.legendHighlight;
    return (
      (tagFilter.length === 0 || tagFilter.some((tag) => cell.tags.includes(tag))) &&
      (!highlight ||
        (highlight.kind === "tag"
          ? cell.tags.includes(highlight.key as TagKey)
          : cell[highlight.kind] === highlight.key))
    );
  };
  function brushCells(cell: ActiveCell): ActiveCell[] {
    const found = new Map([[cell.id, cell]]);
    let edge = [cell];
    for (let step = 0; step < (props.brushRadius ?? 0); step++) {
      const next: ActiveCell[] = [];
      for (const source of edge)
        for (const coord of getNeighborCoords(source)) {
          const id = createCellId(coord.row, coord.col),
            target = sceneCellsById.get(id);
          if (target && !found.has(id)) {
            found.set(id, target);
            next.push(target);
          }
        }
      edge = next;
    }
    return [...found.values()];
  }
  const brushHover = props.brushMaterial && hoveredCellId && sceneCellsById.get(hoveredCellId);
  const brushPreviewIds = strokeIds.size
    ? strokeIds
    : new Set(brushHover ? brushCells(brushHover).map((cell) => cell.id) : []);

  function worldAtPoint(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect(),
      scale = viewportMetrics.baseScale * cameraRef.current.zoom;
    return {
      x:
        (clientX - rect.left - viewportMetrics.baseOffset.x - cameraRef.current.offset.x) / scale +
        scene.minX,
      y:
        (clientY - rect.top - viewportMetrics.baseOffset.y - cameraRef.current.offset.y) / scale +
        scene.minY
    };
  }
  function cellAtPoint(clientX: number, clientY: number): ActiveCell | null {
    const point = worldAtPoint(clientX, clientY),
      coord = scenePointToCoord(point, { minX: 0, minY: 0 }, 36);
    return sceneCellsById.get(createCellId(coord.row, coord.col)) ?? null;
  }
  function addStrokeCell(cell: ActiveCell | null): void {
    if (!cell || !stroke.current) return;
    const points = strokeLast.current ? buildHexLine(strokeLast.current, cell) : [cell];
    for (const point of points) {
      const target = sceneCellsById.get(createCellId(point.row, point.col));
      if (target)
        for (const expanded of brushCells(target)) stroke.current.set(expanded.id, expanded);
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
    if (!props.focusRequest) return;
    const point = centerForCoord(props.focusRequest.coord, 36);
    const zoom = clamp(1 / viewportMetrics.baseScale, MIN_ZOOM, MAX_ZOOM);
    const scale = viewportMetrics.baseScale * zoom;
    setCamera({
      zoom,
      offset: {
        x: viewportSize.width / 2 - viewportMetrics.baseOffset.x - (point.x - scene.minX) * scale,
        y: viewportSize.height / 2 - viewportMetrics.baseOffset.y - (point.y - scene.minY) * scale
      }
    });
  }, [props.focusRequest?.token]);
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
          setGestureRiver(null);
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
        if (
          (props.interactionMode === "brush" || props.interactionMode === "format-brush") &&
          !spacePan.current
        ) {
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
          {props.snapRiverConnections &&
            hoveredCellId &&
            props.map.document.features.rivers.some((r) =>
              r.points.some((p) => createCellId(p.row, p.col) === hoveredCellId)
            ) && <span className="status-chip">点击将连接已有节点</span>}
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
          ? "全图概览 · 放大后编辑单元格" +
            (props.overview.river_detail_limited ? " · 部分水系请放大查看" : "")
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
                    fill={getTerrainColor(
                      props.showTerrain === false ? null : tile.terrain,
                      scene.options.mapStyle
                    )}
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
          {props.overview && props.showRivers !== false && (
            <g aria-label="远景河网" fill="none" strokeLinecap="round" strokeLinejoin="round">
              {props.overview.rivers?.map((river) => (
                <path
                  key={river.id}
                  d={river.paths
                    .map((path) =>
                      path
                        .map((p, i) => {
                          const point = centerForCoord(p, 36);
                          return (
                            (i ? "L " : "M ") +
                            (point.x - scene.minX) +
                            " " +
                            (point.y - scene.minY)
                          );
                        })
                        .join(" ")
                    )
                    .join(" ")}
                  stroke={river.color}
                  strokeWidth={Math.max(1.25 / Math.max(effectiveScale, 0.0001), river.width)}
                >
                  <title>{river.name} · 远景概括路径</title>
                </path>
              ))}
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
                  batchSelectedCellIds.has(entry.cell.id) || brushPreviewIds.has(entry.cell.id)
                }
                hovered={hoveredCellId === entry.cell.id}
                showPattern={effectiveShowPattern && props.showBiomes !== false}
                showSymbols={visualDetail >= 1}
                showTerrain={props.showTerrain !== false}
                mapStyle={scene.options.mapStyle}
                preview={
                  props.brushMaterial && brushPreviewIds.has(entry.cell.id)
                    ? materialForCell(
                        entry.cell,
                        props.brushMaterial,
                        props.brushFields ?? { terrain: true, biome: true }
                      )
                    : undefined
                }
                showGrid={props.showGrid && visualDetail >= 2}
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
          {props.showRivers !== false &&
            props.interactionMode === "select" &&
            props.onSelectRiver && (
              <g aria-label="选择河流">
                {scene.riverBodies
                  .filter((b) => !b.preview)
                  .map((body) => (
                    <path
                      key={body.id}
                      d={body.centerPath}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(
                        body.widthRange.max,
                        18 / Math.max(0.01, effectiveScale)
                      )}
                      role="button"
                      tabIndex={0}
                      aria-label={"选择河流 " + body.riverName}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        const river = props.map.document.features.rivers.find(
                          (r) => r.id === body.riverId
                        );
                        if (river) props.onSelectRiver?.(river);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          const river = props.map.document.features.rivers.find(
                            (r) => r.id === body.riverId
                          );
                          if (river) props.onSelectRiver?.(river);
                        }
                      }}
                    />
                  ))}
              </g>
            )}
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
                  brushPreviewIds.has(entry.cell.id)
              )
              .map((entry) => {
                const selected = entry.cell.id === props.selectedCellId;
                const stroke = brushPreviewIds.has(entry.cell.id);
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
          {props.selectedRiver && props.interactionMode === "select" && (
            <RiverEditingLayer
              river={gestureRiver ?? props.selectedRiver}
              selectedNode={props.selectedRiverNode ?? 0}
              scale={effectiveScale}
              minX={scene.minX}
              minY={scene.minY}
              disabled={Boolean(props.riverEditingDisabled)}
              toWorld={worldAtPoint}
              onSelectNode={(index) => props.onSelectRiverNode?.(index)}
              onPreview={setGestureRiver}
              onCommit={(points) => props.onCommitRiverPoints?.(points)}
            />
          )}
          {isRiverDrawing && props.snapRiverConnections && (
            <g pointerEvents="none" aria-hidden="true">
              {props.map.document.features.rivers.flatMap((r) =>
                r.points.map((p, i) => {
                  const center = centerForCoord(p, 36);
                  return (
                    <circle
                      key={r.id + ":" + i}
                      cx={center.x - scene.minX}
                      cy={center.y - scene.minY}
                      r={7 / Math.max(0.1, effectiveScale)}
                      fill="none"
                      stroke="#AA6A12"
                      strokeWidth={2 / Math.max(0.1, effectiveScale)}
                    />
                  );
                })
              )}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
