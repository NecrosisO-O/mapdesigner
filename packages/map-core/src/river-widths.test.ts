import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createEmptyDocument,
  createRuntimeState,
  expandRiverPath,
  parseDocument,
  stringifyDocument,
  undo,
  redo,
  type RiverFeature
} from "./index.js";

const legacy: RiverFeature = {
  id: "old-river",
  name: "Old river",
  points: [
    { row: 0, col: 0, width: 2 },
    { row: 0, col: 1 },
    { row: 0, col: 10, width: 22 }
  ]
};
function oldMap() {
  const document = createEmptyDocument({ id: "old-map", name: "Old map" });
  document.features.rivers = [structuredClone(legacy)];
  return createRuntimeState(parseDocument(JSON.stringify(document)).document!);
}
const widths = (river: RiverFeature) => expandRiverPath(river).map((p) => p.width);

describe("river width semantics", () => {
  it("keeps the width profile unchanged when a new river's path is subdivided", () => {
    const empty = createRuntimeState(createEmptyDocument({ id: "new-map", name: "New map" }));
    const created = applyCommand(empty, {
      action: "create_river",
      river: { ...legacy, points: [legacy.points[0]!, legacy.points[2]!] }
    });
    const before = created.map.document.features.rivers[0]!;
    const updated = applyCommand(created.map, {
      action: "set_river_path",
      river_id: legacy.id,
      points: legacy.points
    });
    expect(updated.ok).toBe(true);
    expect(widths(updated.map.document.features.rivers[0]!)).toEqual(widths(before));
    expect(widths(updated.map.document.features.rivers[0]!)[1]).toBe(4);
  });
  it("uses cumulative path length across unequal segments", () => {
    const river = {
      ...legacy,
      points: [
        { row: 0, col: 0, width: 2 },
        { row: 0, col: 2 },
        { row: 8, col: 2, width: 22 }
      ]
    };
    expect(expandRiverPath(river).find((p) => p.row === 0 && p.col === 2)?.width).toBe(6);
  });
  it("retains legacy widths on read, export, metadata edits, undo and redo", () => {
    const original = oldMap();
    const river = original.document.features.rivers[0]!;
    expect(river.width_mode).toBe("legacy");
    expect(widths(river)[1]).toBe(12);
    expect(river.points[1]?.width).toBeUndefined();
    const exported = parseDocument(stringifyDocument(original.document)).document!;
    expect(widths(exported.features.rivers[0]!)).toEqual(widths(river));
    const edited = applyCommand(original, {
      action: "update_river",
      river_id: river.id,
      changes: { name: "Renamed" }
    }).map;
    expect(edited.document.features.rivers[0]?.width_mode).toBe("distance");
    expect(edited.document.features.rivers[0]?.points[1]?.width).toBe(12);
    expect(widths(edited.document.features.rivers[0]!)).toEqual(widths(river));
    const reverted = undo(edited);
    expect(reverted.document.features.rivers[0]).toEqual(river);
    expect(widths(redo(reverted).document.features.rivers[0]!)).toEqual(widths(river));
  });
  it("inherits old effective anchors while adding a new unanchored control", () => {
    const original = oldMap();
    const edited = applyCommand(original, {
      action: "set_river_path",
      river_id: legacy.id,
      points: [...legacy.points.slice(0, 2), { row: 0, col: 5 }, legacy.points[2]!]
    }).map;
    const before = widths(original.document.features.rivers[0]!);
    const after = widths(edited.document.features.rivers[0]!);
    expect(after).toHaveLength(before.length);
    after.forEach((width, index) => expect(width).toBeCloseTo(before[index]!, 10));
  });
  it("can replay an old width operation using its original interpolation semantics", () => {
    const original = oldMap();
    const command = {
      action: "set_river_width" as const,
      river_id: legacy.id,
      target: { row: 0, col: 2 },
      width: 8
    };
    const old = applyCommand(original, command, { legacyRiverWidths: true }).map.document.features
      .rivers[0]!;
    const current = applyCommand(original, command).map.document.features.rivers[0]!;
    expect(widths(old)[1]).toBe(5);
    expect(widths(current)[1]).toBe(12);
  });
});
