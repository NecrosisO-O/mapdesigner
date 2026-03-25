import { buildHexLayout } from "./layout.js";
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
import type { MapRuntimeState } from "@mapdesigner/map-core";

const DEFAULT_OPTIONS: Required<MapRenderOptions> = {
  size: 36,
  padding: 48,
  background: "#F4F0E6",
  includeCoordinates: true,
  includeShorthand: false,
  includeGrid: true,
  includeUndesigned: true,
  selectedCellId: null,
  hoveredCellId: null
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildMapScene(map: MapRuntimeState, options: MapRenderOptions = {}): MapScene {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const cells = resolved.includeUndesigned
    ? map.activeCells
    : map.activeCells.filter((cell) => cell.status === "designed");
  const layout = buildHexLayout(cells, {
    size: resolved.size,
    padding: resolved.padding
  });
  return {
    width: layout.width,
    height: layout.height,
    minX: layout.minX,
    minY: layout.minY,
    background: resolved.background,
    layout: layout.layout,
    defs: buildSvgDefs(),
    options: resolved
  };
}

function renderCell(scene: MapScene, entry: MapScene["layout"][number]): string {
  const { cell } = entry;
  const isSelected = scene.options.selectedCellId === cell.id;
  const isHovered = scene.options.hoveredCellId === cell.id;
  const fill = getTerrainColor(cell.terrain);
  const overlay = buildPatternOverlay(cell.biome);
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
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" role="img" aria-label="MapDesigner export">`,
    defs,
    `<rect width="100%" height="100%" fill="${scene.background}" />`,
    cells,
    `</svg>`
  ].join("");
}

export function buildExportScene(input: ExportSceneInput): MapScene {
  return buildMapScene(input.map, {
    size: 36 * input.options.scale,
    padding: input.options.padding,
    background: input.options.background,
    includeCoordinates: input.options.includeCoordinates,
    includeShorthand: input.options.includeShorthand,
    includeGrid: input.options.includeGrid,
    includeUndesigned: input.options.includeUndesigned
  });
}
