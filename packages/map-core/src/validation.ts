import { BIOME_KEYS, TAG_KEYS, TERRAIN_KEYS } from "./dictionaries.js";
import type {
  BiomeKey,
  DesignedCellRecord,
  GridCoordinate,
  MapDocument,
  TagKey,
  TerrainKey,
  ValidationIssue
} from "./types.js";

function issue(
  code: string,
  message: string,
  severity: ValidationIssue["severity"],
  target?: string
): ValidationIssue {
  return { code, message, severity, target };
}

export function isTerrainKey(value: unknown): value is TerrainKey {
  return typeof value === "string" && TERRAIN_KEYS.includes(value as TerrainKey);
}

export function isBiomeKey(value: unknown): value is BiomeKey {
  return typeof value === "string" && BIOME_KEYS.includes(value as BiomeKey);
}

export function isTagKey(value: unknown): value is TagKey {
  return typeof value === "string" && TAG_KEYS.includes(value as TagKey);
}

export function validateCoordinate(coord: GridCoordinate, target: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(coord.row)) {
    issues.push(issue("invalid_row", "row must be an integer", "invalid", `${target}.row`));
  }
  if (!Number.isInteger(coord.col)) {
    issues.push(issue("invalid_col", "col must be an integer", "invalid", `${target}.col`));
  }
  return issues;
}

export function validateTerrainBiomePair(
  terrain: TerrainKey,
  biome: BiomeKey | null,
  target = "cell"
): ValidationIssue[] {
  if (biome === null) {
    return [];
  }

  const issues: ValidationIssue[] = [];
  const invalid = (
    code: string,
    message: string
  ) => issues.push(issue(code, message, "invalid", `${target}.biome`));
  const warning = (
    code: string,
    message: string
  ) => issues.push(issue(code, message, "warning", `${target}.biome`));

  if (biome === "freshwater" && ["ocean", "sea", "reef"].includes(terrain)) {
    invalid("biome_freshwater_conflict", "freshwater cannot be used with ocean, sea, or reef terrain");
  }

  if (
    biome === "marine" &&
    ["plain", "hill", "mountain", "plateau", "dune", "badlands"].includes(terrain)
  ) {
    invalid("biome_marine_conflict", "marine cannot be used with clearly inland dry land terrain");
  }

  if (biome === "coral" && !["sea", "reef", "lagoon"].includes(terrain)) {
    invalid("biome_coral_conflict", "coral is only valid for sea, reef, or lagoon terrain");
  }

  if (biome === "seagrass" && !["sea", "coast", "lagoon", "estuary"].includes(terrain)) {
    invalid("biome_seagrass_conflict", "seagrass is only valid for sea, coast, lagoon, or estuary terrain");
  }

  if (
    biome === "mangrove" &&
    !["coast", "tidal_flat", "lagoon", "estuary", "delta"].includes(terrain)
  ) {
    invalid(
      "biome_mangrove_conflict",
      "mangrove is only valid for coast, tidal_flat, lagoon, estuary, or delta terrain"
    );
  }

  if (biome === "pack_ice" && !["ocean", "sea", "coast"].includes(terrain)) {
    invalid("biome_pack_ice_conflict", "pack_ice is only valid for ocean, sea, or coast terrain");
  }

  if (
    biome === "arid" &&
    ["ocean", "sea", "lake", "river", "lagoon"].includes(terrain)
  ) {
    invalid("biome_arid_conflict", "arid cannot be used with stable water terrains");
  }

  if (biome === "alpine" && ["plain", "alluvial_plain", "delta"].includes(terrain)) {
    warning("biome_alpine_warning", "alpine on obvious lowland terrain should be reviewed");
  }

  if (
    biome === "tropical_rainforest" &&
    ["glacier", "permafrost"].includes(terrain)
  ) {
    warning(
      "biome_tropical_rainforest_warning",
      "tropical_rainforest on glacier or permafrost should be reviewed"
    );
  }

  if (
    ["bog", "marsh", "swamp", "reedbed"].includes(biome) &&
    ["mountain", "canyon", "lava_field"].includes(terrain)
  ) {
    warning("biome_wet_highland_warning", "wetland biome on steep highland terrain should be reviewed");
  }

  if (biome === "bare" && ["wetland", "floodplain"].includes(terrain)) {
    warning("biome_bare_wet_warning", "bare on wet terrain is unusual and should be reviewed");
  }

  return issues;
}

