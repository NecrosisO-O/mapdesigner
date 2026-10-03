import { describe, it, expect } from "vitest";
import { createEmptyDocument, createRuntimeState, type RiverFeature } from "@mapdesigner/map-core";
import { riverGeometry } from "./river-geometry.js";
import { centerForCoord } from "./layout.js";
import { buildMapScene, filterRiversForRange } from "./scene.js";

const river = (points: RiverFeature["points"]): RiverFeature => ({
  id: "geometry",
  name: "Geometry",
  width_mode: "distance",
  points
});
describe("canonical river geometry", () => {
  it("keeps distance widths when a straight segment is subdivided", () => {
    const data = river([
      { row: 0, col: 0, width: 2 },
      { row: 0, col: 1 },
      { row: 0, col: 10, width: 22 }
    ]);
    const points = riverGeometry(data);
    const control = points.find((p) => p.controlIndex === 1)!;
    expect(control.width).toBeCloseTo(4);
    for (const point of points)
      expect(point.width).toBeCloseTo(2 + (20 * point.distance) / points.at(-1)!.distance);
  });
  it.each([
    [
      { row: 0, col: 0 },
      { row: 0, col: 4 },
      { row: 1, col: 4 },
      { row: 1, col: 0 }
    ],
    [
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: 0 },
      { row: 0, col: -1 }
    ],
    [
      { row: 0, col: 0 },
      { row: 0, col: 0 },
      { row: 1, col: 0 }
    ]
  ])("bounds hairpins, reversals and repeated controls without invalid coordinates", (...input) => {
    const controls = input.filter(
      (p, i) => i === 0 || p.row !== input[i - 1]!.row || p.col !== input[i - 1]!.col
    );
    const geometry = riverGeometry(river(input.map((p) => ({ ...p, width: 64 }))));
    let segment = 0;
    for (const p of geometry) {
      if (p.controlIndex !== undefined) segment = Math.min(p.controlIndex, controls.length - 2);
      const a = controls[segment]!,
        b = controls[segment + 1]!;
      const col = p.x / 54,
        row = -p.y / (36 * Math.sqrt(3)) - col / 2;
      expect(col).toBeGreaterThanOrEqual(Math.min(a.col, b.col) - 1e-7);
      expect(col).toBeLessThanOrEqual(Math.max(a.col, b.col) + 1e-7);
      expect(row).toBeGreaterThanOrEqual(Math.min(a.row, b.row) - 1e-7);
      expect(row).toBeLessThanOrEqual(Math.max(a.row, b.row) + 1e-7);
      expect(Number.isFinite(p.width)).toBe(true);
    }
    for (const control of controls) {
      const p = centerForCoord(control, 36);
      expect(geometry.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < 1e-7)).toBe(true);
    }
  });
  it("scales the width and geometry together in large exports", () => {
    const doc = createEmptyDocument({ id: "scaling", name: "Scaling" });
    doc.features.rivers = [
      river([
        { row: 0, col: 0, width: 2 },
        { row: 0, col: 3, width: 22 }
      ])
    ];
    const runtime = createRuntimeState(doc);
    const small = buildMapScene(runtime, { size: 36 }),
      large = buildMapScene(runtime, { size: 108 });
    expect(large.riverBodies[0]!.widthRange.max).toBeCloseTo(
      small.riverBodies[0]!.widthRange.max * 3
    );
  });
  it("retains a wide river whose body reaches a neighboring viewport", () => {
    const wide = river([
      { row: 0, col: 0, width: 64 },
      { row: 3, col: 0, width: 64 }
    ]);
    expect(filterRiversForRange([wide], { minRow: 0, maxRow: 1, minCol: 1, maxCol: 1 }, 0)).toEqual(
      [wide]
    );
  });
});
