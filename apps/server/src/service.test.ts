import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    const jsonExport = await service.exportJson(created.document.meta.id);
    expect(await fs.stat(jsonExport.path)).toBeTruthy();

    const pngExport = await service.exportPng(created.document.meta.id, { preset: "reference" });
    expect(await fs.stat(pngExport.path)).toBeTruthy();
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
});
