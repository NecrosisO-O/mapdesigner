import type Database from "better-sqlite3";
import type { CellRange, MapBounds, TerrainKey } from "@mapdesigner/map-core";

const bin = (value: string) => `CAST((${value} - ((${value} % 32 + 32) % 32)) / 32 AS INTEGER)`;

/** Persist coarse counts; triggers keep them exact across edits, undo and bulk operations. */
export function initializeDerivedSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS derived_maps (map_id TEXT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS terrain_tiles (
      map_id TEXT REFERENCES derived_maps(map_id) ON DELETE CASCADE, r INTEGER, c INTEGER, terrain TEXT, n INTEGER NOT NULL,
      PRIMARY KEY(map_id,r,c,terrain)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS material_counts (
      map_id TEXT REFERENCES derived_maps(map_id) ON DELETE CASCADE, kind TEXT, value TEXT, n INTEGER NOT NULL,
      PRIMARY KEY(map_id,kind,value)
    ) WITHOUT ROWID;
  `);
  const add = `
    INSERT INTO terrain_tiles VALUES (NEW.map_id, ${bin("NEW.row")}, ${bin("NEW.col")}, NEW.terrain, 1)
      ON CONFLICT(map_id,r,c,terrain) DO UPDATE SET n=n+1;
    INSERT INTO material_counts VALUES (NEW.map_id, 'terrain', NEW.terrain, 1) ON CONFLICT(map_id,kind,value) DO UPDATE SET n=n+1;
    INSERT INTO material_counts SELECT NEW.map_id, 'biome', NEW.biome, 1 WHERE NEW.biome IS NOT NULL ON CONFLICT(map_id,kind,value) DO UPDATE SET n=n+1;
    INSERT INTO material_counts SELECT DISTINCT NEW.map_id, 'tag', value, 1 FROM json_each(NEW.tags_json) WHERE true ON CONFLICT(map_id,kind,value) DO UPDATE SET n=n+1;
  `;
  const remove = `
    UPDATE terrain_tiles SET n=n-1 WHERE map_id=OLD.map_id AND r=${bin("OLD.row")} AND c=${bin("OLD.col")} AND terrain=OLD.terrain;
    DELETE FROM terrain_tiles WHERE map_id=OLD.map_id AND r=${bin("OLD.row")} AND c=${bin("OLD.col")} AND terrain=OLD.terrain AND n=0;
    UPDATE material_counts SET n=n-1 WHERE map_id=OLD.map_id AND ((kind='terrain' AND value=OLD.terrain) OR (kind='biome' AND value=OLD.biome) OR (kind='tag' AND value IN (SELECT value FROM json_each(OLD.tags_json))));
    DELETE FROM material_counts WHERE map_id=OLD.map_id AND n=0;
  `;
  for (const [name, event, ref, body] of [
    ["insert", "INSERT", "NEW", add],
    ["delete", "DELETE", "OLD", remove],
    ["update_old", "UPDATE OF row,col,map_id,terrain,biome,tags_json", "OLD", remove],
    ["update_new", "UPDATE OF row,col,map_id,terrain,biome,tags_json", "NEW", add]
  ])
    db.exec(`CREATE TRIGGER IF NOT EXISTS derived_cells_${name} AFTER ${event} ON cells
    WHEN EXISTS(SELECT 1 FROM derived_maps WHERE map_id=${ref}.map_id) BEGIN ${body} END;`);
}

export function ensureDerivedData(db: Database.Database, id: string): void {
  if (db.prepare("SELECT 1 FROM derived_maps WHERE map_id=?").get(id)) return;
  db.transaction(() => {
    db.prepare("INSERT INTO derived_maps VALUES (?)").run(id);
    db.prepare(
      `INSERT INTO terrain_tiles SELECT map_id, ${bin("row")}, ${bin("col")}, terrain, count(*) FROM cells WHERE map_id=? GROUP BY 1,2,3,4`
    ).run(id);
    db.prepare(
      "INSERT INTO material_counts SELECT map_id,'terrain',terrain,count(*) FROM cells WHERE map_id=? GROUP BY terrain"
    ).run(id);
    db.prepare(
      "INSERT INTO material_counts SELECT map_id,'biome',biome,count(*) FROM cells WHERE map_id=? AND biome IS NOT NULL GROUP BY biome"
    ).run(id);
    db.prepare(
      "INSERT INTO material_counts SELECT c.map_id,'tag',j.value,count(*) FROM cells c,json_each(c.tags_json) j WHERE c.map_id=? GROUP BY j.value"
    ).run(id);
  })();
}

export function readOverviewTerrain(
  db: Database.Database,
  id: string,
  range: CellRange,
  bounds: MapBounds
) {
  const span = Math.max(range.maxRow - range.minRow + 1, range.maxCol - range.minCol + 1);
  let size = Math.max(1, Math.ceil(span / 64));
  if (size >= 8) {
    size = 32 * 2 ** Math.ceil(Math.log2(Math.max(1, size / 32)));
    while (
      (Math.floor(range.maxRow / size) - Math.floor(range.minRow / size) + 1) *
        (Math.floor(range.maxCol / size) - Math.floor(range.minCol / size) + 1) >
      4096
    )
      size *= 2;
  }
  const originRow = size >= 32 ? Math.floor(range.minRow / size) * size : range.minRow;
  const originCol = size >= 32 ? Math.floor(range.minCol / size) * size : range.minCol;
  type Row = { r: number; c: number; terrain: TerrainKey; count: number };
  const rows: Row[] = [];
  const readCells = (
    minRow: number,
    maxRow: number,
    minCol: number,
    maxCol: number,
    vertical = false
  ) => {
    if (minRow > maxRow || minCol > maxCol) return;
    rows.push(
      ...(db
        .prepare(
          `SELECT CAST((row - ?) / ? AS INTEGER) r, CAST((col - ?) / ? AS INTEGER) c, terrain, count(*) count
      FROM cells INDEXED BY ${vertical ? "idx_cells_map_col_row" : "idx_cells_map_row_col"} WHERE map_id=? AND row BETWEEN ? AND ? AND col BETWEEN ? AND ? GROUP BY r,c,terrain`
        )
        .all(originRow, size, originCol, size, id, minRow, maxRow, minCol, maxCol) as Row[])
    );
  };
  if (size < 32) {
    readCells(range.minRow, range.maxRow, range.minCol, range.maxCol);
  } else {
    ensureDerivedData(db, id);
    const whole =
      bounds.min_row === null ||
      (range.minRow <= bounds.min_row &&
        range.maxRow >= bounds.max_row! &&
        range.minCol <= bounds.min_col! &&
        range.maxCol >= bounds.max_col!);
    const loR = Math.ceil(range.minRow / 32),
      hiR = Math.floor((range.maxRow + 1) / 32) - 1;
    const loC = Math.ceil(range.minCol / 32),
      hiC = Math.floor((range.maxCol + 1) / 32) - 1;
    const where = whole ? "" : " AND r BETWEEN ? AND ? AND c BETWEEN ? AND ?";
    rows.push(
      ...(db
        .prepare(
          `SELECT CAST((r*32 - ?) / ? AS INTEGER) r, CAST((c*32 - ?) / ? AS INTEGER) c, terrain, sum(n) count
      FROM terrain_tiles WHERE map_id=?${where} GROUP BY 1,2,terrain`
        )
        .all(originRow, size, originCol, size, id, ...(whole ? [] : [loR, hiR, loC, hiC])) as Row[])
    );
    if (!whole) {
      if (loR > hiR || loC > hiC) readCells(range.minRow, range.maxRow, range.minCol, range.maxCol);
      else {
        readCells(range.minRow, loR * 32 - 1, range.minCol, range.maxCol);
        readCells((hiR + 1) * 32, range.maxRow, range.minCol, range.maxCol);
        readCells(loR * 32, (hiR + 1) * 32 - 1, range.minCol, loC * 32 - 1, true);
        readCells(loR * 32, (hiR + 1) * 32 - 1, (hiC + 1) * 32, range.maxCol, true);
      }
    }
  }
  const combined = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.r},${row.c},${row.terrain}`,
      prior = combined.get(key);
    if (prior) prior.count += row.count;
    else combined.set(key, row);
  }
  return { size, originRow, originCol, rows: [...combined.values()] };
}
