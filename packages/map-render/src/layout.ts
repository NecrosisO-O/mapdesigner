import type { ActiveCell, GridCoordinate } from "@mapdesigner/map-core";
import type { HexCellLayout, HexLayoutOptions } from "./types.js";

const SQRT3 = Math.sqrt(3);

export function centerForCoord(coord: GridCoordinate, size: number): { x: number; y: number } {
  const x = size * 1.5 * coord.col;
  const y = -size * SQRT3 * (coord.row + coord.col / 2);
  return { x, y };
}

function centerForCell(cell: ActiveCell, size: number): { x: number; y: number } {
  return centerForCoord(cell, size);
}

function polygonPoints(x: number, y: number, size: number): string {
  const points = [
    [x + size, y],
    [x + size / 2, y + (SQRT3 * size) / 2],
    [x - size / 2, y + (SQRT3 * size) / 2],
    [x - size, y],
    [x - size / 2, y - (SQRT3 * size) / 2],
    [x + size / 2, y - (SQRT3 * size) / 2]
  ];
  return points.map(([px, py]) => `${px},${py}`).join(" ");
}

export function buildHexLayout(
  cells: ActiveCell[],
  options: HexLayoutOptions
): { layout: HexCellLayout[]; width: number; height: number; minX: number; minY: number } {
  const size = options.size;
  const padding = options.padding ?? size * 2;
  const centers = cells.map((cell) => ({ cell, ...centerForCell(cell, size) }));
  const extraCenters = (options.extraCoords ?? []).map((coord) => centerForCoord(coord, size));
  const boundsCenters = [
    ...centers,
    ...extraCenters,
    ...(options.boundsCoords ?? []).map((coord) => centerForCoord(coord, size))
  ];

  const minCenterX = Math.min(...boundsCenters.map((entry) => entry.x), 0);
  const maxCenterX = Math.max(...boundsCenters.map((entry) => entry.x), 0);
  const minCenterY = Math.min(...boundsCenters.map((entry) => entry.y), 0);
  const maxCenterY = Math.max(...boundsCenters.map((entry) => entry.y), 0);

  const minX = minCenterX - size - padding;
  const maxX = maxCenterX + size + padding;
  const minY = minCenterY - (SQRT3 * size) / 2 - padding;
  const maxY = maxCenterY + (SQRT3 * size) / 2 + padding;

  return {
    width: maxX - minX,
    height: maxY - minY,
    minX,
    minY,
    layout: centers.map((entry) => ({
      cell: entry.cell,
      centerX: entry.x - minX,
      centerY: entry.y - minY,
      points: polygonPoints(entry.x - minX, entry.y - minY, size)
    }))
  };
}
