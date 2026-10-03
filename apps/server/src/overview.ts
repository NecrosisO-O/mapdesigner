import { riverGeometry } from "@mapdesigner/map-render";
import {
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
  const riverLines: NonNullable<MapOverview["rivers"]> = [];
  let totalPoints = 0,
    limited = false;
  for (const row of rivers) {
    const river = JSON.parse(row.json) as RiverFeature;
    const geometry = riverGeometry(
      {
        ...river,
        points: river.points.map((p) => ({ ...p, row: p.row / size, col: p.col / size }))
      },
      "low"
    );
    const coords = geometry.map((p) => {
      const col = (p.x / 54) * size;
      return { row: (-p.y / (36 * Math.sqrt(3))) * size - col / 2, col };
    });
    const paths: Array<Array<{ row: number; col: number }>> = [];
    let run: Array<{ row: number; col: number }> = [];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1]!,
        b = coords[i]!,
        dr = b.row - a.row,
        dc = b.col - a.col;
      let lo = 0,
        hi = 1;
      for (const [v, d, min, max] of [
        [a.row, dr, range.minRow - 1, range.maxRow + 1],
        [a.col, dc, range.minCol - 1, range.maxCol + 1]
      ]) {
        if (!d) {
          if (v! < min! || v! > max!) hi = -1;
          continue;
        }
        const u = (min! - v!) / d,
          w = (max! - v!) / d;
        lo = Math.max(lo, Math.min(u, w));
        hi = Math.min(hi, Math.max(u, w));
      }
      if (hi < lo) {
        if (run.length > 1) paths.push(run);
        run = [];
        continue;
      }
      const start = { row: a.row + dr * lo, col: a.col + dc * lo },
        end = { row: a.row + dr * hi, col: a.col + dc * hi };
      if (
        run.length &&
        Math.hypot(run.at(-1)!.row - start.row, run.at(-1)!.col - start.col) > 0.0001
      ) {
        paths.push(run);
        run = [];
      }
      if (!run.length) run.push(start);
      run.push(end);
      const bucket = tiles.get(
        Math.floor((start.row - range.minRow) / size) +
          "," +
          Math.floor((start.col - range.minCol) / size)
      );
      if (bucket) bucket.river = true;
      if (hi < 1) {
        paths.push(run);
        run = [];
      }
    }
    if (run.length > 1) paths.push(run);
    const weight = paths.reduce((n, p) => n + p.length, 0);
    if (totalPoints + weight > 100000) {
      limited = true;
      continue;
    }
    totalPoints += weight;
    if (paths.length)
      riverLines.push({
        id: river.id,
        name: river.name,
        color: river.color ?? "#2F83B7",
        width: Math.max(4, ...river.points.map((p) => p.width ?? 4)),
        paths
      });
  }
  return {
    map_id: id,
    revision: summary.meta.revision,
    range,
    bucket_size: size,
    designed_cell_count: count,
    tiles: [...tiles.values()],
    rivers: riverLines,
    river_detail_limited: limited
  };
}
