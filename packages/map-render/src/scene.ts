import { buildHexLayout, centerForCoord } from "./layout.js";
import { buildSvgDefs } from "./styles.js";
import { escapeXml, renderCellSurface, renderCellAnnotations } from "./presentation.js";
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
  mapStyle: "classic-v1",
  includeTerrain: true,
  includeTerrainSymbols: true,
  includeBiomes: true,
  includeRivers: true,
  includeTags: true,
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
  return (
    coord.row >= range.minRow &&
    coord.row <= range.maxRow &&
    coord.col >= range.minCol &&
    coord.col <= range.maxCol
  );
}

function doRangesOverlap(left: CellRange, right: CellRange): boolean {
  return (
    left.minRow <= right.maxRow &&
    left.maxRow >= right.minRow &&
    left.minCol <= right.maxCol &&
    left.maxCol >= right.minCol
  );
}

const riverSamplesCache = new Map<string, ReturnType<typeof expandRiverPath>>();
let cachedSampleCount = 0;
function riverSamples(river: RiverFeature): ReturnType<typeof expandRiverPath> {
  const key = JSON.stringify(river),
    hit = riverSamplesCache.get(key);
  if (hit) {
    riverSamplesCache.delete(key);
    riverSamplesCache.set(key, hit);
    return hit;
  }
  const samples = expandRiverPath(river);
  if (samples.length <= 100_000) {
    while (
      riverSamplesCache.size &&
      (cachedSampleCount + samples.length > 100_000 || riverSamplesCache.size >= 128)
    ) {
      const oldest = riverSamplesCache.keys().next().value!;
      cachedSampleCount -= riverSamplesCache.get(oldest)!.length;
      riverSamplesCache.delete(oldest);
    }
    riverSamplesCache.set(key, samples);
    cachedSampleCount += samples.length;
  }
  return samples;
}
function coordRangeForRiver(river: RiverFeature): CellRange | null {
  return rangeFromCoords(river.points);
}
function rangeFromCoords(points: Array<{ row: number; col: number }>): CellRange | null {
  if (!points.length) return null;
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  for (const point of points) {
    minRow = Math.min(minRow, point.row);
    maxRow = Math.max(maxRow, point.row);
    minCol = Math.min(minCol, point.col);
    maxCol = Math.max(maxCol, point.col);
  }
  return { minRow, maxRow, minCol, maxCol };
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
  return rangeFromCoords(cells);
}

export function filterRiversForRange(
  rivers: RiverFeature[],
  range: CellRange,
  padding = 1
): RiverFeature[] {
  const padded = padRange(range, padding);
  return rivers.filter((river) => {
    const riverRange = coordRangeForRiver(river);
    return riverRange ? doRangesOverlap(riverRange, padded) : false;
  });
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

function perpendicularDistance(
  point: RiverRenderPoint,
  start: RiverRenderPoint,
  end: RiverRenderPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return distanceBetween(point, start);
  }
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function simplifyRiverPoints(
  points: RiverRenderPoint[],
  tolerance: number,
  widthTolerance: number
): RiverRenderPoint[] {
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
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: interpolate(p0.x, p1.x, p2.x, p3.x),
    y: interpolate(p0.y, p1.y, p2.y, p3.y),
    width: interpolate(p0.width, p1.width, p2.width, p3.width)
  };
}

