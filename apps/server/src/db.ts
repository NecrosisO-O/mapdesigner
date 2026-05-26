import Database from "better-sqlite3";
import { createCellId, createDisplayCoord, createRuntimeState, getNeighborCoords, getNeighborCoordsForLayout, type ActiveCell, type DesignedCellRecord, type ExportRenderOptions, type GridCoordinate, type LayoutType, type MapDocument, type TagKey } from "@mapdesigner/map-core";
import { buildExportScene, renderSvgString } from "@mapdesigner/map-render";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { EXPORT_STORAGE_DIR, MAP_STORAGE_DIR } from "./config.js";
import { createMapId, slugify } from "./utils.js";

/* ============================================================
 *  better-sqlite3 — synchronous, auto-persist
 * ============================================================ */

let _db: Database.Database | null = null;
const DB_PATH = path.join(MAP_STORAGE_DIR, "..", "mapdesigner.db");

/** Called once at server startup. Synchronous with better-sqlite3. */
export function initDb(): void {
  if (_db) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  runSchema();
}

function db(): Database.Database {
  if (!_db) throw new Error("Database not initialized — call initDb() first");
  return _db;
}

function runSchema(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS maps (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      tags          TEXT NOT NULL DEFAULT '[]',
      layout        TEXT NOT NULL DEFAULT 'flat-top-even-q',
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      revision      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cells (
      map_id  TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      row     INTEGER NOT NULL,
      col     INTEGER NOT NULL,
      terrain TEXT NOT NULL,
      biome   TEXT,
      tags    TEXT NOT NULL DEFAULT '[]',
      note    TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (map_id, row, col)
    );

    CREATE INDEX IF NOT EXISTS idx_cells_range ON cells(map_id, row, col);
    CREATE INDEX IF NOT EXISTS idx_cells_by_row ON cells(map_id, row);

    CREATE TABLE IF NOT EXISTS history (
      map_id       TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      seq          INTEGER NOT NULL,
      label        TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'system',
      timestamp    TEXT NOT NULL,
      cells_before TEXT NOT NULL DEFAULT '[]',
      cells_after  TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (map_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_history_map ON history(map_id, seq);
  `);
}

/* ============================================================
 *  Helper — thin wrappers over better-sqlite3
 * ============================================================ */

interface SqlRow {
  [col: string]: unknown;
}

function queryAll(sql: string, params?: unknown[]): SqlRow[] {
  if (params && params.length > 0) {
    return db().prepare(sql).all(...params) as SqlRow[];
  }
  return db().prepare(sql).all() as SqlRow[];
}

function queryOne(sql: string, params?: unknown[]): SqlRow | null {
  const result = params && params.length > 0
    ? db().prepare(sql).get(...params)
    : db().prepare(sql).get();
  return (result ?? null) as SqlRow | null;
}

function execute(sql: string, params?: unknown[]): void {
  if (params && params.length > 0) {
    db().prepare(sql).run(...params);
  } else {
    db().prepare(sql).run();
  }
}

/* ============================================================
 *  Types
 * ============================================================ */

export interface MapRow {
  id: string;
  name: string;
  description: string;
  tags: string;
  layout: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
  revision: number;
}

export interface CellRow {
  map_id: string;
  row: number;
  col: number;
  terrain: string;
  biome: string | null;
  tags: string;
  note: string;
}

/* ============================================================
 *  Map CRUD
 * ============================================================ */

export function listMapsDb(): MapRow[] {
  return queryAll("SELECT * FROM maps ORDER BY updated_at DESC") as unknown as MapRow[];
}

export function getMapDb(id: string): MapRow | null {
  return queryOne("SELECT * FROM maps WHERE id = ?", [id]) as unknown as MapRow | null;
}

export function insertMapDb(row: MapRow): void {
  execute(
    `INSERT INTO maps (id, name, description, tags, layout, schema_version, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.description, row.tags, row.layout, row.schema_version, row.created_at, row.updated_at, row.revision]
  );
}

export function updateMapMetaDb(id: string, meta: { name?: string; description?: string; tags?: string; updated_at?: string; revision?: number }): void {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (meta.name !== undefined) { sets.push("name = ?"); params.push(meta.name); }
  if (meta.description !== undefined) { sets.push("description = ?"); params.push(meta.description); }
  if (meta.tags !== undefined) { sets.push("tags = ?"); params.push(meta.tags); }
  if (meta.updated_at !== undefined) { sets.push("updated_at = ?"); params.push(meta.updated_at); }
  if (meta.revision !== undefined) { sets.push("revision = ?"); params.push(meta.revision); }
  if (sets.length > 0) {
    params.push(id);
    execute(`UPDATE maps SET ${sets.join(", ")} WHERE id = ?`, params);
  }
}

export function deleteMapDb(id: string): boolean {
  execute("DELETE FROM cells WHERE map_id = ?", [id]);
  execute("DELETE FROM history WHERE map_id = ?", [id]);
  execute("DELETE FROM maps WHERE id = ?", [id]);
  return true;
}

/* ============================================================
 *  Map Merge
 * ============================================================ */

export function mergeMapDb(
  targetId: string,
  sourceId: string,
  rowOffset: number,
  colOffset: number
): { cellsAdded: number; cellsOverwritten: number } {
  // Count overlapping cells before modification
  const overlap = queryOne(
    `SELECT COUNT(*) AS cnt FROM cells src
     WHERE src.map_id = ?
     AND EXISTS (SELECT 1 FROM cells tgt WHERE tgt.map_id = ? AND tgt.row = src.row + ? AND tgt.col = src.col + ?)`,
    [sourceId, targetId, rowOffset, colOffset]
  ) as { cnt: number } | null;
  const cellsOverwritten = overlap?.cnt ?? 0;

  // Count total source cells
  const total = queryOne("SELECT COUNT(*) AS cnt FROM cells WHERE map_id = ?", [sourceId]) as { cnt: number } | null;
  const totalSource = total?.cnt ?? 0;

  // UPSERT all source cells into target with offset
  execute(
    `INSERT INTO cells (map_id, row, col, terrain, biome, tags, note)
     SELECT ?, src.row + ?, src.col + ?, src.terrain, src.biome, src.tags, src.note
     FROM cells src WHERE src.map_id = ?
     ON CONFLICT(map_id, row, col)
     DO UPDATE SET terrain = excluded.terrain, biome = excluded.biome, tags = excluded.tags, note = excluded.note`,
    [targetId, rowOffset, colOffset, sourceId]
  );

  // Update target map revision
  const existing = getMapDb(targetId);
  if (existing) {
    updateMapMetaDb(targetId, { revision: existing.revision + 1, updated_at: new Date().toISOString() });
  }

  return { cellsAdded: Math.max(0, totalSource - cellsOverwritten), cellsOverwritten };
}

/* ============================================================
 *  Cell CRUD
 * ============================================================ */

export function getCellsForExport(mapId: string): DesignedCellRecord[] {
  const rows = queryAll(
    "SELECT row, col, terrain, biome, tags, note FROM cells WHERE map_id = ? ORDER BY row, col",
    [mapId]
  ) as unknown as CellRow[];
  return rows.map(deserializeCellRow);
}

export function getCellDb(mapId: string, row: number, col: number): CellRow | null {
  return queryOne("SELECT * FROM cells WHERE map_id = ? AND row = ? AND col = ?", [mapId, row, col]) as unknown as CellRow | null;
}

export function upsertCellDb(mapId: string, cell: DesignedCellRecord): void {
  execute(
    `INSERT INTO cells (map_id, row, col, terrain, biome, tags, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(map_id, row, col)
     DO UPDATE SET terrain = excluded.terrain, biome = excluded.biome, tags = excluded.tags, note = excluded.note`,
    [mapId, cell.row, cell.col, cell.terrain, cell.biome ?? null, JSON.stringify(cell.tags ?? []), cell.note ?? ""]
  );
}

export function deleteCellDb(mapId: string, row: number, col: number): void {
  execute("DELETE FROM cells WHERE map_id = ? AND row = ? AND col = ?", [mapId, row, col]);
}

export function getCellCountDb(mapId: string): number {
  const r = queryOne("SELECT COUNT(*) AS cnt FROM cells WHERE map_id = ?", [mapId]) as { cnt: number } | null;
  return r?.cnt ?? 0;
}

export function upsertCellsBatchDb(mapId: string, cells: DesignedCellRecord[]): void {
  if (cells.length === 0) return;
  const stmt = db().prepare(
    `INSERT INTO cells (map_id, row, col, terrain, biome, tags, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(map_id, row, col)
     DO UPDATE SET terrain = excluded.terrain, biome = excluded.biome, tags = excluded.tags, note = excluded.note`
  );
  const insertMany = db().transaction((items: DesignedCellRecord[]) => {
    for (const cell of items) {
      stmt.run(mapId, cell.row, cell.col, cell.terrain, cell.biome ?? null, JSON.stringify(cell.tags ?? []), cell.note ?? "");
    }
  });
  insertMany(cells);
}

/* ============================================================
 *  History (undo / redo)
 * ============================================================ */

export function pushHistoryDb(
  mapId: string,
  label: string,
  source: string,
  changedCells: { before: DesignedCellRecord | null; after: DesignedCellRecord | null }[]
): void {
  const maxSeq = queryOne("SELECT COALESCE(MAX(seq), 0) AS m FROM history WHERE map_id = ?", [mapId]) as { m: number } | null;
  const nextSeq = (maxSeq?.m ?? 0) + 1;

  // Purge redo entries beyond current position
  execute("DELETE FROM history WHERE map_id = ? AND seq > ?", [mapId, nextSeq - 1]);

  // Limit to 100 entries
  const count = queryOne("SELECT COUNT(*) AS cnt FROM history WHERE map_id = ?", [mapId]) as { cnt: number } | null;
  if ((count?.cnt ?? 0) >= 100) {
    const oldest = queryOne("SELECT MIN(seq) AS m FROM history WHERE map_id = ?", [mapId]) as { m: number } | null;
    if (oldest) execute("DELETE FROM history WHERE map_id = ? AND seq = ?", [mapId, oldest.m]);
  }

  const beforeRows = changedCells.filter(c => c.before).map(c => serializeCellRow(mapId, c.before!));
  const afterRows = changedCells.filter(c => c.after).map(c => serializeCellRow(mapId, c.after!));

  execute(
    "INSERT INTO history (map_id, seq, label, source, timestamp, cells_before, cells_after) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [mapId, nextSeq, label, source, new Date().toISOString(), JSON.stringify(beforeRows), JSON.stringify(afterRows)]
  );
}

export function undoDb(mapId: string): { cellsBefore: CellRow[]; cellsAfter: CellRow[]; label: string } | null {
  const row = queryOne(
    "SELECT seq, label, cells_before, cells_after FROM history WHERE map_id = ? ORDER BY seq DESC LIMIT 1",
    [mapId]
  ) as { seq: number; label: string; cells_before: string; cells_after: string } | null;
  if (!row) return null;

  const beforeRows = JSON.parse(row.cells_before) as CellRow[];
  const afterRows = JSON.parse(row.cells_after) as CellRow[];

  const undo = db().transaction(() => {
    // Delete cells created by this action
    for (const a of afterRows) {
      const stillExists = beforeRows.some(b => b.row === a.row && b.col === a.col);
      if (!stillExists) {
        execute("DELETE FROM cells WHERE map_id = ? AND row = ? AND col = ?", [mapId, a.row, a.col]);
      }
    }
    // Restore cells to before state
    for (const b of beforeRows) {
      if (!b.terrain) {
        // Cell was undesigned before — delete it
        execute("DELETE FROM cells WHERE map_id = ? AND row = ? AND col = ?", [mapId, b.row, b.col]);
      } else {
        execute(
          `INSERT INTO cells (map_id, row, col, terrain, biome, tags, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(map_id, row, col)
           DO UPDATE SET terrain = excluded.terrain, biome = excluded.biome, tags = excluded.tags, note = excluded.note`,
          [b.map_id, b.row, b.col, b.terrain, b.biome, b.tags, b.note]
        );
      }
    }
    // Remove the history entry
    execute("DELETE FROM history WHERE map_id = ? AND seq = ?", [mapId, row.seq]);
  });
  undo();

  return { cellsBefore: beforeRows, cellsAfter: afterRows, label: row.label };
}

export function canUndoDb(mapId: string): boolean {
  const r = queryOne("SELECT COUNT(*) AS cnt FROM history WHERE map_id = ?", [mapId]) as { cnt: number } | null;
  return (r?.cnt ?? 0) > 0;
}

/* ============================================================
 *  Range query for visible cells
 * ============================================================ */

function getSeedCoordsForLayout(layout: LayoutType): GridCoordinate[] {
  const origin = { row: 0, col: 0 };
  return [origin, ...getNeighborCoordsForLayout(origin, layout)];
}

export interface CellRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export function queryCellsInRange(mapId: string, range: CellRange, options?: { includeUndesigned?: boolean }): ActiveCell[] {
  const includeUndesigned = options?.includeUndesigned ?? true;

  // Get map layout to determine coordinate system
  const mapRow = getMapDb(mapId);
  const layout: LayoutType = mapRow?.layout === "square" ? "square" : "flat-top-even-q";

  const cnt = getCellCountDb(mapId);
  if (cnt === 0) {
    return getSeedCoordsForLayout(layout).map((c) => ({
      id: createCellId(c.row, c.col),
      display_coord: createDisplayCoord(c.row, c.col),
      row: c.row,
      col: c.col,
      status: "undesigned" as const,
      terrain: null,
      biome: null,
      tags: [] as TagKey[],
      note: "",
      is_seed: true
    }));
  }

  const pad = 1;
  const rows = queryAll(
    `SELECT row, col, terrain, biome, tags, note FROM cells
     WHERE map_id = ? AND row BETWEEN ? AND ? AND col BETWEEN ? AND ?`,
    [mapId, range.minRow - pad, range.maxRow + pad, range.minCol - pad, range.maxCol + pad]
  ) as unknown as CellRow[];

  const allCoords = new Map<string, GridCoordinate>();

  for (const row of rows) {
    const coord: GridCoordinate = { row: row.row, col: row.col };
    const id = createCellId(row.row, row.col);

    if (row.row >= range.minRow && row.row <= range.maxRow && row.col >= range.minCol && row.col <= range.maxCol) {
      allCoords.set(id, coord);
    }

    if (includeUndesigned) {
      for (const n of getNeighborCoordsForLayout(coord, layout)) {
        if (n.row >= range.minRow && n.row <= range.maxRow && n.col >= range.minCol && n.col <= range.maxCol) {
          allCoords.set(createCellId(n.row, n.col), n);
        }
      }
    }
  }

  const designedRowMap = new Map<string, CellRow>();
  for (const row of rows) {
    designedRowMap.set(createCellId(row.row, row.col), row);
  }

  return [...allCoords.values()]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((coord) => {
      const id = createCellId(coord.row, coord.col);
      const d = designedRowMap.get(id);
      return {
        id,
        display_coord: createDisplayCoord(coord.row, coord.col),
        row: coord.row,
        col: coord.col,
        status: d ? ("designed" as const) : ("undesigned" as const),
        terrain: (d?.terrain ?? null) as ActiveCell["terrain"],
        biome: (d?.biome ?? null) as ActiveCell["biome"],
        tags: d ? (JSON.parse(d.tags) as TagKey[]) : ([] as TagKey[]),
        note: d?.note ?? "",
        is_seed: false
      };
    });
}

/* ============================================================
 *  Build full document from DB
 * ============================================================ */

export function buildDocumentFromDb(mapId: string): MapDocument | null {
  const meta = getMapDb(mapId);
  if (!meta) return null;
  const cells = getCellsForExport(mapId);
  return {
    schema_version: 1 as const,
    meta: {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      tags: JSON.parse(meta.tags) as string[],
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      revision: meta.revision
    },
    grid: {
      layout: meta.layout as LayoutType,
      origin: { row: 0, col: 0 }
    },
    cells
  };
}

export function saveDocumentToDb(doc: MapDocument): void {
  const existing = getMapDb(doc.meta.id);
  if (existing) {
    updateMapMetaDb(doc.meta.id, {
      name: doc.meta.name,
      description: doc.meta.description,
      tags: JSON.stringify(doc.meta.tags),
      updated_at: doc.meta.updated_at,
      revision: doc.meta.revision
    });
    execute("DELETE FROM cells WHERE map_id = ?", [doc.meta.id]);
  } else {
    insertMapDb({
      id: doc.meta.id,
      name: doc.meta.name,
      description: doc.meta.description,
      tags: JSON.stringify(doc.meta.tags),
      layout: doc.grid.layout,
      schema_version: doc.schema_version,
      created_at: doc.meta.created_at,
      updated_at: doc.meta.updated_at,
      revision: doc.meta.revision
    });
  }
  for (const cell of doc.cells) {
    upsertCellDb(doc.meta.id, cell);
  }
}

/* ============================================================
 *  JSON import / export
 * ============================================================ */

export function importJsonMap(rawJson: string): { mapId: string; cellCount: number } {
  const parsed = JSON.parse(rawJson);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON: not an object");
  if (!parsed.meta?.id) throw new Error("missing meta.id");
  if (!parsed.meta?.name) throw new Error("missing meta.name");
  if (!Array.isArray(parsed.cells)) throw new Error("missing or invalid cells array");

  const now = new Date().toISOString();
  const doc: MapDocument = {
    schema_version: 1 as const,
    meta: {
      id: parsed.meta.id,
      name: parsed.meta.name,
      description: parsed.meta.description ?? "",
      tags: Array.isArray(parsed.meta.tags) ? parsed.meta.tags.map(String) : [],
      created_at: parsed.meta.created_at ?? now,
      updated_at: now,
      revision: (parsed.meta.revision ?? 0) + 1
    },
    grid: {
      layout: parsed.grid?.layout ?? "flat-top-even-q",
      origin: { row: 0, col: 0 }
    },
    cells: (parsed.cells as Record<string, unknown>[]).map((c) => ({
      row: Number(c.row),
      col: Number(c.col),
      terrain: String(c.terrain) as DesignedCellRecord["terrain"],
      biome: (c.biome != null ? String(c.biome) : null) as DesignedCellRecord["biome"],
      tags: (Array.isArray(c.tags) ? c.tags.map(String) : []) as TagKey[],
      note: String(c.note ?? "")
    }))
  };

  saveDocumentToDb(doc);
  return { mapId: doc.meta.id, cellCount: doc.cells.length };
}

export function importLegacyJsonFiles(): number {
  let files: string[];
  try {
    files = fs.readdirSync(MAP_STORAGE_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return 0;
  }

  let imported = 0;
  for (const file of files) {
    const filePath = path.join(MAP_STORAGE_DIR, file);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      if (!parsed?.meta?.id) continue;
      if (getMapDb(parsed.meta.id)) continue;
      importJsonMap(content);
      imported++;
    } catch {
      // skip problematic files
    }
  }
  return imported;
}

export function exportMapToFile(mapId: string): { fileName: string; path: string } {
  const doc = buildDocumentFromDb(mapId);
  if (!doc) throw new Error(`map ${mapId} not found`);
  const fileName = `${slugify(doc.meta.name) || doc.meta.id}.json`;
  const outPath = path.join(EXPORT_STORAGE_DIR, fileName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), "utf8");
  return { fileName, path: outPath };
}

export async function exportPngFromDb(
  mapId: string,
  options: Partial<ExportRenderOptions> = {}
): Promise<{ fileName: string; path: string }> {
  const doc = buildDocumentFromDb(mapId);
  if (!doc) throw new Error(`map ${mapId} not found`);
  const runtime = createRuntimeState(doc);

  const baseOptions: ExportRenderOptions = {
    preset: "clean",
    includeCoordinates: false,
    includeShorthand: false,
    includeGrid: true,
    includeUndesigned: false,
    background: "#F4F0E6",
    transparent: false,
    padding: 32,
    scale: 2
  };
  const resolved = { ...baseOptions, ...options };
  if (resolved.preset === "reference") {
    resolved.includeCoordinates = true;
    resolved.includeShorthand = true;
  }

  const scene = buildExportScene({ map: runtime, options: resolved });
  const svg = renderSvgString(scene);
  const fileName = `${slugify(runtime.document.meta.name) || runtime.document.meta.id}-${resolved.preset}.png`;
  const filePath = path.join(EXPORT_STORAGE_DIR, fileName);
  fs.mkdirSync(EXPORT_STORAGE_DIR, { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(filePath);
  return { fileName, path: filePath };
}

/* ============================================================
 *  Helpers
 * ============================================================ */

function serializeCellRow(mapId: string, cell: DesignedCellRecord): CellRow {
  return {
    map_id: mapId,
    row: cell.row,
    col: cell.col,
    terrain: cell.terrain,
    biome: cell.biome ?? null,
    tags: JSON.stringify(cell.tags ?? []),
    note: cell.note ?? ""
  };
}

function deserializeCellRow(row: CellRow): DesignedCellRecord {
  return {
    row: row.row,
    col: row.col,
    terrain: row.terrain as DesignedCellRecord["terrain"],
    biome: row.biome as DesignedCellRecord["biome"],
    tags: JSON.parse(row.tags) as TagKey[],
    note: row.note
  };
}
