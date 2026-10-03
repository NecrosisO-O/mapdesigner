import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { exportJson, exportPng, getMapSummary, importMap } from "./service.js";
import { closeDatabaseForTests, getDatabase } from "./db.js";
import type { JobInput } from "./jobs.js";
const { input, cancellation } = workerData as { input: JobInput; cancellation: SharedArrayBuffer };
const flag = new Int32Array(cancellation);
const cancelled = () => { if (Atomics.load(flag, 0) === 1) throw new Error("任务已取消"); };
function progress(stage: string): void { cancelled(); parentPort!.postMessage({ stage }); }
function beforeCommit(): void {
  // Cancellation and commit race through a single atomic state transition.
  if (Atomics.compareExchange(flag, 0, 0, 2) !== 0) throw new Error("任务已取消");
}
try {
  let result: unknown;
  if (input.kind === "import") {
    progress("正在读取文件");
    const content = await fs.readFile(input.filePath, "utf8");
    cancelled();
    result = await importMap({ content, generateNewId: input.generateNewId, includeMap: false, progress, beforeCommit });
  } else {
    progress(input.kind === "png" ? "正在渲染图片" : "正在写出地图");
    await getMapSummary(input.mapId);
    // This worker owns its connection for the entire asynchronous export.
    getDatabase().exec("BEGIN");
    try { result = input.kind === "png" ? await exportPng(input.mapId, input.options) : await exportJson(input.mapId); }
    finally { getDatabase().exec("ROLLBACK"); }
    if (Atomics.load(flag, 0) === 1) {
      await fs.rm((result as { path: string }).path, { force: true });
      cancelled();
    }
    beforeCommit();
  }
  parentPort!.postMessage({ result });
} catch (error) {
  parentPort!.postMessage({ error: error instanceof Error ? error.message : "任务失败", cancelled: Atomics.load(flag, 0) === 1 });
} finally {
  closeDatabaseForTests();
  if (input.kind === "import") await fs.rm(input.filePath, { force: true });
}
