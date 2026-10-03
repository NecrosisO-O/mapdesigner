/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCommand,
  createEmptyDocument,
  createRuntimeState,
  type MapCommand,
  type MapRuntimeState
} from "@mapdesigner/map-core";
import { useCellEditor } from "./useCellEditor.js";
import { useAdvancedEditor } from "./useAdvancedEditor.js";
import { useRiverEditor } from "./useRiverEditor.js";
import { useMapWorkspace } from "./useMapWorkspace.js";
import { api } from "./api.js";
import { runtimeSummary } from "./editor-session.js";
const makeMap = (id = "A") => {
  const doc = createEmptyDocument({ id, name: id });
  doc.cells = [
    { row: 0, col: 0, terrain: "plain", biome: "grassland", tags: ["peak"], note: "original" }
  ];
  return createRuntimeState(doc);
};
const cell = (map: MapRuntimeState) => map.activeCells.find((c) => c.status === "designed")!;
const ok = <T,>(result: T) => ({ ok: true, result, errors: [], warnings: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("draft ownership", () => {
  it("keeps a selected draft outside the viewport", async () => {
    const map = makeMap();
    const { result, rerender } = renderHook(
      ({ map }) => useCellEditor(map, async () => null, vi.fn()),
      { initialProps: { map } }
    );
    await act(() => result.current.handleCanvasCellSelect(cell(map)));
    act(() => result.current.setDraft((d) => ({ ...d, note: "draft" })));
    rerender({ map: { ...map, activeCells: [] } });
    expect(result.current.selectedCellId).toBe(cell(map).id);
    expect(result.current.draft.note).toBe("draft");
    expect(result.current.cellDirty).toBe(true);
  });
  it("retains offscreen batch targets and submits only the changed field", async () => {
    const map = makeMap(),
      apply = vi.fn(async (_commands: MapCommand[]) => null);
    const { result, rerender } = renderHook(({ map }) => useAdvancedEditor(map, apply, vi.fn()), {
      initialProps: { map }
    });
    act(() => result.current.toggleBatchCell(cell(map)));
    act(() => result.current.setBatchTerrain("hill"));
    rerender({ map: { ...map, activeCells: [] } });
    await act(() => result.current.applyBatchEdit());
    expect(apply).toHaveBeenCalledWith([
      {
        action: "patch_cells",
        source: "webui",
        targets: [{ row: 0, col: 0 }],
        changes: { terrain: "hill" }
      }
    ]);
  });
  it("supports explicit clear without changing other fields", async () => {
    const map = makeMap(),
      apply = vi.fn(async (_commands: MapCommand[]) => null);
    const { result } = renderHook(() => useAdvancedEditor(map, apply, vi.fn()));
    act(() => result.current.toggleBatchCell(cell(map)));
    act(() => result.current.setBatchFieldMode("note", "clear"));
    await act(() => result.current.applyBatchEdit());
    expect(apply.mock.calls[0]?.[0]).toEqual([
      {
        action: "patch_cells",
        source: "webui",
        targets: [{ row: 0, col: 0 }],
        changes: { note: "" }
      }
    ]);
  });
  it("deduplicates a pending submission and preserves newer typing", async () => {
    const map = makeMap(),
      wait = deferred<MapRuntimeState | null>();
    const apply = vi.fn(() => wait.promise);
    const { result } = renderHook(() => useCellEditor(map, apply, vi.fn()));
    await act(() => result.current.handleCanvasCellSelect(cell(map)));
    let first!: Promise<void>, second!: Promise<void>;
    act(() => {
      first = result.current.applyDraft();
      second = result.current.applyDraft();
    });
    act(() => result.current.setDraft((d) => ({ ...d, note: "newer" })));
    await act(async () => {
      wait.resolve(map);
      await Promise.all([first, second]);
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.draft.note).toBe("newer");
    expect(result.current.cellDirty).toBe(true);
  });
  it("marks new river drawings dirty and drops them on map change", async () => {
    const map = makeMap(),
      apply = vi.fn(async (_commands: MapCommand[]) => null);
    const { result, rerender } = renderHook(({ map }) => useRiverEditor(map, apply, vi.fn()), {
      initialProps: { map }
    });
    act(() => result.current.startRiverDrawing());
    act(() => {
      result.current.appendRiverPoint(cell(map));
      result.current.appendRiverPoint({ ...cell(map), col: 1 });
    });
    expect(result.current.riverDrawingPoints).toHaveLength(2);
    expect(result.current.riverDirty).toBe(true);
    rerender({ map: makeMap("B") });
    await act(() => result.current.finishRiverDrawing());
    expect(result.current.riverDrawingStatus).toBe("idle");
    expect(result.current.riverDirty).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it("preserves explicit junctions and endpoint semantics when editing a river name", async () => {
    const map = makeMap();
    map.document.features.rivers = [
      {
        id: "network",
        name: "River",
        width_mode: "distance",
        flow_direction: "reverse",
        start_kind: "water",
        end_kind: "spring",
        points: [
          { row: 0, col: 0, width: 2, junction_id: "junction-1" },
          { row: 0, col: 3, width: 8 }
        ]
      }
    ];
    const apply = vi.fn(async (_commands: MapCommand[]) => null);
    const { result } = renderHook(() => useRiverEditor(map, apply, vi.fn()));
    act(() => result.current.selectRiver("network"));
    act(() => result.current.setRiverDraft((draft) => ({ ...draft, name: "Renamed" })));
    await act(() => result.current.applyRiverDraft());
    expect(apply.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        action: "update_river",
        changes: expect.objectContaining({
          flow_direction: "reverse",
          start_kind: "water",
          end_kind: "spring",
          points: map.document.features.rivers[0]!.points
        })
      })
    ]);
  });
});

function mockWorkspace() {
  vi.spyOn(api, "listMaps").mockResolvedValue(ok([]));
  vi.spyOn(api, "getMapSummary").mockImplementation(async (id) => ok(runtimeSummary(makeMap(id))));
  vi.spyOn(api, "getCellsInRange").mockImplementation(async (id, range) =>
    ok({ map_id: id, revision: 1, range, cells: makeMap(id).activeCells })
  );
  vi.spyOn(api, "getMapFeaturesInRange").mockResolvedValue(
    ok({ rivers: [], page: { total: 0, returned: 0, offset: 0, limit: 1000, has_more: false } })
  );
  vi.spyOn(api, "getMapHistory").mockResolvedValue(
    ok({ entries: [], status: { canUndo: false, canRedo: false, cursor: 0, latest: 0 } })
  );
}
describe("workspace responses", () => {
  it("exports the visible range even when moving within the same preloaded region", async () => {
    mockWorkspace();
    const { result } = renderHook(() => useMapWorkspace(vi.fn()));
    await act(() => result.current.openMap("A"));
    const initial = { minRow: -4, maxRow: 4, minCol: -4, maxCol: 4 };
    await act(() => result.current.requestVisibleRange(initial));
    const loaded = vi.mocked(api.getCellsInRange).mock.calls.at(-1)![1];
    expect(loaded.minRow).toBeLessThan(initial.minRow);
    expect(loaded.maxRow).toBeGreaterThan(initial.maxRow);
    expect(result.current.visibleRange).toEqual(initial);
    const calls = vi.mocked(api.getCellsInRange).mock.calls.length;
    const moved = { ...initial, minCol: -3, maxCol: 5 };
    await act(() => result.current.requestVisibleRange(moved));
    expect(result.current.visibleRange).toEqual(moved);
    expect(api.getCellsInRange).toHaveBeenCalledTimes(calls);
    await act(() => result.current.openMap("B"));
    await act(() => result.current.requestVisibleRange(initial, "A"));
    expect(result.current.visibleRange).toBeNull();
  });
  it("ignores an older map open that finishes last", async () => {
    mockWorkspace();
    const wait = deferred<Awaited<ReturnType<typeof api.getMapSummary>>>();
    vi.mocked(api.getMapSummary).mockImplementation(async (id) =>
      id === "A" ? wait.promise : ok(runtimeSummary(makeMap(id)))
    );
    const { result } = renderHook(() => useMapWorkspace(vi.fn()));
    let first!: Promise<unknown>;
    await act(async () => {
      first = result.current.openMap("A");
    });
    await act(() => result.current.openMap("B"));
    await act(async () => {
      wait.resolve(ok(runtimeSummary(makeMap("A"))));
      await first;
    });
    expect(result.current.currentMapId).toBe("B");
    expect(result.current.loading).toBe(false);
  });
  it("keeps rename drafts across viewport loading and retries failed ranges", async () => {
    mockWorkspace();
    const { result } = renderHook(() => useMapWorkspace(vi.fn()));
    await act(() => result.current.openMap("A"));
    act(() => result.current.renameCurrentMap("draft name"));
    vi.mocked(api.getCellsInRange).mockResolvedValueOnce({ ok: false, errors: [], warnings: [] });
    const before = vi.mocked(api.getCellsInRange).mock.calls.length;
    const range = { minRow: 100, maxRow: 110, minCol: 100, maxCol: 110 };
    await act(() => result.current.requestVisibleRange(range));
    await act(() => result.current.requestVisibleRange(range));
    expect(vi.mocked(api.getCellsInRange).mock.calls.length - before).toBe(2);
    expect(result.current.currentMap?.document.meta.name).toBe("draft name");
    expect(result.current.mapDirty).toBe(true);
  });
  it("clears loading after a network failure", async () => {
    mockWorkspace();
    vi.mocked(api.getMapSummary).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMapWorkspace(vi.fn()));
    await act(() => result.current.openMap("A"));
    expect(result.current.loading).toBe(false);
  });
});
it("requests a complete overview instead of clipping a large viewport to its centre", async () => {
  mockWorkspace();
  const overview = vi
    .spyOn(api, "getOverview")
    .mockImplementation(async (id, range) =>
      ok({ map_id: id, revision: 1, range, bucket_size: 16, designed_cell_count: 2, tiles: [] })
    );
  const { result } = renderHook(() => useMapWorkspace(vi.fn()));
  await act(() => result.current.openMap("A"));
  await act(() =>
    result.current.requestVisibleRange({ minRow: 0, maxRow: 999, minCol: 0, maxCol: 999 })
  );
  const range = overview.mock.calls[0]![1];
  expect(range.minRow).toBeLessThanOrEqual(0);
  expect(range.maxRow).toBeGreaterThanOrEqual(999);
  expect(range.minCol).toBeLessThanOrEqual(0);
  expect(range.maxCol).toBeGreaterThanOrEqual(999);
  expect(result.current.overview?.designed_cell_count).toBe(2);
});
it("keeps terrain category choices when identical viewport cells arrive", async () => {
  const map = makeMap();
  const { result, rerender } = renderHook(
    ({ map }) => useCellEditor(map, async () => null, vi.fn()),
    { initialProps: { map } }
  );
  const empty = map.activeCells.find((c) => c.status === "undesigned")!;
  await act(() => result.current.handleCanvasCellSelect(empty));
  act(() => result.current.handleTerrainCategoryChange("upland"));
  rerender({ map: structuredClone(map) });
  expect(result.current.terrainCategory).toBe("upland");
});
it("identifies a newly created offscreen river without selecting an existing river", async () => {
  const map = makeMap();
  const apply = vi.fn(async (commands: MapCommand[]) => {
    const command = commands[0];
    if (command?.action !== "create_river") return null;
    return {
      ...map,
      document: {
        ...map.document,
        features: {
          rivers: [
            {
              id: "unseen-existing",
              name: "Existing",
              points: [
                { row: 99, col: 99 },
                { row: 100, col: 99 }
              ]
            },
            { ...command.river, id: command.river.id! }
          ]
        }
      }
    };
  });
  const { result } = renderHook(() => useRiverEditor(map, apply, vi.fn()));
  act(() =>
    result.current.setRiverDraft((draft) => ({
      ...draft,
      name: "New",
      pointsText: "R50C50, R51C50"
    }))
  );
  await act(() => result.current.applyRiverDraft());
  expect(result.current.selectedRiver?.name).toBe("New");
  act(() => result.current.acceptConfirmedFeatures({ rivers: [] }));
  expect(result.current.selectedRiverId).toBe("");
  expect(result.current.riverDirty).toBe(false);
});

describe("structured river operations", () => {
  function setup() {
    let map = makeMap();
    map.document.features.rivers = [
      {
        id: "main",
        name: "主河",
        width_mode: "distance",
        points: [
          { row: 0, col: 0, width: 2 },
          { row: 0, col: 4, width: 10 }
        ]
      }
    ];
    const apply = vi.fn(async (commands: MapCommand[]) => {
      for (const command of commands) {
        const result = applyCommand(map, command);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        map = result.map;
      }
      return map;
    });
    const hook = renderHook(() => useRiverEditor(map, apply, vi.fn()));
    act(() => hook.result.current.selectRiver("main"));
    return { ...hook, apply, getMap: () => map };
  }
  it("commits a numeric gesture without leaving a stale draft", async () => {
    const { result, apply } = setup();
    await act(() =>
      result.current.commitPoints(
        result.current.riverPoints.map((p, i) => (i === 0 ? { ...p, row: 1 } : p))
      )
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.riverPoints[0]!.row).toBe(1);
    expect(result.current.riverDirty).toBe(false);
  });
  it("creates a branch and its connection in a single submission", async () => {
    const { result, apply, getMap } = setup();
    act(() => result.current.startBranch());
    act(() => result.current.appendRiverPoint({ ...cell(makeMap()), row: 2, col: 0 }));
    await act(() => result.current.finishRiverDrawing());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0].map((c) => c.action)).toEqual([
      "create_river",
      "connect_river_points"
    ]);
    const rivers = getMap().document.features.rivers;
    expect(rivers[0]!.points[0]!.junction_id).toBeTruthy();
    expect(rivers[1]!.points[0]!.junction_id).toBe(rivers[0]!.points[0]!.junction_id);
    expect(result.current.riverDirty).toBe(false);
  });
  it("leaves the source untouched when branch drawing is cancelled", () => {
    const { result, apply, getMap } = setup();
    act(() => result.current.startBranch());
    act(() => result.current.cancelRiverDrawing());
    expect(apply).not.toHaveBeenCalled();
    expect(getMap().document.features.rivers).toHaveLength(1);
    expect(getMap().document.features.rivers[0]!.points[0]!.junction_id).toBeUndefined();
  });
});
