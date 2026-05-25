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
  const svg = screen.getByLabelText("Map canvas");
  return Array.from(svg.querySelectorAll("text")).filter((node) => /^R-?\d+C-?\d+$/.test(node.textContent ?? "")).length;
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

    const container = screen.getByLabelText("Map canvas").parentElement as HTMLDivElement;
    mockCanvasRect(container);

    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.getByLabelText("Map canvas").getAttribute("data-render-detail")).toBe("near");
      expect(screen.getByText("R0C0")).toBeTruthy();
      expect(screen.getByText("PLN-GRS")).toBeTruthy();
      expect(screen.getByRole("button", { name: "R0C0 designed" })).toBeTruthy();
    });

    for (let index = 0; index < 25; index += 1) {
      fireEvent.wheel(container, { deltaY: 120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      expect(screen.queryByText("R0C0")).toBeNull();
      expect(screen.queryByText("PLN-GRS")).toBeNull();
      expect(screen.getByRole("button", { name: "R0C0 designed" })).toBeTruthy();
      expect(screen.getByLabelText("Map canvas").getAttribute("data-render-detail")).toMatch(/far/);
    });
  });

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

    const container = screen.getByLabelText("Map canvas").parentElement as HTMLDivElement;
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.getByLabelText("Map canvas").getAttribute("data-coordinate-label-mode")).toBe("hidden");
      expect(countCoordinateLabels()).toBe(0);
    });

    for (let index = 0; index < 12; index += 1) {
      fireEvent.wheel(container, { deltaY: -120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      const labelMode = screen.getByLabelText("Map canvas").getAttribute("data-coordinate-label-mode");
      const coordinateCount = countCoordinateLabels();
      expect(labelMode).toMatch(/sparse|medium|full/);
      expect(coordinateCount).toBeGreaterThan(0);
      expect(coordinateCount).toBeLessThan(largeMap.activeCells.length / 2);
    });
  });

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

    const container = screen.getByLabelText("Map canvas").parentElement as HTMLDivElement;
    mockCanvasRect(container);
    fireEvent(window, new Event("resize"));

    for (let index = 0; index < 24; index += 1) {
      fireEvent.wheel(container, { deltaY: -120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      expect(screen.getByLabelText("Map canvas").getAttribute("data-coordinate-label-mode")).toBe("full");
      const coordinateCount = countCoordinateLabels();
      expect(coordinateCount).toBeGreaterThan(0);
      expect(coordinateCount).toBeLessThan(largeMap.activeCells.length / 3);
    });
  });
});
