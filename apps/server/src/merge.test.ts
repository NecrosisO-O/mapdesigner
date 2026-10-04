import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, normalizeStoredRiver } from "@mapdesigner/map-core";
let root: string,
  service: typeof import("./service.js"),
  merge: typeof import("./merge.js"),
  database: typeof import("./db.js");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-merge-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.resetModules();
  service = await import("./service.js");
  merge = await import("./merge.js");
  database = await import("./db.js");
});
afterEach(async () => {
  database.closeDatabaseForTests();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const target = createEmptyDocument({ id: "target", name: "群岛" }),
    source = createEmptyDocument({ id: "source", name: "新岛" });
  target.cells = [
    { row: -1, col: 2, terrain: "plain", biome: "grassland", tags: [], note: "目标备注" }
  ];
  source.cells = [
    {
      row: 0,
      col: 0,
      terrain: "mountain",
      biome: "conifer_forest",
      tags: ["peak"],
      note: "来源备注"
    },
    { row: 1, col: 0, terrain: "hill", biome: null, tags: [], note: "新增" }
  ];
  target.features.rivers = [
    {
      id: "same",
      name: "河流",
      points: [
        { row: -1, col: 2, width: 6, junction_id: "j" },
        { row: 2, col: 2, width: 10 }
      ]
    }
  ];
  source.features.rivers = [
    {
      id: "same",
      name: "河流",
      start_kind: "spring",
      width_mode: "distance",
      points: [
        { row: 0, col: 0, width: 2 },
        { row: 1, col: 0, width: 8, junction_id: "j" }
      ]
    },
    {
      id: "branch",
      name: "支流",
      points: [
        { row: 3, col: 3, width: 3 },
        { row: 1, col: 0, width: 8, junction_id: "j" }
      ]
    }
  ];
  await service.importMap({ content: JSON.stringify(target) });
  await service.importMap({ content: JSON.stringify(source) });
  return { target, source };
}
it.each(["keep-target", "replace-target"] as const)(
  "previews %s and restores every cell and river after restart",
  async (conflict) => {
    const { source, target } = await fixture();
    const preview = await merge.previewMapMerge("target", {
      sourceId: "source",
      offsetRow: -1,
      offsetCol: 2,
      conflict
    });
    expect([preview.added, preview.overlapping, preview.replaced, preview.rivers]).toEqual([
      1,
      1,
      conflict === "replace-target" ? 1 : 0,
      2
    ]);
    expect(preview.conflicts).toEqual([{ row: -1, col: 2 }]);
    await merge.mergeMaps("target", preview.input);
    const merged = (await service.getMap("target")).document;
    expect(merged.cells).toHaveLength(2);
    expect(merged.cells.find((c) => c.row === -1)!.note).toBe(
      conflict === "replace-target" ? "来源备注" : "目标备注"
    );
    expect(merged.features.rivers).toHaveLength(3);
    expect(merged.features.rivers.find((r) => r.id === "same")).toEqual(
      normalizeStoredRiver(target.features.rivers[0]!)
    );
    const copied = merged.features.rivers.filter((r) => r.id !== "same");
    const junctions = copied.flatMap((r) =>
      r.points.filter((p) => p.junction_id).map((p) => p.junction_id)
    );
    expect(new Set(junctions).size).toBe(1);
    expect(junctions[0]).not.toBe("j");
    expect(
      copied
        .flatMap((r) => r.points)
        .filter((p) => p.junction_id)
        .every((p) => p.row === 0 && p.col === 2)
    ).toBe(true);
    expect((await service.getMap("source")).document.cells).toEqual(source.cells);
    database.closeDatabaseForTests();
    await service.undoMapLight("target");
    const undone = (await service.getMap("target")).document;
    expect(undone.cells).toEqual(target.cells);
    expect(undone.features.rivers).toEqual(target.features.rivers.map(normalizeStoredRiver));
    await service.redoMapLight("target");
    const redone = (await service.getMap("target")).document;
    expect(redone.cells).toEqual(merged.cells);
    expect(redone.features).toEqual(merged.features);
    await service.undoMapLight("target");
    await service.applyCommandsLight("target", [
      { action: "annotate_cell", target: { row: -1, col: 2 }, changes: { note: "新历史" } }
    ]);
    expect(await service.redoMapLight("target")).toBe(null);
    expect(
      (
        database.getDatabase().prepare("SELECT count(*) n FROM operation_cells").get() as {
          n: number;
        }
      ).n
    ).toBe(0);
  }
);
it("rejects changed source/target revisions and requires an explicit preview", async () => {
  await fixture();
  const input = {
    sourceId: "source",
    offsetRow: 0,
    offsetCol: 0,
    conflict: "keep-target" as const
  };
  await expect(merge.mergeMaps("target", input)).rejects.toThrow("预览");
  for (const changed of ["source", "target"]) {
    const preview = await merge.previewMapMerge("target", input);
    await service.applyCommandsLight(changed, [
      { action: "set_cell", target: { row: 4, col: 4 }, changes: { terrain: "plain" } }
    ]);
    await expect(merge.mergeMaps("target", preview.input)).rejects.toThrow("地图已改变");
  }
});
it("rolls back cell deltas, copied rivers and history when cancellation wins", async () => {
  const { target } = await fixture();
  const preview = await merge.previewMapMerge("target", {
    sourceId: "source",
    offsetRow: -1,
    offsetCol: 2,
    conflict: "replace-target"
  });
  await expect(
    merge.mergeMaps("target", preview.input, {
      beforeCommit: () => {
        throw new Error("cancel");
      }
    })
  ).rejects.toThrow("cancel");
  expect((await service.getMap("target")).document.cells).toEqual(target.cells);
  expect((await service.getMap("target")).document.features.rivers).toHaveLength(1);
  expect((await service.getHistoryStatus("target")).canUndo).toBe(false);
});
