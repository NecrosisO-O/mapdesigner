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

it("downloads Chinese-named JSON and PNG files over a real HTTP connection", async () => {
  const map = await service.createMap({ name: "星湾群岛" });
  await service.applyCommandsLight(map.document.meta.id, [
    { action: "set_cell", target: { row: 0, col: 0 }, changes: { terrain: "plain" } }
  ]);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  for (const kind of ["json", "png"]) {
    const started = (
      await app.inject({
        method: "POST",
        url: "/api/jobs/export",
        payload: { kind, mapId: map.document.meta.id }
      })
    ).json().result;
    const job = await finish(started.id);
    expect(job.state, job.error).toBe("done");
    const response = await fetch(address + job.result.downloadUrl);
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition")!;
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]!)).toBe(
      job.result.fileName
    );
    if (kind === "json") {
      expect((await response.json()).meta.name).toBe("星湾群岛");
    } else {
      const image = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      expect(image.format).toBe("png");
      expect(image.width).toBeGreaterThan(0);
    }
  }
});

it("previews the same composition as PNG and rejects stale preview revisions", async () => {
  const map = await service.createMap({ name: "Preview" }),
    id = map.document.meta.id;
  await service.applyCommandsLight(id, [
    {
      action: "set_cell",
      target: { row: 0, col: 0 },
      changes: { terrain: "mountain", biome: "conifer_forest", tags: ["peak"] }
    }
  ]);
  const options = {
    scale: 1,
    title: "山地 <样例>",
    caption: "图例与标题采用真实输出排版",
    includeLegend: true,
    northArrow: true,
    gridScale: true,
    background: "transparent"
  };
  const started = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/export",
      payload: { kind: "preview", mapId: id, options }
    })
  ).json().result;
  const job = await finish(started.id);
  expect(job.state, job.error).toBe("done");
  const preview = job.result,
    exported = await service.exportPng(id, { ...options, expectedRevision: preview.revision });
  const original = await sharp(exported.path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = await sharp(Buffer.from(preview.image.split(",")[1], "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(preview.width).toBe(original.info.width);
  expect(preview.height).toBe(original.info.height);
  expect(image.data.equals(original.data)).toBe(true);
  await service.applyCommandsLight(id, [
    { action: "set_cell", target: { row: 0, col: 0 }, changes: { terrain: "hill" } }
  ]);
  await expect(
    service.exportPng(id, { ...options, expectedRevision: preview.revision })
  ).rejects.toThrow("地图已改变");
});
it("returns material usage outside the currently displayed region", async () => {
  const map = await service.createMap({ name: "Legend" }),
    id = map.document.meta.id;
  await service.applyCommandsLight(id, [
    {
      action: "set_cell",
      target: { row: 0, col: 0 },
      changes: { terrain: "plain", biome: "grassland" }
    },
    {
      action: "set_cell",
      target: { row: 400, col: 400 },
      changes: { terrain: "mountain", biome: "conifer_forest", tags: ["peak"] }
    }
  ]);
  const usage = (await app.inject({ url: "/api/maps/" + id + "/materials" })).json().result;
  expect(usage.terrains).toEqual(["mountain", "plain"]);
  expect(usage.biomes).toEqual(["conifer_forest", "grassland"]);
  expect(usage.tags).toEqual(["peak"]);
});

it("exports a downloadable ZIP and performs merge history through background jobs", async () => {
  const source = await service.createMap({ name: "来源岛" }),
    target = await service.createMap({ name: "群岛" });
  await service.applyCommandsLight(source.document.meta.id, [
    { action: "set_cell", target: { row: 0, col: 0 }, changes: { terrain: "mountain" } }
  ]);
  const input = {
    sourceId: source.document.meta.id,
    offsetRow: -3,
    offsetCol: 2,
    conflict: "keep-target"
  };
  const started = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/merge",
      payload: { mapId: target.document.meta.id, input, preview: true }
    })
  ).json().result;
  const preview = await finish(started.id);
  expect(preview.state, preview.error).toBe("done");
  const pending = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/merge",
      payload: { mapId: target.document.meta.id, input: preview.result.input }
    })
  ).json().result;
  expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
  const merged = await finish(pending.id);
  expect(merged.state, merged.error).toBe("done");
  expect(merged.result.summary.designed_cell_count).toBe(1);
  const undo = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/history",
      payload: {
        mapId: target.document.meta.id,
        direction: "undo",
        expectedRevision: merged.result.summary.meta.revision
      }
    })
  ).json().result;
  const undone = await finish(undo.id);
  expect(undone.state, undone.error).toBe("done");
  expect(undone.result.summary.designed_cell_count).toBe(0);
  const zip = (
    await app.inject({
      method: "POST",
      url: "/api/jobs/export",
      payload: {
        kind: "tiles",
        mapId: source.document.meta.id,
        tileSize: 1024,
        options: { scale: 1 }
      }
    })
  ).json().result;
  const ready = await finish(zip.id);
  expect(ready.state, ready.error).toBe("done");
  const downloaded = await app.inject({ url: ready.result.downloadUrl });
  expect(downloaded.headers["content-type"]).toContain("application/zip");
  expect(downloaded.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
});
