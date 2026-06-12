import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_FILE, STORAGE_DIR } from "./config.js";
import { storageError } from "./errors.js";

let connection: Database.Database | null = null;

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

export function getDatabase(): Database.Database {
  if (connection) {
    return connection;
  }

  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    connection = new Database(DATABASE_FILE);
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");
    connection.exec(`
      CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        layout TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        bounds_min_row INTEGER,
        bounds_max_row INTEGER,
        bounds_min_col INTEGER,
        bounds_max_col INTEGER,
        designed_cell_count INTEGER NOT NULL DEFAULT 0,
        history_cursor INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS cells (
        map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        row INTEGER NOT NULL,
        col INTEGER NOT NULL,
        terrain TEXT NOT NULL,
        biome TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (map_id, row, col)
      );

      CREATE INDEX IF NOT EXISTS idx_cells_map_row_col ON cells(map_id, row, col);
      CREATE INDEX IF NOT EXISTS idx_cells_map_col_row ON cells(map_id, col, row);
      CREATE INDEX IF NOT EXISTS idx_cells_map_terrain ON cells(map_id, terrain);
      CREATE INDEX IF NOT EXISTS idx_cells_map_biome ON cells(map_id, biome);

      CREATE TABLE IF NOT EXISTS features (
        map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        json TEXT NOT NULL,
        bounds_min_row INTEGER,
        bounds_max_row INTEGER,
        bounds_min_col INTEGER,
        bounds_max_col INTEGER,
        PRIMARY KEY (map_id, kind, feature_id)
      );

      CREATE TABLE IF NOT EXISTS operations (
        map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        command_json TEXT NOT NULL,
        inverse_json TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        PRIMARY KEY (map_id, seq)
      );
    `);
    addColumnIfMissing(connection, "maps", "history_cursor", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(connection, "features", "bounds_min_row", "INTEGER");
    addColumnIfMissing(connection, "features", "bounds_max_row", "INTEGER");
    addColumnIfMissing(connection, "features", "bounds_min_col", "INTEGER");
    addColumnIfMissing(connection, "features", "bounds_max_col", "INTEGER");
    connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_features_map_kind_bounds
        ON features(map_id, kind, bounds_min_row, bounds_max_row, bounds_min_col, bounds_max_col);
    `);
    return connection;
  } catch (error) {
    throw storageError("failed to initialize map database", error);
  }
}

export function closeDatabaseForTests(): void {
  connection?.close();
  connection = null;
}

export function databaseFileExists(): boolean {
  return fs.existsSync(path.resolve(DATABASE_FILE));
}
