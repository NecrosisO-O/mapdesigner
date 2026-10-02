// Run after pnpm build. All mutations are confined to a new temporary database.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const root = new URL("../../../", import.meta.url);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-review-"));
process.env.MAPDESIGNER_ROOT = tempRoot;
const service = await import(new URL("apps/server/dist/apps/server/src/service.js", root));
const repository = await import(new URL("apps/server/dist/apps/server/src/repository.js", root));
const { getDatabase, closeDatabaseForTests } = await import(new URL("apps/server/dist/apps/server/src/db.js", root));
const core = await import(new URL("packages/map-core/dist/index.js", root));
const renderer = await import(new URL("packages/map-render/dist/map-render/src/index.js", root));
const { createServer } = await import(new URL("apps/server/dist/apps/server/src/api.js", root));
const results = { node: process.version, platform: `${process.platform}/${process.arch}`, probes: {} };
const setCell = (row, col, note = "") => ({ action: "set_cell", target: { row, col }, changes: { terrain: "plain", biome: "grassland", tags: [], note } });
const river = (name, id) => ({ action: "create_river", river: { ...(id ? { id } : {}), name, points: [{ row: 0, col: 0 }, { row: 0, col: 1 }] } });
const newMap = async (id) => (await service.createMap({ id, name: id })).document.meta.id;
async function probe(name, run) {
  if (process.argv[2] && process.argv[2] !== name) return;
  try { results.probes[name] = await run(); }
  catch (error) { results.probes[name] = { probeError: String(error), stack: error.stack }; }
  process.stderr.write(`${name}: ${JSON.stringify(results.probes[name])}\n`);
}

