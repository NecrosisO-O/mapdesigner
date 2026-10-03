import { DEFAULT_RIVER_WIDTH, getRiverPointWidths, type RiverFeature } from "@mapdesigner/map-core";
import { centerForCoord } from "./layout.js";

export interface RiverGeometryPoint {
  x: number;
  y: number;
  width: number;
  distance: number;
  controlIndex?: number;
}
const cache = new Map<string, RiverGeometryPoint[]>();
let cachePoints = 0;
const number = (value: number) => Number(value.toFixed(3));

/** Monotone Hermite derivatives in axial space keep each coordinate inside its adjacent controls. */
function slopes(values: number[], positions: number[]): number[] {
  const d = values
    .slice(1)
    .map((v, i) => (v - values[i]!) / Math.max(positions[i + 1]! - positions[i]!, 1e-8));
  return values.map((_, i) => {
    if (i === 0) return d[0] ?? 0;
    if (i === values.length - 1) return d[i - 1] ?? 0;
    const a = d[i - 1]!,
      b = d[i]!;
    if (a * b <= 0) return 0;
    const h0 = positions[i]! - positions[i - 1]!,
      h1 = positions[i + 1]! - positions[i]!;
    const w0 = 2 * h1 + h0,
      w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / a + w1 / b);
  });
}
const blend = (a: number, b: number, da: number, db: number, h: number, t: number) => {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a +
    (t3 - 2 * t2 + t) * h * da +
    (-2 * t3 + 3 * t2) * b +
    (t3 - t2) * h * db
  );
};
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y);
function deviation(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
) {
  const length = distance(a, b);
  return length < 1e-8
    ? distance(p, a)
    : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
}

/** Geometry is independent of viewport, style and flow direction. Widths are map units at size 36. */
export function riverGeometry(
  river: RiverFeature,
  detail: "high" | "low" = "high"
): RiverGeometryPoint[] {
  const key = JSON.stringify([river.points, river.width_mode, detail]);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const points = river.points.filter(
    (point, i) =>
      i === 0 || point.row !== river.points[i - 1]!.row || point.col !== river.points[i - 1]!.col
  );
  if (points.length < 2) return [];
  const controls = points.map((point) => centerForCoord(point, 36));
  const positions = [0];
  for (let i = 1; i < points.length; i++)
    positions.push(positions[i - 1]! + distance(controls[i - 1]!, controls[i]!));
  const rowSlopes = slopes(
      points.map((p) => p.row),
      positions
    ),
    colSlopes = slopes(
      points.map((p) => p.col),
      positions
    );
  const result: RiverGeometryPoint[] = [
    { ...controls[0]!, width: 0, distance: 0, controlIndex: 0 }
  ];
  const tolerance = detail === "high" ? 0.25 : 1;
  const maxStep = Math.max(detail === "high" ? 18 : 72, positions.at(-1)! / 40000);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!,
      b = points[i + 1]!,
      h = positions[i + 1]! - positions[i]!;
    const at = (t: number) =>
      centerForCoord(
        {
          row: blend(a.row, b.row, rowSlopes[i]!, rowSlopes[i + 1]!, h, t),
          col: blend(a.col, b.col, colSlopes[i]!, colSlopes[i + 1]!, h, t)
        },
        36
      );
    const append = (t0: number, t1: number, depth: number) => {
      const p0 = at(t0),
        p1 = at(t1),
        middle = (t0 + t1) / 2;
      const error = Math.max(
        deviation(at(middle), p0, p1),
        deviation(at((3 * t0 + t1) / 4), p0, p1),
        deviation(at((t0 + 3 * t1) / 4), p0, p1)
      );
      if ((error > tolerance || distance(p0, p1) > maxStep) && depth < 14) {
        append(t0, middle, depth + 1);
        append(middle, t1, depth + 1);
      } else {
        const previous = result.at(-1)!;
        result.push({
          ...p1,
          width: 0,
          distance: previous.distance + distance(previous, p1),
          ...(t1 === 1 ? { controlIndex: i + 1 } : {})
        });
      }
    };
    append(0, 1, 0);
  }
  const oldWidths = getRiverPointWidths(points, river.width_mode ?? "distance");
  const anchors = result.flatMap((point, index) => {
    if (point.controlIndex === undefined) return [];
    const width =
      river.width_mode === "legacy"
        ? oldWidths[point.controlIndex]
        : points[point.controlIndex]!.width;
    return typeof width === "number" ? [{ index, distance: point.distance, width }] : [];
  });
  let next = 0;
  for (const point of result) {
    while (next < anchors.length && anchors[next]!.distance < point.distance) next++;
    const left = anchors[Math.max(0, next - 1)],
      right = anchors[Math.min(anchors.length - 1, next)];
    const amount =
      left && right && right.distance > left.distance
        ? (point.distance - left.distance) / (right.distance - left.distance)
        : 0;
    point.width = Math.max(
      0.5,
      left && right
        ? left.width + (right.width - left.width) * Math.max(0, Math.min(1, amount))
        : DEFAULT_RIVER_WIDTH
    );
  }
  if (result.length <= 100000) {
    while (cache.size && (cache.size >= 128 || cachePoints + result.length > 100000)) {
      const oldest = cache.keys().next().value!;
      cachePoints -= cache.get(oldest)!.length;
      cache.delete(oldest);
    }
    cache.set(key, result);
    cachePoints += result.length;
  }
  return result;
}

/** Union of tapered quadrilaterals and consistently wound round joints; no offset-bank inversions. */
export function riverBandPath(
  points: Array<{ x: number; y: number; width: number }>,
  extra = 0
): string | null {
  if (points.length < 2) return null;
  const paths: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!,
      r = Math.max(0.05, (p.width + extra) / 2);
    paths.push(
      "M " +
        number(p.x + r) +
        " " +
        number(p.y) +
        " A " +
        number(r) +
        " " +
        number(r) +
        " 0 1 0 " +
        number(p.x - r) +
        " " +
        number(p.y) +
        " A " +
        number(r) +
        " " +
        number(r) +
        " 0 1 0 " +
        number(p.x + r) +
        " " +
        number(p.y) +
        " Z"
    );
    const q = points[i + 1];
    if (!q) continue;
    const length = distance(p, q);
    if (length < 1e-8) continue;
    const nx = -(q.y - p.y) / length,
      ny = (q.x - p.x) / length,
      s = Math.max(0.05, (q.width + extra) / 2);
    const polygon = [
      [p.x + nx * r, p.y + ny * r],
      [q.x + nx * s, q.y + ny * s],
      [q.x - nx * s, q.y - ny * s],
      [p.x - nx * r, p.y - ny * r]
    ];
    paths.push(
      polygon
        .map(([x, y], index) => (index ? "L " : "M ") + number(x!) + " " + number(y!))
        .join(" ") + " Z"
    );
  }
  return paths.join(" ");
}
