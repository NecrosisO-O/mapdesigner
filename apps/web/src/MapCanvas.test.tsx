/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapCanvas } from "./MapCanvas.js";

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

describe("MapCanvas", () => {
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

    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.getByLabelText("Map canvas").getAttribute("data-render-detail")).toBe("near");
      expect(screen.getByText("R0C0")).toBeTruthy();
      expect(screen.getByText("PLN-GRS")).toBeTruthy();
    });

    for (let index = 0; index < 25; index += 1) {
      fireEvent.wheel(container, { deltaY: 120, clientX: 400, clientY: 300 });
    }

    await waitFor(() => {
      expect(screen.queryByText("R0C0")).toBeNull();
      expect(screen.queryByText("PLN-GRS")).toBeNull();
      expect(screen.getByLabelText("Map canvas").getAttribute("data-render-detail")).toMatch(/far/);
    });
  });
});
