import type { GridCoordinate } from "./types.js";

const EVEN_COLUMN_OFFSETS = [
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 }
] as const;

const ODD_COLUMN_OFFSETS = [
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 0 }
] as const;

export function getNeighborCoords(coord: GridCoordinate): GridCoordinate[] {
  const offsets = coord.col % 2 === 0 ? EVEN_COLUMN_OFFSETS : ODD_COLUMN_OFFSETS;
  return offsets.map((offset) => ({
    row: coord.row + offset.row,
    col: coord.col + offset.col
  }));
}
