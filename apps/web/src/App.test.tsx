/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("当前地图：", { exact: false })).toBeTruthy();
  });

  it("selects a cell and shows its metadata", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");
    fireEvent.click(screen.getByText("R0C0"));
    expect(await screen.findByText("坐标：R0C0")).toBeTruthy();
    expect(screen.getByText("ID：cell@0,0")).toBeTruthy();
    expect((screen.getByLabelText("Terrain") as HTMLSelectElement).value).toBe("plain");
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

  it("shows hover details for a map cell", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    const coordLabel = screen.getByText("R0C0");
    fireEvent.mouseEnter(coordLabel.closest("g")!);

    expect(await screen.findByText("地形：平原 (PLN)")).toBeTruthy();
    expect(screen.getByText("生态：草原 (GRS)")).toBeTruthy();
  });

  it("shows recent history after editing a cell", async () => {
    render(<App />);
    await screen.findByText("已打开 Sample Map");

    fireEvent.click(screen.getByText("R0C0"));
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "history-note" }
    });
    fireEvent.click(screen.getByText("保存修改"));

    expect(await screen.findByText("已记录 1 步 | 可重做 0 步")).toBeTruthy();
    expect(screen.getByText("设置单元格")).toBeTruthy();
  });
});
