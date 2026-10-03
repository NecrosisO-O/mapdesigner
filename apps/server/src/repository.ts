import {
  createCellId,
  createDisplayCoord,
  createEmptyDocument,
  expandRiverPath,
  getNeighborCoords,
  normalizeDocument,
  parseDocument,
  type ActiveCell,
  type CellRange,
  type CellRangeResult,
  type DesignedCellRecord,
  type GridConfig,
  type HistorySource,
  type MapBounds,
  type MapCommand,
  type MapDocument,
  type MapFeaturePage,
  type MapFeatures,
  type MapMeta,
  type MapSummary,
  type RiverFeature
} from "@mapdesigner/map-core";
import type Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { MAP_STORAGE_DIR } from "./config.js";
import { getDatabase } from "./db.js";
import { badRequest, notFound, storageError } from "./errors.js";
import { assertSafeMapId, mapFilePath, writeFileAtomicStream } from "./storage.js";
import { createMapId } from "./utils.js";

interface MapRow {
  id: string;
  name: string;
  description: string;
  tags_json: string;
  layout: GridConfig["layout"];
  schema_version: 1;
  created_at: string;
  updated_at: string;
  revision: number;
  bounds_min_row: number | null;
  bounds_max_row: number | null;
  bounds_min_col: number | null;
  bounds_max_col: number | null;
  designed_cell_count: number;
  history_cursor: number;
}

interface CellRow {
  map_id: string;
  row: number;
  col: number;
  terrain: DesignedCellRecord["terrain"];
  biome: DesignedCellRecord["biome"];
  tags_json: string;
  note: string;
}

interface FeatureRow {
  map_id: string;
  kind: string;
  feature_id: string;
  json: string;
  bounds_min_row: number | null;
  bounds_max_row: number | null;
  bounds_min_col: number | null;
  bounds_max_col: number | null;
}

interface OperationRow {
  map_id: string;
  seq: number;
  source: HistorySource;
  action: string;
  command_json: string;
  inverse_json: string;
  summary_json: string;
  timestamp: string;
}

export interface MapListItem {
  id: string;
  name: string;
  fileName: string;
  updatedAt: string;
  revision: number;
  designedCellCount: number;
}

export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
  cursor: number;
  latest: number;
}

export interface HistoryEntry {
  seq: number;
  source: HistorySource;
  action: string;
  timestamp: string;
}

export interface MapHistory {
  status: HistoryStatus;
  entries: HistoryEntry[];
}

export interface StoredOperation {
  mapId: string;
  seq: number;
  source: HistorySource;
  action: string;
  commands: MapCommand[];
  inverseCommands: MapCommand[];
  summary: unknown;
  timestamp: string;
}

export interface OperationInput {
  source: HistorySource;
  action: string;
  commands: MapCommand[];
  inverseCommands: MapCommand[];
  summary: unknown;
}

export interface MapMetadataUpdate {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface CellWriteChange {
  row: number;
  col: number;
  cell: DesignedCellRecord | null;
}

export interface FeatureWriteChange {
  kind: "river";
  featureId: string;
  river: RiverFeature | null;
}

export interface FeaturePageOptions {
  limit?: number;
  offset?: number;
}

const MAX_LEGACY_IMPORT_FILE_BYTES = 32 * 1024 * 1024;
const DEFAULT_FEATURE_PAGE_LIMIT = 500;
const MAX_FEATURE_PAGE_LIMIT = 2_000;
const SQLITE_IMPORT_BATCH_SIZE = 1_000;

/** Prepare legacy I/O before opening a transaction. No asynchronous work may escape this callback. */
export async function withMapTransaction<T>(id: string, callback: () => T): Promise<T> {
  await ensureMapInDatabase(id);
  return getDatabase()
    .transaction(() => {
      const result = callback();
      if (result && typeof result === "object" && "then" in result) {
        throw new TypeError("map transaction callback must be synchronous");
      }
      return result;
    })
    .immediate();
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function serializeStringArray(value: string[]): string {
  return JSON.stringify(value);
}

function normalizeStringArray(value: string[]): string[] {
  return [...new Set(value)].sort();
}

function normalizeBounds(cells: DesignedCellRecord[]): MapBounds {
  const bounds: MapBounds = { min_row: null, max_row: null, min_col: null, max_col: null };
  for (const cell of cells) {
    bounds.min_row = bounds.min_row === null ? cell.row : Math.min(bounds.min_row, cell.row);
    bounds.max_row = bounds.max_row === null ? cell.row : Math.max(bounds.max_row, cell.row);
    bounds.min_col = bounds.min_col === null ? cell.col : Math.min(bounds.min_col, cell.col);
    bounds.max_col = bounds.max_col === null ? cell.col : Math.max(bounds.max_col, cell.col);
  }
  return bounds;
}

function mapRowToMeta(row: MapRow): MapMeta {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: safeJsonArray(row.tags_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    revision: row.revision
  };
}

function mapRowToGrid(row: MapRow): GridConfig {
  return {
    layout: row.layout,
    origin: { row: 0, col: 0 }
  };
}

function mapRowToBounds(row: MapRow): MapBounds {
  return {
    min_row: row.bounds_min_row,
    max_row: row.bounds_max_row,
    min_col: row.bounds_min_col,
    max_col: row.bounds_max_col
  };
}

function cellRowToDesignedCell(row: CellRow): DesignedCellRecord {
  return {
    row: row.row,
    col: row.col,
    terrain: row.terrain,
    biome: row.biome ?? null,
    tags: safeJsonArray(row.tags_json) as DesignedCellRecord["tags"],
    note: row.note
  };
}

function normalizeCellForExport(row: CellRow): DesignedCellRecord {
  return {
    row: row.row,
    col: row.col,
    terrain: row.terrain,
    biome: row.biome ?? null,
    tags: normalizeStringArray(safeJsonArray(row.tags_json)) as DesignedCellRecord["tags"],
    note: row.note ?? ""
  };
}

function normalizeRiverForExport(river: RiverFeature): RiverFeature {
  return {
    id: river.id,
    name: river.name,
    points: river.points.map((point) => ({
      row: point.row,
      col: point.col,
      ...(typeof point.width === "number" ? { width: point.width } : {})
    })),
    ...(river.color ? { color: river.color } : {}),
    ...(typeof river.opacity === "number" ? { opacity: river.opacity } : {})
  };
}

function designedCellToActiveCell(cell: DesignedCellRecord): ActiveCell {
  return {
    row: cell.row,
    col: cell.col,
    id: createCellId(cell.row, cell.col),
    display_coord: createDisplayCoord(cell.row, cell.col),
    status: "designed",
    terrain: cell.terrain,
    biome: cell.biome,
    tags: [...cell.tags],
    note: cell.note
  };
}

function undesignedCell(coord: { row: number; col: number }, isSeed = false): ActiveCell {
  return {
    row: coord.row,
    col: coord.col,
    id: createCellId(coord.row, coord.col),
    display_coord: createDisplayCoord(coord.row, coord.col),
    status: "undesigned",
    terrain: null,
    biome: null,
    tags: [],
    note: "",
    is_seed: isSeed
  };
}

function compareActiveCells(left: ActiveCell, right: ActiveCell): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }
  return left.col - right.col;
}

