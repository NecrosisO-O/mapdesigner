/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { applyCommand, createRuntimeState, type CellRange, type MapCommand, type MapRuntimeState } from "@mapdesigner/map-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";

const sampleMap: MapRuntimeState = {
  document: {
    schema_version: 1,
    meta: {
      id: "sample-map",
      name: "Sample Map",
      description: "",
      tags: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      revision: 1
    },
    grid: {
      layout: "flat-top-even-q",
      origin: { row: 0, col: 0 }
    },
    features: {
      rivers: []
    },
    cells: [
      {
        row: 0,
        col: 0,
        terrain: "plain",
        biome: "grassland",
        tags: [],
        note: ""
      }
    ]
  },
  activeCells: [
    { id: "cell@-1,0", display_coord: "R-1C0", row: -1, col: 0, status: "undesigned", terrain: null, biome: null, tags: [], note: "", is_seed: false },
    { id: "cell@-1,1", display_coord: "R-1C1", row: -1, col: 1, status: "undesigned", terrain: null, biome: null, tags: [], note: "", is_seed: false },
    { id: "cell@0,-1", display_coord: "R0C-1", row: 0, col: -1, status: "undesigned", terrain: null, biome: null, tags: [], note: "", is_seed: false },
    { id: "cell@0,0", display_coord: "R0C0", row: 0, col: 0, status: "designed", terrain: "plain", biome: "grassland", tags: [], note: "", is_seed: false },
    { id: "cell@0,1", display_coord: "R0C1", row: 0, col: 1, status: "undesigned", terrain: null, biome: null, tags: [], note: "", is_seed: false },
    { id: "cell@1,0", display_coord: "R1C0", row: 1, col: 0, status: "undesigned", terrain: null, biome: null, tags: [], note: "", is_seed: false },
    { id: "cell@1,1", display_coord: "R1C1", row: 1, col: 1, status: "undesigned", terrain: null, biome: null, tags: [], note: "", is_seed: false }
  ],
  history: {
    past: [],
    future: [],
    limit: 100
  }
};

const taggedMap: MapRuntimeState = {
  ...sampleMap,
  document: {
    ...sampleMap.document,
    cells: [
      {
        row: 0,
        col: 0,
        terrain: "plain",
        biome: "grassland",
        tags: ["peak"],
        note: ""
      },
      {
        row: 0,
        col: 1,
        terrain: "hill",
        biome: "grassland",
        tags: [],
        note: ""
      }
    ]
  },
  activeCells: sampleMap.activeCells.map((cell) =>
    cell.id === "cell@0,0"
      ? { ...cell, tags: ["peak"] }
      : cell.id === "cell@0,1"
        ? { ...cell, status: "designed", terrain: "hill", biome: "grassland", tags: [] }
        : cell
  )
};

const apiMock = vi.hoisted(() => ({
  listMaps: vi.fn(),
  getMap: vi.fn(),
  getMapSummary: vi.fn(),
  getMapFeatures: vi.fn(),
  getMapFeaturesInRange: vi.fn(),
  getMapHistory: vi.fn(),
  getHistoryStatus: vi.fn(),
  getCellsInRange: vi.fn(),
  applyCommands: vi.fn(),
  undoMap: vi.fn(),
  redoMap: vi.fn(),
  createMap: vi.fn(),
  saveMap: vi.fn(),
  saveMapMeta: vi.fn(),
  saveMapAs: vi.fn(),
  duplicateMap: vi.fn(),
  deleteMap: vi.fn(),
  importMap: vi.fn(),
  exportJson: vi.fn(),
  exportPng: vi.fn()
}));

vi.mock("./api.js", () => ({
  api: apiMock
}));

interface MockHistoryEntry {
  seq: number;
  action: string;
  source: string;
  timestamp: string;
  before: MapRuntimeState["document"];
  after: MapRuntimeState["document"];
}

function cloneRuntime(map: MapRuntimeState): MapRuntimeState {
  return createRuntimeState(structuredClone(map.document) as MapRuntimeState["document"]);
}

function createMockSummary(map: MapRuntimeState) {
  const rows = map.document.cells.map((cell) => cell.row);
  const cols = map.document.cells.map((cell) => cell.col);
  return {
    meta: map.document.meta,
    grid: map.document.grid,
    bounds:
      map.document.cells.length === 0
        ? { min_row: null, max_row: null, min_col: null, max_col: null }
        : {
            min_row: Math.min(...rows),
            max_row: Math.max(...rows),
            min_col: Math.min(...cols),
            max_col: Math.max(...cols)
          },
    designed_cell_count: map.document.cells.length,
    feature_counts: {
      rivers: map.document.features.rivers.length
    }
  };
}

function createMockHistory(entries: MockHistoryEntry[], cursor: number) {
  const latest = entries.length;
  return {
    status: {
      canUndo: cursor > 0,
      canRedo: cursor < latest,
      cursor,
      latest
    },
    entries: entries
      .filter((entry) => entry.seq <= cursor)
      .slice(-5)
      .reverse()
      .map(({ seq, action, source, timestamp }) => ({ seq, action, source, timestamp }))
  };
}

