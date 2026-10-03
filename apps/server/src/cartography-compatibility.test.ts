import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, parseDocument } from "@mapdesigner/map-core";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-cartography-"));
  process.env.MAPDESIGNER_ROOT = root;
  vi.resetModules();
});
afterEach(async () => {
  (await import("./db.js")).closeDatabaseForTests();
  delete process.env.MAPDESIGNER_ROOT;
  await fs.rm(root, { recursive: true, force: true });
});

it("preserves a legacy style through migration, preview, history and streamed export", async () => {
  const service = await import("./service.js");
  const doc = createEmptyDocument({ id: "legacy-style", name: "Legacy" });
  delete doc.meta.map_style;
  const original = JSON.stringify(doc);
  const dir = path.join(root, "storage/maps");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "legacy-style.json"), original);
  expect((await service.getMap(doc.meta.id)).document.meta.map_style).toBe("classic-v1");
  const command = { action: "set_map_style" as const, style: "atlas-v1" as const };
  const preview = await service.applyCommands(doc.meta.id, [command], {
    dryRun: true,
    expectedRevision: 1
  });
  expect(preview.map.document.meta.map_style).toBe("atlas-v1");
  expect((await service.getMap(doc.meta.id)).document.meta.map_style).toBe("classic-v1");
  await service.applyCommands(doc.meta.id, [command], { expectedRevision: 1 });
  await expect(
    service.applyCommands(doc.meta.id, [command], { expectedRevision: 1 })
  ).rejects.toThrow(/revision conflict/);
  expect((await service.undoMap(doc.meta.id))!.map.document.meta.map_style).toBe("classic-v1");
  expect((await service.redoMap(doc.meta.id))!.map.document.meta.map_style).toBe("atlas-v1");
  const archive = await service.exportJson(doc.meta.id);
  expect(parseDocument(await fs.readFile(archive.path, "utf8")).document?.meta.map_style).toBe(
    "atlas-v1"
  );
  expect(await fs.readFile(path.join(dir, "legacy-style.json"), "utf8")).toBe(original);
});

it("restores all junction members in one history step, including mixed style changes", async () => {
  const service = await import("./service.js");
  const map = await service.createMap({ name: "Network" });
  const id = map.document.meta.id;
  await service.applyCommands(id, [
    {
      action: "create_river",
      river: {
        id: "main",
        name: "Main",
        flow_direction: "forward",
        points: [
          { row: 0, col: 0, width: 2 },
          { row: 0, col: 4, width: 8 },
          { row: 0, col: 10, width: 20 }
        ]
      }
    },
    {
      action: "create_river",
      river: {
        id: "branch",
        name: "Branch",
        points: [
          { row: -4, col: 4, width: 2 },
          { row: 0, col: 4, width: 5 }
        ]
      }
    }
  ]);
  const unconnected = (await service.getMap(id)).document.features;
  await service.applyCommands(id, [
    {
      action: "connect_river_points",
      points: [
        { river_id: "main", point_index: 1 },
        { river_id: "branch", point_index: 1 }
      ]
    }
  ]);
  const connected = (await service.getMap(id)).document.features;
  const main = connected.rivers.find((r) => r.id === "main")!;
  await service.applyCommands(id, [
    { action: "set_map_style", style: "classic-v1" },
    {
      action: "update_river",
      river_id: "main",
      changes: {
        points: main.points.map((p, i) => (i === 1 ? { ...p, row: 2 } : p)),
        flow_direction: "reverse",
        end_kind: "water"
      }
    }
  ]);
  const moved = (await service.getMap(id)).document.features;
  expect(moved.rivers.find((r) => r.id === "branch")?.points[1]?.row).toBe(2);
  for (let n = 0; n < 2; n += 1) {
    const undone = (await service.undoMap(id))!.map.document;
    expect(undone.features).toEqual(connected);
    expect(undone.meta.map_style).toBe("atlas-v1");
    expect((await service.redoMap(id))!.map.document.features).toEqual(moved);
  }
  await service.undoMap(id);
  expect((await service.undoMap(id))!.map.document.features).toEqual(unconnected);
  expect((await service.redoMap(id))!.map.document.features).toEqual(connected);
  const archive = await service.exportJson(id);
  expect(parseDocument(await fs.readFile(archive.path, "utf8")).document?.features).toEqual(
    connected
  );
});

it("releases database iterators when opening an export file fails", async () => {
  const service = await import("./service.js");
  const repository = await import("./repository.js");
  const map = await service.createMap({ name: "Export failure" });
  await expect(
    repository.writeMapDocumentJsonExport(
      map.document.meta.id,
      path.join(root, "missing/export.json")
    )
  ).rejects.toThrow("failed to write file");
  await service.applyCommands(map.document.meta.id, [
    { action: "set_map_style", style: "classic-v1" }
  ]);
  expect((await service.getMap(map.document.meta.id)).document.meta.map_style).toBe("classic-v1");
});

it("finds objects beyond the first 200 independently of the visible region", async () => {
  const service = await import("./service.js");
  const map = await service.createMap({ name: "Object search" });
  const doc = map.document;
  doc.features.rivers = Array.from({ length: 253 }, (_, index) => ({
    id: "river-" + String(index).padStart(3, "0"),
    name: index === 252 ? "Target 远方支流" : "River " + index,
    points: [
      { row: index * 10, col: 0 },
      { row: index * 10, col: 2 }
    ]
  }));
  await service.saveMap({ document: doc, expectedRevision: doc.meta.revision });
  const page = await service.searchMapFeatures(doc.meta.id, { offset: 250, limit: 50 });
  expect(page.page).toMatchObject({ total: 253, returned: 3, has_more: false });
  expect(page.rivers.at(-1)?.id).toBe("river-252");
  expect(
    (await service.searchMapFeatures(doc.meta.id, { search: "target" })).rivers.map((r) => r.id)
  ).toEqual(["river-252"]);
  expect(
    (
      await service.searchMapFeatures(
        doc.meta.id,
        { search: "远方" },
        { minRow: 0, maxRow: 10, minCol: 0, maxCol: 10 }
      )
    ).rivers
  ).toEqual([]);
});
