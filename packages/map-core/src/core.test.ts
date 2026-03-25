import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildActiveCells,
  createEmptyDocument,
  createRuntimeState,
  getNeighborCoords,
  getSeedCoordinates,
  parseCellId,
  parseDisplayCoord,
  stringifyDocument,
  parseDocument,
  validateTerrainBiomePair
} from "./index.js";

describe("coords", () => {
  it("parses stable identifiers", () => {
    expect(parseCellId("cell@-2,5")).toEqual({ row: -2, col: 5 });
    expect(parseDisplayCoord("R-2C5")).toEqual({ row: -2, col: 5 });
  });
});

describe("neighbors", () => {
  it("returns six neighbors for flat-top even-q", () => {
    expect(getNeighborCoords({ row: 0, col: 0 })).toHaveLength(6);
    expect(getNeighborCoords({ row: 1, col: 1 })).toHaveLength(6);
  });
});

describe("activity", () => {
  it("creates a 7-cell seed area for empty maps", () => {
    expect(getSeedCoordinates()).toHaveLength(7);
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
});

describe("validation", () => {
  it("flags invalid terrain-biome combinations", () => {
    const issues = validateTerrainBiomePair("mountain", "coral");
    expect(issues.some((entry) => entry.severity === "invalid")).toBe(true);
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

    const clearResult = applyCommand(setResult.map, {
      action: "clear_cell",
      source: "cli",
      target: { row: 0, col: 0 }
    });
    expect(clearResult.ok).toBe(true);
    expect(clearResult.map.document.cells).toHaveLength(0);
    expect(clearResult.map.activeCells).toHaveLength(7);
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
});
