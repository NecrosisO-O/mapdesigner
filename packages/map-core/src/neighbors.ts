import type { GridCoordinate } from "./types.js";

const AXIAL_DIRECTIONS = [
  { row: 1, col: 0 },
  { row: 0, col: 1 },
  { row: -1, col: 1 },
  { row: -1, col: 0 },
  { row: 0, col: -1 },
  { row: 1, col: -1 }
] as const;

export function getNeighborCoords(coord: GridCoordinate): GridCoordinate[] {
  return AXIAL_DIRECTIONS.map((offset) => ({
    row: coord.row + offset.row,
    col: coord.col + offset.col
  }));
}
