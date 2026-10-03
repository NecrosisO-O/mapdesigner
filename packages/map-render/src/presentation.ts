import {
  isOpenWaterTerrain,
  getAllowedBiomesForTerrain,
  TERRAIN_KEYS,
  TAG_ENTRIES,
  PRIMARY_TAG_PRIORITY,
  type ActiveCell,
  type MapStyle,
  type TerrainKey,
  type BiomeKey,
  type TagKey
} from "@mapdesigner/map-core";
import { buildHexLayout } from "./layout.js";
import {
  getTerrainColor,
  buildPatternOverlay,
  buildCellOpacity,
  getCellShorthand,
  buildSvgDefs,
  getBiomePatternId
} from "./styles.js";
import { TERRAIN_SYMBOLS, TAG_SYMBOLS } from "./symbols.js";
import type { HexCellLayout, MapRenderOptions } from "./types.js";

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function luminance(color: string) {
  const rgb = [1, 3, 5]
    .map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

export function getMapTextStyle(fill: string): { ink: string; halo: string } {
  const dark = luminance(fill) < 0.24;
  return { ink: dark ? "#FAF9F3" : "#25362F", halo: dark ? "#273E46" : "#F6F5EA" };
}

export function renderCellSurface(
  entry: HexCellLayout,
  options: MapRenderOptions,
  sample = false
): string {
  const { cell, points, centerX: x, centerY: y } = entry;
  const style = options.mapStyle ?? "classic-v1";
  const fill = options.includeTerrain === false ? "#EEEDE5" : getTerrainColor(cell.terrain, style);
  const pattern =
    options.usePatternOverlays !== false && options.includeBiomes !== false
      ? buildPatternOverlay(cell.biome, style, options.size ?? 36)
      : null;
  const symbol =
    options.includeTerrain !== false &&
    options.includeTerrainSymbols !== false &&
    cell.terrain &&
    style === "atlas-v1"
      ? TERRAIN_SYMBOLS[cell.terrain]
      : null;
  const hash = Math.abs((cell.row * 73856093) ^ (cell.col * 19349663));
  const scale = (options.size ?? 36) / 36;
  const ink = getMapTextStyle(fill).ink;
  return (
    '<g opacity="' +
    buildCellOpacity(cell) +
    '"><polygon points="' +
    points +
    '" fill="' +
    fill +
    '" stroke="' +
    (options.includeGrid !== false ? "#59675B" : fill) +
    '" stroke-width="' +
    (options.includeGrid !== false ? 0.8 : 1.05) * scale +
    '" stroke-opacity="' +
    (options.includeGrid !== false ? (isOpenWaterTerrain(cell.terrain) ? 0.16 : 0.38) : 1) +
    '"/>' +
    (pattern ? '<polygon points="' + points + '" fill="' + pattern + '"/>' : "") +
    (symbol && (sample || hash % 4 !== 0)
      ? '<path d="' +
        symbol +
        '" transform="translate(' +
        (x + (sample ? 0 : (hash % 5) - 2) * scale) +
        " " +
        (y - 2 * scale) +
        ") scale(" +
        scale * 0.75 +
        ')" fill="none" stroke="' +
        ink +
        '" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity=".65"/>'
      : "") +
    "</g>"
  );
}

/** Labels and feature badges are a separate, topmost map layer. */
export function renderCellAnnotations(entry: HexCellLayout, options: MapRenderOptions): string {
  const { cell, centerX: x, centerY: y } = entry;
  const style = options.mapStyle ?? "classic-v1";
  const { ink, halo } = getMapTextStyle(getTerrainColor(cell.terrain, style));
  const scale = (options.size ?? 36) / 36;
  const text = (value: string, dy: number, size: number) =>
    '<text x="' +
    x +
    '" y="' +
    (y + dy * scale) +
    '" text-anchor="middle" font-family="sans-serif" font-size="' +
    size * scale +
    '" font-weight="600" fill="' +
    ink +
    '" stroke="' +
    halo +
    '" stroke-width="' +
    2.5 * scale +
    '" paint-order="stroke" stroke-linejoin="round">' +
    escapeXml(value) +
    "</text>";
  const tags = [...cell.tags].sort((a, b) => {
    const rank = (tag: TagKey) => {
      const index = PRIMARY_TAG_PRIORITY.indexOf(tag);
      return index < 0 ? 99 : index;
    };
    return rank(a) - rank(b);
  });
  const badges =
    options.includeTags === false
      ? ""
      : tags
          .slice(0, 2)
          .map((tag, i) => {
            if (style === "classic-v1") return text(TAG_ENTRIES[tag].short, -17 + i * 10, 8);
            const cx = x + (i - (Math.min(tags.length, 2) - 1) / 2) * 20 * scale;
            return (
              '<g transform="translate(' +
              cx +
              " " +
              (y - 17 * scale) +
              ") scale(" +
              scale * 0.8 +
              ')"><title>' +
              escapeXml(tags.map((t) => TAG_ENTRIES[t].label).join("、")) +
              '</title><circle r="10" fill="' +
              halo +
              '" opacity=".92"/><path d="' +
              TAG_SYMBOLS[tag] +
              '" fill="none" stroke="' +
              ink +
              '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></g>'
            );
          })
          .join("") + (tags.length > 2 ? text("+" + (tags.length - 2), 0, 8) : "");
  const shorthand = options.includeShorthand ? getCellShorthand(cell) : null;
  return (
    badges +
    (options.includeCoordinates ? text(cell.display_coord, shorthand ? 16 : 22, 9.5) : "") +
    (shorthand ? text(shorthand, 27, 8) : "")
  );
}

/** The library, compact legend and exported key share the same sample renderer. */
export function renderMaterialSvg(
  terrain: TerrainKey,
  biome: BiomeKey | null = null,
  tags: TagKey[] = [],
  mapStyle: MapStyle = "atlas-v1"
): string {
  // A standalone ecology swatch must use a compatible ground, e.g. freshwater on water.
  if (biome && !getAllowedBiomesForTerrain(terrain).includes(biome)) {
    terrain =
      TERRAIN_KEYS.find((key) => getAllowedBiomesForTerrain(key).includes(biome)) ?? terrain;
  }
  const cell: ActiveCell = {
    id: "sample",
    display_coord: "",
    row: 0,
    col: 0,
    terrain,
    biome,
    tags,
    note: "",
    status: "designed"
  };
  const layout = buildHexLayout([cell], { size: 28, padding: 4 });
  const options: MapRenderOptions = { size: 28, mapStyle, includeGrid: false };
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    layout.width +
    " " +
    layout.height +
    '" aria-hidden="true"><defs>' +
    buildSvgDefs(mapStyle, 28, layout.minX, layout.minY)
      .filter((def) => biome && def.includes('id="' + getBiomePatternId(biome, mapStyle, 28) + '"'))
      .join("") +
    "</defs>" +
    renderCellSurface(layout.layout[0]!, options, true) +
    renderCellAnnotations(layout.layout[0]!, options) +
    "</svg>"
  );
}