function configureEditableMapMock(initialMap: typeof sampleMap): void {
  let runtime = cloneRuntime(initialMap);
  let historyCursor = 0;
  let historyEntries: MockHistoryEntry[] = [];

  apiMock.getMap.mockImplementation(async () => ({
    ok: true,
    result: runtime,
    warnings: [],
    errors: []
  }));
  apiMock.getMapSummary.mockImplementation(async () => ({
    ok: true,
    result: createMockSummary(runtime),
    warnings: [],
    errors: []
  }));
  apiMock.getMapFeatures.mockImplementation(async () => ({
    ok: true,
    result: runtime.document.features,
    warnings: [],
    errors: []
  }));
  apiMock.getMapFeaturesInRange.mockImplementation(async () => ({
    ok: true,
    result: runtime.document.features,
    warnings: [],
    errors: []
  }));
  apiMock.getCellsInRange.mockImplementation(async (_id: string, range: CellRange) => ({
    ok: true,
    result: {
      map_id: runtime.document.meta.id,
      revision: runtime.document.meta.revision,
      range,
      cells: runtime.activeCells.filter(
        (cell) =>
          cell.row >= range.minRow &&
          cell.row <= range.maxRow &&
          cell.col >= range.minCol &&
          cell.col <= range.maxCol
      )
    },
    warnings: [],
    errors: []
  }));
  apiMock.getMapHistory.mockImplementation(async () => ({
    ok: true,
    result: createMockHistory(historyEntries, historyCursor),
    warnings: [],
    errors: []
  }));
  apiMock.getHistoryStatus.mockImplementation(async () => ({
    ok: true,
    result: createMockHistory(historyEntries, historyCursor).status,
    warnings: [],
    errors: []
  }));
  apiMock.applyCommands.mockImplementation(async (
    _id: string,
    commands: MapCommand[],
    options: { dryRun?: boolean; includeMap?: boolean } = {}
  ) => {
    const dryRun = options.dryRun ?? false;
    const before = structuredClone(runtime.document);
    let next = runtime;
    const warnings = [];
    for (const command of commands) {
      const result = applyCommand(next, command);
      if (!result.ok) {
        return {
          ok: false,
          warnings: result.warnings,
          errors: result.errors
        };
      }
      warnings.push(...result.warnings);
      next = createRuntimeState(result.map.document);
    }
    if (!dryRun) {
      runtime = next;
      historyEntries = historyEntries.slice(0, historyCursor);
      historyEntries.push({
        seq: historyEntries.length + 1,
        action: commands.length === 1 ? commands[0]?.action ?? "commands" : "commands",
        source: commands.find((command) => command.source)?.source ?? "system",
        timestamp: new Date().toISOString(),
        before,
        after: structuredClone(runtime.document)
      });
      historyCursor = historyEntries.length;
    }
    return {
      ok: true,
      result: {
        ...(options.includeMap === false ? {} : { map: next }),
        summary: createMockSummary(next),
        features: next.document.features,
        dryRun,
        warnings,
        stats: {
          command_count: commands.length,
          changed_count: 0,
          created_count: 0,
          updated_count: 0,
          cleared_count: 0,
          feature_stats: {
            river_created_count: commands.filter((command) => command.action === "create_river").length,
            river_updated_count: commands.filter((command) => command.action === "update_river").length,
            river_deleted_count: commands.filter((command) => command.action === "delete_river").length
          }
        }
      },
      warnings,
      errors: []
    };
  });
  apiMock.undoMap.mockImplementation(async () => {
    if (historyCursor <= 0) {
      return { ok: true, result: null, warnings: [], errors: [] };
    }
    const operation = historyEntries[historyCursor - 1]!;
    historyCursor -= 1;
    runtime = createRuntimeState(operation.before);
    return {
      ok: true,
      result: {
        map: runtime,
        summary: createMockSummary(runtime),
        features: runtime.document.features,
        warnings: [],
        operation: {
          seq: operation.seq,
          action: operation.action,
          source: operation.source,
          timestamp: operation.timestamp
        },
        status: createMockHistory(historyEntries, historyCursor).status
      },
      warnings: [],
      errors: []
    };
  });
  apiMock.redoMap.mockImplementation(async () => {
    if (historyCursor >= historyEntries.length) {
      return { ok: true, result: null, warnings: [], errors: [] };
    }
    const operation = historyEntries[historyCursor]!;
    historyCursor += 1;
    runtime = createRuntimeState(operation.after);
    return {
      ok: true,
      result: {
        map: runtime,
        summary: createMockSummary(runtime),
        features: runtime.document.features,
        warnings: [],
        operation: {
          seq: operation.seq,
          action: operation.action,
          source: operation.source,
          timestamp: operation.timestamp
        },
        status: createMockHistory(historyEntries, historyCursor).status
      },
      warnings: [],
      errors: []
    };
  });
}

function getViewportTransform(): SVGGElement {
  const svg = screen.getByLabelText("Map canvas");
  const viewport = svg.querySelector("g[transform]");
  expect(viewport).toBeTruthy();
  return viewport as SVGGElement;
}

function parseViewportTransform() {
  const transform = getViewportTransform().getAttribute("transform") ?? "";
  const match = transform.match(
    /translate\(([-\d.eE]+)\s+([-\d.eE]+)\)\s+scale\(([-\d.eE]+)\)/
  );

  expect(match).toBeTruthy();

  return {
    tx: Number(match?.[1]),
    ty: Number(match?.[2]),
    scale: Number(match?.[3])
  };
}

