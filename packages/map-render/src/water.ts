import { isOpenWaterTerrain, type ActiveCell, type RiverFeature } from "@mapdesigner/map-core";
import type { HexCellLayout } from "./types.js";
import type { RiverGeometryPoint } from "./river-geometry.js";

const key = (row: number, col: number) => row + "," + col;
const neighbors = [
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1]
];
export function buildWaterGeometry(layout: HexCellLayout[]) {
  const water = layout.filter((entry) => isOpenWaterTerrain(entry.cell.terrain));
  const cells = new Set(water.map((entry) => key(entry.cell.row, entry.cell.col)));
  const outlines: string[] = [];
  for (const entry of water) {
    const vertices = entry.points.split(" ");
    neighbors.forEach(([dr, dc], i) => {
      if (!cells.has(key(entry.cell.row + dr!, entry.cell.col + dc!)))
        outlines.push(
          "M " + vertices[i]!.replace(",", " ") + " L " + vertices[(i + 1) % 6]!.replace(",", " ")
        );
    });
  }
  return {
    surfacePath: water.map((entry) => "M " + entry.points.replaceAll(",", " ") + " Z").join(" "),
    shorePath: outlines.join(" ")
  };
}

export function waterCellLookup(cells: ActiveCell[]) {
  const water = new Set(
    cells.filter((c) => isOpenWaterTerrain(c.terrain)).map((c) => key(c.row, c.col))
  );
  return (point: { x: number; y: number }) => {
    const x = point.x / 54,
      z = -point.y / (36 * Math.sqrt(3)) - x / 2,
      y = -x - z;
    let rx = Math.round(x),
      ry = Math.round(y),
      rz = Math.round(z);
    const dx = Math.abs(rx - x),
      dy = Math.abs(ry - y),
      dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return water.has(key(rz, rx));
  };
}

/** Mouth treatment is local to actual water boundaries, never to viewport endpoints. */
export function riverWaterTransitions(
  points: RiverGeometryPoint[],
  river: RiverFeature,
  isWater: (p: { x: number; y: number }) => boolean
): RiverGeometryPoint[] {
  const crossings: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      startWater = isWater(a);
    if (startWater === isWater(b)) continue;
    let lo = 0,
      hi = 1;
    for (let step = 0; step < 12; step++) {
      const t = (lo + hi) / 2;
      if (isWater({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) === startWater) lo = t;
      else hi = t;
    }
    crossings.push(a.distance + ((b.distance - a.distance) * (lo + hi)) / 2);
  }
  const length = points.at(-1)?.distance ?? 0;
  return points.map((point) => {
    let width = point.width;
    if (!isWater(point)) {
      const transition = Math.max(24, Math.min(72, width * 3));
      const distance = crossings.reduce(
        (min, d) => Math.min(min, Math.abs(point.distance - d)),
        Infinity
      );
      const t = Math.max(0, 1 - distance / transition);
      width *= 1 + 0.28 * t * t * (3 - 2 * t);
    }
    if (river.start_kind === "spring") width *= Math.max(0.08, Math.min(1, point.distance / 24));
    if (river.end_kind === "spring")
      width *= Math.max(0.08, Math.min(1, (length - point.distance) / 24));
    return { ...point, width };
  });
}
