import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createEmptyDocument, createRuntimeState } from "../packages/map-core/dist/index.js";
import {
  buildMapScene,
  renderSvgString
} from "../packages/map-render/dist/map-render/src/index.js";

const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const measure = (fn) => {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
};
const report = {
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  cpu: os.cpus()[0]?.model,
  date: new Date().toISOString(),
  method:
    "Node scene construction + SVG serialization for 1200 visible cells; includes long crossing rivers. These are CPU times, not browser frame or pointer latency.",
  cases: []
};
for (const count of [10000, 100000, 500000]) {
  const doc = createEmptyDocument({ id: `perf-${count}`, name: "Performance" });
  const width = Math.ceil(Math.sqrt(count));
  const cells = Array.from({ length: count }, (_, i) => ({
    row: Math.floor(i / width),
    col: i % width,
    terrain: i % 9 === 0 ? "mountain" : "plain",
    biome: i % 5 === 0 ? "conifer_forest" : "grassland",
    tags: [],
    note: ""
  }));
  const visible = cells.filter((c) => c.row < 30 && c.col < 40);
  doc.cells = visible;
  doc.features.rivers = [
    {
      id: "long-river",
      name: "Long river",
      width_mode: "distance",
      points: [
        { row: -10000, col: 10, width: 2 },
        { row: 0, col: 12, width: 6 },
        { row: 10000, col: 10, width: 20 }
      ]
    }
  ];
  const map = createRuntimeState(doc);
  const options = {
    riverClipRange: { minRow: 0, maxRow: 29, minCol: 0, maxCol: 39 },
    includeCoordinates: false,
    includeUndesigned: false
  };
  const cold = measure(() => buildMapScene(map, options));
  const times = Array.from({ length: 30 }, () => measure(() => buildMapScene(map, options)).ms);
  const exported = measure(() => renderSvgString(cold.value));
  report.cases.push({
    cells: count,
    visible: visible.length,
    coldSceneMs: cold.ms,
    warmSceneP95Ms: p95(times),
    svgMs: exported.ms,
    svgBytes: Buffer.byteLength(exported.value),
    heapMB: process.memoryUsage().heapUsed / 1048576
  });
}
const target = process.argv[2] ?? path.join(os.tmpdir(), "mapdesigner-visual-performance.json");
await fs.writeFile(target, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
