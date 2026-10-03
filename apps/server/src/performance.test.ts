import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type MapCommand } from "@mapdesigner/map-core";
let root: string,
  service: typeof import("./service.js"),
  repository: typeof import("./repository.js"),
  database: typeof import("./db.js");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-performance-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.resetModules();
  service = await import("./service.js");
  repository = await import("./repository.js");
  database = await import("./db.js");
});
afterEach(async () => {
  database.closeDatabaseForTests();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
it("keeps incremental aggregates exact after inserts, deletion, undo and redo", async () => {
  const id = (await service.createMap({ name: "Bounds" })).document.meta.id;
  const commands: MapCommand[] = [
    {
      action: "set_cells",
      targets: [
        { row: -20, col: 100 },
        { row: 2, col: -5 },
        { row: 10, col: 3 }
      ],
      changes: { terrain: "plain" }
    },
    { action: "annotate_cell", target: { row: 2, col: -5 }, changes: { note: "preserve bounds" } },
    { action: "clear_cell", target: { row: -20, col: 100 } },
    { action: "clear_cell", target: { row: 10, col: 3 } },
    { action: "clear_cell", target: { row: 2, col: -5 } }
  ];
  async function verify() {
    const summary = await service.getMapSummary(id);
    const aggregate = database
      .getDatabase()
      .prepare(
        "SELECT count(*) AS n, min(row) AS min_row, max(row) AS max_row, min(col) AS min_col, max(col) AS max_col FROM cells WHERE map_id = ?"
      )
      .get(id) as Record<string, number | null>;
    expect(summary.designed_cell_count).toBe(aggregate.n);
    expect(summary.bounds).toEqual({
      min_row: aggregate.min_row,
      max_row: aggregate.max_row,
      min_col: aggregate.min_col,
      max_col: aggregate.max_col
    });
  }
  for (const command of commands) {
    await service.applyCommandsLight(id, [command]);
    await verify();
  }
  for (let i = 0; i < commands.length; i++) {
    await service.undoMapLight(id);
    await verify();
  }
  for (let i = 0; i < commands.length; i++) {
    await service.redoMapLight(id);
    await verify();
  }
});
it("covers all sparse edges and rivers in a bounded overview", async () => {
  const doc = createEmptyDocument({ id: "overview", name: "Overview" });
  doc.cells = [
    { row: -1000, col: -1000, terrain: "plain", biome: null, tags: [], note: "" },
    { row: 1000, col: 1000, terrain: "hill", biome: null, tags: [], note: "" }
  ];
  doc.features.rivers = [
    {
      id: "r",
      name: "River",
      points: [
        { row: 0, col: 0 },
        { row: 0, col: 1000 }
      ]
    }
  ];
  await repository.importMapDocument(doc);
  const { getOverview } = await import("./overview.js");
  const overview = await getOverview(doc.meta.id, {
    minRow: -1000,
    maxRow: 1000,
    minCol: -1000,
    maxCol: 1000
  });
  expect(overview.tiles.length).toBeLessThanOrEqual(4096);
  expect(overview.tiles.reduce((sum, tile) => sum + tile.count, 0)).toBe(2);
  expect(overview.tiles.some((tile) => tile.row < 0 && tile.count)).toBe(true);
  expect(overview.tiles.some((tile) => tile.row > 900 && tile.count)).toBe(true);
  expect(overview.rivers?.some((river) => river.paths.length > 0)).toBe(true);
  expect(overview.tiles.every((tile) => tile.count > 0)).toBe(true);
  const summary = await service.getMapSummary(doc.meta.id);
  expect(summary.render_bounds).toEqual({
    min_row: -1000,
    max_row: 1000,
    min_col: -1000,
    max_col: 1000
  });
});
it("provides render bounds for maps containing only distant rivers", async () => {
  const doc = createEmptyDocument({ id: "river-only", name: "Rivers" });
  doc.features.rivers = [
    {
      id: "far",
      name: "Far",
      points: [
        { row: 500, col: 1000 },
        { row: 502, col: 1003 }
      ]
    }
  ];
  await repository.importMapDocument(doc);
  expect((await service.getMapSummary(doc.meta.id)).render_bounds).toEqual({
    min_row: 500,
    max_row: 502,
    min_col: 1000,
    max_col: 1003
  });
});

it("keeps persistent material counts exact across overwrite, undo, redo and restart", async () => {
  const id = (await service.createMap({ name: "Counters" })).document.meta.id;
  await repository.getMapMaterialUsage(id);
  await service.applyCommandsLight(id, [
    {
      action: "set_cell",
      target: { row: -32, col: -1 },
      changes: { terrain: "mountain", biome: "conifer_forest", tags: ["peak"] }
    }
  ]);
  expect((await repository.getMapMaterialUsage(id)).tags).toEqual(["peak"]);
  await service.applyCommandsLight(id, [
    {
      action: "set_cell",
      target: { row: -32, col: -1 },
      changes: { terrain: "plain", biome: null, tags: [] }
    }
  ]);
  expect((await repository.getMapMaterialUsage(id)).terrains).toEqual(["plain"]);
  expect((await repository.getMapMaterialUsage(id)).biomes).toEqual([]);
  await service.undoMapLight(id);
  database.closeDatabaseForTests();
  expect((await repository.getMapMaterialUsage(id)).terrains).toEqual(["mountain"]);
  expect((await repository.getMapMaterialUsage(id)).tags).toEqual(["peak"]);
  await service.redoMapLight(id);
  expect((await repository.getMapMaterialUsage(id)).tags).toEqual([]);
});

it("counts sparse negative coordinates and partial tile edges exactly", async () => {
  const doc = createEmptyDocument({ id: "partial-tiles", name: "Tiles" });
  doc.cells = [
    -2101, -2048, -2047, -65, -64, -33, -32, -31, -1, 0, 1, 31, 32, 33, 2047, 2048, 2101
  ].flatMap((row) =>
    [-2048, -31, 0, 31, 2048].map((col) => ({
      row,
      col,
      terrain: "plain" as const,
      biome: null,
      tags: [],
      note: ""
    }))
  );
  await repository.importMapDocument(doc);
  const { getOverview } = await import("./overview.js");
  for (const range of [
    { minRow: -2101, maxRow: 2101, minCol: -2048, maxCol: 2048 },
    { minRow: -2047, maxRow: 2047, minCol: -2047, maxCol: 2047 },
    { minRow: -2047, maxRow: 2047, minCol: -1, maxCol: 1 },
    { minRow: -31, maxRow: 31, minCol: -2047, maxCol: 2047 }
  ]) {
    const expected = doc.cells.filter(
      (c) =>
        c.row >= range.minRow &&
        c.row <= range.maxRow &&
        c.col >= range.minCol &&
        c.col <= range.maxCol
    ).length;
    const overview = await getOverview(doc.meta.id, range);
    expect(overview.designed_cell_count).toBe(expected);
    expect(overview.tiles.reduce((n, t) => n + t.count, 0)).toBe(expected);
  }
});
