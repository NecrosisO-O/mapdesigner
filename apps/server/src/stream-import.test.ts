import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@mapdesigner/map-core";
let root: string,
  importer: typeof import("./stream-import.js"),
  service: typeof import("./service.js"),
  database: typeof import("./db.js");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-stream-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.resetModules();
  importer = await import("./stream-import.js");
  service = await import("./service.js");
  database = await import("./db.js");
});
afterEach(async () => {
  database.closeDatabaseForTests();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function input(content: string) {
  const file = path.join(root, "input.json");
  await fs.writeFile(file, content);
  return file;
}
it("streams unordered fields, UTF-8 records across chunks and shared river junctions", async () => {
  const doc = createEmptyDocument({ id: "streamed", name: "星湾" });
  doc.cells = Array.from({ length: 4101 }, (_, col) => ({
    row: -3,
    col,
    terrain: "plain",
    biome: null,
    tags: [],
    note: "测试𠮷🌊"
  }));
  doc.features.rivers = [
    {
      id: "a",
      name: "A",
      points: [
        { row: 0, col: 0, junction_id: "j" },
        { row: 1, col: 0 }
      ]
    },
    {
      id: "b",
      name: "B",
      points: [
        { row: 0, col: 0, junction_id: "j" },
        { row: 0, col: 1 }
      ]
    }
  ];
  const file = await input(
    JSON.stringify({
      cells: doc.cells,
      features: doc.features,
      grid: doc.grid,
      meta: doc.meta,
      schema_version: 1
    })
  );
  const result = await importer.importMapFile(file);
  expect(result.summary.designed_cell_count).toBe(4101);
  expect(result.summary.bounds).toEqual({ min_row: -3, max_row: -3, min_col: 0, max_col: 4100 });
  expect((await service.getMap("streamed")).document).toEqual(
    (await import("@mapdesigner/map-core")).normalizeDocument(doc)
  );
  expect((await fs.readdir(root)).filter((x) => x.includes("stage"))).toEqual([]);
});
it.each(["duplicate", "null", "truncated", "junction", "duplicate-root"])(
  "rejects %s and never publishes the staging rows",
  async (kind) => {
    const doc = createEmptyDocument({ id: "invalid", name: "Invalid" });
    doc.cells = Array.from({ length: 2100 }, (_, col) => ({
      row: 0,
      col,
      terrain: "plain",
      biome: null,
      tags: [],
      note: ""
    }));
    if (kind === "duplicate") doc.cells.push(doc.cells[0]!);
    if (kind === "null") doc.cells.push(null as never);
    if (kind === "junction")
      doc.features.rivers = [
        {
          id: "r",
          name: "R",
          points: [
            { row: 0, col: 0, junction_id: "x" },
            { row: 2, col: 1, junction_id: "x" }
          ]
        }
      ];
    let json = JSON.stringify(doc);
    if (kind === "truncated") json = json.slice(0, -4);
    if (kind === "duplicate-root") json = json.slice(0, -1) + ',"cells":[]}';
    const file = await input(json);
    await expect(importer.importMapFile(file)).rejects.toThrow();
    expect(await service.listMaps()).toHaveLength(0);
    expect((await fs.readdir(root)).filter((x) => x.includes("stage"))).toEqual([]);
  }
);
it("rolls back publication when cancellation wins and handles id conflicts", async () => {
  const doc = createEmptyDocument({ id: "same", name: "Same" });
  doc.cells = [{ row: 0, col: 0, terrain: "plain", biome: null, tags: [], note: "saved" }];
  const file = await input(JSON.stringify(doc));
  await expect(
    importer.importMapFile(file, {
      beforeCommit: () => {
        throw new Error("cancel");
      }
    })
  ).rejects.toThrow("cancel");
  expect(await service.listMaps()).toHaveLength(0);
  await importer.importMapFile(file);
  await expect(importer.importMapFile(file)).rejects.toThrow("conflict");
  const copy = await importer.importMapFile(file, { generateNewId: true });
  expect(copy.summary.meta.id).not.toBe(doc.meta.id);
  expect(copy.summary.designed_cell_count).toBe(1);
});
