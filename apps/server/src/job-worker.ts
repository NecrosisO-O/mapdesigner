import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { exportJson, exportPng, previewPng, getMapSummary, importMap } from "./service.js";
import { closeDatabaseForTests, getDatabase } from "./db.js";
import type { JobInput } from "./jobs.js";
import { importMapFile } from "./stream-import.js";
import { exportTiles, previewTiledExport } from "./tiled-export.js";
import { mergeMaps, previewMapMerge } from "./merge.js";
import { moveHistory } from "./command-executor.js";
import { getMapMaterialUsage } from "./repository.js";
const { input, cancellation, taskId } = workerData as {
  input: JobInput;
  cancellation: SharedArrayBuffer;
  taskId: string;
};
const flag = new Int32Array(cancellation);
const cancelled = () => {
  if (Atomics.load(flag, 0) === 1) throw new Error("任务已取消");
};
function progress(stage: string): void {
  cancelled();
  parentPort!.postMessage({ stage });
}
function beforeCommit(): void {
  // Cancellation and commit race through a single atomic state transition.
  if (Atomics.compareExchange(flag, 0, 0, 2) !== 0) throw new Error("任务已取消");
}
let completion: Record<string, unknown>;
try {
  let result: unknown;
  if (input.kind === "import") {
    progress("正在读取文件");
    result = await importMapFile(input.filePath, {
      generateNewId: input.generateNewId,
      progress,
      checkCancelled: cancelled,
      beforeCommit
    });
  } else if (input.kind === "merge") {
    progress("正在准备地图合并");
    result = await mergeMaps(input.mapId, input.merge, {
      progress,
      checkCancelled: cancelled,
      beforeCommit
    });
  } else if (input.kind === "merge-preview") {
    progress("正在计算放置位置与重叠格");
    await getMapMaterialUsage(input.mapId);
    await getMapMaterialUsage(input.merge.sourceId);
    getDatabase().exec("BEGIN");
    try {
      result = await previewMapMerge(input.mapId, input.merge);
    } finally {
      getDatabase().exec("ROLLBACK");
    }
    beforeCommit();
  } else if (input.kind === "history") {
    progress(input.direction === "undo" ? "正在撤销合并" : "正在重做合并");
    result = await moveHistory(input.mapId, input.direction, false, {
      expectedRevision: input.expectedRevision,
      beforeCommit
    });
    if (result === null) beforeCommit();
  } else {
    progress(
      input.kind === "preview"
        ? "正在生成成图预览"
        : input.kind === "png"
          ? "正在渲染图片"
          : "正在写出地图"
    );
    await getMapSummary(input.mapId);
    if (input.kind === "tiles") await getMapMaterialUsage(input.mapId);
    // This worker owns its connection for the entire asynchronous export.
    getDatabase().exec("BEGIN");
    try {
      result =
        input.kind === "tiles"
          ? await exportTiles(input.mapId, input.options, input.tileSize, {
              taskId,
              progress,
              checkCancelled: cancelled
            })
          : input.kind === "tiles-preview"
            ? await previewTiledExport(input.mapId, input.options, input.tileSize)
            : input.kind === "preview"
              ? await previewPng(input.mapId, input.options)
              : input.kind === "png"
                ? await exportPng(input.mapId, input.options)
                : await exportJson(input.mapId, { checkCancelled: cancelled, progress });
    } finally {
      getDatabase().exec("ROLLBACK");
    }
    if (Atomics.load(flag, 0) === 1) {
      if (input.kind !== "preview" && input.kind !== "tiles-preview")
        await fs.rm((result as { path: string }).path, { force: true });
      cancelled();
    }
    beforeCommit();
  }
  completion = { result };
} catch (error) {
  completion = {
    error: error instanceof Error ? error.message : "任务失败",
    cancelled: Atomics.load(flag, 0) === 1
  };
} finally {
  closeDatabaseForTests();
  if (input.kind === "import") await fs.rm(input.filePath, { force: true });
}

parentPort!.postMessage(completion);