export function validateDesignedCellRecord(
  cell: DesignedCellRecord,
  index = 0
): ValidationIssue[] {
  const issues = validateCoordinate(cell, `cells[${index}]`);
  if (!isTerrainKey(cell.terrain)) {
    issues.push(issue("invalid_terrain", "terrain must be a known terrain key", "invalid", `cells[${index}].terrain`));
  }
  if (cell.biome !== null && !isBiomeKey(cell.biome)) {
    issues.push(issue("invalid_biome", "biome must be null or a known biome key", "invalid", `cells[${index}].biome`));
  }
  if (!Array.isArray(cell.tags) || cell.tags.some((tag) => !isTagKey(tag))) {
    issues.push(issue("invalid_tags", "tags must all be known tag keys", "invalid", `cells[${index}].tags`));
  }
  if (typeof cell.note !== "string") {
    issues.push(issue("invalid_note", "note must be a string", "invalid", `cells[${index}].note`));
  }
  if (isTerrainKey(cell.terrain) && (cell.biome === null || isBiomeKey(cell.biome))) {
    issues.push(...validateTerrainBiomePair(cell.terrain, cell.biome, `cells[${index}]`));
  }
  return issues;
}

export function validateMapDocument(document: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!document || typeof document !== "object") {
    return [issue("invalid_document", "document must be an object", "invalid")];
  }

  const value = document as Partial<MapDocument>;
  if (value.schema_version !== 1) {
    issues.push(issue("invalid_schema_version", "schema_version must be 1", "invalid", "schema_version"));
  }

  if (!value.meta || typeof value.meta !== "object") {
    issues.push(issue("invalid_meta", "meta is required", "invalid", "meta"));
  } else {
    if (!value.meta.id) {
      issues.push(issue("invalid_meta_id", "meta.id is required", "invalid", "meta.id"));
    }
    if (!value.meta.name) {
      issues.push(issue("invalid_meta_name", "meta.name is required", "invalid", "meta.name"));
    }
    if (!Number.isInteger(value.meta.revision)) {
      issues.push(issue("invalid_revision", "meta.revision must be an integer", "invalid", "meta.revision"));
    }
  }

  if (!value.grid || typeof value.grid !== "object") {
    issues.push(issue("invalid_grid", "grid is required", "invalid", "grid"));
  } else {
    if (value.grid.layout !== "flat-top-even-q") {
      issues.push(issue("invalid_layout", "grid.layout must be flat-top-even-q", "invalid", "grid.layout"));
    }
    issues.push(...validateCoordinate(value.grid.origin ?? { row: NaN, col: NaN }, "grid.origin"));
    if (value.grid.origin && (value.grid.origin.row !== 0 || value.grid.origin.col !== 0)) {
      issues.push(issue("invalid_origin", "grid.origin must be R0C0", "invalid", "grid.origin"));
    }
  }

  if (!Array.isArray(value.cells)) {
    issues.push(issue("invalid_cells", "cells must be an array", "invalid", "cells"));
  } else {
    const seen = new Set<string>();
    value.cells.forEach((cell, index) => {
      issues.push(...validateDesignedCellRecord(cell, index));
      const key = `${cell.row},${cell.col}`;
      if (seen.has(key)) {
        issues.push(issue("duplicate_cell", "duplicate coordinates are not allowed", "invalid", `cells[${index}]`));
      }
      seen.add(key);
    });
  }

  return issues;
}
