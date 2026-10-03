import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createRuntimeState,
  isRiverWaterEndpointCell,
  type RiverFeature
} from "@mapdesigner/map-core";
import {
  buildMapScene,
  centerForCoord,
  renderSvgString,
  riverGeometry
} from "@mapdesigner/map-render";

const makeRiver = (id: string, points: RiverFeature["points"]): RiverFeature => ({
  id,
  name: id,
  points,
  width_mode: "distance",
  color: "#2F83B7",
  opacity: 0.7
});
async function raster(rivers: RiverFeature[], water = false) {
  const doc = createEmptyDocument({ id: "raster", name: "Raster" });
  doc.features.rivers = rivers;
  doc.cells = Array.from({ length: 13 }, (_, i) => ({
    row: 0,
    col: i - 6,
    terrain: water && i >= 5 && i <= 7 ? ("lake" as const) : ("plain" as const),
    biome: null,
    tags: [],
    note: ""
  }));
  const scene = buildMapScene(createRuntimeState(doc), {
    includeGrid: false,
    includeCoordinates: false,
    includeTerrainSymbols: false,
    includeTags: false,
    padding: 64,
    boundsCoords: [
      { row: -5, col: -7 },
      { row: 5, col: 7 }
    ]
  });
  const { data, info } = await sharp(Buffer.from(renderSvgString(scene)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [
    ...data.subarray(
      (Math.round(y) * info.width + Math.round(x)) * 4,
      (Math.round(y) * info.width + Math.round(x)) * 4 + 4
    )
  ];
  return { scene, data, pixel };
}
describe("river water compositing", () => {
  it("has no holes along a wide hairpin or a reversal", async () => {
    const river = makeRiver("hairpin", [
      { row: 0, col: -4, width: 40 },
      { row: 0, col: 3, width: 40 },
      { row: 1, col: 3, width: 40 },
      { row: 1, col: -3, width: 40 }
    ]);
    const image = await raster([river]);
    for (const p of riverGeometry(river)) {
      const [r, , b] = image.pixel(p.x - image.scene.minX, p.y - image.scene.minY);
      expect(b! - r!).toBeGreaterThan(10);
    }
  });
  it("paints connected translucent tributaries once regardless of object order", async () => {
    const main = makeRiver("main", [
      { row: 0, col: -4, width: 14 },
      { row: 0, col: 0, width: 14, junction_id: "j" },
      { row: 0, col: 4, width: 14 }
    ]);
    const branch = makeRiver("branch", [
      { row: 3, col: 0, width: 6 },
      { row: 0, col: 0, width: 6, junction_id: "j" }
    ]);
    const a = await raster([main, branch]),
      b = await raster([branch, main]);
    expect(a.data.equals(b.data)).toBe(true);
    const only = await raster([main]);
    const center = centerForCoord({ row: 0, col: 0 }, 36);
    expect(a.pixel(center.x - a.scene.minX, center.y - a.scene.minY)).toEqual(
      only.pixel(center.x - only.scene.minX, center.y - only.scene.minY)
    );
  });
  it("keeps open lake pixels identical with and without a crossing river", async () => {
    const river = makeRiver("through", [
      { row: 0, col: -4, width: 12 },
      { row: 0, col: 4, width: 12 }
    ]);
    const a = await raster([river], true),
      b = await raster([], true);
    for (const col of [-1, 0, 1]) {
      const p = centerForCoord({ row: 0, col }, 36);
      expect(a.pixel(p.x - a.scene.minX, p.y - a.scene.minY)).toEqual(
        b.pixel(p.x - b.scene.minX, p.y - b.scene.minY)
      );
    }
  });
  it("does not infer open water from shore, delta or wetland names", () => {
    for (const terrain of ["coast", "wetland", "delta", "estuary", "tidal_flat"] as const)
      expect(isRiverWaterEndpointCell({ terrain })).toBe(false);
    for (const terrain of ["sea", "lake", "salt_lake", "lagoon"] as const)
      expect(isRiverWaterEndpointCell({ terrain })).toBe(true);
  });
});
