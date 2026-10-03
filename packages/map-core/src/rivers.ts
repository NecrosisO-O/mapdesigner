import { sameCoord } from "./coords.js";
import type {
  ActiveCell,
  DesignedCellRecord,
  GridCoordinate,
  RiverFeature,
  RiverPathSample,
  RiverPoint,
  TerrainKey
} from "./types.js";

export const DEFAULT_RIVER_WIDTH = 4;
export const MIN_RIVER_WIDTH = 0.5;
export const MAX_RIVER_WIDTH = 64;

const RIVER_ENDPOINT_WATER_TERRAINS = new Set<TerrainKey>([
  "ocean",
  "sea",
  "lagoon",
  "estuary",
  "lake",
  "salt_lake",
  "river",
  "delta",
  "wetland",
  "tidal_flat",
  "coast"
]);

function axialToCube(coord: GridCoordinate): { x: number; y: number; z: number } {
  const x = coord.col;
  const z = coord.row;
  return { x, y: -x - z, z };
}

function cubeToAxial(cube: { x: number; y: number; z: number }): GridCoordinate {
  return {
    row: cube.z,
    col: cube.x
  };
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function roundCube(cube: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  let x = Math.round(cube.x);
  let y = Math.round(cube.y);
  let z = Math.round(cube.z);

  const xDiff = Math.abs(x - cube.x);
  const yDiff = Math.abs(y - cube.y);
  const zDiff = Math.abs(z - cube.z);

  if (xDiff > yDiff && xDiff > zDiff) {
    x = -y - z;
  } else if (yDiff > zDiff) {
    y = -x - z;
  } else {
    z = -x - y;
  }

  return { x, y, z };
}

export function getHexDistance(left: GridCoordinate, right: GridCoordinate): number {
  const rowDelta = left.row - right.row;
  const colDelta = left.col - right.col;
  return (Math.abs(rowDelta) + Math.abs(colDelta) + Math.abs(rowDelta + colDelta)) / 2;
}

export function buildHexLine(start: GridCoordinate, end: GridCoordinate): GridCoordinate[] {
  const distance = getHexDistance(start, end);
  if (!Number.isSafeInteger(distance) || distance > 500_000)
    throw new Error("hex line exceeds the 500000 cell budget");
  if (distance === 0) {
    return [{ row: start.row, col: start.col }];
  }

  const startCube = axialToCube(start);
  const endCube = axialToCube(end);
  const line: GridCoordinate[] = [];
  const seen = new Set<string>();

  for (let index = 0; index <= distance; index += 1) {
    const amount = index / distance;
    const rounded = roundCube({
      x: lerp(startCube.x, endCube.x, amount),
      y: lerp(startCube.y, endCube.y, amount),
      z: lerp(startCube.z, endCube.z, amount)
    });
    const coord = cubeToAxial(rounded);
    const key = coord.row + "," + coord.col;
    if (!seen.has(key)) {
      seen.add(key);
      line.push(coord);
    }
  }

  return line;
}

function normalizeRiverWidth(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(MAX_RIVER_WIDTH, Math.max(MIN_RIVER_WIDTH, value));
}

function pointWidths(points: RiverPoint[]): number[] {
  const widths = points.map((point) => normalizeRiverWidth(point.width));
  const next = new Array<number>(points.length).fill(-1);
  let following = -1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (widths[i] !== null) following = i;
    next[i] = following;
  }
  let previous = -1;
  return widths.map((width, i) => {
    if (width !== null) {
      previous = i;
      return width!;
    }
    const after = next[i]!;
    if (previous >= 0 && after >= 0)
      return lerp(widths[previous]!, widths[after]!, (i - previous) / (after - previous));
    return previous >= 0 ? widths[previous]! : after >= 0 ? widths[after]! : DEFAULT_RIVER_WIDTH;
  });
}

export function expandRiverPath(river: RiverFeature): RiverPathSample[] {
  if (river.points.length === 0) {
    return [];
  }
  const widths = pointWidths(river.points);
  if (river.points.length === 1) {
    const point = river.points[0]!;
    return [
      {
        row: point.row,
        col: point.col,
        width: widths[0]!,
        river_id: river.id,
        river_name: river.name,
        index: 0
      }
    ];
  }

  const samples: RiverPathSample[] = [];
  for (let pointIndex = 0; pointIndex < river.points.length - 1; pointIndex += 1) {
    const start = river.points[pointIndex]!;
    const end = river.points[pointIndex + 1]!;
    const startWidth = widths[pointIndex]!;
    const endWidth = widths[pointIndex + 1]!;
    const line = buildHexLine(start, end);

    line.forEach((coord, lineIndex) => {
      if (samples.length > 0 && lineIndex === 0 && sameCoord(samples[samples.length - 1]!, coord)) {
        return;
      }
      const amount = line.length > 1 ? lineIndex / (line.length - 1) : 0;
      samples.push({
        row: coord.row,
        col: coord.col,
        width: lerp(startWidth, endWidth, amount),
        river_id: river.id,
        river_name: river.name,
        index: samples.length
      });
    });
  }

  return samples;
}

export function findRiversAtCell(
  rivers: RiverFeature[],
  target: GridCoordinate
): RiverPathSample[] {
  return rivers.flatMap((river) =>
    expandRiverPath(river).filter((sample) => sameCoord(sample, target))
  );
}

export function isRiverWaterEndpointCell(
  cell: Pick<ActiveCell | DesignedCellRecord, "terrain"> | null | undefined
): boolean {
  return Boolean(cell?.terrain && RIVER_ENDPOINT_WATER_TERRAINS.has(cell.terrain));
}

export function getRiverEndpointConnections(
  river: RiverFeature,
  cells: Array<ActiveCell | DesignedCellRecord>
): { startConnected: boolean; endConnected: boolean } {
  const first = river.points[0];
  const last = river.points[river.points.length - 1];
  if (!first || !last) {
    return { startConnected: false, endConnected: false };
  }
  const startCell = cells.find((cell) => sameCoord(cell, first));
  const endCell = cells.find((cell) => sameCoord(cell, last));
  return {
    startConnected: isRiverWaterEndpointCell(startCell),
    endConnected: isRiverWaterEndpointCell(endCell)
  };
}
