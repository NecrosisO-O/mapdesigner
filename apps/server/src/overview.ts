import {
  buildHexLine,
  type CellRange,
  type MapOverview,
  type RiverFeature,
  type TerrainKey
} from "@mapdesigner/map-core";
import { getDatabase } from "./db.js";
import { getMapSummary } from "./repository.js";
import { badRequest } from "./errors.js";

/** A fixed maximum grid covers the entire requested range, including sparse edges. */
export async function getOverview(id: string, range: CellRange): Promise<MapOverview> {
  if (
    ![range.minRow, range.maxRow, range.minCol, range.maxCol].every(Number.isSafeInteger) ||
    range.minRow > range.maxRow ||
    range.minCol > range.maxCol ||
    Math.max(
      Math.abs(range.minRow),
      Math.abs(range.maxRow),
      Math.abs(range.minCol),
      Math.abs(range.maxCol)
    ) > 1_000_000_000
  )
    throw badRequest("invalid overview range");
  const summary = await getMapSummary(id),
    db = getDatabase();
  const size = Math.max(
    1,
    Math.ceil(Math.max(range.maxRow - range.minRow + 1, range.maxCol - range.minCol + 1) / 64)
  );
  const rows = db
    .prepare(
      "SELECT CAST((row - ?) / ? AS INTEGER) AS r, CAST((col - ?) / ? AS INTEGER) AS c, terrain, COUNT(*) AS count FROM cells WHERE map_id = ? AND row BETWEEN ? AND ? AND col BETWEEN ? AND ? GROUP BY r, c, terrain"
    )
    .all(
      range.minRow,
      size,
      range.minCol,
      size,
      id,
      range.minRow,
      range.maxRow,
      range.minCol,
      range.maxCol
    ) as Array<{ r: number; c: number; terrain: TerrainKey; count: number }>;
  const tiles = new Map<string, MapOverview["tiles"][number]>(),
    dominant = new Map<string, number>();
  let count = 0;
  for (const row of rows) {
    const key = row.r + "," + row.c;
    const tile = tiles.get(key) ?? {
      row: range.minRow + row.r * size,
      col: range.minCol + row.c * size,
      terrain: null,
      count: 0,
      river: false
    };
    tile.count += row.count;
    count += row.count;
    if (row.count > (dominant.get(key) ?? 0)) {
      tile.terrain = row.terrain;
      dominant.set(key, row.count);
    }
    tiles.set(key, tile);
  }
  const rivers = db
    .prepare(
      "SELECT json FROM features WHERE map_id = ? AND kind = 'river' AND bounds_min_row <= ? AND bounds_max_row >= ? AND bounds_min_col <= ? AND bounds_max_col >= ?"
    )
    .iterate(id, range.maxRow, range.minRow, range.maxCol, range.minCol) as Iterable<{
    json: string;
  }>;
  for (const row of rivers) {
    const river = JSON.parse(row.json) as RiverFeature;
    for (let i = 1; i < river.points.length; i++) {
      const bucket = (p: RiverFeature["points"][number]) => ({
        row: Math.floor((p.row - range.minRow) / size),
        col: Math.floor((p.col - range.minCol) / size)
      });
      const a = bucket(river.points[i - 1]!),
        b = bucket(river.points[i]!);
      // Clip to the overview grid before generating samples, also for offscreen endpoints.
      const deltaR = b.row - a.row,
        deltaC = b.col - a.col;
      let start = 0,
        end = 1;
      for (const [value, delta] of [
        [a.row, deltaR],
        [a.col, deltaC]
      ]) {
        if (!delta) {
          if (value! < 0 || value! > 63) end = -1;
          continue;
        }
        const t0 = (0 - value!) / delta!,
          t1 = (63 - value!) / delta!;
        start = Math.max(start, Math.min(t0, t1));
        end = Math.min(end, Math.max(t0, t1));
      }
      if (end < start) continue;
      for (const coord of buildHexLine(
        { row: Math.round(a.row + deltaR * start), col: Math.round(a.col + deltaC * start) },
        { row: Math.round(a.row + deltaR * end), col: Math.round(a.col + deltaC * end) }
      )) {
        if (coord.row < 0 || coord.col < 0 || coord.row > 63 || coord.col > 63) continue;
        const key = coord.row + "," + coord.col;
        const tile = tiles.get(key) ?? {
          row: range.minRow + coord.row * size,
          col: range.minCol + coord.col * size,
          terrain: null,
          count: 0,
          river: true
        };
        tile.river = true;
        tiles.set(key, tile);
      }
    }
  }
  return {
    map_id: id,
    revision: summary.meta.revision,
    range,
    bucket_size: size,
    designed_cell_count: count,
    tiles: [...tiles.values()]
  };
}
