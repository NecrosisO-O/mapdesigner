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
  type MapRuntimeState,
  type RiverFeature
} from "@mapdesigner/map-core";

const DEFAULT_OPTIONS: Required<Omit<MapRenderOptions, "previewRivers">> & { previewRivers: RiverFeature[] } = {
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
  previewRivers: []
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildRiverSegments(
  rivers: RiverFeature[],
  size: number,
  minX: number,
  minY: number,
  preview: boolean
): MapScene["riverSegments"] {
  return rivers.flatMap((river) => {
    const samples = expandRiverPath(river);
    const color = river.color ?? "#2F83B7";
    const opacity = river.opacity ?? 0.88;
    const segments: MapScene["riverSegments"] = [];
    for (let index = 0; index < samples.length - 1; index += 1) {
      const start = samples[index]!;
      const end = samples[index + 1]!;
      const startCenter = centerForCoord(start, size);
      const endCenter = centerForCoord(end, size);
      segments.push({
        id: `${river.id}-${index}`,
        riverId: river.id,
        riverName: river.name,
        x1: startCenter.x - minX,
        y1: startCenter.y - minY,
        x2: endCenter.x - minX,
        y2: endCenter.y - minY,
        width: (start.width + end.width) / 2,
        color,
        opacity,
        preview
      });
    }
    return segments;
  });
}

function buildRiverEndpoints(
  rivers: RiverFeature[],
  cells: ActiveCell[],
  size: number,
  minX: number,
  minY: number,
  preview: boolean
): MapScene["riverEndpoints"] {
  return rivers.flatMap((river) => {
    const connections = getRiverEndpointConnections(river, cells);
    const color = river.color ?? "#2F83B7";
    const opacity = river.opacity ?? 0.88;
    return [
      connections.startConnected && river.points[0]
        ? { point: river.points[0], position: "start" as const }
        : null,
      connections.endConnected && river.points[river.points.length - 1]
        ? { point: river.points[river.points.length - 1]!, position: "end" as const }
        : null
    ]
      .filter((entry): entry is { point: RiverFeature["points"][number]; position: "start" | "end" } => Boolean(entry))
      .map((entry) => {
        const center = centerForCoord(entry.point, size);
        return {
          id: `${river.id}-${entry.position}-water`,
          riverId: river.id,
          riverName: river.name,
          x: center.x - minX,
          y: center.y - minY,
          radius: Math.max((entry.point.width ?? 4) * 0.9, 4),
          color,
          opacity,
          position: entry.position,
          kind: "water" as const,
          preview
        };
      });
  });
}

function buildRiverControlPoints(
  rivers: RiverFeature[],
  size: number,
  minX: number,
  minY: number,
  preview: boolean
): MapScene["riverControlPoints"] {
  if (!preview) {
    return [];
  }
  return rivers.flatMap((river) => {
    const color = river.color ?? "#2F83B7";
    const opacity = river.opacity ?? 0.88;
    return river.points.map((point, index) => {
      const center = centerForCoord(point, size);
      const isStart = index === 0;
      const isEnd = index === river.points.length - 1;
      return {
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
      };
    });
  });
}

export function buildMapScene(map: MapRuntimeState, options: MapRenderOptions = {}): MapScene {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const cells = resolved.includeUndesigned
    ? map.activeCells
    : map.activeCells.filter((cell) => cell.status === "designed");
  const rivers = map.document.features?.rivers ?? [];
  const previewRivers = resolved.previewRivers;
  const allRivers = [...rivers, ...previewRivers];
  const riverCoords = allRivers.flatMap((river) => expandRiverPath(river));
  const layout = buildHexLayout(cells, {
    size: resolved.size,
    padding: resolved.padding,
    extraCoords: riverCoords
  });
  return {
    width: layout.width,
    height: layout.height,
    minX: layout.minX,
    minY: layout.minY,
    background: resolved.background,
    layout: layout.layout,
    riverSegments: [
      ...buildRiverSegments(rivers, resolved.size, layout.minX, layout.minY, false),
      ...buildRiverSegments(previewRivers, resolved.size, layout.minX, layout.minY, true)
    ],
    riverEndpoints: [
      ...buildRiverEndpoints(rivers, map.activeCells, resolved.size, layout.minX, layout.minY, false),
      ...buildRiverEndpoints(previewRivers, map.activeCells, resolved.size, layout.minX, layout.minY, true)
    ],
    riverControlPoints: [
      ...buildRiverControlPoints(rivers, resolved.size, layout.minX, layout.minY, false),
      ...buildRiverControlPoints(previewRivers, resolved.size, layout.minX, layout.minY, true)
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
  const riverSegments = scene.riverSegments
    .map(
      (segment) =>
        `<g data-river-id="${escapeXml(segment.riverId)}" data-river-name="${escapeXml(segment.riverName)}"${segment.preview ? ' data-river-preview="true"' : ""}>` +
        `<line x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}" stroke="#EAF8FC" stroke-width="${segment.width + 2.2}" stroke-linecap="round" opacity="${Math.min(0.9, segment.opacity)}"${segment.preview ? ' stroke-dasharray="7 5"' : ""} />` +
        `<line x1="${segment.x1}" y1="${segment.y1}" x2="${segment.x2}" y2="${segment.y2}" stroke="${segment.color}" stroke-width="${segment.width}" stroke-linecap="round" opacity="${segment.opacity}"${segment.preview ? ' stroke-dasharray="7 5"' : ""} />` +
        `</g>`
    )
    .join("");
  const riverEndpoints = scene.riverEndpoints
    .map(
      (endpoint) =>
        `<circle data-river-endpoint="${endpoint.kind}" data-river-id="${escapeXml(endpoint.riverId)}"${endpoint.preview ? ' data-river-preview="true"' : ""} cx="${endpoint.x}" cy="${endpoint.y}" r="${endpoint.radius}" fill="${endpoint.color}" stroke="#EAF8FC" stroke-width="2" opacity="${Math.min(1, endpoint.opacity + 0.08)}" />`
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
    riverSegments,
    riverEndpoints,
    riverControlPoints,
    `</svg>`
  ].join("");
}

export function buildExportScene(input: ExportSceneInput): MapScene {
  return buildMapScene(input.map, {
    size: 36 * input.options.scale,
    padding: input.options.padding,
    background: input.options.background,
    usePatternOverlays: false,
    includeCoordinates: input.options.includeCoordinates,
    includeShorthand: input.options.includeShorthand,
    includeGrid: input.options.includeGrid,
    includeUndesigned: input.options.includeUndesigned
  });
}