function assertRange(range: CellRange): CellRange {
  for (const [key, value] of Object.entries(range)) {
    if (!Number.isInteger(value)) {
      throw badRequest(`${key} must be an integer`);
    }
  }
  if (range.minRow > range.maxRow) {
    throw badRequest("minRow must be less than or equal to maxRow");
  }
  if (range.minCol > range.maxCol) {
    throw badRequest("minCol must be less than or equal to maxCol");
  }
  const cellCount = (range.maxRow - range.minRow + 1) * (range.maxCol - range.minCol + 1);
  if (cellCount > 100_000) {
    throw badRequest("requested cell range is too large");
  }
  return range;
}

function normalizeFeaturePageOptions(
  options: FeaturePageOptions = {}
): Required<FeaturePageOptions> {
  const limit = options.limit ?? DEFAULT_FEATURE_PAGE_LIMIT;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FEATURE_PAGE_LIMIT) {
    throw badRequest(`feature limit must be an integer between 1 and ${MAX_FEATURE_PAGE_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw badRequest("feature offset must be a non-negative integer");
  }
  return { limit, offset };
}

function isWithinRange(coord: { row: number; col: number }, range: CellRange): boolean {
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
  if (!river.points.length) return null;
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  for (const point of river.points) {
    minRow = Math.min(minRow, point.row);
    maxRow = Math.max(maxRow, point.row);
    minCol = Math.min(minCol, point.col);
    maxCol = Math.max(maxCol, point.col);
  }
  return { minRow, maxRow, minCol, maxCol };
}

function rangeFromFeatureRow(row: FeatureRow): CellRange | null {
  if (
    row.bounds_min_row === null ||
    row.bounds_max_row === null ||
    row.bounds_min_col === null ||
    row.bounds_max_col === null
  ) {
    return null;
  }
  return {
    minRow: row.bounds_min_row,
    maxRow: row.bounds_max_row,
    minCol: row.bounds_min_col,
    maxCol: row.bounds_max_col
  };
}

function getMapRowOrThrow(db: Database.Database, id: string): MapRow {
  const normalizedId = assertSafeMapId(id);
  const row = db.prepare("SELECT * FROM maps WHERE id = ?").get(normalizedId) as MapRow | undefined;
  if (!row) {
    throw notFound(`map ${normalizedId} was not found`);
  }
  return row;
}

function mapSummaryFromRow(db: Database.Database, row: MapRow): MapSummary {
  const riverCount = db
    .prepare(
      "SELECT COUNT(*) AS count, MIN(bounds_min_row) AS min_row, MAX(bounds_max_row) AS max_row, MIN(bounds_min_col) AS min_col, MAX(bounds_max_col) AS max_col FROM features WHERE map_id = ? AND kind = 'river'"
    )
    .get(row.id) as { count: number } & MapBounds;
  const renderBounds = mapRowToBounds(row);
  for (const key of ["min_row", "max_row", "min_col", "max_col"] as const) {
    const value = riverCount[key];
    if (value !== null)
      renderBounds[key] =
        renderBounds[key] === null
          ? value
          : key.startsWith("min")
            ? Math.min(renderBounds[key]!, value)
            : Math.max(renderBounds[key]!, value);
  }
  return {
    meta: mapRowToMeta(row),
    grid: mapRowToGrid(row),
    bounds: mapRowToBounds(row),
    render_bounds: renderBounds,
    designed_cell_count: row.designed_cell_count,
    feature_counts: {
      rivers: riverCount?.count ?? 0
    }
  };
}

function readFeatureRows(db: Database.Database, id: string): FeatureRow[] {
  return db
    .prepare(
      `SELECT map_id, kind, feature_id, json,
              bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col
       FROM features
       WHERE map_id = ?
       ORDER BY kind, feature_id`
    )
    .all(id) as FeatureRow[];
}

function readFeaturePage(
  db: Database.Database,
  id: string,
  range: CellRange,
  options: Required<FeaturePageOptions>
): MapFeaturePage {
  const where =
    "map_id = ? AND kind = 'river' AND bounds_min_row <= ? AND bounds_max_row >= ? AND bounds_min_col <= ? AND bounds_max_col >= ?";
  const params = [id, range.maxRow, range.minRow, range.maxCol, range.minCol];
  const total = (
    db.prepare("SELECT COUNT(*) AS total FROM features WHERE " + where).get(...params) as {
      total: number;
    }
  ).total;
  const rows = db
    .prepare("SELECT json FROM features WHERE " + where + " ORDER BY feature_id LIMIT ? OFFSET ?")
    .all(...params, options.limit, options.offset) as Array<{ json: string }>;
  return {
    rivers: rows.map((row) => JSON.parse(row.json) as RiverFeature),
    page: {
      total,
      limit: options.limit,
      offset: options.offset,
      returned: rows.length,
      has_more: options.offset + rows.length < total
    }
  };
}

function featureRowsToFeatures(rows: FeatureRow[]): MapFeatures {
  return {
    rivers: rows
      .filter((row) => row.kind === "river")
      .map((row) => JSON.parse(row.json) as RiverFeature)
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}

function backfillMissingFeatureBounds(db: Database.Database, id: string): void {
  const rows = db
    .prepare(
      `SELECT map_id, kind, feature_id, json,
              bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col
       FROM features
       WHERE map_id = ?
         AND kind = 'river'
         AND (
           bounds_min_row IS NULL
           OR bounds_max_row IS NULL
           OR bounds_min_col IS NULL
           OR bounds_max_col IS NULL
         )`
    )
    .all(id) as FeatureRow[];
  if (rows.length === 0) {
    return;
  }
  const update = db.prepare(
    `UPDATE features
     SET bounds_min_row = ?,
         bounds_max_row = ?,
         bounds_min_col = ?,
         bounds_max_col = ?
     WHERE map_id = ? AND kind = ? AND feature_id = ?`
  );
  const write = db.transaction(() => {
    for (const row of rows) {
      const river = JSON.parse(row.json) as RiverFeature;
      const range = coordRangeForRiver(river);
      update.run(
        range?.minRow ?? null,
        range?.maxRow ?? null,
        range?.minCol ?? null,
        range?.maxCol ?? null,
        row.map_id,
        row.kind,
        row.feature_id
      );
    }
  });
  write();
}

function readCells(db: Database.Database, id: string): DesignedCellRecord[] {
  return (
    db
      .prepare(
        "SELECT map_id, row, col, terrain, biome, tags_json, note FROM cells WHERE map_id = ? ORDER BY row, col"
      )
      .all(id) as CellRow[]
  ).map(cellRowToDesignedCell);
}

function readCellAt(
  db: Database.Database,
  id: string,
  row: number,
  col: number
): DesignedCellRecord | null {
  const found = db
    .prepare(
      "SELECT map_id, row, col, terrain, biome, tags_json, note FROM cells WHERE map_id = ? AND row = ? AND col = ?"
    )
    .get(id, row, col) as CellRow | undefined;
  return found ? cellRowToDesignedCell(found) : null;
}

function updateMapCellAggregate(
  db: Database.Database,
  id: string,
  revisionIncrement: number,
  projected: MapSummary
): MapRow {
  const row = getMapRowOrThrow(db, id);
  db.prepare(
    `UPDATE maps
     SET updated_at = @updated_at,
         revision = @revision,
         bounds_min_row = @bounds_min_row,
         bounds_max_row = @bounds_max_row,
         bounds_min_col = @bounds_min_col,
         bounds_max_col = @bounds_max_col,
         designed_cell_count = @designed_cell_count
     WHERE id = @id`
  ).run({
    id,
    updated_at: revisionIncrement > 0 ? new Date().toISOString() : row.updated_at,
    revision: row.revision + revisionIncrement,
    bounds_min_row: projected.designed_cell_count > 0 ? projected.bounds.min_row : null,
    bounds_max_row: projected.designed_cell_count > 0 ? projected.bounds.max_row : null,
    bounds_min_col: projected.designed_cell_count > 0 ? projected.bounds.min_col : null,
    bounds_max_col: projected.designed_cell_count > 0 ? projected.bounds.max_col : null,
    designed_cell_count: projected.designed_cell_count
  });
  return getMapRowOrThrow(db, id);
}

function updateMapRevision(db: Database.Database, id: string, revisionIncrement: number): MapRow {
  const row = getMapRowOrThrow(db, id);
  if (revisionIncrement <= 0) {
    return row;
  }
  db.prepare(
    `UPDATE maps
     SET updated_at = @updated_at,
         revision = @revision
     WHERE id = @id`
  ).run({
    id,
    updated_at: new Date().toISOString(),
    revision: row.revision + revisionIncrement
  });
  return getMapRowOrThrow(db, id);
}

export function advanceMapRevisionSync(id: string, increment: number): void {
  updateMapRevision(getDatabase(), id, increment);
}

function writeDocument(db: Database.Database, document: MapDocument): void {
  const normalized = normalizeDocument(document);
  const bounds = normalizeBounds(normalized.cells);
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO maps (
        id, name, description, tags_json, layout, schema_version, created_at, updated_at, revision,
        bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col, designed_cell_count
      ) VALUES (
        @id, @name, @description, @tags_json, @layout, @schema_version, @created_at, @updated_at, @revision,
        @bounds_min_row, @bounds_max_row, @bounds_min_col, @bounds_max_col, @designed_cell_count
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        tags_json = excluded.tags_json,
        layout = excluded.layout,
        schema_version = excluded.schema_version,
        updated_at = excluded.updated_at,
        revision = excluded.revision,
        bounds_min_row = excluded.bounds_min_row,
        bounds_max_row = excluded.bounds_max_row,
        bounds_min_col = excluded.bounds_min_col,
        bounds_max_col = excluded.bounds_max_col,
        designed_cell_count = excluded.designed_cell_count`
    ).run({
      id: normalized.meta.id,
      name: normalized.meta.name,
      description: normalized.meta.description,
      tags_json: serializeStringArray(normalized.meta.tags),
      layout: normalized.grid.layout,
      schema_version: normalized.schema_version,
      created_at: normalized.meta.created_at,
      updated_at: normalized.meta.updated_at,
      revision: normalized.meta.revision,
      bounds_min_row: bounds.min_row,
      bounds_max_row: bounds.max_row,
      bounds_min_col: bounds.min_col,
      bounds_max_col: bounds.max_col,
      designed_cell_count: normalized.cells.length
    });

    db.prepare("DELETE FROM cells WHERE map_id = ?").run(normalized.meta.id);
    const insertCell = db.prepare(
      `INSERT INTO cells (map_id, row, col, terrain, biome, tags_json, note)
       VALUES (@map_id, @row, @col, @terrain, @biome, @tags_json, @note)`
    );
    for (const cell of normalized.cells) {
      insertCell.run({
        map_id: normalized.meta.id,
        row: cell.row,
        col: cell.col,
        terrain: cell.terrain,
        biome: cell.biome,
        tags_json: serializeStringArray(cell.tags),
        note: cell.note
      });
    }

    db.prepare("DELETE FROM features WHERE map_id = ?").run(normalized.meta.id);
    const insertFeature = db.prepare(
      `INSERT INTO features (
        map_id, kind, feature_id, json, bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const river of normalized.features.rivers) {
      const range = coordRangeForRiver(river);
      insertFeature.run(
        normalized.meta.id,
        "river",
        river.id,
        JSON.stringify(river),
        range?.minRow ?? null,
        range?.maxRow ?? null,
        range?.minCol ?? null,
        range?.maxCol ?? null
      );
    }
  });
  write();
}

function upsertMapRow(db: Database.Database, document: MapDocument, bounds: MapBounds): void {
  db.prepare(
    `INSERT INTO maps (
      id, name, description, tags_json, layout, schema_version, created_at, updated_at, revision,
      bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col, designed_cell_count
    ) VALUES (
      @id, @name, @description, @tags_json, @layout, @schema_version, @created_at, @updated_at, @revision,
      @bounds_min_row, @bounds_max_row, @bounds_min_col, @bounds_max_col, @designed_cell_count
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      tags_json = excluded.tags_json,
      layout = excluded.layout,
      schema_version = excluded.schema_version,
      updated_at = excluded.updated_at,
      revision = excluded.revision,
      bounds_min_row = excluded.bounds_min_row,
      bounds_max_row = excluded.bounds_max_row,
      bounds_min_col = excluded.bounds_min_col,
      bounds_max_col = excluded.bounds_max_col,
      designed_cell_count = excluded.designed_cell_count`
  ).run({
    id: document.meta.id,
    name: document.meta.name,
    description: document.meta.description,
    tags_json: serializeStringArray(document.meta.tags),
    layout: document.grid.layout,
    schema_version: document.schema_version,
    created_at: document.meta.created_at,
    updated_at: document.meta.updated_at,
    revision: document.meta.revision,
    bounds_min_row: bounds.min_row,
    bounds_max_row: bounds.max_row,
    bounds_min_col: bounds.min_col,
    bounds_max_col: bounds.max_col,
    designed_cell_count: document.cells.length
  });
}

function writeDocumentBatched(
  db: Database.Database,
  document: MapDocument,
  beforeCommit?: () => void
): void {
  const bounds = normalizeBounds(document.cells);
  const insertCell = db.prepare(
    `INSERT INTO cells (map_id, row, col, terrain, biome, tags_json, note)
     VALUES (@map_id, @row, @col, @terrain, @biome, @tags_json, @note)`
  );
  const insertFeature = db.prepare(
    `INSERT INTO features (
      map_id, kind, feature_id, json, bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const write = db.transaction(() => {
    if (db.prepare("SELECT id FROM maps WHERE id = ?").get(document.meta.id))
      throw badRequest("meta.id conflict for " + document.meta.id);
    upsertMapRow(db, document, bounds);
    db.prepare("DELETE FROM cells WHERE map_id = ?").run(document.meta.id);
    db.prepare("DELETE FROM features WHERE map_id = ?").run(document.meta.id);

    for (let start = 0; start < document.cells.length; start += SQLITE_IMPORT_BATCH_SIZE) {
      for (const cell of document.cells.slice(start, start + SQLITE_IMPORT_BATCH_SIZE)) {
        insertCell.run({
          map_id: document.meta.id,
          row: cell.row,
          col: cell.col,
          terrain: cell.terrain,
          biome: cell.biome,
          tags_json: serializeStringArray(cell.tags),
          note: cell.note
        });
      }
    }

    for (
      let start = 0;
      start < document.features.rivers.length;
      start += SQLITE_IMPORT_BATCH_SIZE
    ) {
      for (const river of document.features.rivers.slice(start, start + SQLITE_IMPORT_BATCH_SIZE)) {
        const range = coordRangeForRiver(river);
        insertFeature.run(
          document.meta.id,
          "river",
          river.id,
          JSON.stringify(river),
          range?.minRow ?? null,
          range?.maxRow ?? null,
          range?.minCol ?? null,
          range?.maxCol ?? null
        );
      }
    }
    beforeCommit?.();
  });
  write.immediate();
}

function rowToStoredOperation(row: OperationRow): StoredOperation {
  return {
    mapId: row.map_id,
    seq: row.seq,
    source: row.source,
    action: row.action,
    commands: JSON.parse(row.command_json) as MapCommand[],
    inverseCommands: JSON.parse(row.inverse_json) as MapCommand[],
    summary: JSON.parse(row.summary_json) as unknown,
    timestamp: row.timestamp
  };
}

function readHistoryCursor(db: Database.Database, mapId: string): number {
  const row = db.prepare("SELECT history_cursor FROM maps WHERE id = ?").get(mapId) as
    { history_cursor: number } | undefined;
  return row?.history_cursor ?? 0;
}

function readLatestOperationSeq(db: Database.Database, mapId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS latest FROM operations WHERE map_id = ?")
    .get(mapId) as { latest: number } | undefined;
  return row?.latest ?? 0;
}

async function readLegacyDocument(id: string): Promise<MapDocument | null> {
  try {
    const raw = await fs.readFile(mapFilePath(MAP_STORAGE_DIR, id), "utf8");
    const parsed = parseDocument(raw);
    if (!parsed.document) {
      throw badRequest(parsed.errors.map((entry) => entry.message).join("; "));
    }
    return parsed.document;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = (error as { code?: unknown }).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return null;
      }
    }
    throw error;
  }
}

export async function ensureMapInDatabase(id: string): Promise<void> {
  const normalizedId = assertSafeMapId(id);
  const db = getDatabase();
  const existing = db.prepare("SELECT id FROM maps WHERE id = ?").get(normalizedId);
  if (existing) {
    return;
  }
  const legacy = await readLegacyDocument(normalizedId);
  if (!legacy) {
    throw notFound(`map ${normalizedId} was not found`);
  }
  if (!db.prepare("SELECT id FROM maps WHERE id = ?").get(normalizedId)) writeDocument(db, legacy);
}

export async function importLegacyJsonFiles(): Promise<void> {
  let files: string[];
  try {
    files = (await fs.readdir(MAP_STORAGE_DIR)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return;
    }
    throw storageError("failed to scan legacy map files", error);
  }
  const db = getDatabase();
  for (const fileName of files) {
    const id = path.basename(fileName, ".json");
    const existing = db.prepare("SELECT id FROM maps WHERE id = ?").get(id);
    if (existing) {
      continue;
    }
    let document: MapDocument | null = null;
    try {
      const stat = await fs.stat(path.join(MAP_STORAGE_DIR, fileName));
      if (!stat.isFile() || stat.size > MAX_LEGACY_IMPORT_FILE_BYTES) {
        continue;
      }
      document = await readLegacyDocument(id);
    } catch {
      continue;
    }
    if (!document) {
      continue;
    }
    writeDocument(db, document);
  }
}

export async function listMapRows(): Promise<MapListItem[]> {
  await importLegacyJsonFiles();
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM maps ORDER BY name").all() as MapRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    fileName: `${row.id}.json`,
    updatedAt: row.updated_at,
    revision: row.revision,
    designedCellCount: row.designed_cell_count
  }));
}

