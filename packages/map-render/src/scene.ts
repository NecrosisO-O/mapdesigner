import { buildHexLayout, centerForCoord } from "./layout.js";
import { buildSvgDefs } from "./styles.js";
import { riverGeometry, riverBandPath } from "./river-geometry.js";
import { buildWaterGeometry, riverWaterTransitions, waterCellLookup } from "./water.js";
import { paintRiverWater } from "./river-paint.js";
import { escapeXml, renderCellSurface, renderCellAnnotations } from "./presentation.js";
import type { ExportSceneInput, MapRenderOptions, MapScene } from "./types.js";
import {
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
  return rivers.filter((river) => {
    const width = Math.max(4, ...river.points.map((point) => point.width ?? 4));
    const padded = padRange(range, padding + Math.ceil(width / 54));
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

function centerPathFromPoints(points: RiverRenderPoint[]): string {
  if (points.length === 0) {
    return "";
  }
  return [
    `M ${formatNumber(points[0]!.x)} ${formatNumber(points[0]!.y)}`,
    ...points.slice(1).map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`)
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
  const isWater = waterCellLookup(cells);
  const parent = new Map(rivers.map((r) => [r.id, r.id]));
  function root(id: string): string {
    const p = parent.get(id)!;
    if (p !== id) parent.set(id, root(p));
    return parent.get(id)!;
  }
  const junctions = new Map<string, string>();
  for (const river of rivers)
    for (const point of river.points)
      if (point.junction_id) {
        const prior = junctions.get(point.junction_id);
        if (prior) parent.set(root(river.id), root(prior));
        else junctions.set(point.junction_id, river.id);
      }
  return rivers.flatMap((river) => {
    const geometry = riverWaterTransitions(riverGeometry(river, detail), river, isWater);
    if (geometry.length < 2) return [];
    const color = river.color ?? "#2F83B7";
    const opacity = river.opacity ?? 0.88;
    const connections = getRiverEndpointConnections(river, cells);
    const scale = size / 36;
    const canonical = geometry.map((point) => ({
      ...point,
      x: point.x * scale,
      y: point.y * scale,
      width: point.width * scale
    }));
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
      const bodyPath = riverBandPath(points, 0);
      if (!bodyPath) {
        return [];
      }
      return [
        {
          id: run.start === 0 ? river.id : river.id + "-fragment-" + run.start,
          riverId: river.id,
          networkId: root(river.id),
          riverName: river.name,
          bankPath: preview ? null : riverBandPath(points, 3.2 * scale),
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
    river.points.filter((sample) => !riverCoordRange || isCoordInRange(sample, riverCoordRange))
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
    water: buildWaterGeometry(layout.layout),
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
  const water = paintRiverWater(scene);
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
  return [water, riverPreviews, riverControlPoints].join("");
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
