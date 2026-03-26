/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";

const sampleMap = {
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

const apiMock = vi.hoisted(() => ({
  listMaps: vi.fn(),
  getMap: vi.fn(),
  createMap: vi.fn(),
  saveMap: vi.fn(),
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

function getViewportTransform(): SVGGElement {
  const svg = screen.getByLabelText("Map canvas");
  const viewport = svg.querySelector("g[transform]");
  expect(viewport).toBeTruthy();
  return viewport as SVGGElement;
}

function parseViewportTransform() {
  const transform = getViewportTransform().getAttribute("transform") ?? "";
  const match = transform.match(
    /translate\(([-\d.]+)\s+([-\d.]+)\)\s+scale\(([-\d.]+)\)/
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
    apiMock.getMap.mockResolvedValue({
      ok: true,
      result: sampleMap,
      warnings: [],
      errors: []
    });
    apiMock.saveMap.mockResolvedValue({
      ok: true,
      result: sampleMap,
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
      result: { fileName: "sample-map-reference.png", path: "/tmp/sample-map-reference.png" },
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
    await waitFor(() => expect(apiMock.getMap).toHaveBeenCalledWith("sample-map"));
    expect(await screen.findByText("已打开 Sample Map")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Sample Map" })).toBeTruthy();
    const statusBar = screen.getByLabelText("当前状态");
    expect(screen.getByRole("heading", { name: "当前状态" })).toBeTruthy();
    expect(statusBar.textContent).toContain("当前地图：");
    expect(statusBar.textContent).toContain("ID：sample-map");
    expect(statusBar.textContent).toContain("Designed：1");
    expect(statusBar.textContent).toContain("Revision：1");
    expect(screen.queryByRole("list", { name: "地图列表" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "悬停信息" })).toBeNull();
  });

  it("ignores empty map selection in the top dropdown", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    const mapSelector = screen.getAllByRole("combobox")[0] as HTMLSelectElement;

    fireEvent.change(mapSelector, { target: { value: "" } });

    expect(apiMock.getMap).toHaveBeenCalledTimes(1);
    expect(screen.getByText("当前地图：", { exact: false })).toBeTruthy();
  });

  it("normalizes low-level file errors in the status panel", async () => {
    apiMock.getMap.mockResolvedValueOnce({
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

    await waitFor(() => expect(apiMock.getMap).toHaveBeenCalledWith("sample-map"));
    expect(await screen.findByText("地图文件不存在或暂时无法读取")).toBeTruthy();
    expect(screen.queryByText(/ENOENT:/)).toBeNull();
  });

  it("selects a cell and shows its metadata", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(screen.getByText("R0C0"));
    expect(await screen.findByText("坐标：R0C0 | ID：cell@0,0")).toBeTruthy();
    const terrainField = screen.getByLabelText("Terrain") as HTMLSelectElement;
    expect(terrainField.value).toBe("plain");
    const cellPanel = terrainField.closest("section");
    expect(cellPanel).toBeTruthy();
    expect(within(cellPanel as HTMLElement).getByRole("button", { name: "保存" })).toBeTruthy();
    expect(within(cellPanel as HTMLElement).getByRole("button", { name: "撤销" })).toBeTruthy();
    expect(within(cellPanel as HTMLElement).getByRole("button", { name: "清空" })).toBeTruthy();
  });

  it("allows zooming out further than the previous minimum", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const mapCanvas = await prepareCanvasViewport();
    const initialTransform = parseViewportTransform();

    for (let index = 0; index < 30; index += 1) {
      fireEvent.wheel(mapCanvas, { deltaY: 120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      const zoomedOutTransform = parseViewportTransform();
      expect(zoomedOutTransform.scale).toBeCloseTo(initialTransform.scale * 0.1, 3);
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

  it("exports png with configured options", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    expect(screen.queryByLabelText("预设")).toBeNull();

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
          includeShorthand: true
        })
      )
    );
  });

  it("can collapse the export panel after opening it", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByLabelText("预设")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByLabelText("预设")).toBeNull();
    expect(screen.getByText("展开后可配置 PNG 导出的预设、比例和参考信息。")).toBeTruthy();
  });

  it("does not render a hover details panel for map cells", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const coordLabel = screen.getByText("R0C0");
    fireEvent.mouseEnter(coordLabel.closest("g")!);

    expect(screen.queryByRole("heading", { name: "悬停信息" })).toBeNull();
    expect(screen.queryByText("地形：平原 (PLN)")).toBeNull();
  });

  it("shows recent history after editing a cell", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByText("R0C0"));
    const noteField = screen.getByLabelText("Note");
    fireEvent.change(noteField, {
      target: { value: "history-note" }
    });
    const cellPanel = noteField.closest("section");
    fireEvent.click(within(cellPanel as HTMLElement).getByRole("button", { name: "保存" }));

    expect(await screen.findByText("已记录 1 步 | 可重做 0 步")).toBeTruthy();
    expect(screen.getByText("设置单元格")).toBeTruthy();
  });
});