export async function createMapDocument(input: {
  name: string;
  description?: string;
  id?: string;
}): Promise<MapDocument> {
  const id = assertSafeMapId(input.id ?? createMapId(input.name));
  if (await readLegacyDocument(id)) {
    throw badRequest(`map id ${id} already exists`);
  }
  const document = createEmptyDocument({
    id,
    name: input.name,
    description: input.description ?? ""
  });
  const db = getDatabase();
  const existing = db.prepare("SELECT id FROM maps WHERE id = ?").get(document.meta.id);
  if (existing) {
    throw badRequest(`map id ${document.meta.id} already exists`);
  }
  writeDocument(db, document);
  return document;
}

export async function getMapDocument(id: string): Promise<MapDocument> {
  await ensureMapInDatabase(id);
  return getMapDocumentSync(id);
}

export function getMapDocumentSync(id: string): MapDocument {
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  return normalizeDocument({
    schema_version: 1,
    meta: mapRowToMeta(row),
    grid: mapRowToGrid(row),
    cells: readCells(db, row.id),
    features: featureRowsToFeatures(readFeatureRows(db, row.id))
  });
}

function indentJson(value: unknown, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export async function writeMapDocumentJsonExport(id: string, filePath: string): Promise<void> {
  await ensureMapInDatabase(id);
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  const meta: MapMeta = {
    ...mapRowToMeta(row),
    tags: normalizeStringArray(mapRowToMeta(row).tags)
  };
  const grid = mapRowToGrid(row);
  const cellRows = db
    .prepare(
      "SELECT map_id, row, col, terrain, biome, tags_json, note FROM cells WHERE map_id = ? ORDER BY row, col"
    )
    .iterate(row.id) as Iterable<CellRow>;
  const riverRows = db
    .prepare(
      `SELECT map_id, kind, feature_id, json,
              bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col
       FROM features
       WHERE map_id = ? AND kind = 'river'
       ORDER BY feature_id`
    )
    .iterate(row.id) as Iterable<FeatureRow>;

  await writeFileAtomicStream(filePath, async (write) => {
    await write("{\n");
    await write('  "schema_version": 1,\n');
    await write(`  "meta": ${JSON.stringify(meta, null, 2).replace(/\n/g, "\n  ")},\n`);
    await write(`  "grid": ${JSON.stringify(grid, null, 2).replace(/\n/g, "\n  ")},\n`);
    await write('  "cells": [');
    let hasCell = false;
    for (const cellRow of cellRows) {
      await write(`${hasCell ? "," : ""}\n${indentJson(normalizeCellForExport(cellRow), 4)}`);
      hasCell = true;
    }
    await write(hasCell ? "\n  ],\n" : "],\n");
    await write('  "features": {\n');
    await write('    "rivers": [');
    let hasRiver = false;
    for (const featureRow of riverRows) {
      const river = normalizeRiverForExport(JSON.parse(featureRow.json) as RiverFeature);
      await write(`${hasRiver ? "," : ""}\n${indentJson(river, 6)}`);
      hasRiver = true;
    }
    await write(hasRiver ? "\n    ]\n" : "]\n");
    await write("  }\n");
    await write("}");
  });
}

export async function getMapFeatures(id: string): Promise<MapFeatures> {
  await ensureMapInDatabase(id);
  return getMapFeaturesSync(id);
}

export function getMapFeaturesSync(id: string): MapFeatures {
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  backfillMissingFeatureBounds(db, row.id);
  return featureRowsToFeatures(readFeatureRows(db, row.id));
}

export async function getMapFeaturesInRange(
  id: string,
  inputRange: CellRange,
  options: FeaturePageOptions = {}
): Promise<MapFeaturePage> {
  const range = assertRange(inputRange);
  const pageOptions = normalizeFeaturePageOptions(options);
  await ensureMapInDatabase(id);
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  backfillMissingFeatureBounds(db, row.id);
  return readFeaturePage(db, row.id, range, pageOptions);
}

export async function getRiverFeatures(id: string): Promise<RiverFeature[]> {
  return (await getMapFeatures(id)).rivers;
}

export async function applyFeatureWriteChanges(
  id: string,
  changes: FeatureWriteChange[],
  options: { dryRun?: boolean; revisionIncrement?: number } = {}
): Promise<MapSummary> {
  await ensureMapInDatabase(id);
  return applyFeatureWriteChangesSync(id, changes, options);
}

export function applyFeatureWriteChangesSync(
  id: string,
  changes: FeatureWriteChange[],
  options: { dryRun?: boolean; revisionIncrement?: number } = {}
): MapSummary {
  const normalizedId = assertSafeMapId(id);
  const db = getDatabase();
  const applyChanges = () => {
    const row = getMapRowOrThrow(db, normalizedId);
    if (changes.length === 0) {
      return row;
    }
    const deleteFeature = db.prepare(
      "DELETE FROM features WHERE map_id = ? AND kind = ? AND feature_id = ?"
    );
    const upsertFeature = db.prepare(
      `INSERT INTO features (
        map_id, kind, feature_id, json, bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(map_id, kind, feature_id) DO UPDATE SET
        json = excluded.json,
        bounds_min_row = excluded.bounds_min_row,
        bounds_max_row = excluded.bounds_max_row,
        bounds_min_col = excluded.bounds_min_col,
        bounds_max_col = excluded.bounds_max_col`
    );
    for (const change of changes) {
      if (!change.river) {
        deleteFeature.run(row.id, change.kind, change.featureId);
        continue;
      }
      const range = coordRangeForRiver(change.river);
      upsertFeature.run(
        row.id,
        change.kind,
        change.river.id,
        JSON.stringify(change.river),
        range?.minRow ?? null,
        range?.maxRow ?? null,
        range?.minCol ?? null,
        range?.maxCol ?? null
      );
    }
    return updateMapRevision(db, row.id, options.revisionIncrement ?? 1);
  };
  if (options.dryRun) {
    db.prepare("SAVEPOINT feature_write_preview").run();
    try {
      const summary = mapSummaryFromRow(db, applyChanges());
      db.prepare("ROLLBACK TO feature_write_preview").run();
      db.prepare("RELEASE feature_write_preview").run();
      return summary;
    } catch (error) {
      db.prepare("ROLLBACK TO feature_write_preview").run();
      db.prepare("RELEASE feature_write_preview").run();
      throw error;
    }
  }
  const write = db.transaction(applyChanges);
  return mapSummaryFromRow(db, write());
}

export async function applyCellAndFeatureWriteChanges(
  id: string,
  cellChanges: CellWriteChange[],
  featureChanges: FeatureWriteChange[],
  options: {
    dryRun?: boolean;
    cellRevisionIncrement?: number;
    featureRevisionIncrement?: number;
  } = {}
): Promise<MapSummary> {
  return withMapTransaction(id, () => {
    const db = getDatabase();
    db.exec("SAVEPOINT mixed_write");
    try {
      applyCellWriteChangesSync(id, cellChanges, {
        revisionIncrement: options.cellRevisionIncrement ?? 0
      });
      const result = applyFeatureWriteChangesSync(id, featureChanges, {
        revisionIncrement: options.featureRevisionIncrement ?? 0
      });
      if (options.dryRun) db.exec("ROLLBACK TO mixed_write");
      db.exec("RELEASE mixed_write");
      return result;
    } catch (error) {
      db.exec("ROLLBACK TO mixed_write; RELEASE mixed_write");
      throw error;
    }
  });
}

export async function getDesignedCellsAt(
  id: string,
  targets: Array<{ row: number; col: number }>
): Promise<DesignedCellRecord[]> {
  await ensureMapInDatabase(id);
  return getDesignedCellsAtSync(id, targets);
}

export function getDesignedCellsAtSync(
  id: string,
  targets: Array<{ row: number; col: number }>
): DesignedCellRecord[] {
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  const seen = new Set<string>();
  const cells: DesignedCellRecord[] = [];
  for (const target of targets) {
    const key = `${target.row},${target.col}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const cell = readCellAt(db, row.id, target.row, target.col);
    if (cell) {
      cells.push(cell);
    }
  }
  return cells;
}

export async function getDesignedCellsByTerrain(
  id: string,
  terrain: DesignedCellRecord["terrain"]
): Promise<DesignedCellRecord[]> {
  await ensureMapInDatabase(id);
  return getDesignedCellsByTerrainSync(id, terrain);
}

export function getDesignedCellsByTerrainSync(
  id: string,
  terrain: DesignedCellRecord["terrain"]
): DesignedCellRecord[] {
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  return (
    db
      .prepare(
        "SELECT map_id, row, col, terrain, biome, tags_json, note FROM cells WHERE map_id = ? AND terrain = ? ORDER BY row, col"
      )
      .all(row.id, terrain) as CellRow[]
  ).map(cellRowToDesignedCell);
}

export async function getDesignedCellsByBiome(
  id: string,
  biome: DesignedCellRecord["biome"]
): Promise<DesignedCellRecord[]> {
  await ensureMapInDatabase(id);
  return getDesignedCellsByBiomeSync(id, biome);
}

export function getDesignedCellsByBiomeSync(
  id: string,
  biome: DesignedCellRecord["biome"]
): DesignedCellRecord[] {
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  const rows =
    biome === null
      ? db
          .prepare(
            "SELECT map_id, row, col, terrain, biome, tags_json, note FROM cells WHERE map_id = ? AND biome IS NULL ORDER BY row, col"
          )
          .all(row.id)
      : db
          .prepare(
            "SELECT map_id, row, col, terrain, biome, tags_json, note FROM cells WHERE map_id = ? AND biome = ? ORDER BY row, col"
          )
          .all(row.id, biome);
  return (rows as CellRow[]).map(cellRowToDesignedCell);
}

/** Project changed cells without writing preview data into the live database. */
export function previewCellChangesSync(id: string, changes: CellWriteChange[]): MapSummary {
  const db = getDatabase();
  const summary = getMapSummarySync(id);
  if (!changes.length) return summary;
  const unique = new Map(changes.map((c) => [createCellId(c.row, c.col), c]));
  let membershipChanged = false;
  for (const change of unique.values()) {
    const existed = !!readCellAt(db, id, change.row, change.col);
    const exists = !!change.cell;
    if (existed !== exists) {
      summary.designed_cell_count += exists ? 1 : -1;
      membershipChanged = true;
    }
  }
  if (!membershipChanged) return summary;
  const bounds: MapBounds = { min_row: null, max_row: null, min_col: null, max_col: null };
  for (const [key, column, direction] of [
    ["min_row", "row", "ASC"],
    ["max_row", "row", "DESC"],
    ["min_col", "col", "ASC"],
    ["max_col", "col", "DESC"]
  ] as const) {
    for (const raw of db
      .prepare("SELECT row, col FROM cells WHERE map_id = ? ORDER BY " + column + " " + direction)
      .iterate(id)) {
      const cell = raw as { row: number; col: number };
      if (!unique.has(createCellId(cell.row, cell.col))) {
        bounds[key] = cell[column];
        break;
      }
    }
    for (const { cell } of unique.values()) {
      if (!cell) continue;
      bounds[key] =
        bounds[key] === null
          ? cell[column]
          : direction === "ASC"
            ? Math.min(bounds[key]!, cell[column])
            : Math.max(bounds[key]!, cell[column]);
    }
  }
  summary.bounds = bounds;
  return summary;
}

export async function applyCellWriteChanges(
  id: string,
  changes: CellWriteChange[],
  options: { dryRun?: boolean; revisionIncrement?: number } = {}
): Promise<MapSummary> {
  await ensureMapInDatabase(id);
  return applyCellWriteChangesSync(id, changes, options);
}

export function applyCellWriteChangesSync(
  id: string,
  changes: CellWriteChange[],
  options: { dryRun?: boolean; revisionIncrement?: number } = {}
): MapSummary {
  const normalizedId = assertSafeMapId(id);
  const db = getDatabase();
  const applyChanges = () => {
    const row = getMapRowOrThrow(db, normalizedId);
    if (changes.length === 0) {
      return row;
    }
    const projected = previewCellChangesSync(normalizedId, changes);
    const deleteCell = db.prepare("DELETE FROM cells WHERE map_id = ? AND row = ? AND col = ?");
    const upsertCell = db.prepare(
      `INSERT INTO cells (map_id, row, col, terrain, biome, tags_json, note)
       VALUES (@map_id, @row, @col, @terrain, @biome, @tags_json, @note)
       ON CONFLICT(map_id, row, col) DO UPDATE SET
         terrain = excluded.terrain,
         biome = excluded.biome,
         tags_json = excluded.tags_json,
         note = excluded.note`
    );
    for (const change of changes) {
      if (!change.cell) {
        deleteCell.run(row.id, change.row, change.col);
        continue;
      }
      upsertCell.run({
        map_id: row.id,
        row: change.cell.row,
        col: change.cell.col,
        terrain: change.cell.terrain,
        biome: change.cell.biome,
        tags_json: serializeStringArray(change.cell.tags),
        note: change.cell.note
      });
    }
    return updateMapCellAggregate(db, row.id, options.revisionIncrement ?? 1, projected);
  };
  if (options.dryRun) {
    db.prepare("SAVEPOINT cell_write_preview").run();
    try {
      const summary = mapSummaryFromRow(db, applyChanges());
      db.prepare("ROLLBACK TO cell_write_preview").run();
      db.prepare("RELEASE cell_write_preview").run();
      return summary;
    } catch (error) {
      db.prepare("ROLLBACK TO cell_write_preview").run();
      db.prepare("RELEASE cell_write_preview").run();
      throw error;
    }
  }
  const write = db.transaction(applyChanges);
  return mapSummaryFromRow(db, write());
}

export async function updateMapMetadata(id: string, input: MapMetadataUpdate): Promise<MapSummary> {
  await ensureMapInDatabase(id);
  return updateMapMetadataSync(id, input);
}

export function updateMapMetadataSync(id: string, input: MapMetadataUpdate): MapSummary {
  const normalizedId = assertSafeMapId(id);
  const db = getDatabase();
  const row = getMapRowOrThrow(db, normalizedId);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE maps
     SET name = @name,
         description = @description,
         tags_json = @tags_json,
         updated_at = @updated_at,
         revision = @revision
     WHERE id = @id`
  ).run({
    id: row.id,
    name: input.name ?? row.name,
    description: input.description ?? row.description,
    tags_json: input.tags ? serializeStringArray(input.tags) : row.tags_json,
    updated_at: now,
    revision: row.revision + 1
  });
  return getMapSummarySync(row.id);
}

export async function saveMapDocument(document: MapDocument): Promise<MapDocument> {
  return saveMapDocumentSync(document);
}

export function saveMapDocumentSync(document: MapDocument): MapDocument {
  const normalized = normalizeDocument(document);
  writeDocument(getDatabase(), normalized);
  return normalized;
}

export async function importMapDocument(
  document: MapDocument,
  beforeCommit?: () => void
): Promise<MapDocument> {
  const normalized = normalizeDocument(document);
  writeDocumentBatched(getDatabase(), normalized, beforeCommit);
  return normalized;
}

export async function mapExists(id: string): Promise<boolean> {
  const normalizedId = assertSafeMapId(id);
  const db = getDatabase();
  if (db.prepare("SELECT id FROM maps WHERE id = ?").get(normalizedId)) {
    return true;
  }
  return (await readLegacyDocument(normalizedId)) !== null;
}

export async function deleteMapDocument(id: string): Promise<void> {
  const normalizedId = assertSafeMapId(id);
  await ensureMapInDatabase(normalizedId);
  getDatabase().prepare("DELETE FROM maps WHERE id = ?").run(normalizedId);
  await fs.rm(mapFilePath(MAP_STORAGE_DIR, normalizedId), { force: true }).catch(() => undefined);
}

export async function getMapSummary(id: string): Promise<MapSummary> {
  await ensureMapInDatabase(id);
  return getMapSummarySync(id);
}

export function getMapSummarySync(id: string): MapSummary {
  const db = getDatabase();
  const row = getMapRowOrThrow(db, id);
  return mapSummaryFromRow(db, row);
}

export async function recordOperation(
  mapId: string,
  input: OperationInput
): Promise<StoredOperation> {
  await ensureMapInDatabase(mapId);
  return recordOperationSync(mapId, input);
}

export function recordOperationSync(mapId: string, input: OperationInput): StoredOperation {
  const normalizedId = assertSafeMapId(mapId);
  const db = getDatabase();
  const timestamp = new Date().toISOString();
  const write = db.transaction(() => {
    const cursor = readHistoryCursor(db, normalizedId);
    const nextSeq = cursor + 1;
    db.prepare("DELETE FROM operations WHERE map_id = ? AND seq > ?").run(normalizedId, cursor);
    db.prepare(
      `INSERT INTO operations (
        map_id, seq, source, action, command_json, inverse_json, summary_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      normalizedId,
      nextSeq,
      input.source,
      input.action,
      JSON.stringify(input.commands),
      JSON.stringify(input.inverseCommands),
      JSON.stringify(input.summary),
      timestamp
    );
    db.prepare("UPDATE maps SET history_cursor = ? WHERE id = ?").run(nextSeq, normalizedId);
    return nextSeq;
  });
  const seq = write();
  const operation = db
    .prepare("SELECT * FROM operations WHERE map_id = ? AND seq = ?")
    .get(normalizedId, seq) as OperationRow;
  return rowToStoredOperation(operation);
}

export async function getHistoryStatus(mapId: string): Promise<HistoryStatus> {
  await ensureMapInDatabase(mapId);
  return getHistoryStatusSync(mapId);
}

export function getHistoryStatusSync(mapId: string): HistoryStatus {
  const normalizedId = assertSafeMapId(mapId);
  const db = getDatabase();
  const cursor = readHistoryCursor(db, normalizedId);
  const latest = readLatestOperationSeq(db, normalizedId);
  const undoExists = db
    .prepare("SELECT 1 FROM operations WHERE map_id = ? AND seq = ?")
    .get(normalizedId, cursor);
  const redoExists = db
    .prepare("SELECT 1 FROM operations WHERE map_id = ? AND seq = ?")
    .get(normalizedId, cursor + 1);
  return {
    canUndo: cursor > 0 && Boolean(undoExists),
    canRedo: Boolean(redoExists),
    cursor,
    latest
  };
}

export async function getMapHistory(mapId: string, limit = 5): Promise<MapHistory> {
  const normalizedId = assertSafeMapId(mapId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw badRequest("history limit must be an integer between 1 and 50");
  }
  await ensureMapInDatabase(normalizedId);
  const db = getDatabase();
  const status = await getHistoryStatus(normalizedId);
  const rows = db
    .prepare(
      `SELECT seq, source, action, timestamp FROM operations
       WHERE map_id = ? AND seq <= ?
       ORDER BY seq DESC
       LIMIT ?`
    )
    .all(normalizedId, status.cursor, limit) as Array<{
    seq: number;
    source: HistorySource;
    action: string;
    timestamp: string;
  }>;
  return {
    status,
    entries: rows.map((row) => ({
      seq: row.seq,
      source: row.source,
      action: row.action,
      timestamp: row.timestamp
    }))
  };
}

export async function getUndoOperation(mapId: string): Promise<StoredOperation | null> {
  await ensureMapInDatabase(mapId);
  return getUndoOperationSync(mapId);
}

export function getUndoOperationSync(mapId: string): StoredOperation | null {
  const normalizedId = assertSafeMapId(mapId);
  const db = getDatabase();
  const cursor = readHistoryCursor(db, normalizedId);
  if (cursor <= 0) {
    return null;
  }
  const row = db
    .prepare("SELECT * FROM operations WHERE map_id = ? AND seq = ?")
    .get(normalizedId, cursor) as OperationRow | undefined;
  return row ? rowToStoredOperation(row) : null;
}

export async function getRedoOperation(mapId: string): Promise<StoredOperation | null> {
  await ensureMapInDatabase(mapId);
  return getRedoOperationSync(mapId);
}

export function getRedoOperationSync(mapId: string): StoredOperation | null {
  const normalizedId = assertSafeMapId(mapId);
  const db = getDatabase();
  const cursor = readHistoryCursor(db, normalizedId);
  const row = db
    .prepare("SELECT * FROM operations WHERE map_id = ? AND seq = ?")
    .get(normalizedId, cursor + 1) as OperationRow | undefined;
  return row ? rowToStoredOperation(row) : null;
}

export async function moveHistoryCursor(mapId: string, cursor: number): Promise<void> {
  await ensureMapInDatabase(mapId);
  return moveHistoryCursorSync(mapId, cursor);
}

export function moveHistoryCursorSync(mapId: string, cursor: number): void {
  const normalizedId = assertSafeMapId(mapId);
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw badRequest("history cursor must be a non-negative integer");
  }
  getDatabase()
    .prepare("UPDATE maps SET history_cursor = ? WHERE id = ?")
    .run(cursor, normalizedId);
}

export async function getCellsInRange(
  id: string,
  inputRange: CellRange,
  options: { includeUndesigned?: boolean } = {}
): Promise<CellRangeResult> {
  const range = assertRange(inputRange);
  await ensureMapInDatabase(id);
  const db = getDatabase();
  const map = getMapRowOrThrow(db, id);
  const rows = db
    .prepare(
      `SELECT map_id, row, col, terrain, biome, tags_json, note FROM cells
       WHERE map_id = ? AND row BETWEEN ? AND ? AND col BETWEEN ? AND ?
       ORDER BY row, col`
    )
    .all(
      map.id,
      range.minRow - 1,
      range.maxRow + 1,
      range.minCol - 1,
      range.maxCol + 1
    ) as CellRow[];
  const designed = new Map<string, ActiveCell>();
  const activeCoords = new Map<string, { row: number; col: number }>();

  for (const row of rows) {
    const cell = designedCellToActiveCell(cellRowToDesignedCell(row));
    designed.set(cell.id, cell);
    if (isWithinRange(cell, range)) {
      activeCoords.set(cell.id, { row: cell.row, col: cell.col });
    }
    if (options.includeUndesigned ?? true) {
      for (const neighbor of getNeighborCoords(cell)) {
        if (isWithinRange(neighbor, range)) {
          activeCoords.set(createCellId(neighbor.row, neighbor.col), neighbor);
        }
      }
    }
  }

  if (map.designed_cell_count === 0 && (options.includeUndesigned ?? true)) {
    for (const coord of [{ row: 0, col: 0 }, ...getNeighborCoords({ row: 0, col: 0 })]) {
      if (isWithinRange(coord, range)) {
        activeCoords.set(createCellId(coord.row, coord.col), coord);
      }
    }
  }

  const cells = [...activeCoords.values()]
    .map(
      (coord) =>
        designed.get(createCellId(coord.row, coord.col)) ??
        undesignedCell(coord, map.designed_cell_count === 0)
    )
    .sort(compareActiveCells);

  return {
    map_id: map.id,
    revision: map.revision,
    range,
    cells
  };
}
