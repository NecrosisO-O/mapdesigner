import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createEmptyDocument } from "../packages/map-core/dist/index.js";

const count = Number(process.argv[2] ?? 110000);
const output = process.argv[3] ?? "/private/tmp/mapdesigner-capacity-" + count + ".json";
if (!Number.isSafeInteger(count) || count < 1) throw new Error("cell count must be positive");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-capacity-"));
process.env.MAPDESIGNER_ROOT = root;
const { importMapFile } = await import("../apps/server/dist/apps/server/src/stream-import.js");
const service = await import("../apps/server/dist/apps/server/src/service.js");
const repository = await import("../apps/server/dist/apps/server/src/repository.js");
const { getOverview } = await import("../apps/server/dist/apps/server/src/overview.js");
const { closeDatabaseForTests, getDatabase } =
  await import("../apps/server/dist/apps/server/src/db.js");
const timed = async (fn) => {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
};
try {
  const doc = createEmptyDocument({ id: "capacity", name: "容量样本" });
  doc.features.rivers = [
    {
      id: "main",
      name: "河流",
      width_mode: "distance",
      points: [
        { row: 0, col: 3, width: 2 },
        { row: 40, col: 3, width: 12 }
      ]
    }
  ];
  const input = path.join(root, "input.json"),
    stream = createWriteStream(input);
  const write = async (value) => {
    if (!stream.write(value)) await once(stream, "drain");
  };
  await write(JSON.stringify(doc).slice(0, -1).replace('"cells":[],', "") + ',"cells":[');
  const width = Math.ceil(Math.sqrt(count));
  for (let start = 0; start < count; start += 1000) {
    const batch = [];
    for (let i = start; i < Math.min(count, start + 1000); i++)
      batch.push(
        JSON.stringify({
          row: Math.floor(i / width) - 20,
          col: (i % width) - 20,
          terrain: i % 9 === 0 ? "mountain" : "plain",
          biome: i % 9 === 0 ? "conifer_forest" : "grassland",
          tags: i % 503 === 0 ? ["peak"] : [],
          note: i % 97 === 0 ? "测量样本 🌊" : ""
        })
      );
    await write((start ? "," : "") + batch.join(","));
  }
  await write("]}");
  stream.end();
  await once(stream, "finish");
  const imported = await timed(() => importMapFile(input));
  const viewports = [];
  for (let i = 0; i < 10; i++)
    viewports.push(
      (
        await timed(() =>
          service.getCellsInRange(
            "capacity",
            { minRow: i, maxRow: i + 29, minCol: 0, maxCol: 39 },
            { includeUndesigned: true }
          )
        )
      ).ms
    );
  const range = { minRow: -20, maxRow: width - 21, minCol: -20, maxCol: width - 21 };
  const overview = await timed(() => getOverview("capacity", range));
  const repeated = await timed(() => getOverview("capacity", range));
  const materials = await timed(() => repository.getMapMaterialUsage("capacity"));
  const edit = await timed(() =>
    service.applyCommandsLight("capacity", [
      { action: "set_cell", target: { row: 0, col: 0 }, changes: { terrain: "hill" } }
    ])
  );
  const editedOverview = await timed(() => getOverview("capacity", range));
  await service.undoMapLight("capacity");
  let flows;
  if (process.argv.includes("--flows")) {
    const { previewMapMerge, mergeMaps } =
      await import("../apps/server/dist/apps/server/src/merge.js");
    const { exportTiles } = await import("../apps/server/dist/apps/server/src/tiled-export.js");
    const destination = (await service.createMap({ name: "合并容量验收" })).document.meta.id;
    const preview = await timed(() =>
      previewMapMerge(destination, {
        sourceId: "capacity",
        offsetRow: -10,
        offsetCol: 10,
        conflict: "keep-target"
      })
    );
    const merged = await timed(() => mergeMaps(destination, preview.value.input));
    if (merged.value.summary.designed_cell_count !== count) throw new Error("merge count mismatch");
    const undone = await timed(() => service.undoMapLight(destination));
    if (undone.value.summary.designed_cell_count !== 0) throw new Error("undo count mismatch");
    const redone = await timed(() => service.redoMapLight(destination));
    if (redone.value.summary.designed_cell_count !== count) throw new Error("redo count mismatch");
    const json = await timed(() => service.exportJson(destination));
    const reimport = await timed(() => importMapFile(json.value.path, { generateNewId: true }));
    if (reimport.value.summary.designed_cell_count !== count)
      throw new Error("JSON round-trip mismatch");
    const tiles = await timed(() =>
      exportTiles(
        "capacity",
        { scale: 1, range: { minRow: 0, maxRow: 99, minCol: 0, maxCol: 79 }, includeLegend: true },
        4096
      )
    );
    flows = {
      previewMs: preview.ms,
      mergeMs: merged.ms,
      undoMs: undone.ms,
      redoMs: redone.ms,
      jsonExportMs: json.ms,
      jsonReimportMs: reimport.ms,
      jsonMiB: (await fs.stat(json.value.path)).size / 2 ** 20,
      tilesMs: tiles.ms,
      tileCount: tiles.value.tileCount,
      zipMiB: (await fs.stat(tiles.value.path)).size / 2 ** 20
    };
  }
  getDatabase().pragma("wal_checkpoint(TRUNCATE)");
  const report = {
    date: new Date().toISOString(),
    node: process.version,
    cpu: os.cpus()[0]?.model,
    ramGiB: os.totalmem() / 2 ** 30,
    cells: count,
    flows,
    inputMiB: (await fs.stat(input)).size / 2 ** 20,
    databaseMiB: (await fs.stat(path.join(root, "storage/mapdesigner.db"))).size / 2 ** 20,
    importMs: imported.ms,
    viewportP95Ms: viewports.sort((a, b) => a - b).at(-1),
    overviewMs: overview.ms,
    repeatedOverviewMs: repeated.ms,
    editedOverviewMs: editedOverview.ms,
    materialsMs: materials.ms,
    editMs: edit.ms,
    overviewCount: overview.value.designed_cell_count,
    tiles: overview.value.tiles.length,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    heapMiB: process.memoryUsage().heapUsed / 2 ** 20,
    method:
      "One isolated process/database per size. Incrementally generated JSON. Timings include service/SQLite work, exclude network/browser. Peak RSS is process lifetime (including generation); fixtures are generated in batches of 1000."
  };
  if (report.overviewCount !== count) throw new Error("overview count mismatch");
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  closeDatabaseForTests();
  await fs.rm(root, { recursive: true, force: true });
}
