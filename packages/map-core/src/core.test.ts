import { describe, expect, it } from "vitest";
import {
  BIOME_KEYS,
  applyCommand,
  buildActiveCells,
  createEmptyDocument,
  createRuntimeState,
  getAllowedBiomesForTerrain,
  getAllowedTerrainCategoriesForBiome,
  getAllowedTerrainsForBiome,
  getFilteredTerrainEntries,
  getTerrainCategoryKey,
  getTerrainEntriesByCategory,
  redo,
  getNeighborCoords,
  getSeedCoordinates,
  parseCellId,
  parseDisplayCoord,
  stringifyDocument,
  parseDocument,
  undo,
  validateTerrainBiomePair
} from "./index.js";

describe("coords", () => {
  it("parses stable identifiers", () => {
    expect(parseCellId("cell@-2,5")).toEqual({ row: -2, col: 5 });
    expect(parseDisplayCoord("R-2C5")).toEqual({ row: -2, col: 5 });
  });
});

describe("neighbors", () => {
  it("returns six axial neighbors that ring around the origin", () => {
    expect(getNeighborCoords({ row: 0, col: 0 })).toHaveLength(6);
    expect(getNeighborCoords({ row: 1, col: 1 })).toHaveLength(6);
    expect(getNeighborCoords({ row: 0, col: 0 })).toEqual([
      { row: 1, col: 0 },
      { row: 0, col: 1 },
      { row: -1, col: 1 },
      { row: -1, col: 0 },
      { row: 0, col: -1 },
      { row: 1, col: -1 }
    ]);
  });
});

describe("activity", () => {
  it("creates a 7-cell seed area for empty maps", () => {
    expect(getSeedCoordinates()).toHaveLength(7);
    expect(getSeedCoordinates()).toEqual([
      { row: -1, col: 0 },
      { row: -1, col: 1 },
      { row: 0, col: -1 },
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: -1 },
      { row: 1, col: 0 }
    ]);
    const runtime = createRuntimeState(
      createEmptyDocument({
        id: "seed-test",
        name: "Seed Test"
      })
    );
    expect(runtime.activeCells).toHaveLength(7);
    expect(runtime.activeCells.every((cell) => cell.status === "undesigned")).toBe(true);
  });

  it("creates a designed cell plus one ring of undesigned neighbors", () => {
    const document = createEmptyDocument({
      id: "activity-test",
      name: "Activity Test"
    });
    document.cells.push({
      row: 0,
      col: 0,
      terrain: "plain",
      biome: "grassland",
      tags: [],
      note: ""
    });
    expect(buildActiveCells(document)).toHaveLength(7);
  });

  it("keeps internal undesigned cells when multiple designed neighbors exist", () => {
    const document = createEmptyDocument({
      id: "internal-empty",
      name: "Internal Empty"
    });
    document.cells.push(
      {
        row: 0,
        col: -1,
        terrain: "plain",
        biome: "grassland",
        tags: [],
        note: ""
      },
      {
        row: 0,
        col: 1,
        terrain: "plain",
        biome: "grassland",
        tags: [],
        note: ""
      }
    );
    const active = buildActiveCells(document);
    expect(active.find((cell) => cell.row === 0 && cell.col === 0)?.status).toBe("undesigned");
  });
});

describe("validation", () => {
  it("flags invalid terrain-biome combinations", () => {
    const issues = validateTerrainBiomePair("mountain", "coral");
    expect(issues.some((entry) => entry.severity === "invalid")).toBe(true);
  });

  it("groups terrain entries into stable ui categories", () => {
    expect(getTerrainCategoryKey("plain")).toBe("plain");
    expect(getTerrainCategoryKey("volcanic")).toBe("volcanic");
    expect(getTerrainEntriesByCategory("water").map((entry) => entry.key)).toContain("ocean");
    expect(getTerrainEntriesByCategory("water").map((entry) => entry.key)).toContain("river");
    expect(getTerrainEntriesByCategory("upland").map((entry) => entry.key)).toContain("mountain");
  });

  it("provides relaxed terrain to biome filtering helpers", () => {
    expect(getAllowedBiomesForTerrain("ocean")).toEqual(["marine", "coral", "seagrass", "pack_ice"]);
    expect(getAllowedTerrainsForBiome("marine")).toContain("ocean");
    expect(getAllowedTerrainsForBiome("marine")).not.toContain("plain");
    expect(getAllowedTerrainCategoriesForBiome("marine")).toEqual(["water", "coast"]);
    expect(getFilteredTerrainEntries("coast", "marine").map((entry) => entry.key)).toContain("reef");
    expect(getFilteredTerrainEntries("coast", "marine").map((entry) => entry.key)).not.toContain("plain");
    expect(getAllowedBiomesForTerrain("plain")).toContain("grassland");
    expect(getAllowedBiomesForTerrain("plain")).not.toContain("marine");
    expect(getAllowedTerrainCategoriesForBiome("")).toEqual(expect.arrayContaining(["water", "coast", "plain"]));
    expect(BIOME_KEYS).toContain("grassland");
  });
});

