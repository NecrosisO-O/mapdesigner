/* @vitest-environment jsdom */

import type { ActiveCell, MapRuntimeState } from "@mapdesigner/map-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapCanvas } from "./MapCanvas.js";

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
    {
      id: "cell@-1,0",
      display_coord: "R-1C0",
      row: -1,
      col: 0,
      status: "undesigned",
      terrain: null,
      biome: null,
      tags: [],
      note: "",
      is_seed: false
    },
    {
      id: "cell@-1,1",
      display_coord: "R-1C1",
      row: -1,
      col: 1,
      status: "undesigned",
      terrain: null,
      biome: null,
      tags: [],
      note: "",
      is_seed: false
    },
    {
      id: "cell@0,-1",
      display_coord: "R0C-1",
      row: 0,
      col: -1,
      status: "undesigned",
      terrain: null,
      biome: null,
      tags: [],
      note: "",
      is_seed: false
    },
    {
      id: "cell@0,0",
      display_coord: "R0C0",
      row: 0,
      col: 0,
      status: "designed",
      terrain: "plain",
      biome: "grassland",
      tags: [],
      note: "",
      is_seed: false
    },
    {
      id: "cell@0,1",
      display_coord: "R0C1",
      row: 0,
      col: 1,
      status: "undesigned",
      terrain: null,
      biome: null,
      tags: [],
      note: "",
      is_seed: false
    },
    {
      id: "cell@1,0",
      display_coord: "R1C0",
      row: 1,
      col: 0,
      status: "undesigned",
      terrain: null,
      biome: null,
      tags: [],
      note: "",
      is_seed: false
    },
    {
      id: "cell@1,1",
      display_coord: "R1C1",
      row: 1,
      col: 1,
      status: "undesigned",
      terrain: null,
      biome: null,
      tags: [],
      note: "",
      is_seed: false
    }
  ],
  history: {
    past: [],
    future: [],
    limit: 100
  }
};

function buildLargeMap(): MapRuntimeState {
  const activeCells: ActiveCell[] = [];
  for (let row = -20; row <= 20; row += 1) {
    for (let col = -20; col <= 20; col += 1) {
      activeCells.push({
        id: `cell@${row},${col}`,
        display_coord: `R${row}C${col}`,
        row,
        col,
        status: row === 0 && col === 0 ? "designed" : "undesigned",
        terrain: row === 0 && col === 0 ? "plain" : null,
        biome: row === 0 && col === 0 ? "grassland" : null,
        tags: [],
        note: "",
        is_seed: false
      });
    }
  }

  return {
    ...sampleMap,
    activeCells,
    document: {
      ...sampleMap.document,
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
    }
  };
}

function mockCanvasRect(container: HTMLDivElement) {
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
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
}

function countCoordinateLabels() {
  const svg = screen.getByLabelText("地图画布");
  return Array.from(svg.querySelectorAll("text")).filter((node) =>
    /^R-?\d+C-?\d+$/.test(node.textContent ?? "")
  ).length;
}