try {
  await probe("concurrent_full_commands", async () => {
    const id = await newMap("concurrent-full");
    const replies = await Promise.allSettled([service.applyCommands(id, [setCell(0, 0)]), service.applyCommands(id, [setCell(0, 1)])]);
    const document = await repository.getMapDocument(id);
    return { accepted: replies.filter(r => r.status === "fulfilled").length, expectedCells: 2, actualCells: document.cells.length, coordinates: document.cells.map(c => [c.row, c.col]), history: await service.getHistoryStatus(id) };
  });

  await probe("history_write_failure", async () => {
    const id = await newMap("history-failure");
    const db = getDatabase();
    db.exec("CREATE TEMP TRIGGER review_history_failure BEFORE INSERT ON operations WHEN NEW.map_id = 'history-failure' BEGIN SELECT RAISE(ABORT, 'simulated history write failure'); END");
    let error = null;
    try { await service.applyCommandsLight(id, [setCell(0, 0)]); } catch (e) { error = e.message; }
    finally { db.exec("DROP TRIGGER review_history_failure"); }
    return { rejectedWith: error, expectedCellsAfterFailure: 0, actualCells: (await service.getMapSummary(id)).designed_cell_count, history: await service.getHistoryStatus(id) };
  });

  await probe("generated_river_undo", async () => {
    const output = {};
    for (const [mode, apply, undo] of [["full", service.applyCommands, service.undoMap], ["light", service.applyCommandsLight, service.undoMapLight]]) {
      const id = await newMap(`river-${mode}`);
      await apply(id, [river("Existing", "zz-existing")]);
      await apply(id, [river("Alpha")]);
      const beforeUndo = (await service.getMapFeatures(id)).rivers.map(r => r.id);
      await undo(id);
      output[mode] = { beforeUndo, expectedAfterUndo: ["zz-existing"], actualAfterUndo: (await service.getMapFeatures(id)).rivers.map(r => r.id) };
    }
    return output;
  });

  await probe("async_savepoint_isolation", async () => {
    const previewId = await newMap("preview-savepoint");
    const otherId = await newMap("real-write");
    const cell = { row: 0, col: 0, terrain: "plain", biome: "grassland", tags: [], note: "" };
    const replies = await Promise.allSettled([
      repository.applyCellAndFeatureWriteChanges(previewId, [{ row: 0, col: 0, cell }], [], { dryRun: true, cellRevisionIncrement: 1 }),
      repository.applyCellWriteChanges(otherId, [{ row: 0, col: 0, cell }])
    ]);
    return { statuses: replies.map(r => r.status), expectedRealCells: 1, actualRealCells: (await service.getMapSummary(otherId)).designed_cell_count, previewCells: (await service.getMapSummary(previewId)).designed_cell_count };
  });

  await probe("invalid_note_parity", async () => {
    const output = {};
    for (const [mode, apply] of [["full", service.applyCommands], ["light", service.applyCommandsLight]]) {
      const id = await newMap(`invalid-note-${mode}`);
      let error = null;
      try { await apply(id, [setCell(0, 0, 123)]); } catch (e) { error = e.message; }
      output[mode] = { rejected: Boolean(error), error, cells: (await repository.getMapDocument(id)).cells };
    }
    return output;
  });

  await probe("concurrent_mixed_commands", async () => {
    const previewId = await newMap("mixed-preview");
    const realId = await newMap("mixed-real");
    const replies = await Promise.allSettled([
      service.applyCommandsLight(previewId, [setCell(0, 0), river("Preview", "preview-river")], { dryRun: true }),
      service.applyCommandsLight(realId, [setCell(0, 0), river("Real", "real-river")])
    ]);
    const persisted = await service.getMapSummary(realId);
    return { statuses: replies.map(r => r.status), errors: replies.filter(r => r.status === "rejected").map(r => r.reason.message), expectedReal: { cells: 1, rivers: 1 }, persistedReal: { cells: persisted.designed_cell_count, rivers: persisted.feature_counts.rivers }, realHistory: await service.getHistoryStatus(realId) };
  });

  await probe("region_export_geometry", async () => {
    return [0, 1000].map(coordinate => {
      const document = core.createEmptyDocument({ id: `geometry-${coordinate}`, name: "geometry" });
      document.cells = [{ row: coordinate, col: coordinate, terrain: "plain", biome: null, tags: [], note: "" }];
      const scene = renderer.buildExportScene({ map: core.createRuntimeState(document), options: { preset: "clean", includeCoordinates: false, includeShorthand: false, includeGrid: true, includeUndesigned: false, background: "transparent", padding: 32, scale: 2, range: { minRow: coordinate, maxRow: coordinate, minCol: coordinate, maxCol: coordinate } } });
      return { coordinate, cells: 1, width: scene.width, height: scene.height, pixelArea: Math.ceil(scene.width) * Math.ceil(scene.height) };
    });
  });

  await probe("import_150000_cells", async () => {
    const document = core.createEmptyDocument({ id: "large-import", name: "large-import" });
    document.cells = Array.from({ length: 150_000 }, (_, i) => ({ row: Math.floor(i / 500), col: i % 500, terrain: "plain", biome: null, tags: [], note: "" }));
    const content = JSON.stringify(document);
    const started = performance.now();
    let error = null;
    try { await service.importMap({ content, includeMap: false }); } catch (e) { error = { name: e.name, message: e.message, frame: e.stack?.split("\n").slice(1, 4) }; }
    return { cells: document.cells.length, bytes: Buffer.byteLength(content), durationMs: performance.now() - started, error };
  });
  global.gc?.();

  await probe("api_origin_and_import_size", async () => {
    const app = await createServer();
    try {
      const origin = "https://example.invalid";
      const create = await app.inject({ method: "POST", url: "/api/maps", headers: { origin }, payload: { name: "origin-probe", id: "origin-probe" } });
      const document = core.createEmptyDocument({ id: "http-import", name: "http-import" });
      document.meta.description = "x".repeat(1_100_000);
      const imported = await app.inject({ method: "POST", url: "/api/maps/import?includeMap=false", payload: { content: JSON.stringify(document) } });
      return { createStatus: create.statusCode, acceptedOrigin: create.headers["access-control-allow-origin"], importBytes: 1_100_000, importStatus: imported.statusCode, importError: imported.json() };
    } finally { await app.close(); }
  });

  await probe("single_cell_edit_scaling", async () => {
    const output = [];
    const db = getDatabase();
    const insert = db.prepare("INSERT INTO cells (map_id, row, col, terrain, biome, tags_json, note) VALUES (?, ?, ?, 'plain', 'grassland', '[]', '')");
    for (const count of [10_000, 100_000, 500_000]) {
      const id = await newMap(`scale-${count}`);
      const started = performance.now();
      db.transaction(() => {
        for (let i = 0; i < count; i += 1) insert.run(id, Math.floor(i / 1000), i % 1000);
        db.prepare("UPDATE maps SET designed_cell_count = ?, bounds_min_row = 0, bounds_max_row = ?, bounds_min_col = 0, bounds_max_col = 999 WHERE id = ?").run(count, Math.floor((count - 1) / 1000), id);
      })();
      const seedMs = performance.now() - started;
      await service.applyCommandsLight(id, [setCell(0, 0, "warmup")]);
      const samples = [];
      for (let i = 0; i < 5; i += 1) {
        const t = performance.now();
        await service.applyCommandsLight(id, [setCell(0, 0, `measurement-${i}`)]);
        samples.push(performance.now() - t);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      output.push({ cells: count, seedMs, editMedianMs: sorted[2], editSamplesMs: samples });
    }
    return output;
  });

  await probe("river_line_scaling", async () => {
    return [1000, 2000, 4000, 8000, 16000].map(length => {
      const samples = [];
      for (let i = 0; i < 3; i += 1) {
        const t = performance.now();
        core.buildHexLine({ row: 0, col: 0 }, { row: 0, col: length });
        samples.push(performance.now() - t);
      }
      samples.sort((a, b) => a - b);
      return { length, medianMs: samples[1] };
    });
  });
} finally {
  closeDatabaseForTests();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
