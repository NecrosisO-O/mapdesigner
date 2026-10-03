import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@mapdesigner/map-core";
import type { FastifyInstance } from "fastify";
let root: string, app: FastifyInstance;
let service: typeof import("./service.js");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-jobs-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.resetModules();
  service = await import("./service.js");
  app = await (await import("./api.js")).createServer();
});
afterEach(async () => {
  await app?.close();
  (await import("./db.js")).closeDatabaseForTests();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function finish(id: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const response = (await app.inject({ url: "/api/jobs/" + id })).json();
    if (["done", "failed", "cancelled"].includes(response.result.state)) return response.result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not finish");
}
it("imports a file larger than the old body limit without blocking health requests", async () => {
  const doc = createEmptyDocument({ id: "large-file", name: "Large" });
  doc.cells = Array.from({ length: 16000 }, (_, col) => ({
    row: 0,
    col,
    terrain: "plain",
    biome: null,
    tags: [],
    note: "archive"
  }));
  const body = JSON.stringify(doc);
  expect(Buffer.byteLength(body)).toBeGreaterThan(1024 * 1024);
  const response = await app.inject({
    method: "POST",
    url: "/api/jobs/import",
    headers: { "content-type": "application/octet-stream" },
    payload: body
  });
  expect(response.statusCode).toBe(202);
  expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
  const job = await finish(response.json().result.id);
  expect(job.state, job.error).toBe("done");
  expect((await service.getMapSummary("large-file")).designed_cell_count).toBe(16000);
  expect(await fs.readdir(path.join(root, "storage/uploads"))).toEqual([]);
}, 15000);
it("cancels an import and removes its upload without publishing a partial map", async () => {
  const doc = createEmptyDocument({ id: "cancelled", name: "Cancelled" });
  doc.cells = Array.from({ length: 15000 }, (_, col) => ({
    row: 0,
    col,
    terrain: "plain",
    biome: null,
    tags: [],
    note: ""
  }));
  const started = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/import",
      headers: { "content-type": "application/octet-stream" },
      payload: JSON.stringify(doc)
    })
  ).json().result;
  await app.inject({ method: "DELETE", url: "/api/jobs/" + started.id });
  expect((await finish(started.id)).state).toBe("cancelled");
  expect(await service.listMaps()).toHaveLength(0);
  await expect(fs.readdir(path.join(root, "storage/uploads"))).resolves.toEqual([]);
});
it("rolls back every imported row when cancellation wins the commit race", async () => {
  const doc = createEmptyDocument({ id: "commit-cancel", name: "Cancel" });
  doc.cells = [{ row: 0, col: 0, terrain: "plain", biome: null, tags: [], note: "" }];
  await expect(
    service.importMap({
      content: JSON.stringify(doc),
      beforeCommit: () => {
        throw new Error("cancel");
      }
    })
  ).rejects.toThrow("cancel");
  expect(await service.listMaps()).toHaveLength(0);
});
it("exports a remote cell tightly and rejects an excessive pixel budget", async () => {
  const map = await service.createMap({ name: "Remote" });
  await service.applyCommandsLight(map.document.meta.id, [
    { action: "set_cell", target: { row: 1000, col: 1000 }, changes: { terrain: "plain" } }
  ]);
  const png = await service.exportPng(map.document.meta.id);
  const metadata = await sharp(png.path).metadata();
  expect(metadata.width).toBeLessThan(1000);
  expect(metadata.height).toBeLessThan(1000);
  await expect(
    service.exportPng(map.document.meta.id, {
      range: { minRow: 0, maxRow: 100, minCol: 0, maxCol: 100 },
      scale: 4
    })
  ).rejects.toThrow("尺寸预算");
});
it("exports through a job and gives separate files to concurrent export requests", async () => {
  const map = await service.createMap({ name: "Archive" });
  const a = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/export",
      payload: { kind: "json", mapId: map.document.meta.id }
    })
  ).json().result;
  const b = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/export",
      payload: { kind: "json", mapId: map.document.meta.id }
    })
  ).json().result;
  const [first, second] = await Promise.all([finish(a.id), finish(b.id)]);
  expect(first.state, first.error).toBe("done");
  expect(second.state, second.error).toBe("done");
  expect(first.result.fileName).not.toBe(second.result.fileName);
  expect((await app.inject({ url: first.result.downloadUrl })).json().meta.id).toBe(
    map.document.meta.id
  );
});
it("paginates beyond 500 rivers and includes the final river in a range export", async () => {
  const doc = createEmptyDocument({ id: "many-rivers", name: "Rivers" });
  doc.features.rivers = Array.from({ length: 501 }, (_, i) => ({
    id: "river-" + String(i).padStart(3, "0"),
    name: "River " + i,
    points: [
      { row: 0, col: 0 },
      { row: 1, col: 0 }
    ]
  }));
  await service.importMap({ content: JSON.stringify(doc), includeMap: false });
  const range = { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 };
  const first = await service.getMapFeaturesInRange(doc.meta.id, range);
  expect(first.rivers).toHaveLength(500);
  const last = await service.getMapFeaturesInRange(doc.meta.id, range, { offset: 500 });
  expect(last.rivers[0]?.id).toBe("river-500");
  const render = await import("@mapdesigner/map-render");
  const spy = vi.spyOn(render, "buildExportScene");
  await service.exportPng(doc.meta.id, { range });
  expect(spy.mock.calls[0]?.[0].map.document.features.rivers).toHaveLength(501);
  spy.mockRestore();
});
