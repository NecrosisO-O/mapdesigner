import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument, stringifyDocument, type MapCommand } from "@mapdesigner/map-core";

async function loadService(tempRoot: string) {
  process.env.MAPDESIGNER_ROOT = tempRoot;
  vi.resetModules();
  return import("./service.js");
}

describe("server service", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-service-"));
  });

  afterEach(async () => {
    delete process.env.MAPDESIGNER_ROOT;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("creates, lists, and saves maps with revision checks", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Service Test" });
    expect(created.document.meta.revision).toBe(1);
    await expect(fs.stat(path.join(tempRoot, "storage/mapdesigner.db"))).resolves.toBeTruthy();

    const listed = await service.listMaps();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("Service Test");

    const modified = structuredClone(created.document);
    modified.meta.name = "Renamed Service Test";
    modified.meta.updated_at = new Date().toISOString();
    modified.meta.revision += 1;
    const saved = await service.saveMap({
      document: modified,
      expectedRevision: 1
    });
    expect(saved.document.meta.name).toBe("Renamed Service Test");

    await expect(
      service.saveMap({
        document: modified,
        expectedRevision: 1
      })
    ).rejects.toThrow(/revision conflict/);
  });

  it("provides map summaries and viewport cell ranges from sqlite storage", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Range Test" });
    await service.applyCommands(created.document.meta.id, [
      {
        action: "set_cells",
        source: "cli",
        targets: [
          { row: 0, col: 0 },
          { row: 0, col: 1 }
        ],
        changes: {
          terrain: "plain",
          biome: "grassland",
          tags: ["peak"],
          note: "visible"
        }
      },
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "range-river",
          name: "Range River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 1, width: 4 }
          ]
        }
      }
    ]);

    const summary = await service.getMapSummary(created.document.meta.id);
    expect(summary.meta.name).toBe("Range Test");
    expect(summary.designed_cell_count).toBe(2);
    expect(summary.bounds).toEqual({
      min_row: 0,
      max_row: 0,
      min_col: 0,
      max_col: 1
    });
    expect(summary.feature_counts.rivers).toBe(1);

    const designedOnly = await service.getCellsInRange(
      created.document.meta.id,
      {
        minRow: 0,
        maxRow: 0,
        minCol: 0,
        maxCol: 1
      },
      { includeUndesigned: false }
    );
    expect(designedOnly.cells).toHaveLength(2);
    expect(designedOnly.cells.every((cell) => cell.status === "designed")).toBe(true);

    const withUndesigned = await service.getCellsInRange(created.document.meta.id, {
      minRow: -1,
      maxRow: 1,
      minCol: -1,
      maxCol: 2
    });
    expect(withUndesigned.cells.some((cell) => cell.status === "undesigned")).toBe(true);
    expect(withUndesigned.cells.some((cell) => cell.display_coord === "R0C0" && cell.status === "designed")).toBe(true);
  });

  it("filters river features by expanded path range", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Feature Range Test" });
    const mapId = created.document.meta.id;

    await service.applyCommands(mapId, [
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "crossing-river",
          name: "Crossing River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 8, width: 4 }
          ]
        }
      },
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "far-river",
          name: "Far River",
          points: [
            { row: 20, col: 20, width: 2 },
            { row: 20, col: 22, width: 2 }
          ]
        }
      }
    ]);

    const features = await service.getMapFeaturesInRange(mapId, {
      minRow: -1,
      maxRow: 1,
      minCol: 3,
      maxCol: 4
    });
    expect(features.rivers.map((river) => river.id)).toEqual(["crossing-river"]);
  });

  it("records command history and supports undo/redo for cell edits", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "History Test" });
    const mapId = created.document.meta.id;

    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: false,
      canRedo: false,
      cursor: 0,
      latest: 0
    });

    await service.applyCommands(mapId, [
      {
        action: "set_cell",
        source: "cli",
        target: { row: 0, col: 0 },
        changes: {
          terrain: "plain",
          biome: "grassland",
          note: "first"
        }
      }
    ]);
    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: true,
      canRedo: false,
      cursor: 1,
      latest: 1
    });

    const undone = await service.undoMap(mapId);
    expect(undone?.map.document.cells).toHaveLength(0);
    expect(undone?.status).toEqual({
      canUndo: false,
      canRedo: true,
      cursor: 0,
      latest: 1
    });

    const redone = await service.redoMap(mapId);
    expect(redone?.map.document.cells).toHaveLength(1);
    expect(redone?.map.document.cells[0]?.note).toBe("first");
    expect(redone?.status.canUndo).toBe(true);
    expect(redone?.status.canRedo).toBe(false);
  });

  it("supports undo/redo for river feature commands and truncates redo branches", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "River History Test" });
    const mapId = created.document.meta.id;

    await service.applyCommands(mapId, [
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "history-river",
          name: "History River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 2, width: 6 }
          ]
        }
      }
    ]);
    await service.applyCommands(mapId, [
      {
        action: "set_river_width",
        source: "cli",
        river_id: "history-river",
        target: { row: 0, col: 1 },
        width: 4
      }
    ]);

    expect((await service.getMap(mapId)).document.features.rivers[0]?.points).toEqual([
      { row: 0, col: 0, width: 2 },
      { row: 0, col: 1, width: 4 },
      { row: 0, col: 2, width: 6 }
    ]);

    const undoWidth = await service.undoMap(mapId);
    expect(undoWidth?.map.document.features.rivers[0]?.points).toEqual([
      { row: 0, col: 0, width: 2 },
      { row: 0, col: 2, width: 6 }
    ]);

    const undoCreate = await service.undoMap(mapId);
    expect(undoCreate?.map.document.features.rivers).toHaveLength(0);
    expect((await service.getHistoryStatus(mapId)).canRedo).toBe(true);

    await service.applyCommands(mapId, [
      {
        action: "set_cell",
        source: "cli",
        target: { row: 1, col: 0 },
        changes: {
          terrain: "hill",
          biome: "grassland"
        }
      }
    ]);
    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: true,
      canRedo: false,
      cursor: 1,
      latest: 1
    });
    expect(await service.redoMap(mapId)).toBeNull();
  });

  it("migrates existing json maps into sqlite on demand", async () => {
    const service = await loadService(tempRoot);
    const mapsDir = path.join(tempRoot, "storage/maps");
    await fs.mkdir(mapsDir, { recursive: true });
    const legacy = createEmptyDocument({
      id: "legacy-map",
      name: "Legacy Map"
    });
    legacy.cells.push({
      row: 2,
      col: -1,
      terrain: "hill",
      biome: "grassland",
      tags: [],
      note: "from json"
    });
    await fs.writeFile(path.join(mapsDir, "legacy-map.json"), stringifyDocument(legacy), "utf8");

    const listed = await service.listMaps();
    expect(listed.map((item) => item.id)).toContain("legacy-map");

    const summary = await service.getMapSummary("legacy-map");
    expect(summary.designed_cell_count).toBe(1);

    const opened = await service.getMap("legacy-map");
    expect(opened.document.cells[0]?.note).toBe("from json");
  });

  it("rejects creating a map over an existing legacy json id", async () => {
    const service = await loadService(tempRoot);
    const mapsDir = path.join(tempRoot, "storage/maps");
    await fs.mkdir(mapsDir, { recursive: true });
    const legacy = createEmptyDocument({
      id: "legacy-conflict",
      name: "Legacy Conflict"
    });
    await fs.writeFile(path.join(mapsDir, "legacy-conflict.json"), stringifyDocument(legacy), "utf8");

    await expect(
      service.createMap({
        id: "legacy-conflict",
        name: "Replacement"
      })
    ).rejects.toThrow(/already exists/);
  });

  it("applies commands and exports json/png", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Export Test" });
    const applied = await service.applyCommands(created.document.meta.id, [
      {
        action: "set_cell",
        source: "cli",
        target: { row: 0, col: 0 },
        changes: {
          terrain: "plain",
          biome: "grassland"
        }
      }
    ]);
    expect(applied.map.document.cells).toHaveLength(1);
    expect(applied.dryRun).toBe(false);
    expect(applied.command_results).toHaveLength(1);
    expect(applied.changes[0]?.after?.terrain).toBe("plain");
    expect(applied.stats.command_count).toBe(1);
    expect(applied.stats.changed_count).toBe(1);
    expect(applied.stats.created_count).toBe(1);
    expect(applied.stats.updated_count).toBe(0);
    expect(applied.stats.cleared_count).toBe(0);
    expect(applied.stats.terrain_summary.after.plain).toBe(1);
    expect(applied.stats.biome_summary.after.grassland).toBe(1);

    const riverApplied = await service.applyCommands(created.document.meta.id, [
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "main-river",
          name: "Main River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 2, width: 8 }
          ]
        }
      }
    ]);
    expect(riverApplied.map.document.features.rivers).toHaveLength(1);
    expect(riverApplied.command_results[0]?.action).toBe("create_river");
    expect(riverApplied.stats.created_count).toBe(0);
    expect(riverApplied.stats.feature_stats).toEqual({
      river_created_count: 1,
      river_updated_count: 0,
      river_deleted_count: 0
    });

    const jsonExport = await service.exportJson(created.document.meta.id);
    expect(await fs.stat(jsonExport.path)).toBeTruthy();

    const pngExport = await service.exportPng(created.document.meta.id, { preset: "reference" });
    expect(await fs.stat(pngExport.path)).toBeTruthy();
  });

  it("exports png from a bounded cell range without loading the whole visible map", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Range Export Test" });
    await service.applyCommands(created.document.meta.id, [
      {
        action: "set_cells",
        source: "cli",
        targets: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 20, col: 20 }
        ],
        changes: {
          terrain: "plain",
          biome: "grassland"
        }
      },
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "range-export-river",
          name: "Range Export River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 20, col: 20, width: 8 }
          ]
        }
      }
    ]);

    const pngExport = await service.exportPng(created.document.meta.id, {
      preset: "reference",
      includeUndesigned: true,
      range: {
        minRow: -1,
        maxRow: 1,
        minCol: -1,
        maxCol: 2
      }
    });

    expect(pngExport.fileName).toMatch(/range-export-test-reference-r-1_1-c-1_2\.png$/);
    await expect(fs.stat(pngExport.path)).resolves.toBeTruthy();
  });

  it("rejects whole-map png export for large maps and accepts a region export", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Large Export Test" });
    const targets = [];
    for (let row = 0; row < 101; row += 1) {
      for (let col = 0; col < 100; col += 1) {
        targets.push({ row, col });
      }
    }
    await service.applyCommands(created.document.meta.id, [
      {
        action: "set_cells",
        source: "cli",
        targets,
        changes: {
          terrain: "plain",
          biome: "grassland"
        }
      }
    ]);

    await expect(service.exportPng(created.document.meta.id)).rejects.toThrow(/whole-map PNG export is limited/);
    await expect(
      service.exportPng(created.document.meta.id, {
        range: {
          minRow: 0,
          maxRow: 4,
          minCol: 0,
          maxCol: 4
        }
      })
    ).resolves.toMatchObject({
      fileName: expect.stringContaining("-r0_4-c0_4.png")
    });
  });

  it("supports dry-run without writing the map file", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Dry Run Test" });

    const preview = await service.applyCommands(
      created.document.meta.id,
      [
        {
          action: "set_cell",
          source: "cli",
          target: { row: 0, col: 0 },
          changes: {
            terrain: "plain",
            biome: "grassland"
          }
        }
      ],
      { dryRun: true }
    );

    expect(preview.dryRun).toBe(true);
    expect(preview.map.document.cells).toHaveLength(1);
    expect(preview.changes[0]?.before?.status).toBe("undesigned");
    expect(preview.changes[0]?.after?.status).toBe("designed");
    expect(preview.stats.created_count).toBe(1);

    const persisted = await service.getMap(created.document.meta.id);
    expect(persisted.document.cells).toHaveLength(0);
    expect(persisted.document.meta.revision).toBe(1);
  });

  it("applies lightweight cell commands without returning a full map", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Light Apply Test" });
    const mapId = created.document.meta.id;

    const result = await service.applyCommandsLight(mapId, [
      {
        action: "set_cells",
        source: "cli",
        targets: [
          { row: 0, col: 0 },
          { row: 0, col: 1 }
        ],
        changes: {
          terrain: "plain",
          biome: "grassland",
          tags: ["peak"],
          note: "batch"
        }
      },
      {
        action: "replace_terrain",
        source: "cli",
        match: { terrain: "plain" },
        changes: { terrain: "hill" }
      },
      {
        action: "replace_biome",
        source: "cli",
        match: { biome: "grassland" },
        changes: { biome: "shrubland" }
      }
    ]);

    expect(result.mapId).toBe(mapId);
    expect(result.summary.designed_cell_count).toBe(2);
    expect(result.summary.meta.revision).toBe(4);
    expect(result.changes).toHaveLength(6);
    expect(result.stats.changed_count).toBe(6);
    expect(result.stats.terrain_summary.after.hill).toBe(4);
    expect(result.stats.biome_summary.after.shrubland).toBe(2);

    const persisted = await service.getMap(mapId);
    expect(persisted.document.cells).toEqual([
      expect.objectContaining({
        row: 0,
        col: 0,
        terrain: "hill",
        biome: "shrubland",
        tags: ["peak"],
        note: "batch"
      }),
      expect.objectContaining({
        row: 0,
        col: 1,
        terrain: "hill",
        biome: "shrubland",
        tags: ["peak"],
        note: "batch"
      })
    ]);

    const undone = await service.undoMap(mapId);
    expect(undone?.map.document.cells).toHaveLength(0);
  });

  it("supports lightweight dry-run without persisting cells or history", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Light Dry Run Test" });
    const mapId = created.document.meta.id;

    const result = await service.applyCommandsLight(
      mapId,
      [
        {
          action: "set_cell",
          source: "cli",
          target: { row: 0, col: 0 },
          changes: {
            terrain: "plain",
            biome: "grassland"
          }
        }
      ],
      { dryRun: true }
    );

    expect(result.summary.designed_cell_count).toBe(1);
    expect(result.summary.meta.revision).toBe(2);
    expect((await service.getMap(mapId)).document.cells).toHaveLength(0);
    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: false,
      canRedo: false,
      cursor: 0,
      latest: 0
    });
  });

  it("applies lightweight river commands and returns feature state without full map data", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Light River Test" });
    const mapId = created.document.meta.id;

    const preview = await service.applyCommandsLight(
      mapId,
      [
        {
          action: "create_river",
          source: "cli",
          river: {
            id: "preview-river",
            name: "Preview River",
            points: [
              { row: 0, col: 0, width: 2 },
              { row: 0, col: 2, width: 6 }
            ]
          }
        }
      ],
      { dryRun: true }
    );

    expect(preview.dryRun).toBe(true);
    expect(preview.features?.rivers.map((river) => river.id)).toEqual(["preview-river"]);
    expect(preview.summary.feature_counts.rivers).toBe(1);
    expect((await service.getMap(mapId)).document.features.rivers).toHaveLength(0);
    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: false,
      canRedo: false,
      cursor: 0,
      latest: 0
    });

    const createdRiver = await service.applyCommandsLight(mapId, [
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "light-river",
          name: "Light River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 2, width: 6 }
          ]
        }
      },
      {
        action: "set_river_width",
        source: "cli",
        river_id: "light-river",
        target: { row: 0, col: 1 },
        width: 4
      }
    ]);

    expect(createdRiver.mapId).toBe(mapId);
    expect(createdRiver.changes).toHaveLength(0);
    expect(createdRiver.summary.meta.revision).toBe(3);
    expect(createdRiver.stats.feature_stats).toEqual({
      river_created_count: 1,
      river_updated_count: 1,
      river_deleted_count: 0
    });
    expect(createdRiver.features?.rivers[0]?.points).toEqual([
      { row: 0, col: 0, width: 2 },
      { row: 0, col: 1, width: 4 },
      { row: 0, col: 2, width: 6 }
    ]);

    const persisted = await service.getMap(mapId);
    expect(persisted.document.features.rivers[0]?.points).toEqual(createdRiver.features?.rivers[0]?.points);
    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: true,
      canRedo: false,
      cursor: 1,
      latest: 1
    });

    const undone = await service.undoMapLight(mapId);
    expect(undone?.features?.rivers).toHaveLength(0);
    expect(undone?.status).toEqual({
      canUndo: false,
      canRedo: true,
      cursor: 0,
      latest: 1
    });
    expect((await service.getMap(mapId)).document.features.rivers).toHaveLength(0);

    const redone = await service.redoMapLight(mapId);
    expect(redone?.features?.rivers[0]?.points).toEqual(createdRiver.features?.rivers[0]?.points);
    expect(redone?.status).toEqual({
      canUndo: true,
      canRedo: false,
      cursor: 1,
      latest: 1
    });
  });

  it("applies mixed lightweight cell and river commands as one history operation", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Light Mixed Test" });
    const mapId = created.document.meta.id;
    const commands: MapCommand[] = [
      {
        action: "set_cell",
        source: "cli",
        target: { row: 0, col: 0 },
        changes: {
          terrain: "plain",
          biome: "grassland"
        }
      },
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "mixed-river",
          name: "Mixed River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 2, width: 6 }
          ]
        }
      }
    ];

    const preview = await service.applyCommandsLight(mapId, commands, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.summary.designed_cell_count).toBe(1);
    expect(preview.summary.feature_counts.rivers).toBe(1);
    expect(preview.features?.rivers.map((river) => river.id)).toEqual(["mixed-river"]);
    expect((await service.getMap(mapId)).document.cells).toHaveLength(0);
    expect((await service.getMap(mapId)).document.features.rivers).toHaveLength(0);
    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: false,
      canRedo: false,
      cursor: 0,
      latest: 0
    });

    const applied = await service.applyCommandsLight(mapId, commands);
    expect(applied.summary.designed_cell_count).toBe(1);
    expect(applied.summary.feature_counts.rivers).toBe(1);
    expect(applied.summary.meta.revision).toBe(3);
    expect(applied.changes).toHaveLength(1);
    expect(applied.features?.rivers[0]?.id).toBe("mixed-river");
    expect(applied.command_results.map((entry) => entry.index)).toEqual([0, 1]);
    expect(applied.stats.feature_stats.river_created_count).toBe(1);
    expect(await service.getHistoryStatus(mapId)).toEqual({
      canUndo: true,
      canRedo: false,
      cursor: 1,
      latest: 1
    });

    const undone = await service.undoMapLight(mapId);
    expect(undone?.summary.designed_cell_count).toBe(0);
    expect(undone?.features?.rivers).toHaveLength(0);
    expect(undone?.status).toEqual({
      canUndo: false,
      canRedo: true,
      cursor: 0,
      latest: 1
    });

    const redone = await service.redoMapLight(mapId);
    expect(redone?.summary.designed_cell_count).toBe(1);
    expect(redone?.features?.rivers[0]?.id).toBe("mixed-river");
    expect(redone?.status).toEqual({
      canUndo: true,
      canRedo: false,
      cursor: 1,
      latest: 1
    });
  });

  it("provides inspect-cell, inspect-area, and neighbors queries", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Inspect Test" });
    await service.applyCommands(created.document.meta.id, [
      {
        action: "set_cell",
        source: "cli",
        target: { row: 0, col: 0 },
        changes: {
          terrain: "plain",
          biome: "grassland"
        }
      }
    ]);
    await service.applyCommands(created.document.meta.id, [
      {
        action: "create_river",
        source: "cli",
        river: {
          id: "inspect-river",
          name: "Inspect River",
          points: [
            { row: 0, col: 0, width: 2 },
            { row: 0, col: 2, width: 6 }
          ]
        }
      }
    ]);

    const cell = await service.inspectCell(created.document.meta.id, { row: 0, col: 0 });
    expect(cell.cell.display_coord).toBe("R0C0");
    expect(cell.cell.status).toBe("designed");
    expect(cell.neighbors).toHaveLength(6);
    expect(cell.rivers).toEqual([
      expect.objectContaining({
        river_id: "inspect-river",
        river_name: "Inspect River",
        width: 2
      })
    ]);

    const area = await service.inspectArea(created.document.meta.id, { row: 0, col: 0 }, 1);
    expect(area.radius).toBe(1);
    expect(area.cells).toHaveLength(7);
    expect(area.cells.some((entry) => entry.display_coord === "R0C0" && entry.status === "designed")).toBe(true);

    const neighbors = await service.getNeighbors(created.document.meta.id, { row: 0, col: 0 });
    expect(neighbors.center.display_coord).toBe("R0C0");
    expect(neighbors.neighbors).toHaveLength(6);
    expect(neighbors.neighbors.some((entry) => entry.display_coord === "R1C0")).toBe(true);

    const fallbackCell = await service.inspectCell(created.document.meta.id, { row: 2, col: 0 });
    expect("is_seed" in fallbackCell.cell).toBe(true);
    expect(fallbackCell.cell.is_seed).toBe(false);
    expect(fallbackCell.neighbors.every((entry) => "is_seed" in entry)).toBe(true);
  });

  it("supports duplicate and import with generateNewId", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Duplicate Test" });
    const duplicated = await service.duplicateMap(created.document.meta.id);
    expect(duplicated.document.meta.id).not.toBe(created.document.meta.id);

    const content = JSON.stringify(created.document);
    await expect(service.importMap({ content })).rejects.toThrow(/meta.id conflict/);

    const imported = await service.importMap({ content, generateNewId: true });
    expect(imported.map.document.meta.id).not.toBe(created.document.meta.id);
  });

  it("can save a runtime document as a new map", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Save As Source" });
    const copied = await service.saveMapAs({
      document: created.document,
      name: "Save As Copy"
    });

    expect(copied.document.meta.id).not.toBe(created.document.meta.id);
    expect(copied.document.meta.name).toBe("Save As Copy");
    expect(copied.document.meta.revision).toBe(1);

    const listed = await service.listMaps();
    expect(listed.map((item) => item.name)).toEqual(["Save As Copy", "Save As Source"]);
  });

  it("skips unreadable, malformed, and oversized files while listing maps", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Good Map" });
    const mapsDir = path.join(tempRoot, "storage/maps");
    await fs.writeFile(path.join(mapsDir, "bad-json.json"), "{not-json", "utf8");
    const oversizedPath = path.join(mapsDir, "oversized.json");
    await fs.writeFile(oversizedPath, "{}", "utf8");
    await fs.truncate(oversizedPath, 33 * 1024 * 1024);

    const listed = await service.listMaps();

    expect(listed).toEqual([
      expect.objectContaining({
        id: created.document.meta.id,
        name: "Good Map"
      })
    ]);
  });

  it("rejects empty map ids with a clear error", async () => {
    const service = await loadService(tempRoot);
    await expect(service.getMap("")).rejects.toThrow(/map id is required/);
  });

  it("rejects unsafe map ids before touching storage paths", async () => {
    const service = await loadService(tempRoot);

    await expect(service.createMap({ name: "Unsafe", id: "../evil" })).rejects.toThrow(/map id may only contain/);
    await expect(service.getMap("bad/id")).rejects.toThrow(/map id may only contain/);
    await expect(service.deleteMap("")).rejects.toThrow(/map id is required/);
  });

  it("keeps existing slug behavior for CJK map names and ids", async () => {
    const service = await loadService(tempRoot);

    const created = await service.createMap({ name: "山海图" });

    expect(created.document.meta.id).toMatch(/^山海图-/);
    await expect(service.getMap(created.document.meta.id)).resolves.toBeTruthy();
  });

  it("rejects imported documents with unsafe ids and writes no escaped file", async () => {
    const service = await loadService(tempRoot);
    const unsafe = createEmptyDocument({
      id: "../evil",
      name: "Unsafe Import"
    });

    await expect(service.importMap({ content: stringifyDocument(unsafe) })).rejects.toThrow(/map id may only contain/);
    await expect(fs.access(path.join(tempRoot, "evil.json"))).rejects.toThrow();
  });

  it("rejects invalid documents without corrupting the current saved map", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Atomic Save Test" });
    const invalidDocument = structuredClone(created.document);
    invalidDocument.cells.push({
      row: 0,
      col: 0,
      terrain: "not-a-terrain" as never,
      biome: null,
      tags: [],
      note: ""
    });

    await expect(
      service.saveMap({
        document: invalidDocument,
        expectedRevision: 1
      })
    ).rejects.toThrow(/map document failed validation/);

    const persisted = await service.getMap(created.document.meta.id);
    expect(persisted.document.cells).toHaveLength(0);
    expect(persisted.document.meta.revision).toBe(1);
  });

  it("returns structured bad request issues for invalid apply commands", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Bad Apply Test" });

    await expect(
      service.applyCommands(created.document.meta.id, [
        {
          action: "set_cell",
          source: "cli",
          target: { row: 0, col: 0 },
          changes: {
            terrain: "missing-terrain" as never,
            biome: "grassland"
          }
        }
      ])
    ).rejects.toMatchObject({
      code: "bad_request",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_terrain"
        })
      ])
    });
  });

  it("rejects oversized area inspection requests", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Large Area Test" });

    await expect(service.inspectArea(created.document.meta.id, { row: 0, col: 0 }, 51)).rejects.toThrow(
      /less than or equal to 50/
    );
  });

  it("rejects invalid png export options", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Bad Export Test" });

    await expect(service.exportPng(created.document.meta.id, { preset: "poster" as never })).rejects.toThrow(
      /preset must be clean or reference/
    );
    await expect(service.exportPng(created.document.meta.id, { scale: 5 })).rejects.toThrow(
      /scale must be an integer between 1 and 4/
    );
    await expect(service.exportPng(created.document.meta.id, { padding: 300 })).rejects.toThrow(
      /padding must be an integer between 0 and 256/
    );
    await expect(service.exportPng(created.document.meta.id, { background: "white" })).rejects.toThrow(
      /background must be a #RRGGBB color or transparent/
    );
  });

  it("exports png with a transparent background", async () => {
    const service = await loadService(tempRoot);
    const created = await service.createMap({ name: "Transparent Export Test" });

    const pngExport = await service.exportPng(created.document.meta.id, { background: "transparent" });

    await expect(fs.stat(pngExport.path)).resolves.toBeTruthy();
  });
});
