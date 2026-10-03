import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyCommand,
  createRuntimeState,
  expandRiverPath,
  createEmptyDocument
} from "@mapdesigner/map-core";
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

it("replays legacy river history while new edits preserve its effective widths", async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-river-compat-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.resetModules();
  const document = createEmptyDocument({ id: "legacy-river", name: "Legacy river" });
  const river = {
    id: "river",
    name: "River",
    points: [
      { row: 0, col: 0, width: 2 },
      { row: 0, col: 1 },
      { row: 0, col: 10, width: 22 }
    ]
  };
  document.features.rivers = [river];
  const maps = path.join(root, "storage/maps");
  await fs.mkdir(maps, { recursive: true });
  const original = JSON.stringify(document);
  const originalPath = path.join(maps, "legacy-river.json");
  await fs.writeFile(originalPath, original);
  const service = await import("./service.js"),
    repository = await import("./repository.js");
  const loaded = await service.getMap(document.meta.id);
  const widthAtOne = async () =>
    expandRiverPath((await service.getMap(document.meta.id)).document.features.rivers[0]!).find(
      (p) => p.row === 0 && p.col === 1
    )!.width;
  expect(await widthAtOne()).toBe(12);
  const command = {
    action: "set_river_width" as const,
    river_id: river.id,
    target: { row: 0, col: 2 },
    width: 8
  };
  const oldResult = applyCommand(createRuntimeState(loaded.document), command, {
    legacyRiverWidths: true
  });
  await repository.withMapTransaction(document.meta.id, () => {
    repository.applyFeatureWriteChangesSync(document.meta.id, [
      { kind: "river", featureId: river.id, river: oldResult.map.document.features.rivers[0]! }
    ]);
    repository.recordOperationSync(document.meta.id, {
      source: "system",
      action: command.action,
      commands: [command],
      inverseCommands: [
        { action: "update_river", river_id: river.id, changes: { points: river.points } }
      ],
      summary: {}
    });
  });
  expect(await widthAtOne()).toBe(5);
  await service.undoMapLight(document.meta.id);
  expect(await widthAtOne()).toBe(12);
  await service.redoMapLight(document.meta.id);
  expect(await widthAtOne()).toBe(5);
  await service.applyCommandsLight(document.meta.id, [
    { action: "update_river", river_id: river.id, changes: { name: "New editor" } }
  ]);
  expect(await widthAtOne()).toBe(5);
  expect((await service.getMap(document.meta.id)).document.features.rivers[0]?.width_mode).toBe(
    "distance"
  );
  await service.undoMapLight(document.meta.id);
  expect((await service.getMap(document.meta.id)).document.features.rivers[0]?.width_mode).toBe(
    "legacy"
  );
  await service.undoMapLight(document.meta.id);
  expect(await widthAtOne()).toBe(12);
  await service.redoMapLight(document.meta.id);
  await service.redoMapLight(document.meta.id);
  expect(await widthAtOne()).toBe(5);
  const exported = path.join(root, "export.json");
  await repository.writeMapDocumentJsonExport(document.meta.id, exported);
  expect(JSON.parse(await fs.readFile(exported, "utf8")).features.rivers[0].width_mode).toBe(
    "distance"
  );
  expect(await fs.readFile(originalPath, "utf8")).toBe(original);
});
