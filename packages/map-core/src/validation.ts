import { BIOME_KEYS, TAG_KEYS, TERRAIN_KEYS } from "./dictionaries.js";
import { MAX_RIVER_WIDTH, MIN_RIVER_WIDTH } from "./rivers.js";
import type {
  BiomeKey,
  DesignedCellRecord,
  GridCoordinate,
  MapDocument,
  RiverFeature,
  RiverPoint,
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

export function isRiverId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
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

export function validateRiverPoint(point: RiverPoint, target: string): ValidationIssue[] {
  const issues = validateCoordinate(point, target);
  if (
    point.width !== undefined &&
    point.width !== null &&
    (typeof point.width !== "number" || !Number.isFinite(point.width) || point.width < MIN_RIVER_WIDTH || point.width > MAX_RIVER_WIDTH)
  ) {
    issues.push(
      issue(
        "invalid_river_width",
        `river width must be a number between ${MIN_RIVER_WIDTH} and ${MAX_RIVER_WIDTH}`,
        "invalid",
        `${target}.width`
      )
    );
  }
  return issues;
}

export function validateRiverFeature(river: RiverFeature, index = 0): ValidationIssue[] {
  const target = `features.rivers[${index}]`;
  const issues: ValidationIssue[] = [];
  if (!isRiverId(river.id)) {
    issues.push(
      issue(
        "invalid_river_id",
        "river id may only contain letters, numbers, underscores, and dashes, and must be 1-64 characters",
        "invalid",
        `${target}.id`
      )
    );
  }
  if (typeof river.name !== "string" || !river.name.trim()) {
    issues.push(issue("invalid_river_name", "river name must be a non-empty string", "invalid", `${target}.name`));
  }
  if (!Array.isArray(river.points)) {
    issues.push(issue("invalid_river_points", "river points must be an array", "invalid", `${target}.points`));
  } else {
    if (river.points.length < 2) {
      issues.push(issue("invalid_river_points", "river requires at least two points", "invalid", `${target}.points`));
    }
    river.points.forEach((point, pointIndex) => {
      issues.push(...validateRiverPoint(point, `${target}.points[${pointIndex}]`));
      const previous = river.points[pointIndex - 1];
      if (previous && previous.row === point.row && previous.col === point.col) {
        issues.push(
          issue(
            "duplicate_river_point",
            "consecutive river points cannot use the same coordinate",
            "invalid",
            `${target}.points[${pointIndex}]`
          )
        );
      }
    });
  }
  if (river.color !== undefined && river.color !== null && !isHexColor(river.color)) {
    issues.push(issue("invalid_river_color", "river color must be a #RRGGBB color", "invalid", `${target}.color`));
  }
  if (
    river.opacity !== undefined &&
    river.opacity !== null &&
    (typeof river.opacity !== "number" || !Number.isFinite(river.opacity) || river.opacity < 0.1 || river.opacity > 1)
  ) {
    issues.push(issue("invalid_river_opacity", "river opacity must be between 0.1 and 1", "invalid", `${target}.opacity`));
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

  if (value.features !== undefined) {
    if (!value.features || typeof value.features !== "object") {
      issues.push(issue("invalid_features", "features must be an object", "invalid", "features"));
    } else if (value.features.rivers !== undefined) {
      if (!Array.isArray(value.features.rivers)) {
        issues.push(issue("invalid_rivers", "features.rivers must be an array", "invalid", "features.rivers"));
      } else {
        const seenRiverIds = new Set<string>();
        value.features.rivers.forEach((river, index) => {
          issues.push(...validateRiverFeature(river, index));
          if (seenRiverIds.has(river.id)) {
            issues.push(issue("duplicate_river", "duplicate river ids are not allowed", "invalid", `features.rivers[${index}]`));
          }
          seenRiverIds.add(river.id);
        });
      }
    }
  }

  return issues;
}
