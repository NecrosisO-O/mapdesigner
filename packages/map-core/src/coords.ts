import type { GridCoordinate } from "./types.js";

export function createCellId(row: number, col: number): string {
  return `cell@${row},${col}`;
}

export function createDisplayCoord(row: number, col: number): string {
  return `R${row}C${col}`;
}

export function parseCellId(value: string): GridCoordinate | null {
  const match = /^cell@(-?\d+),(-?\d+)$/.exec(value);
  if (!match) {
    return null;
  }
  return {
    row: Number(match[1]),
    col: Number(match[2])
  };
}

export function parseDisplayCoord(value: string): GridCoordinate | null {
  const match = /^R(-?\d+)C(-?\d+)$/.exec(value);
  if (!match) {
    return null;
  }
  return {
    row: Number(match[1]),
    col: Number(match[2])
  };
}

export function sameCoord(left: GridCoordinate, right: GridCoordinate): boolean {
  return left.row === right.row && left.col === right.col;
}