describe("MapCanvas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reduces label density at far zoom levels", async () => {
    render(
      <MapCanvas
        map={sampleMap}
        selectedCell={null}
        selectedCellId={null}
        onSelectCell={() => {}}
        showCoordinates
        showShorthand
        showGrid
        showUndesigned
      />
    );

    const container = screen.getByLabelText("地图画布").parentElement as HTMLDivElement;
    mockCanvasRect(container);

    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.getByLabelText("地图画布").getAttribute("data-render-detail")).toBe("near");
      expect(screen.getByText("R0C0")).toBeTruthy();
      expect(screen.getByText("PLN-GRS")).toBeTruthy();
      expect(screen.getByRole("button", { name: "R0C0 已设计" })).toBeTruthy();
    });

    for (let index = 0; index < 25; index += 1) {
      fireEvent.wheel(container, { deltaY: 120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      expect(screen.queryByText("R0C0")).toBeNull();
      expect(screen.queryByText("PLN-GRS")).toBeNull();
      expect(screen.getByRole("button", { name: "R0C0 已设计" })).toBeTruthy();
      expect(screen.getByLabelText("地图画布").getAttribute("data-render-detail")).toMatch(/far/);
    });
  });

  it("selects cells from the real pointer path while preserving drag panning", async () => {
    const onSelectCell = vi.fn();
    render(
      <MapCanvas
        map={sampleMap}
        selectedCell={null}
        selectedCellId={null}
        onSelectCell={onSelectCell}
        showCoordinates
        showShorthand
        showGrid
        showUndesigned
      />
    );

    const container = screen.getByLabelText("地图画布").parentElement as HTMLDivElement;
    const designedCell = screen.getByRole("button", { name: "R0C0 已设计" });
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    fireEvent.pointerDown(designedCell, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 400, clientY: 300 });

    expect(onSelectCell).toHaveBeenCalledTimes(1);
    expect(onSelectCell).toHaveBeenLastCalledWith(expect.objectContaining({ id: "cell@0,0" }));

    fireEvent.pointerDown(designedCell, { button: 0, pointerId: 2, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(container, { pointerId: 2, clientX: 430, clientY: 300 });
    fireEvent.pointerUp(container, { pointerId: 2, clientX: 430, clientY: 300 });

    expect(onSelectCell).toHaveBeenCalledTimes(1);
  });

  it("adds river points in draw mode without changing cell selection", async () => {
    const onSelectCell = vi.fn();
    const onRiverPointAdd = vi.fn();
    render(
      <MapCanvas
        map={sampleMap}
        selectedCell={null}
        selectedCellId={null}
        onSelectCell={onSelectCell}
        interactionMode="river-draw"
        onRiverPointAdd={onRiverPointAdd}
        riverPreview={{
          id: "__river-preview",
          name: "Preview",
          points: [
            { row: 0, col: 0, width: 4 },
            { row: 0, col: 1 }
          ],
          color: "#2F83B7",
          opacity: 0.88
        }}
        riverDrawingPointCount={2}
        onFinishRiverDrawing={() => {}}
        onCancelRiverDrawing={() => {}}
        showCoordinates
        showShorthand
        showGrid
        showUndesigned
      />
    );

    const container = screen.getByLabelText("地图画布").parentElement as HTMLDivElement;
    const designedCell = screen.getByRole("button", { name: "R0C0 已设计" });
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    fireEvent.pointerDown(designedCell, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 400, clientY: 300 });

    expect(onRiverPointAdd).toHaveBeenCalledTimes(1);
    expect(onRiverPointAdd).toHaveBeenLastCalledWith(expect.objectContaining({ id: "cell@0,0" }));
    expect(onSelectCell).not.toHaveBeenCalled();
    expect(screen.getByLabelText("河流绘制工具").textContent).toContain("路径点 2");
    expect(
      screen.getByLabelText("地图画布").querySelector('[data-river-preview="true"]')
    ).toBeTruthy();
    expect(
      screen.getByLabelText("地图画布").querySelector('[data-river-control-point="start"]')
    ).toBeTruthy();
    expect(
      screen.getByLabelText("地图画布").querySelector('[data-river-control-point="end"]')
    ).toBeTruthy();
  });

  it("toggles batch selection in batch mode without normal cell selection", async () => {
    const onSelectCell = vi.fn();
    const onBatchCellToggle = vi.fn();
    render(
      <MapCanvas
        map={sampleMap}
        selectedCell={null}
        selectedCellId={null}
        onSelectCell={onSelectCell}
        interactionMode="batch-select"
        batchSelectedCellIds={new Set(["cell@0,0"])}
        onBatchCellToggle={onBatchCellToggle}
        showCoordinates
        showShorthand
        showGrid
        showUndesigned
      />
    );

    const container = screen.getByLabelText("地图画布").parentElement as HTMLDivElement;
    const designedCell = screen.getByRole("button", { name: "R0C0 已设计" });
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    expect(
      screen
        .getByLabelText("地图画布")
        .querySelector('[data-cell-id="cell@0,0"]')
        ?.getAttribute("data-batch-selected")
    ).toBe("true");

    fireEvent.pointerDown(designedCell, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(container, { pointerId: 1, clientX: 400, clientY: 300 });

    expect(onBatchCellToggle).toHaveBeenCalledTimes(1);
    expect(onBatchCellToggle).toHaveBeenLastCalledWith(expect.objectContaining({ id: "cell@0,0" }));
    expect(onSelectCell).not.toHaveBeenCalled();

    fireEvent.pointerDown(designedCell, { button: 0, pointerId: 2, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(container, { pointerId: 2, clientX: 430, clientY: 300 });
    fireEvent.pointerUp(container, { pointerId: 2, clientX: 430, clientY: 300 });

    expect(onBatchCellToggle).toHaveBeenCalledTimes(1);
  });

  it("reports the visible coordinate range for range-backed loading", async () => {
    const onVisibleRangeChange = vi.fn();
    render(
      <MapCanvas
        map={sampleMap}
        selectedCell={null}
        selectedCellId={null}
        onSelectCell={() => {}}
        onVisibleRangeChange={onVisibleRangeChange}
        showCoordinates
        showShorthand
        showGrid
        showUndesigned
      />
    );

    const container = screen.getByLabelText("地图画布").parentElement as HTMLDivElement;
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(onVisibleRangeChange).toHaveBeenCalledWith(
        expect.objectContaining({
          minRow: expect.any(Number),
          maxRow: expect.any(Number),
          minCol: expect.any(Number),
          maxCol: expect.any(Number)
        })
      );
    });
  });

  // JSDOM constructs 1,681 SVG cell trees on shared CI runners. The deadline is not a frame budget;
  // browser performance is measured independently by the visual QA runner.
  it("limits coordinate labels by viewport and density instead of rendering every cell at once", async () => {
    const largeMap = buildLargeMap();
    render(
      <MapCanvas
        map={largeMap}
        selectedCell={null}
        selectedCellId={null}
        onSelectCell={() => {}}
        showCoordinates
        showShorthand={false}
        showGrid
        showUndesigned
      />
    );

    const container = screen.getByLabelText("地图画布").parentElement as HTMLDivElement;
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.getByLabelText("地图画布").getAttribute("data-coordinate-label-mode")).toBe(
        "hidden"
      );
      expect(countCoordinateLabels()).toBe(0);
    });

    // This checks density at the final scale; gesture sequences are covered separately.
    fireEvent.wheel(container, { deltaY: -1440, clientX: 400, clientY: 300 });

    await waitFor(() => {
      const labelMode = screen
        .getByLabelText("地图画布")
        .getAttribute("data-coordinate-label-mode");
      const coordinateCount = countCoordinateLabels();
      expect(labelMode).toMatch(/sparse|medium|full/);
      expect(coordinateCount).toBeGreaterThan(0);
      expect(coordinateCount).toBeLessThan(largeMap.activeCells.length / 2);
    });
  }, 15000);

  it("keeps coordinate labels culled to the visible map area at deep zoom", async () => {
    const largeMap = buildLargeMap();
    render(
      <MapCanvas
        map={largeMap}
        selectedCell={null}
        selectedCellId={null}
        onSelectCell={() => {}}
        showCoordinates
        showShorthand
        showGrid
        showUndesigned
      />
    );

    const container = screen.getByLabelText("地图画布").parentElement as HTMLDivElement;
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    fireEvent.wheel(container, { deltaY: -2880, clientX: 400, clientY: 300 });

    await waitFor(() => {
      expect(screen.getByLabelText("地图画布").getAttribute("data-coordinate-label-mode")).toBe(
        "full"
      );
      const coordinateCount = countCoordinateLabels();
      expect(coordinateCount).toBeGreaterThan(0);
      expect(coordinateCount).toBeLessThan(largeMap.activeCells.length / 3);
    });
  }, 15000);
});

