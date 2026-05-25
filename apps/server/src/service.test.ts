import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument, stringifyDocument } from "@mapdesigner/map-core";

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

    const jsonExport = await service.exportJson(created.document.meta.id);
    expect(await fs.stat(jsonExport.path)).toBeTruthy();

    const pngExport = await service.exportPng(created.document.meta.id, { preset: "reference" });
    expect(await fs.stat(pngExport.path)).toBeTruthy();
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

    const cell = await service.inspectCell(created.document.meta.id, { row: 0, col: 0 });
    expect(cell.cell.display_coord).toBe("R0C0");
    expect(cell.cell.status).toBe("designed");
    expect(cell.neighbors).toHaveLength(6);

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
      /background must be a #RRGGBB color/
    );
  });
});
