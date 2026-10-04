import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@mapdesigner/map-core";
import { buildMapScene, renderSvgString } from "@mapdesigner/map-render";
let root: string,
  service: typeof import("./service.js"),
  tiled: typeof import("./tiled-export.js"),
  database: typeof import("./db.js");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-tiles-"));
  vi.stubEnv("MAPDESIGNER_ROOT", root);
  vi.resetModules();
  service = await import("./service.js");
  tiled = await import("./tiled-export.js");
  database = await import("./db.js");
});
afterEach(async () => {
  database.closeDatabaseForTests();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const doc = createEmptyDocument({ id: "tiles", name: "河口群岛" });
  doc.cells = Array.from({ length: 25 * 25 }, (_, i) => ({
    row: Math.floor(i / 25) - 12,
    col: (i % 25) - 12,
    terrain: i % 25 > 19 ? ("sea" as const) : ("plain" as const),
    biome: i % 25 > 19 ? ("marine" as const) : ("grassland" as const),
    tags: [],
    note: ""
  }));
  doc.features.rivers = [
    {
      id: "main",
      name: "干流",
      width_mode: "distance",
      start_kind: "spring",
      end_kind: "water",
      points: [
        { row: -10, col: -10, width: 2 },
        { row: 0, col: 0, width: 12, junction_id: "meet" },
        { row: 5, col: 12, width: 32 }
      ]
    },
    {
      id: "branch",
      name: "支流",
      points: [
        { row: 11, col: -9, width: 5 },
        { row: 0, col: 0, width: 12, junction_id: "meet" }
      ]
    }
  ];
  await service.importMap({ content: JSON.stringify(doc), includeMap: false });
  return doc.meta.id;
}
it("stitches variable-width rivers, junctions and coastlines like a single render", async () => {
  const id = await fixture();
  const plan = await tiled.planTiledExport(
    id,
    { scale: 1, background: "transparent", includeCoordinates: true, includeGrid: true },
    2048
  );
  const map = await service.getMap(id);
  const whole = buildMapScene(map, {
    ...plan.options,
    size: 36,
    padding: 0,
    frame: plan,
    riverClipRange: plan.range
  });
  const expected = await sharp(Buffer.from(renderSvgString(whole)))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const stitched = Buffer.alloc(plan.width * plan.height * 4);
  for (let row = 0; row < plan.rows; row++)
    for (let col = 0; col < plan.columns; col++) {
      const { data, info } = await sharp(await tiled.renderExportTile(plan, row, col))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let y = 0; y < info.height; y++)
        data.copy(
          stitched,
          ((row * plan.tileSize + y) * plan.width + col * plan.tileSize) * 4,
          y * info.width * 4,
          (y + 1) * info.width * 4
        );
    }
  expect(stitched.length).toBe(expected.length);
  let error = 0,
    changed = 0;
  for (let i = 0; i < expected.length; i++) {
    const d = Math.abs(expected[i]! - stitched[i]!);
    error += d;
    if (d > 4) changed++;
  }
  expect(error / expected.length).toBeLessThan(0.1);
  expect(changed / expected.length).toBeLessThan(0.001);
}, 20000);
it("packages PNG tiles and an index, rejects stale previews and cleans cancelled output", async () => {
  const id = await fixture();
  const preview = await tiled.previewTiledExport(id, { scale: 1 }, 1024);
  expect(preview.tileCount).toBeGreaterThan(1);
  expect(preview.image.startsWith("data:image/png;base64,")).toBe(true);
  const archive = await tiled.exportTiles(
    id,
    { scale: 1, expectedRevision: preview.revision, title: "<地图>" },
    1024,
    { taskId: "test-archive" }
  );
  const bytes = await fs.readFile(archive.path);
  expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(bytes.includes(Buffer.from("manifest.json"))).toBe(true);
  expect(bytes.includes(Buffer.from("index.html"))).toBe(true);
  await service.applyCommandsLight(id, [
    { action: "set_cell", target: { row: 0, col: 0 }, changes: { terrain: "mountain" } }
  ]);
  await expect(tiled.planTiledExport(id, { expectedRevision: preview.revision })).rejects.toThrow(
    "地图已改变"
  );
  let calls = 0;
  await expect(
    tiled.exportTiles(id, { scale: 1 }, 1024, {
      taskId: "cancelled",
      checkCancelled: () => {
        if (++calls === 2) throw new Error("cancel");
      }
    })
  ).rejects.toThrow("cancel");
  expect(
    (await fs.readdir(path.join(root, "storage/exports"))).filter(
      (n) => n.includes("cancelled") || n.endsWith("tmp")
    )
  ).toEqual([]);
}, 20000);
it("bounds tile counts and validates sizes before allocating a surface", async () => {
  const id = await fixture();
  await expect(
    tiled.planTiledExport(
      id,
      { range: { minRow: 0, maxRow: 100000, minCol: 0, maxCol: 100000 } },
      1024
    )
  ).rejects.toThrow("分块预算");
  await expect(tiled.planTiledExport(id, {}, 100)).rejects.toThrow("分块尺寸");
});