function getScenePointAtScreenPoint(
  pointer: { x: number; y: number },
  transform = parseViewportTransform()
) {
  return {
    x: (pointer.x - transform.tx) / transform.scale,
    y: (pointer.y - transform.ty) / transform.scale
  };
}

async function prepareCanvasViewport() {
  const mapCanvas = screen.getByLabelText("Map canvas").parentElement as HTMLDivElement;

  vi.spyOn(mapCanvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    toJSON: () => ({})
  });

  fireEvent(window, new Event("resize"));

  await waitFor(() => {
    expect(parseViewportTransform().scale).toBeGreaterThan(1);
  });

  return mapCanvas;
}

function getCellButton(displayCoord: string, status: "designed" | "undesigned") {
  return screen.getByRole("button", { name: `${displayCoord} ${status}` });
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    apiMock.listMaps.mockResolvedValue({
      ok: true,
      result: [
        {
          id: "sample-map",
          name: "Sample Map",
          fileName: "sample-map.json",
          updatedAt: "2026-01-01T00:00:00.000Z",
          revision: 1,
          designedCellCount: 1
        }
      ],
      warnings: [],
      errors: []
    });
    configureEditableMapMock(sampleMap);
    apiMock.saveMap.mockResolvedValue({
      ok: true,
      result: sampleMap,
      warnings: [],
      errors: []
    });
    apiMock.saveMapMeta.mockResolvedValue({
      ok: true,
      result: createMockSummary(sampleMap),
      warnings: [],
      errors: []
    });
    apiMock.saveMapAs.mockResolvedValue({
      ok: true,
      result: {
        ...sampleMap,
        document: {
          ...sampleMap.document,
          meta: {
            ...sampleMap.document.meta,
            id: "copied-map",
            name: "Copied Map"
          }
        }
      },
      warnings: [],
      errors: []
    });
    apiMock.exportJson.mockResolvedValue({
      ok: true,
      result: { fileName: "sample-map.json", path: "/tmp/sample-map.json" },
      warnings: [],
      errors: []
    });
    apiMock.exportPng.mockResolvedValue({
      ok: true,
      result: {
        fileName: "sample-map-reference.png",
        path: "/tmp/sample-map-reference.png",
        downloadUrl: "/api/exports/sample-map-reference.png"
      },
      warnings: [],
      errors: []
    });
    apiMock.createMap.mockResolvedValue({
      ok: true,
      result: sampleMap,
      warnings: [],
      errors: []
    });
    apiMock.duplicateMap.mockResolvedValue({
      ok: true,
      result: sampleMap,
      warnings: [],
      errors: []
    });
    apiMock.deleteMap.mockResolvedValue({
      ok: true,
      result: { deleted: true },
      warnings: [],
      errors: []
    });
    apiMock.importMap.mockResolvedValue({
      ok: true,
      result: sampleMap,
      warnings: [],
      errors: []
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "prompt").mockReturnValue("Created from Test");
  });

  it("loads and opens the first map", async () => {
    render(<App />);
    await waitFor(() => expect(apiMock.listMaps).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.getMapSummary).toHaveBeenCalledWith("sample-map"));
    await waitFor(() => expect(apiMock.getMapFeaturesInRange).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.getCellsInRange).toHaveBeenCalled());
    expect(apiMock.getMapFeatures).not.toHaveBeenCalled();
    expect(apiMock.getMap).not.toHaveBeenCalled();
    expect(await screen.findByText("已打开 Sample Map")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Sample Map" })).toBeTruthy();
    const statusBar = screen.getByLabelText("当前状态");
    expect(screen.getByRole("heading", { name: "地图" })).toBeTruthy();
    expect(statusBar.textContent).toContain("当前地图：");
    expect(statusBar.textContent).toContain("ID");
    expect(statusBar.textContent).toContain("sample-map");
    expect(statusBar.textContent).toContain("已设计");
    expect(statusBar.textContent).toContain("1");
    expect(statusBar.textContent).toContain("版本");
    expect(screen.queryByRole("list", { name: "地图列表" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "悬停信息" })).toBeNull();
  });

  it("refreshes the current loaded range after edits without expanding it repeatedly", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    await waitFor(() => expect(apiMock.getCellsInRange).toHaveBeenCalled());
    const initialRange = (apiMock.getCellsInRange.mock.calls.at(-1)?.[1] ?? null) as CellRange | null;
    expect(initialRange).toBeTruthy();

    fireEvent.click(getCellButton("R0C0", "designed"));
    fireEvent.change(screen.getByLabelText("Terrain 分类"), { target: { value: "upland" } });
    fireEvent.change(screen.getByLabelText("Terrain"), { target: { value: "hill" } });
    const terrainField = screen.getByLabelText("Terrain");
    const cellPanel = terrainField.closest("section");
    expect(cellPanel).toBeTruthy();
    fireEvent.click(within(cellPanel as HTMLElement).getByRole("button", { name: "应用" }));

    await screen.findByText("单元格修改已保存到服务器");
    await waitFor(() => expect(apiMock.getCellsInRange.mock.calls.length).toBeGreaterThan(1));
    const refreshedRange = (apiMock.getCellsInRange.mock.calls.at(-1)?.[1] ?? null) as CellRange | null;
    expect(refreshedRange).toEqual(initialRange);
  });

  it("ignores empty map selection in the top dropdown", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    const mapSelector = screen.getAllByRole("combobox")[0] as HTMLSelectElement;

    fireEvent.change(mapSelector, { target: { value: "" } });

    expect(apiMock.getMap).not.toHaveBeenCalled();
    expect(screen.getByText("当前地图：", { exact: false })).toBeTruthy();
  });

  it("normalizes low-level file errors in the status panel", async () => {
    apiMock.getMapSummary.mockResolvedValueOnce({
      ok: false,
      result: undefined,
      warnings: [],
      errors: [
        {
          code: "map_not_found",
          message: "ENOENT: no such file or directory, open '/root/WorkSpace/MapDesigner/apps/server/storage/maps/.json'",
          severity: "invalid"
        }
      ]
    });

    render(<App />);

    await waitFor(() => expect(apiMock.getMapSummary).toHaveBeenCalledWith("sample-map"));
    expect(await screen.findByText("地图文件不存在或暂时无法读取")).toBeTruthy();
    expect(screen.queryByText(/ENOENT:/)).toBeNull();
  });

  it("selects a cell and shows its metadata", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(getCellButton("R0C0", "designed"));
    expect(await screen.findByLabelText("当前选中信息")).toBeTruthy();
    expect(screen.getByLabelText("当前选中信息").textContent).toContain("R0C0 | designed");
    expect(screen.queryByRole("heading", { name: "当前选中" })).toBeNull();
    const terrainCategoryField = screen.getByLabelText("Terrain 分类") as HTMLSelectElement;
    expect(terrainCategoryField.value).toBe("plain");
    const terrainField = screen.getByLabelText("Terrain") as HTMLSelectElement;
    expect(terrainField.value).toBe("plain");
    const cellPanel = terrainField.closest("section");
    expect(cellPanel).toBeTruthy();
    expect(within(cellPanel as HTMLElement).getByRole("button", { name: "应用" })).toBeTruthy();
    expect(within(cellPanel as HTMLElement).getByRole("button", { name: "还原" })).toBeTruthy();
    expect(within(cellPanel as HTMLElement).getByRole("button", { name: "清空" })).toBeTruthy();
  });

  it("creates a river overlay from the detail panel", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const riverPanel = screen.getByRole("heading", { name: "河流覆盖层" }).closest("section");
    expect(riverPanel).toBeTruthy();
    fireEvent.change(within(riverPanel as HTMLElement).getByLabelText("Name"), { target: { value: "Main River" } });
    fireEvent.change(within(riverPanel as HTMLElement).getByLabelText("Points"), { target: { value: "R0C0, R0C2" } });
    fireEvent.change(within(riverPanel as HTMLElement).getByLabelText("Width anchors"), {
      target: { value: "R0C0:2, R0C1:5, R0C2:8" }
    });
    fireEvent.click(within(riverPanel as HTMLElement).getByRole("button", { name: "应用河流" }));

    expect(await screen.findByText("河流修改已保存到服务器")).toBeTruthy();
    expect(within(riverPanel as HTMLElement).getByRole("option", { name: "Main River (main-river)" })).toBeTruthy();
    const svg = screen.getByLabelText("Map canvas");
    expect(svg.querySelector('[data-river-id="main-river"]')).toBeTruthy();
  });

  it("draws a river from canvas clicks and returns to cell selection", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const riverPanel = screen.getByRole("heading", { name: "河流覆盖层" }).closest("section");
    expect(riverPanel).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "河流" }));
    expect(screen.getByRole("button", { name: "河流" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("河流绘制工具")).toBeTruthy();

    fireEvent.click(getCellButton("R0C0", "designed"));
    expect(await screen.findByText("路径点：1")).toBeTruthy();
    expect(screen.getByLabelText("河流绘制工具").textContent).toContain("路径点 1");
    expect(screen.queryByLabelText("当前选中信息")).toBeNull();

    fireEvent.click(getCellButton("R0C1", "undesigned"));
    expect(await screen.findByText("路径点：2")).toBeTruthy();
    expect(screen.getByLabelText("河流绘制工具").textContent).toContain("路径点 2");
    expect(screen.getByLabelText("Map canvas").querySelector('[data-river-preview="true"]')).toBeTruthy();
    expect(screen.getByLabelText("Map canvas").querySelector('[data-river-control-point="start"]')).toBeTruthy();
    expect(screen.getByLabelText("Map canvas").querySelector('[data-river-control-point="end"]')).toBeTruthy();

    fireEvent.click(within(screen.getByLabelText("河流绘制工具")).getByRole("button", { name: "完成" }));

    expect(await screen.findByText("河流修改已保存到服务器")).toBeTruthy();
    expect(screen.getByRole("button", { name: "选择" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Map canvas").querySelector('[data-river-id="river-1"]')).toBeTruthy();

    fireEvent.click(getCellButton("R0C1", "undesigned"));
    expect(await screen.findByLabelText("当前选中信息")).toBeTruthy();
    expect(screen.getByLabelText("当前选中信息").textContent).toContain("R0C1 | undesigned");
  });

  it("enables format brush from a designed cell and disables it on an undesigned cell", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(getCellButton("R0C0", "designed"));
    const brushButton = screen.getByRole("button", { name: "格式刷" });
    expect((brushButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(brushButton);
    expect(await screen.findByText("格式刷源格：R0C0 | 当前刷入：地形 + 生态")).toBeTruthy();
    expect(brushButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(brushButton);
    expect(await screen.findByText("选中已设计单元格后可进入格式刷模式；再次点击按钮即可退出。")).toBeTruthy();
    expect(brushButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(getCellButton("R0C1", "undesigned"));
    expect((screen.getByRole("button", { name: "格式刷" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("brushes terrain only onto an undesigned cell", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(getCellButton("R0C0", "designed"));
    fireEvent.click(screen.getByLabelText("刷生态"));
    fireEvent.click(screen.getByRole("button", { name: "格式刷" }));
    fireEvent.click(getCellButton("R0C1", "undesigned"));

    await waitFor(() => {
      const statusBar = screen.getByLabelText("当前状态");
      expect(statusBar.textContent).toContain("已设计");
      expect(statusBar.textContent).toContain("2");
    });
    expect(screen.getByText("已将 R0C0 的地形刷到 R0C1 并保存到服务器")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "格式刷" }));
    await waitFor(() => expect(getCellButton("R0C1", "designed")).toBeTruthy());
    fireEvent.click(getCellButton("R0C1", "designed"));

    expect(await screen.findByLabelText("当前选中信息")).toBeTruthy();
    expect(screen.getByLabelText("当前选中信息").textContent).toContain("R0C1 | designed");
    expect((screen.getByLabelText("Terrain") as HTMLSelectElement).value).toBe("plain");
    expect((screen.getByLabelText("Biome") as HTMLSelectElement).value).toBe("");
  });

  it("brushes biome only onto an already designed cell", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(getCellButton("R0C1", "undesigned"));
    fireEvent.change(screen.getByLabelText("Terrain 分类"), { target: { value: "plain" } });
    fireEvent.change(screen.getByLabelText("Terrain"), { target: { value: "plain" } });
    const terrainField = screen.getByLabelText("Terrain");
    const cellPanel = terrainField.closest("section");
    expect(cellPanel).toBeTruthy();
    fireEvent.click(within(cellPanel as HTMLElement).getByRole("button", { name: "应用" }));
    await screen.findByText("单元格修改已保存到服务器");
    await waitFor(() => expect(getCellButton("R0C0", "designed")).toBeTruthy());
    await waitFor(() => expect(getCellButton("R0C1", "designed")).toBeTruthy());

    fireEvent.click(getCellButton("R0C0", "designed"));
    fireEvent.click(screen.getByLabelText("刷地形"));
    fireEvent.click(screen.getByRole("button", { name: "格式刷" }));
    fireEvent.click(getCellButton("R0C1", "designed"));

    expect(await screen.findByText("已将 R0C0 的生态刷到 R0C1 并保存到服务器")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "格式刷" }));
    fireEvent.click(getCellButton("R0C1", "designed"));

    expect(screen.getByLabelText("当前选中信息").textContent).toContain("R0C1 | designed");
    expect((screen.getByLabelText("Terrain") as HTMLSelectElement).value).toBe("plain");
    expect((screen.getByLabelText("Biome") as HTMLSelectElement).value).toBe("grassland");
  });

  it("brushes tags and notes when those format brush scopes are enabled", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(getCellButton("R0C0", "designed"));
    const terrainField = screen.getByLabelText("Terrain");
    const cellPanel = terrainField.closest("section");
    expect(cellPanel).toBeTruthy();

    fireEvent.click(within(cellPanel as HTMLElement).getByLabelText("山峰"));
    fireEvent.change(within(cellPanel as HTMLElement).getByLabelText("Note"), {
      target: { value: "source note" }
    });
    fireEvent.click(within(cellPanel as HTMLElement).getByRole("button", { name: "应用" }));
    await screen.findByText("单元格修改已保存到服务器");

    fireEvent.click(within(cellPanel as HTMLElement).getByLabelText("刷标签"));
    fireEvent.click(within(cellPanel as HTMLElement).getByLabelText("刷备注"));
    fireEvent.click(within(cellPanel as HTMLElement).getByRole("button", { name: "格式刷" }));
    fireEvent.click(getCellButton("R0C1", "undesigned"));

    expect(await screen.findByText("已将 R0C0 的地形 + 生态 + 标签 + 备注刷到 R0C1 并保存到服务器")).toBeTruthy();

    fireEvent.click(within(cellPanel as HTMLElement).getByRole("button", { name: "格式刷" }));
    fireEvent.click(getCellButton("R0C1", "designed"));

    expect((within(cellPanel as HTMLElement).getByLabelText("山峰") as HTMLInputElement).checked).toBe(true);
    expect((within(cellPanel as HTMLElement).getByLabelText("Note") as HTMLTextAreaElement).value).toBe("source note");
  });

  it("batch-selects cells and applies set_cells through the advanced editor", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const advancedPanel = screen.getByRole("heading", { name: "高级编辑" }).closest("section");
    expect(advancedPanel).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "批量" }));
    expect(screen.getByRole("button", { name: "批量" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(getCellButton("R0C1", "undesigned"));
    fireEvent.click(getCellButton("R1C0", "undesigned"));

    expect(within(advancedPanel as HTMLElement).getByText("已选 2 格")).toBeTruthy();

    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("批量 Terrain 分类"), {
      target: { value: "upland" }
    });
    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("批量 Terrain"), {
      target: { value: "hill" }
    });
    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("批量 Biome"), {
      target: { value: "grassland" }
    });
    fireEvent.click(within(advancedPanel as HTMLElement).getByLabelText("山峰"));
    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("批量 Note"), {
      target: { value: "batch note" }
    });
    fireEvent.click(within(advancedPanel as HTMLElement).getByRole("button", { name: "应用到选中格" }));

    expect(await screen.findByText("已批量设置 2 个单元格并保存到服务器")).toBeTruthy();
    expect(within(advancedPanel as HTMLElement).getByText("已选 2 格")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(getCellButton("R0C1", "designed"));
    const cellPanel = screen.getByLabelText("Terrain").closest("section");
    expect(cellPanel).toBeTruthy();
    expect((screen.getByLabelText("Terrain") as HTMLSelectElement).value).toBe("hill");
    expect((screen.getByLabelText("Biome") as HTMLSelectElement).value).toBe("grassland");
    expect((within(cellPanel as HTMLElement).getByLabelText("山峰") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("batch note");
  });

  it("replaces terrain and biome from the advanced editor", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const advancedPanel = screen.getByRole("heading", { name: "高级编辑" }).closest("section");
    expect(advancedPanel).toBeTruthy();

    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("匹配 Terrain"), {
      target: { value: "plain" }
    });
    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("目标 Terrain 分类"), {
      target: { value: "upland" }
    });
    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("目标 Terrain"), {
      target: { value: "hill" }
    });
    fireEvent.click(within(advancedPanel as HTMLElement).getByRole("button", { name: "替换地形" }));

    expect(await screen.findByText("地形替换已保存到服务器")).toBeTruthy();

    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("匹配 Biome"), {
      target: { value: "grassland" }
    });
    fireEvent.change(within(advancedPanel as HTMLElement).getByLabelText("目标 Biome"), {
      target: { value: "shrubland" }
    });
    fireEvent.click(within(advancedPanel as HTMLElement).getByRole("button", { name: "替换生态" }));

    expect(await screen.findByText("生态替换已保存到服务器")).toBeTruthy();

    fireEvent.click(getCellButton("R0C0", "designed"));
    expect((screen.getByLabelText("Terrain") as HTMLSelectElement).value).toBe("hill");
    expect((screen.getByLabelText("Biome") as HTMLSelectElement).value).toBe("shrubland");
    expect(await screen.findByText("已记录 2 步 | 可重做 0 步")).toBeTruthy();
  });

  it("returns to normal selection after leaving format brush mode", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(getCellButton("R0C0", "designed"));
    fireEvent.click(screen.getByRole("button", { name: "格式刷" }));
    fireEvent.click(screen.getByRole("button", { name: "格式刷" }));
    fireEvent.click(getCellButton("R0C1", "undesigned"));

    expect(await screen.findByLabelText("当前选中信息")).toBeTruthy();
    expect(screen.getByLabelText("当前选中信息").textContent).toContain("R0C1 | undesigned");
  });

  it("filters terrain options by the selected terrain category", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(getCellButton("R0C0", "designed"));

    const terrainCategoryField = screen.getByLabelText("Terrain 分类") as HTMLSelectElement;
    const terrainField = screen.getByLabelText("Terrain") as HTMLSelectElement;
    const biomeField = screen.getByLabelText("Biome") as HTMLSelectElement;

    fireEvent.change(biomeField, { target: { value: "" } });

    fireEvent.change(terrainCategoryField, { target: { value: "water" } });

    expect(terrainCategoryField.value).toBe("water");
    expect(terrainField.value).toBe("");
    expect(Array.from(terrainField.options).map((option) => option.value)).toContain("ocean");
    expect(Array.from(terrainField.options).map((option) => option.value)).not.toContain("plain");
  });

  it("filters biome options after selecting a terrain", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(getCellButton("R0C0", "designed"));

    const terrainCategoryField = screen.getByLabelText("Terrain 分类") as HTMLSelectElement;
    const terrainField = screen.getByLabelText("Terrain") as HTMLSelectElement;
    const biomeField = screen.getByLabelText("Biome") as HTMLSelectElement;

    fireEvent.change(biomeField, { target: { value: "" } });
    fireEvent.change(terrainCategoryField, { target: { value: "water" } });
    fireEvent.change(terrainField, { target: { value: "ocean" } });

    expect(terrainField.value).toBe("ocean");
    expect(biomeField.value).toBe("");
    expect(Array.from(biomeField.options).map((option) => option.value)).toEqual([
      "",
      "marine",
      "pack_ice"
    ]);
  });

  it("filters terrain categories and terrain options after selecting a biome", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(getCellButton("R0C0", "designed"));

    const terrainCategoryField = screen.getByLabelText("Terrain 分类") as HTMLSelectElement;
    const terrainField = screen.getByLabelText("Terrain") as HTMLSelectElement;
    const biomeField = screen.getByLabelText("Biome") as HTMLSelectElement;

    fireEvent.change(terrainField, { target: { value: "" } });
    fireEvent.change(biomeField, { target: { value: "marine" } });

    expect(biomeField.value).toBe("marine");
    expect(terrainCategoryField.value).toBe("");
    expect(terrainField.value).toBe("");
    expect(Array.from(terrainCategoryField.options).map((option) => option.value)).toEqual(["", "water", "coast"]);

    fireEvent.change(terrainCategoryField, { target: { value: "coast" } });

    expect(Array.from(terrainField.options).map((option) => option.value)).toEqual([
      "",
      "coast",
      "beach",
      "tidal_flat",
      "reef"
    ]);
  });

  it("keeps zoom-out bounded so the map never collapses to zero scale", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const mapCanvas = await prepareCanvasViewport();
    const initialTransform = parseViewportTransform();

    for (let index = 0; index < 240; index += 1) {
      fireEvent.wheel(mapCanvas, { deltaY: 120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      const zoomedOutTransform = parseViewportTransform();
      expect(zoomedOutTransform.scale).toBeCloseTo(initialTransform.scale * 0.2, 3);
      expect(zoomedOutTransform.scale).toBeGreaterThan(0);
    });
  });

  it("allows very deep zooming for fine map design", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const mapCanvas = await prepareCanvasViewport();
    const initialTransform = parseViewportTransform();
    const previousMaxScale = initialTransform.scale * 2.6;

    for (let index = 0; index < 100; index += 1) {
      fireEvent.wheel(mapCanvas, { deltaY: -120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      const zoomedInTransform = parseViewportTransform();
      expect(zoomedInTransform.scale).toBeGreaterThan(previousMaxScale);
      expect(zoomedInTransform.scale).toBeGreaterThan(initialTransform.scale * 1_000_000);
    });
  });

  it("zooms around the mouse position instead of staying centered", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const mapCanvas = await prepareCanvasViewport();
    const pointer = { x: 120, y: 80 };
    const beforeZoom = getScenePointAtScreenPoint(pointer);

    fireEvent.wheel(mapCanvas, { deltaY: -120, clientX: pointer.x, clientY: pointer.y });

    await waitFor(() => {
      const afterZoom = getScenePointAtScreenPoint(pointer);
      const transform = parseViewportTransform();

      expect(transform.scale).toBeGreaterThan(1);
      expect(afterZoom.x).toBeCloseTo(beforeZoom.x, 2);
      expect(afterZoom.y).toBeCloseTo(beforeZoom.y, 2);
    });
  });

  it("uses the latest pan offset when zooming immediately after a drag", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const mapCanvas = await prepareCanvasViewport();

    fireEvent.pointerDown(mapCanvas, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(mapCanvas, { pointerId: 1, clientX: 520, clientY: 350 });
    fireEvent.pointerUp(mapCanvas, { pointerId: 1, clientX: 520, clientY: 350 });

    await waitFor(() => {
      const afterDrag = parseViewportTransform();
      expect(afterDrag.tx).toBeGreaterThan(100);
      expect(afterDrag.ty).toBeGreaterThan(40);
    });

    const pointer = { x: 460, y: 320 };
    const beforeZoom = getScenePointAtScreenPoint(pointer);
    fireEvent.wheel(mapCanvas, { deltaY: -120, clientX: pointer.x, clientY: pointer.y });

    await waitFor(() => {
      const afterZoom = getScenePointAtScreenPoint(pointer);
      expect(afterZoom.x).toBeCloseTo(beforeZoom.x, 2);
      expect(afterZoom.y).toBeCloseTo(beforeZoom.y, 2);
    });
  });

  it("can create a map from the toolbar", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(screen.getByText("新建地图"));
    await waitFor(() => expect(apiMock.createMap).toHaveBeenCalled());
  });

  it("can save the current map as a new copy", async () => {
    vi.spyOn(window, "prompt").mockReturnValueOnce("Copied Map");
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(screen.getByText("另存为"));
    await waitFor(() =>
      expect(apiMock.saveMapAs).toHaveBeenCalledWith(
        "sample-map",
        expect.objectContaining({ name: "Copied Map" })
      )
    );
    expect(await screen.findByText("已另存为 Copied Map")).toBeTruthy();
  });

  it("can rename the current map locally before saving", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.change(screen.getByLabelText("地图名称"), {
      target: { value: "Renamed Map" }
    });
    fireEvent.click(screen.getByText("确认重命名"));
    expect(await screen.findByText("地图名称已更新，等待保存")).toBeTruthy();
    expect(screen.getAllByText("Renamed Map").length).toBeGreaterThanOrEqual(2);
  });

  it("deletes the current map without immediately auto-opening another map", async () => {
    apiMock.listMaps
      .mockResolvedValueOnce({
        ok: true,
        result: [
          {
            id: "sample-map",
            name: "Sample Map",
            fileName: "sample-map.json",
            updatedAt: "2026-01-01T00:00:00.000Z",
            revision: 1,
            designedCellCount: 1
          },
          {
            id: "other-map",
            name: "Other Map",
            fileName: "other-map.json",
            updatedAt: "2026-01-01T00:00:00.000Z",
            revision: 1,
            designedCellCount: 0
          }
        ],
        warnings: [],
        errors: []
      })
      .mockResolvedValueOnce({
        ok: true,
        result: [
          {
            id: "other-map",
            name: "Other Map",
            fileName: "other-map.json",
            updatedAt: "2026-01-01T00:00:00.000Z",
            revision: 1,
            designedCellCount: 0
          }
        ],
        warnings: [],
        errors: []
      });
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByRole("button", { name: "删除地图" }));

    await waitFor(() => expect(apiMock.deleteMap).toHaveBeenCalledWith("sample-map"));
    expect(await screen.findByText("地图已删除")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("当前没有打开地图。")).toBeTruthy());
    expect(apiMock.getMap).not.toHaveBeenCalledWith("other-map");
  });

  it("exports png with configured options", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    expect(screen.queryByLabelText("预设")).toBeNull();
    expect(screen.queryByText("导出图片")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开" }));

    fireEvent.change(screen.getByLabelText("预设"), {
      target: { value: "reference" }
    });
    fireEvent.change(screen.getByLabelText("Scale"), {
      target: { value: "3" }
    });
    fireEvent.click(screen.getByText("导出图片"));

    await waitFor(() =>
      expect(apiMock.exportPng).toHaveBeenCalledWith(
        "sample-map",
        expect.objectContaining({
          preset: "reference",
          scale: 3,
          includeCoordinates: true,
          includeShorthand: true,
          range: expect.objectContaining({
            minRow: expect.any(Number),
            maxRow: expect.any(Number),
            minCol: expect.any(Number),
            maxCol: expect.any(Number)
          })
        })
      )
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("PNG 已导出并开始下载：sample-map-reference.png")).toBeTruthy();
  });

  it("shows png export progress and prevents duplicate export clicks", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let resolveExport: ((value: Awaited<ReturnType<typeof apiMock.exportPng>>) => void) | undefined;
    apiMock.exportPng.mockReturnValue(
      new Promise((resolve) => {
        resolveExport = resolve;
      })
    );
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    fireEvent.click(screen.getByRole("button", { name: "导出图片" }));

    expect(await screen.findByText("正在导出 PNG...")).toBeTruthy();
    const exportingButton = screen.getByRole("button", { name: "导出中..." }) as HTMLButtonElement;
    expect(exportingButton.disabled).toBe(true);
    fireEvent.click(exportingButton);
    expect(apiMock.exportPng).toHaveBeenCalledTimes(1);

    resolveExport?.({
      ok: true,
      result: {
        fileName: "sample-map-clean.png",
        path: "/tmp/sample-map-clean.png",
        downloadUrl: "/api/exports/sample-map-clean.png"
      },
      warnings: [],
      errors: []
    });

    expect(await screen.findByText("PNG 已导出并开始下载：sample-map-clean.png")).toBeTruthy();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("exports png with a transparent background option", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    fireEvent.click(screen.getByLabelText("透明背景"));
    fireEvent.click(screen.getByText("导出图片"));

    await waitFor(() =>
      expect(apiMock.exportPng).toHaveBeenCalledWith(
        "sample-map",
        expect.objectContaining({
          background: "transparent"
        })
      )
    );
  });

  it("can switch png export to whole map mode", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    fireEvent.change(screen.getByLabelText("导出范围"), {
      target: { value: "full" }
    });
    fireEvent.click(screen.getByText("导出图片"));

    await waitFor(() =>
      expect(apiMock.exportPng).toHaveBeenCalledWith(
        "sample-map",
        expect.objectContaining({
          range: null
        })
      )
    );
  });

  it("dims cells that do not match the selected tag filter", async () => {
    configureEditableMapMock(taggedMap);
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const tagFilterPanel = screen.getByLabelText("标签筛选");
    fireEvent.click(within(tagFilterPanel).getByLabelText("山峰"));

    const svg = screen.getByLabelText("Map canvas");
    expect(svg.querySelector('[data-cell-id="cell@0,0"]')?.getAttribute("data-filter-match")).toBe("true");
    expect(svg.querySelector('[data-cell-id="cell@0,1"]')?.getAttribute("data-filter-match")).toBe("false");

    fireEvent.click(within(tagFilterPanel).getByRole("button", { name: "清除" }));

    expect(svg.querySelector('[data-cell-id="cell@0,1"]')?.getAttribute("data-filter-match")).toBe("true");
  });

  it("can collapse the export panel after opening it", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByLabelText("预设")).toBeTruthy();
    expect(screen.getByText("导出图片")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByLabelText("预设")).toBeNull();
    expect(screen.queryByText("导出图片")).toBeNull();
  });

  it("does not render a hover details panel for map cells", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.mouseEnter(getCellButton("R0C0", "designed"));

    expect(screen.queryByRole("heading", { name: "悬停信息" })).toBeNull();
    expect(screen.queryByText("地形：平原 (PLN)")).toBeNull();
  });

  it("shows recent history after editing a cell", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(getCellButton("R0C0", "designed"));
    const noteField = screen.getByLabelText("Note");
    fireEvent.change(noteField, {
      target: { value: "history-note" }
    });
    const cellPanel = noteField.closest("section");
    fireEvent.click(within(cellPanel as HTMLElement).getByRole("button", { name: "应用" }));

    expect(await screen.findByText("已记录 1 步 | 可重做 0 步")).toBeTruthy();
    expect(screen.getByText("设置单元格")).toBeTruthy();
  });
});