function smoothRiverPoints(
  points: RiverRenderPoint[],
  size: number,
  detail: "high" | "low"
): RiverRenderPoint[] {
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
    const steps =
      detail === "low"
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
    ...right
      .slice(0, -1)
      .reverse()
      .map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`),
    `Q ${formatNumber(start.x)} ${formatNumber(start.y)} ${formatNumber(left[0]!.x)} ${formatNumber(left[0]!.y)}`,
    "Z"
  ].join(" ");
}

// Cull whole, adjacent segments of the canonical curve. Keeping their outside
// vertices preserves tangents; separate visits to the viewport remain separate.
function visibleRiverRuns(points: RiverRenderPoint[], range: CellRange | undefined, size: number) {
  if (!range) return [{ start: 0, end: points.length - 1 }];
  const width = points.reduce((max, point) => Math.max(max, point.width), 0);
  const padded = padRange(range, 2 + Math.ceil(width / (size * 1.5)));
  const axial = points.map((point) => {
    const col = point.x / (size * 1.5);
    return { col, row: -point.y / (size * Math.sqrt(3)) - col / 2 };
  });
  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 1; i < points.length; i++) {
    const a = axial[i - 1]!,
      b = axial[i]!;
    const visible = doRangesOverlap(
      {
        minRow: Math.min(a.row, b.row),
        maxRow: Math.max(a.row, b.row),
        minCol: Math.min(a.col, b.col),
        maxCol: Math.max(a.col, b.col)
      },
      padded
    );
    if (visible && start < 0) start = i - 1;
    if (!visible && start >= 0) {
      runs.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: points.length - 1 });
  return runs;
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
  return rivers.flatMap((river) => {
    const samples = riverSamples(river);
    if (samples.length < 2) {
      return [];
    }
    const color = river.color ?? "#2F83B7";
    const opacity = river.opacity ?? 0.88;
    const connections = getRiverEndpointConnections(river, cells);
    const basePoints = samples.map((sample, index) => {
      const center = centerForCoord(sample, size);
      let width = sample.width;
      if (
        (index === 0 && connections.startConnected) ||
        (index === samples.length - 1 && connections.endConnected)
      ) {
        width *= 1.2;
      }
      return {
        x: center.x,
        y: center.y,
        width
      };
    });
    const simplified =
      detail === "low" ? simplifyRiverPoints(basePoints, size * 0.5, 0.8) : basePoints;
    const canonical = smoothRiverPoints(simplified, size, detail);
    return visibleRiverRuns(canonical, clipRange, size).flatMap((run) => {
      const points = canonical
        .slice(run.start, run.end + 1)
        .map((point) => ({ ...point, x: point.x - minX, y: point.y - minY }));
      let minWidth = Infinity,
        maxWidth = -Infinity;
      for (const point of points) {
        minWidth = Math.min(minWidth, point.width);
        maxWidth = Math.max(maxWidth, point.width);
      }
      const bodyPath = buildRiverBandPath(points, 0);
      if (!bodyPath) {
        return [];
      }
      return [
        {
          id: run.start === 0 ? river.id : river.id + "-fragment-" + run.start,
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
          outlineWidth: Math.max(1.2, minWidth * 0.45),
          highlightWidth: Math.max(0.6, Math.min(1.8, minWidth * 0.28)),
          widthRange: {
            min: minWidth,
            max: maxWidth
          },
          connectedStart: run.start === 0 && connections.startConnected,
          connectedEnd: run.end === canonical.length - 1 && connections.endConnected
        }
      ];
    });
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
      return [
        {
          id: `${river.id}-control-${index}`,
          riverId: river.id,
          riverName: river.name,
          x: center.x - minX,
          y: center.y - minY,
          radius: Math.max(4.2, size * 0.12),
          label: isStart ? "S" : isEnd ? "E" : String(index + 1),
          position: isStart ? ("start" as const) : isEnd ? ("end" as const) : ("middle" as const),
          color,
          opacity,
          preview
        }
      ];
    });
  });
}

export function buildMapScene(map: MapRuntimeState, options: MapRenderOptions = {}): MapScene {
  const resolved: ResolvedMapRenderOptions = {
    ...DEFAULT_OPTIONS,
    mapStyle: map.document.meta.map_style ?? "classic-v1",
    ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
  };
  const cells = resolved.includeUndesigned
    ? map.activeCells
    : map.activeCells.filter((cell) => cell.status === "designed");
  const renderRange = resolved.riverClipRange ?? rangeFromCells(cells);
  const rivers = !resolved.includeRivers
    ? []
    : renderRange
      ? filterRiversForRange(map.document.features?.rivers ?? [], renderRange)
      : (map.document.features?.rivers ?? []);
  const previewRivers = renderRange
    ? filterRiversForRange(resolved.previewRivers, renderRange)
    : resolved.previewRivers;
  const allRivers = [...rivers, ...previewRivers];
  const riverCoordRange = renderRange ? padRange(renderRange, 1) : null;
  const riverCoords = allRivers.flatMap((river) =>
    riverSamples(river).filter(
      (sample) => !riverCoordRange || isCoordInRange(sample, riverCoordRange)
    )
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
      ...buildRiverBodies(
        rivers,
        map.activeCells,
        resolved.size,
        layout.minX,
        layout.minY,
        false,
        renderRange ?? undefined,
        resolved.riverDetail
      ),
      ...buildRiverBodies(
        previewRivers,
        map.activeCells,
        resolved.size,
        layout.minX,
        layout.minY,
        true,
        renderRange ?? undefined,
        "high"
      )
    ],
    riverControlPoints: [
      ...buildRiverControlPoints(
        rivers,
        resolved.size,
        layout.minX,
        layout.minY,
        false,
        renderRange ?? undefined
      ),
      ...buildRiverControlPoints(
        previewRivers,
        resolved.size,
        layout.minX,
        layout.minY,
        true,
        renderRange ?? undefined
      )
    ],
    defs: buildSvgDefs(resolved.mapStyle),
    options: resolved
  };
}

export function renderRiverLayers(scene: MapScene): string {
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
  return [riverBanks, riverBodies, riverHighlights, riverPreviews, riverControlPoints].join("");
}

export function renderSvgString(scene: MapScene): string {
  const background =
    scene.background === "transparent"
      ? ""
      : '<rect width="100%" height="100%" fill="' + escapeXml(scene.background) + '" />';
  const surfaces = scene.layout.map((entry) => renderCellSurface(entry, scene.options)).join("");
  const labels = scene.layout.map((entry) => renderCellAnnotations(entry, scene.options)).join("");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    scene.width +
    '" height="' +
    scene.height +
    '" viewBox="0 0 ' +
    scene.width +
    " " +
    scene.height +
    '" role="img" aria-label="MapDesigner export"><defs>' +
    scene.defs.join("") +
    "</defs>" +
    background +
    surfaces +
    renderRiverLayers(scene) +
    labels +
    "</svg>"
  );
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
    usePatternOverlays: true,
    includeCoordinates: input.options.includeCoordinates,
    includeShorthand: input.options.includeShorthand,
    includeGrid: input.options.includeGrid,
    includeUndesigned: input.options.includeUndesigned,
    riverClipRange: input.options.range ?? undefined,
    boundsCoords
  });
}
