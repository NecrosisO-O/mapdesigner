import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@mapdesigner/map-core";
let root: string | undefined;
afterEach(async () => {
  (await import("./db.js")).closeDatabaseForTests();
  vi.unstubAllEnvs();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
it("retains legacy JSON and restores a SQLite backup with operation history intact", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-compatibility-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.resetModules();
  const doc = createEmptyDocument({ id: "legacy", name: "Legacy" });
  const { features: _features, ...legacy } = doc;
  const maps = path.join(root, "storage/maps");
  await fs.mkdir(maps, { recursive: true });
  const original = JSON.stringify(legacy);
  await fs.writeFile(path.join(maps, "legacy.json"), original);
  const service = await import("./service.js"),
    database = await import("./db.js");
  const loaded = await service.getMap("legacy");
  expect(loaded.document.features).toEqual({ rivers: [] });
  await service.applyCommandsLight("legacy", [
    {
      action: "set_cell",
      target: { row: -4, col: 9 },
      changes: { terrain: "plain", note: "archive" }
    }
  ]);
  const saved = await service.getMapSummary("legacy"),
    backup = path.join(root, "backup.db");
  await database.getDatabase().backup(backup);
  await service.applyCommandsLight("legacy", [
    { action: "clear_cell", target: { row: -4, col: 9 } }
  ]);
  database.closeDatabaseForTests();
  await fs.copyFile(backup, path.join(root, "storage/mapdesigner.db"));
  expect(await service.getMapSummary("legacy")).toEqual(saved);
  expect((await service.getHistoryStatus("legacy")).canUndo).toBe(true);
  await service.undoMapLight("legacy");
  expect((await service.getMapSummary("legacy")).designed_cell_count).toBe(0);
  await service.redoMapLight("legacy");
  expect((await service.getMap("legacy")).document.cells[0]?.note).toBe("archive");
  expect(await fs.readFile(path.join(maps, "legacy.json"), "utf8")).toBe(original);
});
