import { buildHexLayout, centerForCoord } from "./layout.js";
import {
  buildCellOpacity,
  buildCellStroke,
  buildPatternOverlay,
  buildSvgDefs,
  getCellShorthand,
  getPrimaryTag,
  getPrimaryTagSymbol,
  getTerrainColor
} from "./styles.js";
import type { ExportSceneInput, MapRenderOptions, MapScene } from "./types.js";
import {
  expandRiverPath,
  getRiverEndpointConnections,
  type ActiveCell,
  type CellRange,
  type MapRuntimeState,
  type RiverFeature
} from "@mapdesigner/map-core";

type ResolvedMapRenderOptions = MapScene["options"];

const DEFAULT_OPTIONS: ResolvedMapRenderOptions = {
  size: 36,
  padding: 48,
  background: "#F4F0E6",
  usePatternOverlays: true,
  includeCoordinates: true,
  includeShorthand: false,
  includeGrid: true,
  includeUndesigned: true,
  selectedCellId: null,
  hoveredCellId: null,
  previewRivers: [],
  riverDetail: "high"
};

function isCoordInRange(coord: { row: number; col: number }, range: CellRange): boolean {
  return coord.row >= range.minRow && coord.row <= range.maxRow && coord.col >= range.minCol && coord.col <= range.maxCol;
}

function doRangesOverlap(left: CellRange, right: CellRange): boolean {
  return left.minRow <= right.maxRow && left.maxRow >= right.minRow && left.minCol <= right.maxCol && left.maxCol >= right.minCol;
}

function coordRangeForRiver(river: RiverFeature): CellRange | null {
  const samples = expandRiverPath(river);
  if (samples.length === 0) {
    return null;
  }
  return {
    minRow: Math.min(...samples.map((sample) => sample.row)),
    maxRow: Math.max(...samples.map((sample) => sample.row)),
    minCol: Math.min(...samples.map((sample) => sample.col)),
    maxCol: Math.max(...samples.map((sample) => sample.col))
  };
}

function padRange(range: CellRange, padding: number): CellRange {
  return {
    minRow: range.minRow - padding,
    maxRow: range.maxRow + padding,
    minCol: range.minCol - padding,
    maxCol: range.maxCol + padding
  };
}

function rangeFromCells(cells: ActiveCell[]): CellRange | null {
  if (cells.length === 0) {
    return null;
  }
  return {
    minRow: Math.min(...cells.map((cell) => cell.row)),
    maxRow: Math.max(...cells.map((cell) => cell.row)),
    minCol: Math.min(...cells.map((cell) => cell.col)),
    maxCol: Math.max(...cells.map((cell) => cell.col))
  };
}

