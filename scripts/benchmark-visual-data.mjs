import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createEmptyDocument } from "../packages/map-core/dist/index.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-visual-data-"));
process.env.MAPDESIGNER_ROOT = root;
const repository = await import("../apps/server/dist/apps/server/src/repository.js");
const service = await import("../apps/server/dist/apps/server/src/service.js");
const { createServer } = await import("../apps/server/dist/apps/server/src/api.js");
const { closeDatabaseForTests } = await import("../apps/server/dist/apps/server/src/db.js");
const app = await createServer();
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}
async function request(url) {
  const response = await app.inject({ url });
  if (response.statusCode !== 200) throw new Error(response.body);
  return response;
}
const report = {
  date: new Date().toISOString(),
  node: process.version,
  cpu: os.cpus()[0]?.model,
  method:
    "Actual SQLite maps of 10000/100000/500000 cells in an isolated temporary database. Fastify inject includes routing, SQL and JSON serialization, excluding network/browser latency. Ten viewport samples. Overview first and repeated requests; no server overview cache. Region preview and PNG export use 1200 cells, scale 1, shared composition. Memory is process RSS/heap after each sequential case, not a peak or isolated per-map measurement.",
  cases: []
};
try {
  for (const count of [10000, 100000, 500000]) {
    let doc = createEmptyDocument({ id: "data-" + count, name: "视觉性能验收" });
    const width = Math.ceil(Math.sqrt(count));
    doc.cells = Array.from({ length: count }, (_, i) => ({
      row: Math.floor(i / width),
      col: i % width,
      terrain: i % 9 === 0 ? "mountain" : "plain",
      biome: i % 9 === 0 ? "conifer_forest" : "grassland",
      tags: [],
      note: ""
    }));
    doc.features.rivers = [
      {
        id: "long",
        name: "长河",
        width_mode: "distance",
        points: [
          { row: -10000, col: 10, width: 2 },
          { row: 0, col: 12, width: 6 },
          { row: 10000, col: 10, width: 20 }
        ]
      }
    ];
    const id = doc.meta.id;
    const imported = await timed(() => repository.importMapDocument(doc));
    doc = null;
    const rangeTimes = [];
    let rangeBytes = 0;
    for (let i = 0; i < 10; i++) {
      const result = await timed(() =>
        request(
          "/api/maps/" + id + "/cells?minRow=" + i + "&maxRow=" + (i + 29) + "&minCol=0&maxCol=39"
        )
      );
      rangeTimes.push(result.ms);
      rangeBytes = Buffer.byteLength(result.value.body);
    }
    const overviewUrl =
      "/api/maps/" +
      id +
      "/overview?minRow=0&maxRow=" +
      (width - 1) +
      "&minCol=0&maxCol=" +
      (width - 1);
    const overview = await timed(() => request(overviewUrl));
    const cached = await timed(() => request(overviewUrl));
    const overviewData = overview.value.json().result;
    const materials = await timed(() => request("/api/maps/" + id + "/materials"));
    const options = {
      scale: 1,
      padding: 32,
      includeLegend: true,
      title: "视觉性能验收",
      range: { minRow: 0, maxRow: 29, minCol: 0, maxCol: 39 },
      includeUndesigned: false
    };
    const preview = await timed(() => service.previewPng(id, options));
    const exported = await timed(() => service.exportPng(id, options));
    const memory = process.memoryUsage();
    const result = {
      cells: count,
      importMs: imported.ms,
      viewportP95Ms: p95(rangeTimes),
      viewportBytes: rangeBytes,
      overviewColdMs: overview.ms,
      overviewWarmMs: cached.ms,
      overviewBytes: Buffer.byteLength(overview.value.body),
      overviewTiles: overviewData.tiles.length,
      overviewRiverPoints: overviewData.rivers?.reduce(
        (sum, r) => sum + r.paths.reduce((n, p) => n + p.length, 0),
        0
      ),
      materialsMs: materials.ms,
      previewMs: preview.ms,
      exportMs: exported.ms,
      exportWidth: preview.value.width,
      exportHeight: preview.value.height,
      exportBytes: (await fs.stat(exported.value.path)).size,
      heapMB: memory.heapUsed / 1048576,
      rssMB: memory.rss / 1048576
    };
    report.cases.push(result);
    console.log(JSON.stringify(result));
  }
  await fs.writeFile(
    process.argv[2] ?? "/private/tmp/mapdesigner-visual-data.json",
    JSON.stringify(report, null, 2) + "\n"
  );
} finally {
  await app.close();
  closeDatabaseForTests();
  await fs.rm(root, { recursive: true, force: true });
}
