import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createEmptyDocument,
  createRuntimeState,
  parseDocument,
  stringifyDocument,
  undo,
  type MapCommand,
  type MapRuntimeState
} from "./index.js";

function fixture() {
  const doc = createEmptyDocument({ id: "network", name: "Network" });
  doc.features.rivers = [
    {
      id: "main",
      name: "Main",
      points: [
        { row: 0, col: 0, width: 2 },
        { row: 0, col: 4, width: 10 },
        { row: 0, col: 9, width: 20 }
      ]
    },
    {
      id: "branch",
      name: "Branch",
      points: [
        { row: -4, col: 4, width: 2 },
        { row: 0, col: 4, width: 7 }
      ]
    }
  ];
  return createRuntimeState(doc);
}
function run(state: MapRuntimeState, command: MapCommand) {
  const result = applyCommand(state, command);
  expect(result.errors).toEqual([]);
  return result.map;
}
const connect: MapCommand = {
  action: "connect_river_points",
  points: [
    { river_id: "main", point_index: 1 },
    { river_id: "branch", point_index: 1 }
  ]
};

describe("explicit river topology", () => {
  it("keeps old crossings unspecified through a round trip", () => {
    const map = fixture();
    const parsed = parseDocument(stringifyDocument(map.document)).document!;
    expect(parsed.features.rivers.every((r) => r.flow_direction === "unspecified")).toBe(true);
    expect(parsed.features.rivers.flatMap((r) => r.points).every((p) => !p.junction_id)).toBe(true);
  });
  it("moves a junction atomically, then disconnects without moving the other path", () => {
    const connected = run(fixture(), connect);
    const main = connected.document.features.rivers.find((r) => r.id === "main")!;
    const moved = run(connected, {
      action: "set_river_path",
      river_id: "main",
      points: main.points.map((p, i) => (i === 1 ? { ...p, row: 2 } : p))
    });
    expect(moved.document.features.rivers.find((r) => r.id === "branch")!.points[1]?.row).toBe(2);
    expect(undo(moved).document.features).toEqual(connected.document.features);
    const detached = run(moved, {
      action: "disconnect_river_point",
      point: { river_id: "branch", point_index: 1 }
    });
    expect(
      detached.document.features.rivers.find((r) => r.id === "branch")!.points[1]
    ).toMatchObject({ row: 2, col: 4, width: 7 });
    expect(
      detached.document.features.rivers.find((r) => r.id === "branch")!.points[1]?.junction_id
    ).toBeUndefined();
  });
  it("rejects a junction move that would collapse a neighboring river, without partial edits", () => {
    const connected = run(fixture(), connect);
    const main = connected.document.features.rivers.find((r) => r.id === "main")!;
    const result = applyCommand(connected, {
      action: "set_river_path",
      river_id: "main",
      points: main.points.map((p, i) => (i === 1 ? { ...p, row: -4 } : p))
    });
    expect(result.ok).toBe(false);
    expect(result.map).toBe(connected);
  });
  it("reverses flow without changing positions or effective width anchors", () => {
    const connected = run(fixture(), connect);
    const forward = run(connected, {
      action: "update_river",
      river_id: "main",
      changes: { flow_direction: "forward" }
    });
    const reversed = run(forward, {
      action: "update_river",
      river_id: "main",
      changes: { flow_direction: "reverse" }
    });
    expect(reversed.document.features.rivers.find((r) => r.id === "main")!.points).toEqual(
      forward.document.features.rivers.find((r) => r.id === "main")!.points
    );
  });
  it("rejects inconsistent imported junctions and unsupported styles", () => {
    const doc = run(fixture(), connect).document;
    doc.features.rivers[0]!.points[1]!.row = 10;
    expect(parseDocument(JSON.stringify(doc)).document).toBeUndefined();
    const old = createEmptyDocument({ id: "old", name: "Old" });
    delete old.meta.map_style;
    expect(parseDocument(JSON.stringify(old)).document?.meta.map_style).toBe("classic-v1");
    expect(createEmptyDocument({ id: "new", name: "New" }).meta.map_style).toBe("atlas-v1");
    expect(
      parseDocument(JSON.stringify({ ...old, meta: { ...old.meta, map_style: "unknown" } }))
        .document
    ).toBeUndefined();
  });
});