describe("canvas gestures", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const props = {
    map: sampleMap,
    selectedCell: null,
    selectedCellId: null,
    showCoordinates: true,
    showShorthand: false,
    showGrid: true,
    showUndesigned: true
  };
  function pointer(target: Element, type: string, x: number, y: number) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(target, event);
  }
  function screenCenter(id: string) {
    const svg = screen.getByLabelText("地图画布"),
      group = svg.querySelector("g[transform]")!;
    const match = group
      .getAttribute("transform")!
      .match(/translate\(([-\d.eE]+) ([-\d.eE]+)\) scale\(([-\d.eE]+)\)/)!;
    const points = svg
      .querySelector('[data-cell-id="' + id + '"] polygon')!
      .getAttribute("points")!
      .split(" ")
      .map((p) => p.split(",").map(Number));
    const x = points.reduce((sum, p) => sum + p[0]!, 0) / 6,
      y = points.reduce((sum, p) => sum + p[1]!, 0) / 6;
    return {
      x: Number(match[1]) + x * Number(match[3]),
      y: Number(match[2]) + y * Number(match[3])
    };
  }
  it("submits one brush stroke on release and drops a cancelled gesture", () => {
    const brush = vi.fn();
    render(
      <MapCanvas {...props} interactionMode="brush" onSelectCell={vi.fn()} onBrushStroke={brush} />
    );
    const canvas = screen.getByLabelText("地图编辑区域");
    mockCanvasRect(canvas as HTMLDivElement);
    fireEvent(window, new Event("resize"));
    const a = screenCenter("cell@0,0"),
      b = screenCenter("cell@0,1");
    pointer(screen.getByRole("button", { name: "R0C0 已设计" }), "pointerdown", a.x, a.y);
    pointer(canvas, "pointermove", b.x, b.y);
    expect(brush).not.toHaveBeenCalled();
    pointer(canvas, "pointerup", b.x, b.y);
    expect(brush).toHaveBeenCalledTimes(1);
    expect(brush.mock.calls[0]?.[0].map((cell: ActiveCell) => cell.id)).toEqual([
      "cell@0,0",
      "cell@0,1"
    ]);
    pointer(screen.getByRole("button", { name: "R0C0 已设计" }), "pointerdown", a.x, a.y);
    pointer(canvas, "pointermove", b.x, b.y);
    pointer(canvas, "pointercancel", b.x, b.y);
    expect(brush).toHaveBeenCalledTimes(1);
  });
  it("supports directional navigation and visible zoom controls", () => {
    const select = vi.fn();
    render(
      <MapCanvas
        {...props}
        selectedCell={sampleMap.activeCells[3]!}
        selectedCellId="cell@0,0"
        onSelectCell={select}
      />
    );
    const canvas = screen.getByLabelText("地图编辑区域");
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "cell@0,1" }));
    const before = screen.getByLabelText("缩放比例").textContent;
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(screen.getByLabelText("缩放比例").textContent).not.toBe(before);
  });
});