describe("commands", () => {
  it("applies set_cell and clear_cell", () => {
    const empty = createRuntimeState(
      createEmptyDocument({
        id: "command-test",
        name: "Command Test"
      })
    );
    const setResult = applyCommand(empty, {
      action: "set_cell",
      source: "cli",
      target: { row: 0, col: 0 },
      changes: {
        terrain: "plain",
        biome: "grassland",
        tags: ["peak"],
        note: "center"
      }
    });
    expect(setResult.ok).toBe(true);
    expect(setResult.map.document.cells).toHaveLength(1);
    expect(setResult.map.document.cells[0]?.terrain).toBe("plain");
    expect(setResult.details).toHaveLength(1);
    expect(setResult.details[0]?.display_coord).toBe("R0C0");
    expect(setResult.details[0]?.before?.status).toBe("undesigned");
    expect(setResult.details[0]?.after?.status).toBe("designed");
    expect(setResult.details[0]?.after?.terrain).toBe("plain");

    const clearResult = applyCommand(setResult.map, {
      action: "clear_cell",
      source: "cli",
      target: { row: 0, col: 0 }
    });
    expect(clearResult.ok).toBe(true);
    expect(clearResult.map.document.cells).toHaveLength(0);
    expect(clearResult.map.activeCells).toHaveLength(7);
    expect(clearResult.details).toHaveLength(1);
    expect(clearResult.details[0]?.before?.status).toBe("designed");
    expect(clearResult.details[0]?.after?.status).toBe("undesigned");
  });

  it("supports set_cells and replace_terrain", () => {
    const empty = createRuntimeState(
      createEmptyDocument({
        id: "bulk-test",
        name: "Bulk Test"
      })
    );
    const setCells = applyCommand(empty, {
      action: "set_cells",
      source: "cli",
      targets: [
        { row: 0, col: 0 },
        { row: 1, col: 0 }
      ],
      changes: {
        terrain: "plain",
        biome: "grassland"
      }
    });
    expect(setCells.ok).toBe(true);
    expect(setCells.map.document.cells).toHaveLength(2);

    const replaced = applyCommand(setCells.map, {
      action: "replace_terrain",
      source: "cli",
      match: { terrain: "plain" },
      changes: { terrain: "hill" }
    });
    expect(replaced.ok).toBe(true);
    expect(replaced.map.document.cells.every((cell) => cell.terrain === "hill")).toBe(true);
    expect(replaced.details).toHaveLength(2);
    expect(replaced.details.every((entry) => entry.before?.terrain === "plain")).toBe(true);
    expect(replaced.details.every((entry) => entry.after?.terrain === "hill")).toBe(true);
  });

  it("supports replace_biome and annotate_cell", () => {
    const empty = createRuntimeState(
      createEmptyDocument({
        id: "annotate-test",
        name: "Annotate Test"
      })
    );
    const seeded = applyCommand(empty, {
      action: "set_cell",
      source: "cli",
      target: { row: 0, col: 0 },
      changes: {
        terrain: "plain",
        biome: "grassland"
      }
    });
    expect(seeded.ok).toBe(true);

    const replaced = applyCommand(seeded.map, {
      action: "replace_biome",
      source: "cli",
      match: { biome: "grassland" },
      changes: { biome: "steppe" }
    });
    expect(replaced.ok).toBe(true);
    expect(replaced.map.document.cells[0]?.biome).toBe("steppe");

    const annotated = applyCommand(replaced.map, {
      action: "annotate_cell",
      source: "cli",
      target: { row: 0, col: 0 },
      changes: {
        tags: ["peak"],
        note: "high point"
      }
    });
    expect(annotated.ok).toBe(true);
    expect(annotated.map.document.cells[0]?.tags).toEqual(["peak"]);
    expect(annotated.map.document.cells[0]?.note).toBe("high point");
    expect(annotated.details).toHaveLength(1);
    expect(annotated.details[0]?.before?.note).toBe("");
    expect(annotated.details[0]?.after?.note).toBe("high point");
  });

  it("rejects invalid command payloads", () => {
    const empty = createRuntimeState(
      createEmptyDocument({
        id: "invalid-test",
        name: "Invalid Test"
      })
    );
    const result = applyCommand(empty, {
      action: "set_cell",
      source: "cli",
      target: { row: 0, col: 0 },
      changes: {
        terrain: "mountain",
        biome: "coral"
      }
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((entry) => entry.severity === "invalid")).toBe(true);
    expect(result.details).toHaveLength(0);
  });
});

describe("history", () => {
  it("supports undo and redo", () => {
    const empty = createRuntimeState(
      createEmptyDocument({
        id: "history-test",
        name: "History Test"
      })
    );
    const setResult = applyCommand(empty, {
      action: "set_cell",
      source: "webui",
      target: { row: 0, col: 0 },
      changes: {
        terrain: "plain"
      }
    });
    expect(setResult.ok).toBe(true);
    const undone = undo(setResult.map);
    expect(undone.document.cells).toHaveLength(0);
    const redone = redo(undone);
    expect(redone.document.cells).toHaveLength(1);
  });
});

describe("serialization", () => {
  it("round-trips JSON documents", () => {
    const document = createEmptyDocument({
      id: "roundtrip-test",
      name: "Roundtrip Test"
    });
    const json = stringifyDocument(document);
    const parsed = parseDocument(json);
    expect(parsed.document?.meta.id).toBe("roundtrip-test");
    expect(parsed.errors).toHaveLength(0);
  });

  it("rejects duplicate coordinates on parse", () => {
    const raw = JSON.stringify({
      schema_version: 1,
      meta: {
        id: "duplicate-test",
        name: "Duplicate Test",
        description: "",
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        revision: 1
      },
      grid: {
        layout: "flat-top-even-q",
        origin: { row: 0, col: 0 }
      },
      cells: [
        { row: 0, col: 0, terrain: "plain", biome: null, tags: [], note: "" },
        { row: 0, col: 0, terrain: "hill", biome: null, tags: [], note: "" }
      ]
    });
    const parsed = parseDocument(raw);
    expect(parsed.document).toBeUndefined();
    expect(parsed.errors.some((entry) => entry.code === "duplicate_cell")).toBe(true);
  });
});
