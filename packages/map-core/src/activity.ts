import { createCellId, createDisplayCoord } from "./coords.js";
import { getNeighborCoords } from "./neighbors.js";
import type {
  ActiveCell,
  DesignedCellRecord,
  GridCoordinate,
  MapDocument
} from "./types.js";

function sortCoords(a: GridCoordinate, b: GridCoordinate): number {
  if (a.row !== b.row) {
    return a.row - b.row;
  }
  return a.col - b.col;
}

export function getSeedCoordinates(): GridCoordinate[] {
  const origin = { row: 0, col: 0 };
  return [origin, ...getNeighborCoords(origin)].sort(sortCoords);
}

export function buildActiveCells(document: MapDocument): ActiveCell[] {
  const designedById = new Map<string, DesignedCellRecord>();
  for (const cell of document.cells) {
    designedById.set(createCellId(cell.row, cell.col), cell);
  }

  const coords = new Map<string, GridCoordinate>();
  if (document.cells.length === 0) {
    for (const seed of getSeedCoordinates()) {
      coords.set(createCellId(seed.row, seed.col), seed);
    }
  } else {
    for (const cell of document.cells) {
      coords.set(createCellId(cell.row, cell.col), { row: cell.row, col: cell.col });
      for (const neighbor of getNeighborCoords(cell)) {
        coords.set(createCellId(neighbor.row, neighbor.col), neighbor);
      }
    }
  }

  return [...coords.values()]
    .sort(sortCoords)
    .map((coord) => {
      const designed = designedById.get(createCellId(coord.row, coord.col));
      return {
        id: createCellId(coord.row, coord.col),
        display_coord: createDisplayCoord(coord.row, coord.col),
        row: coord.row,
        col: coord.col,
        status: designed ? "designed" : "undesigned",
        terrain: designed?.terrain ?? null,
        biome: designed?.biome ?? null,
        tags: designed?.tags ?? [],
        note: designed?.note ?? "",
        is_seed: document.cells.length === 0
      } satisfies ActiveCell;
    });
}
