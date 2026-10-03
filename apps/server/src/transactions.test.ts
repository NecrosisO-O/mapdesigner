import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapCommand } from "@mapdesigner/map-core";

const cell = (col = 0): MapCommand => ({
  action: "set_cell", source: "webui", target: { row: 0, col },
  changes: { terrain: "plain", biome: "grassland", note: "retained" }
});
const river = (name = "Alpha"): Extract<MapCommand, { action: "create_river" }> => ({
  action: "create_river", source: "webui",
  river: { name, points: [{ row: 0, col: 0 }, { row: 0, col: 1 }] }
});

describe("atomic editor commands", () => {
  let root: string;
  let service: typeof import("./service.js");
  let database: typeof import("./db.js");
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-atomic-"));
    vi.stubEnv("MAPDESIGNER_ROOT", root);
    vi.resetModules();
    service = await import("./service.js");
    database = await import("./db.js");
  });
  afterEach(async () => {
    database?.closeDatabaseForTests();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each(["full", "summary"])("retains concurrent independent edits through %s output", async mode => {
    const id = (await service.createMap({ name: "Concurrent" })).document.meta.id;
    const apply = mode === "full" ? service.applyCommands : service.applyCommandsLight;
    await Promise.all([apply(id, [cell(0)]), apply(id, [cell(1)])]);
    expect((await service.getMap(id)).document.cells.map(c => c.col)).toEqual([0, 1]);
    expect((await service.getHistoryStatus(id)).cursor).toBe(2);
    await service.undoMapLight(id);
    expect((await service.getMapSummary(id)).designed_cell_count).toBe(1);
  });

  it("never rolls back another map when previewing mixed commands", async () => {
    const a = (await service.createMap({ name: "Preview" })).document.meta.id;
    const b = (await service.createMap({ name: "Live" })).document.meta.id;
    await Promise.all([
      service.applyCommandsLight(a, [cell(), river()], { dryRun: true }),
      service.applyCommandsLight(b, [cell(), river()])
    ]);
    expect((await service.getMapSummary(a)).designed_cell_count).toBe(0);
    expect((await service.getHistoryStatus(a)).cursor).toBe(0);
    expect((await service.getMapSummary(b)).designed_cell_count).toBe(1);
    expect((await service.getMapFeatures(b)).rivers).toHaveLength(1);
  });

  it.each(["full", "summary"])("rolls back data and revision if history insertion fails for %s", async mode => {
    const id = (await service.createMap({ name: "Rollback" })).document.meta.id;
    database.getDatabase().exec("CREATE TRIGGER fail_history BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'history failed'); END");
    const apply = mode === "full" ? service.applyCommands : service.applyCommandsLight;
    await expect(apply(id, [cell(), river()])).rejects.toThrow("history failed");
    const summary = await service.getMapSummary(id);
    expect(summary.designed_cell_count).toBe(0);
    expect(summary.feature_counts.rivers).toBe(0);
    expect(summary.meta.revision).toBe(1);
    expect((await service.getHistoryStatus(id)).cursor).toBe(0);
  });

  it("rolls back undo data when the history cursor cannot move", async () => {
    const id = (await service.createMap({ name: "Undo rollback" })).document.meta.id;
    await service.applyCommands(id, [cell()]);
    database.getDatabase().exec("CREATE TRIGGER fail_cursor BEFORE UPDATE OF history_cursor ON maps BEGIN SELECT RAISE(ABORT, 'cursor failed'); END");
    await expect(service.undoMapLight(id)).rejects.toThrow("cursor failed");
    expect((await service.getMapSummary(id)).designed_cell_count).toBe(1);
    expect((await service.getHistoryStatus(id)).cursor).toBe(1);
  });

  it("undoes exactly the generated river and redoes its resolved identity", async () => {
    const id = (await service.createMap({ name: "River identities" })).document.meta.id;
    await service.applyCommands(id, [{ ...river(), river: { ...river().river, id: "zz-existing" } }]);
    await service.applyCommands(id, [river()]);
    expect((await service.getMapFeatures(id)).rivers.map(r => r.id)).toEqual(["alpha", "zz-existing"]);
    await service.undoMap(id);
    expect((await service.getMapFeatures(id)).rivers.map(r => r.id)).toEqual(["zz-existing"]);
    await service.redoMapLight(id);
    expect((await service.getMapFeatures(id)).rivers.map(r => r.id)).toEqual(["alpha", "zz-existing"]);
  });

  it.each(["full", "summary"])("rejects invalid notes consistently for %s", async mode => {
    const id = (await service.createMap({ name: "Validation" })).document.meta.id;
    const command = cell() as Extract<MapCommand, { action: "set_cell" }>;
    const invalid = { ...command, changes: { ...command.changes, note: 123 } } as unknown as MapCommand;
    const apply = mode === "full" ? service.applyCommands : service.applyCommandsLight;
    await expect(apply(id, [invalid])).rejects.toThrow();
    expect((await service.getMapSummary(id)).designed_cell_count).toBe(0);
  });

  it("evaluates dry runs without writing temporary data", async () => {
    const id = (await service.createMap({ name: "Pure preview" })).document.meta.id;
    const before = database.getDatabase().prepare("SELECT total_changes() AS count").get();
    const preview = await service.applyCommandsLight(id, [cell(), river()], { dryRun: true });
    expect(preview.summary.designed_cell_count).toBe(1);
    expect(preview.summary.feature_counts.rivers).toBe(1);
    expect(database.getDatabase().prepare("SELECT total_changes() AS count").get()).toEqual(before);
  });

  it("checks concurrent expected revisions inside the transaction", async () => {
    const id = (await service.createMap({ name: "Revision" })).document.meta.id;
    const results = await Promise.allSettled([
      service.applyCommandsLight(id, [cell(0)], { expectedRevision: 1 }),
      service.applyCommandsLight(id, [cell(1)], { expectedRevision: 1 })
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await service.getMapSummary(id)).designed_cell_count).toBe(1);
    expect((await service.getHistoryStatus(id)).cursor).toBe(1);
  });

  it("restores the original state after repeated changes in one operation", async () => {
    const id = (await service.createMap({ name: "Repeated" })).document.meta.id;
    await service.applyCommandsLight(id, [cell(), { action: "annotate_cell", source: "webui", target: { row: 0, col: 0 }, changes: { note: "second" } }, river(), { action: "update_river", source: "webui", river_id: "alpha", changes: { name: "Renamed" } }]);
    await service.undoMap(id);
    expect((await service.getMapSummary(id)).designed_cell_count).toBe(0);
    expect((await service.getMapFeatures(id)).rivers).toHaveLength(0);
    await service.redoMapLight(id);
    expect((await service.getMap(id)).document.cells[0]?.note).toBe("second");
    expect((await service.getMapFeatures(id)).rivers[0]?.name).toBe("Renamed");
  });
});
