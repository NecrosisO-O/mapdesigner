import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ExportRenderOptions } from "@mapdesigner/map-core";
import { STORAGE_DIR } from "./config.js";
import { badRequest } from "./errors.js";
import { MAX_IMPORT_BYTES } from "./resource-limits.js";
import { normalizeExportOptions, assertSafeMapId } from "./storage.js";
import { createEnvelope } from "./utils.js";
import { downloadUrl } from "./downloads.js";
export type JobInput =
  | { kind: "import"; filePath: string; generateNewId: boolean }
  | { kind: "png" | "json" | "preview"; mapId: string; options?: Partial<ExportRenderOptions> };
export interface JobStatus {
  id: string;
  kind: JobInput["kind"];
  state: "queued" | "running" | "cancelling" | "cancelled" | "done" | "failed";
  stage: string;
  result?: unknown;
  error?: string;
  createdAt: number;
}
interface Job {
  status: JobStatus;
  input: JobInput;
  flag: Int32Array;
  worker?: Worker;
}
export async function registerJobs(app: FastifyInstance): Promise<void> {
  const jobs = new Map<string, Job>();
  let active: Job | undefined,
    uploads = 0,
    closing = false;
  const directory = path.join(STORAGE_DIR, "uploads");
  await fs.mkdir(directory, { recursive: true });
  function prune(): void {
    for (const [id, job] of jobs)
      if (
        !job.worker &&
        ["done", "failed", "cancelled"].includes(job.status.state) &&
        Date.now() - job.status.createdAt > 900_000
      )
        jobs.delete(id);
    for (const [id, job] of jobs)
      if (jobs.size >= 20 && ["done", "failed", "cancelled"].includes(job.status.state))
        jobs.delete(id);
  }
  function capacity(): void {
    if (
      [...jobs.values()].filter((job) =>
        ["queued", "running", "cancelling"].includes(job.status.state)
      ).length +
        uploads >=
      3
    )
      throw badRequest("后台任务已满，请等待当前任务完成");
  }
  function runNext(): void {
    if (active || closing) return;
    const next = [...jobs.values()].find((job) => job.status.state === "queued");
    if (!next) return;
    active = next;
    next.status.state = "running";
    const entry = import.meta.url.endsWith(".ts")
      ? new URL("../worker.mjs", import.meta.url)
      : new URL("./job-worker.js", import.meta.url);
    const worker = new Worker(entry, {
      workerData: { input: next.input, cancellation: next.flag.buffer },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
      execArgv: []
    });
    next.worker = worker;
    const timer = setTimeout(() => {
      if (Atomics.load(next.flag, 0) === 2) return;
      next.status.error = "任务超时，请缩小地图或导出范围";
      next.status.state = "failed";
      void worker.terminate();
    }, 120_000);
    timer.unref();
    worker.on(
      "message",
      (message: { stage?: string; result?: unknown; error?: string; cancelled?: boolean }) => {
        if (message.stage) next.status.stage = message.stage;
        if (message.error) {
          next.status.state = message.cancelled ? "cancelled" : "failed";
          next.status.error = message.error;
        }
        if (message.result) {
          const result = message.result as Record<string, unknown>;
          if (typeof result.fileName === "string") {
            result.downloadUrl = downloadUrl(result.fileName);
            delete result.path;
          }
          next.status.result = result;
          next.status.state = "done";
          next.status.stage = "已完成";
        }
      }
    );
    worker.on("error", (error) => {
      next.status.state = "failed";
      next.status.error = error.message;
    });
    worker.on("exit", async () => {
      clearTimeout(timer);
      if (["running", "cancelling"].includes(next.status.state)) {
        next.status.state = "failed";
        next.status.error = "后台处理意外中断，请重试";
      }
      if (next.input.kind === "import") await fs.rm(next.input.filePath, { force: true });
      next.worker = undefined;
      active = undefined;
      runNext();
    });
  }
  function create(input: JobInput): JobStatus {
    prune();
    capacity();
    const status: JobStatus = {
      id: randomUUID(),
      kind: input.kind,
      state: "queued",
      stage: "等待处理",
      createdAt: Date.now()
    };
    jobs.set(status.id, { status, input, flag: new Int32Array(new SharedArrayBuffer(4)) });
    runNext();
    return { ...status };
  }
  function get(id: string): Job {
    prune();
    const job = jobs.get(id);
    if (!job) throw badRequest("任务不存在或已过期");
    return job;
  }
  app.addContentTypeParser(
    "application/octet-stream",
    async (request: FastifyRequest, payload: Readable) => {
      if (!request.url.split("?")[0]?.endsWith("/api/jobs/import"))
        throw badRequest("此端点不接受文件上传");
      capacity();
      uploads++;
      const filePath = path.join(directory, randomUUID() + ".json");
      let file: Awaited<ReturnType<typeof fs.open>> | undefined;
      try {
        file = await fs.open(filePath, "wx");
        let bytes = 0;
        for await (const chunk of payload) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += data.length;
          if (bytes > MAX_IMPORT_BYTES) throw badRequest("导入文件超过 64 MiB 限制");
          await file.writeFile(data);
        }
        if (!bytes) throw badRequest("导入文件为空");
        return filePath;
      } catch (error) {
        await fs.rm(filePath, { force: true });
        throw error;
      } finally {
        await file?.close();
        uploads--;
      }
    }
  );
  app.post<{ Body: string; Querystring: { generateNewId?: string } }>(
    "/api/jobs/import",
    { bodyLimit: MAX_IMPORT_BYTES },
    async (request, reply) => {
      if (request.headers["content-type"] !== "application/octet-stream")
        throw badRequest("请上传原始 JSON 文件");
      try {
        return reply.code(202).send(
          createEnvelope({
            result: create({
              kind: "import",
              filePath: request.body,
              generateNewId: request.query.generateNewId === "true"
            })
          })
        );
      } catch (error) {
        await fs.rm(request.body, { force: true });
        throw error;
      }
    }
  );
  app.post<{
    Body: {
      kind: "png" | "json" | "preview";
      mapId: string;
      options?: Partial<ExportRenderOptions>;
    };
  }>("/api/jobs/export", async (request, reply) => {
    const body = request.body;
    if (!body || !["png", "json", "preview"].includes(body.kind))
      throw badRequest("请选择导出格式");
    return reply.code(202).send(
      createEnvelope({
        result: create({
          kind: body.kind,
          mapId: assertSafeMapId(body.mapId),
          options: normalizeExportOptions(body.options ?? {})
        })
      })
    );
  });
  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request) =>
    createEnvelope({ result: get(request.params.id).status })
  );
  app.delete<{ Params: { id: string } }>("/api/jobs/:id", async (request) => {
    const job = get(request.params.id);
    if (["done", "failed", "cancelled"].includes(job.status.state))
      return createEnvelope({ result: job.status });
    if (Atomics.compareExchange(job.flag, 0, 0, 1) === 2)
      throw badRequest("任务已完成写入，请等待结果");
    if (job.status.state === "queued") {
      job.status.state = "cancelled";
      job.status.stage = "已取消";
      if (job.input.kind === "import") await fs.rm(job.input.filePath, { force: true });
    } else {
      job.status.state = "cancelling";
      job.status.stage = "正在取消";
    }
    return createEnvelope({ result: job.status });
  });
  app.addHook("onClose", async () => {
    closing = true;
    for (const job of jobs.values()) {
      if (job.worker) await job.worker.terminate();
      if (job.input.kind === "import") await fs.rm(job.input.filePath, { force: true });
    }
  });
}