export function filterRiversForRange(rivers: RiverFeature[], range: CellRange, padding = 1): RiverFeature[] {
  const padded = padRange(range, padding);
  return rivers.filter((river) => {
    const riverRange = coordRangeForRiver(river);
    return riverRange ? doRangesOverlap(riverRange, padded) : false;
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

interface RiverRenderPoint {
  x: number;
  y: number;
  width: number;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function distanceBetween(left: RiverRenderPoint, right: RiverRenderPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function perpendicularDistance(point: RiverRenderPoint, start: RiverRenderPoint, end: RiverRenderPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return distanceBetween(point, start);
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function simplifyRiverPoints(points: RiverRenderPoint[], tolerance: number, widthTolerance: number): RiverRenderPoint[] {
  if (points.length <= 2) {
    return points;
  }

  let splitIndex = -1;
  let maxScore = -1;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!;
    const geometryScore = perpendicularDistance(point, start, end) / Math.max(tolerance, 0.001);
    const amount = index / (points.length - 1);
    const expectedWidth = start.width + (end.width - start.width) * amount;
    const widthScore = Math.abs(point.width - expectedWidth) / Math.max(widthTolerance, 0.001);
    const score = Math.max(geometryScore, widthScore);
    if (score > maxScore) {
      maxScore = score;
      splitIndex = index;
    }
  }

  if (maxScore <= 1 || splitIndex <= 0) {
    return [start, end];
  }

  const left = simplifyRiverPoints(points.slice(0, splitIndex + 1), tolerance, widthTolerance);
  const right = simplifyRiverPoints(points.slice(splitIndex), tolerance, widthTolerance);
  return [...left.slice(0, -1), ...right];
}

function catmullRom(
  p0: RiverRenderPoint,
  p1: RiverRenderPoint,
  p2: RiverRenderPoint,
  p3: RiverRenderPoint,
  t: number
): RiverRenderPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const interpolate = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: interpolate(p0.x, p1.x, p2.x, p3.x),
    y: interpolate(p0.y, p1.y, p2.y, p3.y),
    width: interpolate(p0.width, p1.width, p2.width, p3.width)
  };
}

function smoothRiverPoints(points: RiverRenderPoint[], size: number, detail: "high" | "low"): RiverRenderPoint[] {
  if (points.length <= 2) {
    return points;
  }

  const smoothed: RiverRenderPoint[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    const segmentDistance = distanceBetween(p1, p2);
    const steps = detail === "low"
      ? Math.max(1, Math.min(3, Math.ceil(segmentDistance / Math.max(size * 1.2, 1))))
      : Math.max(3, Math.min(8, Math.ceil(segmentDistance / Math.max(size * 0.3, 1))));
    for (let step = 0; step < steps; step += 1) {
      if (index > 0 && step === 0) {
        continue;
      }
      smoothed.push(catmullRom(p0, p1, p2, p3, step / steps));
    }
  }
  smoothed.push(points[points.length - 1]!);
  return smoothed.map((point) => ({
    ...point,
    width: Math.max(0.5, point.width)
  }));
}

function centerPathFromPoints(points: RiverRenderPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  return [
    `M ${formatNumber(points[0]!.x)} ${formatNumber(points[0]!.y)}`,
    ...points.slice(1).map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`)
  ].join(" ");
}

function buildRiverBandPath(points: RiverRenderPoint[], extraWidth: number): string | null {
  if (points.length < 2) {
    return null;
  }

  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)]!;
    const current = points[index]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;
    const halfWidth = Math.max(0.4, current.width + extraWidth) / 2;
    left.push({
      x: current.x + normalX * halfWidth,
      y: current.y + normalY * halfWidth
    });
    right.push({
      x: current.x - normalX * halfWidth,
      y: current.y - normalY * halfWidth
    });
  }

  const end = points[points.length - 1]!;
  const start = points[0]!;
  return [
    `M ${formatNumber(left[0]!.x)} ${formatNumber(left[0]!.y)}`,
    ...left.slice(1).map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`),
    `Q ${formatNumber(end.x)} ${formatNumber(end.y)} ${formatNumber(right[right.length - 1]!.x)} ${formatNumber(right[right.length - 1]!.y)}`,
    ...right.slice(0, -1).reverse().map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`),
    `Q ${formatNumber(start.x)} ${formatNumber(start.y)} ${formatNumber(left[0]!.x)} ${formatNumber(left[0]!.y)}`,
    "Z"
  ].join(" ");
}

function buildRiverBodies(
  rivers: RiverFeature[],
  cells: ActiveCell[],
  size: number,
  minX: number,
  minY: number,
  preview: boolean,
  clipRange?: CellRange,
  detail: "high" | "low" = "high"
): MapScene["riverBodies"] {
  const paddedClipRange = clipRange ? padRange(clipRange, 1) : null;
  return rivers.flatMap((river) => {
    const samples = expandRiverPath(river).filter((sample) => !paddedClipRange || isCoordInRange(sample, paddedClipRange));
    if (samples.length < 2) {
      return [];
    }
    const color = river.color ?? "#2F83B7";
    const opacity = river.opacity ?? 0.88;
    const connections = getRiverEndpointConnections(river, cells);
    const basePoints = samples.map((sample, index) => {
      const center = centerForCoord(sample, size);
      let width = sample.width;
      if ((index === 0 && connections.startConnected) || (index === samples.length - 1 && connections.endConnected)) {
        width *= 1.2;
      }
      return {
        x: center.x - minX,
        y: center.y - minY,
        width
      };
    });
    const simplified = detail === "low"
      ? simplifyRiverPoints(basePoints, size * 0.5, 0.8)
      : basePoints;
    const points = smoothRiverPoints(simplified, size, detail);
    const widths = points.map((point) => point.width);
    const bodyPath = buildRiverBandPath(points, 0);
    if (!bodyPath) {
      return [];
    }
    return [{
      id: river.id,
      riverId: river.id,
      riverName: river.name,
      bankPath: preview ? null : buildRiverBandPath(points, 3.2),
      bodyPath,
      highlightPath: preview ? null : centerPathFromPoints(points),
      centerPath: centerPathFromPoints(points),
      color,
      bankColor: "#9FCBD0",
      highlightColor: "#D8F2F6",
      opacity,
      preview,
      pointCount: points.length,
      outlineWidth: Math.max(1.2, Math.min(...widths) * 0.45),
      highlightWidth: Math.max(0.6, Math.min(1.8, Math.min(...widths) * 0.28)),
      widthRange: {
        min: Math.min(...widths),
        max: Math.max(...widths)
      },
      connectedStart: connections.startConnected,
      connectedEnd: connections.endConnected
    }];
  });
}

function buildRiverControlPoints(
  rivers: RiverFeature[],
  size: number,
  minX: number,
  minY: number,
  preview: boolean,
  clipRange?: CellRange
): MapScene["riverControlPoints"] {
  if (!preview) {
    return [];
  }
  const paddedClipRange = clipRange ? padRange(clipRange, 1) : null;
  return rivers.flatMap((river) => {
    const color = river.color ?? "#2F83B7";
    const opacity = river.opacity ?? 0.88;
    return river.points.flatMap((point, index) => {
      if (paddedClipRange && !isCoordInRange(point, paddedClipRange)) {
        return [];
      }
      const center = centerForCoord(point, size);
      const isStart = index === 0;
      const isEnd = index === river.points.length - 1;
      return [{
        id: `${river.id}-control-${index}`,
        riverId: river.id,
        riverName: river.name,
        x: center.x - minX,
        y: center.y - minY,
        radius: Math.max(4.2, size * 0.12),
        label: isStart ? "S" : isEnd ? "E" : String(index + 1),
        position: isStart ? "start" as const : isEnd ? "end" as const : "middle" as const,
        color,
        opacity,
        preview
      }];
    });
  });
}

export function buildMapScene(map: MapRuntimeState, options: MapRenderOptions = {}): MapScene {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const cells = resolved.includeUndesigned
    ? map.activeCells
    : map.activeCells.filter((cell) => cell.status === "designed");
  const renderRange = resolved.riverClipRange ?? rangeFromCells(cells);
  const rivers = renderRange
    ? filterRiversForRange(map.document.features?.rivers ?? [], renderRange)
    : map.document.features?.rivers ?? [];
  const previewRivers = renderRange
    ? filterRiversForRange(resolved.previewRivers, renderRange)
    : resolved.previewRivers;
  const allRivers = [...rivers, ...previewRivers];
  const riverCoordRange = renderRange ? padRange(renderRange, 1) : null;
  const riverCoords = allRivers.flatMap((river) =>
    expandRiverPath(river).filter((sample) => !riverCoordRange || isCoordInRange(sample, riverCoordRange))
  );
  const layout = buildHexLayout(cells, {
    size: resolved.size,
    padding: resolved.padding,
    extraCoords: riverCoords,
    boundsCoords: resolved.boundsCoords
  });
  return {
    width: layout.width,
    height: layout.height,
    minX: layout.minX,
    minY: layout.minY,
    background: resolved.background,
    layout: layout.layout,
    riverBodies: [
      ...buildRiverBodies(rivers, map.activeCells, resolved.size, layout.minX, layout.minY, false, renderRange ?? undefined, resolved.riverDetail),
      ...buildRiverBodies(previewRivers, map.activeCells, resolved.size, layout.minX, layout.minY, true, renderRange ?? undefined, "high")
    ],
    riverControlPoints: [
      ...buildRiverControlPoints(rivers, resolved.size, layout.minX, layout.minY, false, renderRange ?? undefined),
      ...buildRiverControlPoints(previewRivers, resolved.size, layout.minX, layout.minY, true, renderRange ?? undefined)
    ],
    defs: buildSvgDefs(),
    options: resolved
  };
}

function renderCell(scene: MapScene, entry: MapScene["layout"][number]): string {
  const { cell } = entry;
  const isSelected = scene.options.selectedCellId === cell.id;
  const isHovered = scene.options.hoveredCellId === cell.id;
  const fill = getTerrainColor(cell.terrain);
  const overlay = scene.options.usePatternOverlays ? buildPatternOverlay(cell.biome) : null;
  const stroke = buildCellStroke(cell, isSelected, isHovered);
  const opacity = buildCellOpacity(cell);
  const shorthand = scene.options.includeShorthand ? getCellShorthand(cell) : null;
  const primaryTag = getPrimaryTagSymbol(getPrimaryTag(cell));
  const gridStrokeWidth = scene.options.includeGrid ? 1.2 : 0.5;
  const gridStrokeOpacity = scene.options.includeGrid ? 0.9 : 0.3;
  const textFill = cell.status === "designed" ? "#1D1B18" : "#6F675D";
  const primaryTagText = primaryTag
    ? `<text x="${entry.centerX}" y="${entry.centerY - 16}" text-anchor="middle" font-size="9" font-weight="700" fill="#6B2F18">${escapeXml(primaryTag)}</text>`
    : "";
  const coordinateText = scene.options.includeCoordinates
    ? `<text x="${entry.centerX}" y="${entry.centerY - 3}" text-anchor="middle" font-size="9" font-weight="600" fill="${textFill}">${escapeXml(cell.display_coord)}</text>`
    : "";
  const shorthandText =
    shorthand && cell.status === "designed"
      ? `<text x="${entry.centerX}" y="${entry.centerY + 11}" text-anchor="middle" font-size="8.5" font-weight="500" fill="${textFill}">${escapeXml(shorthand)}</text>`
      : "";

  return [
    `<g data-cell-id="${cell.id}" data-status="${cell.status}">`,
    `<polygon points="${entry.points}" fill="${fill}" stroke="${stroke}" stroke-width="${gridStrokeWidth}" stroke-opacity="${gridStrokeOpacity}" opacity="${opacity}" />`,
    overlay
      ? `<polygon points="${entry.points}" fill="${overlay}" stroke="none" opacity="${cell.status === "designed" ? 0.9 : 0.5}" />`
      : "",
    primaryTagText,
    coordinateText,
    shorthandText,
    `</g>`
  ].join("");
}

export function renderSvgString(scene: MapScene): string {
  const defs = `<defs>${scene.defs.join("")}</defs>`;
  const cells = scene.layout.map((entry) => renderCell(scene, entry)).join("");
  const background =
    scene.background === "transparent"
      ? ""
      : `<rect width="100%" height="100%" fill="${escapeXml(scene.background)}" />`;
  const riverAttrs = (body: MapScene["riverBodies"][number], layer: string) =>
    `data-river-layer="${layer}" data-river-id="${escapeXml(body.riverId)}" data-river-name="${escapeXml(body.riverName)}"` +
    (body.preview ? ' data-river-preview="true"' : "") +
    (body.connectedStart ? ' data-river-connected-start="true"' : "") +
    (body.connectedEnd ? ' data-river-connected-end="true"' : "");
  const riverBanks = scene.riverBodies
    .map((body) =>
      body.bankPath
        ? `<path ${riverAttrs(body, "bank")} d="${body.bankPath}" fill="${escapeXml(body.bankColor)}" stroke="none" opacity="${Math.min(0.5, body.opacity * 0.42)}" />`
        : ""
    )
    .join("");
  const riverBodies = scene.riverBodies
    .map(
      (body) =>
        `<path ${riverAttrs(body, "body")} d="${body.bodyPath}" fill="${escapeXml(body.color)}" stroke="none" opacity="${body.preview ? Math.min(0.52, body.opacity * 0.66) : body.opacity}" />`
    )
    .join("");
  const riverHighlights = scene.riverBodies
    .map((body) =>
      body.highlightPath
        ? `<path ${riverAttrs(body, "highlight")} d="${body.highlightPath}" fill="none" stroke="${escapeXml(body.highlightColor)}" stroke-width="${body.highlightWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${Math.min(0.28, body.opacity * 0.3)}" />`
        : ""
    )
    .join("");
  const riverPreviews = scene.riverBodies
    .map((body) =>
      body.preview
        ? `<path ${riverAttrs(body, "preview-center")} d="${body.centerPath}" fill="none" stroke="${escapeXml(body.color)}" stroke-width="${Math.max(1.4, body.widthRange.max * 0.32)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7 5" opacity="${Math.min(0.82, body.opacity)}" />`
        : ""
    )
    .join("");
  const riverControlPoints = scene.riverControlPoints
    .map(
      (point) =>
        `<g data-river-control-point="${point.position}" data-river-id="${escapeXml(point.riverId)}"${point.preview ? ' data-river-preview="true"' : ""}>` +
        `<circle cx="${point.x}" cy="${point.y}" r="${point.radius}" fill="#F7FBFC" stroke="${point.color}" stroke-width="1.8" opacity="${Math.min(1, point.opacity + 0.08)}" />` +
        `<text x="${point.x}" y="${point.y + 2.5}" text-anchor="middle" font-size="7" font-weight="800" fill="${point.color}">${escapeXml(point.label)}</text>` +
        `</g>`
    )
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-label="MapDesigner export">`,
    defs,
    background,
    cells,
    riverBanks,
    riverBodies,
    riverHighlights,
    riverPreviews,
    riverControlPoints,
    `</svg>`
  ].join("");
}

export function buildExportScene(input: ExportSceneInput): MapScene {
  const boundsCoords = input.options.range
    ? [
        { row: input.options.range.minRow, col: input.options.range.minCol },
        { row: input.options.range.minRow, col: input.options.range.maxCol },
        { row: input.options.range.maxRow, col: input.options.range.minCol },
        { row: input.options.range.maxRow, col: input.options.range.maxCol }
      ]
    : undefined;
  return buildMapScene(input.map, {
    size: 36 * input.options.scale,
    padding: input.options.padding,
    background: input.options.background,
    usePatternOverlays: false,
    includeCoordinates: input.options.includeCoordinates,
    includeShorthand: input.options.includeShorthand,
    includeGrid: input.options.includeGrid,
    includeUndesigned: input.options.includeUndesigned,
    riverClipRange: input.options.range ?? undefined,
    boundsCoords
  });
}
