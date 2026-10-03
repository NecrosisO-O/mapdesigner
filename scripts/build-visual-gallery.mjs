import fs from "node:fs/promises";
import { createRequire } from "node:module";
import {
  validateMapDocument,
  createEmptyDocument,
  createRuntimeState,
  TERRAIN_KEYS,
  BIOME_KEYS,
  TAG_KEYS,
  getAllowedBiomesForTerrain
} from "../packages/map-core/dist/index.js";
import {
  buildExportScene,
  renderSvgString
} from "../packages/map-render/dist/map-render/src/index.js";
const sharp = createRequire(new URL("../apps/server/package.json", import.meta.url))("sharp");
const cases = [];
function map(
  id,
  name,
  radius = 7,
  material = (r, c) => ({ terrain: "plain", biome: "grassland" })
) {
  const doc = createEmptyDocument({ id, name });
  doc.meta.created_at = doc.meta.updated_at = "2026-10-03T00:00:00.000Z";
  for (let r = -radius; r <= radius; r++)
    for (let c = -radius; c <= radius; c++)
      if (Math.max(Math.abs(r), Math.abs(c), Math.abs(r + c)) <= radius) {
        const m = material(r, c);
        doc.cells.push({
          row: r,
          col: c,
          terrain: m.terrain,
          biome: m.biome ?? null,
          tags: m.tags ?? [],
          note: ""
        });
      }
  return doc;
}
const river = (id, points, extra = {}) => ({
  id: "river-" + Buffer.from(id).toString("hex"),
  name: id,
  width_mode: "distance",
  flow_direction: "unspecified",
  start_kind: "auto",
  end_kind: "auto",
  color: "#2F83B7",
  opacity: 0.8,
  points: points.map((p) => ({
    row: p[0],
    col: p[1],
    ...(p[2] === undefined ? {} : { width: p[2] }),
    ...(p[3] ? { junction_id: p[3] } : {})
  })),
  ...extra
});
function add(doc, check, extra = {}) {
  const invalid = validateMapDocument(doc).filter((i) => i.severity === "invalid");
  if (invalid.length) throw new Error(JSON.stringify({ id: doc.meta.id, invalid }));
  cases.push({
    id: doc.meta.id,
    title: doc.meta.name,
    check,
    document: doc,
    options: {
      preset: "clean",
      includeCoordinates: false,
      includeShorthand: false,
      includeGrid: false,
      includeUndesigned: false,
      background: "#F4F0E6",
      scale: 1,
      padding: 36,
      ...extra
    }
  });
}
add(
  map("island", "海岛与海岸", 7, (r, c) => {
    const d = Math.max(Math.abs(r), Math.abs(c), Math.abs(r + c));
    return {
      terrain: d > 5 ? "sea" : d === 5 ? "beach" : d > 2 ? "plain" : "hill",
      biome: d > 5 ? "marine" : d < 3 ? "deciduous_forest" : null
    };
  }),
  "海陆轮廓清楚，相邻水面没有内部岸线。"
);
add(
  map("forest", "森林与山地", 7, (r, c) => {
    const terrain = c < -2 ? "mountain" : c < 1 ? "foothill" : "plain";
    return {
      terrain,
      biome:
        r > 2
          ? "conifer_forest"
          : r < -2
            ? terrain === "mountain"
              ? "cloud_forest"
              : "monsoon_forest"
            : terrain === "mountain"
              ? "alpine"
              : "temperate_rainforest"
    };
  }),
  "山地形状与森林纹理并存，雨林和季雨林样本有差异。"
);
add(
  map("dry-ice", "荒漠、火山与冰雪", 7, (r, c) => ({
    terrain:
      c < -3
        ? "dune"
        : c < 0
          ? "gravel_desert"
          : r < 0
            ? "lava_field"
            : c < 3
              ? "glacier"
              : "permafrost",
    biome: null
  })),
  "灰度下保留沙丘、冰川和火山的形状线索。"
);
add(
  map("markers", "密集地点标记", 5, (r, c) => ({
    terrain: r > 0 ? "mountain" : "plain",
    biome: null,
    tags:
      Math.abs(r + c) % 3 === 0
        ? TAG_KEYS.slice(0, 5)
        : [TAG_KEYS[Math.abs(r * 3 + c) % TAG_KEYS.length]]
  })),
  "标记最多并排显示两个，余量标注数量；标签不被河道遮挡。",
  { includeCoordinates: true }
);
const network = map("junctions", "多支流交汇");
network.features.rivers = [
  river(
    "主河",
    [
      [0, -6, 12],
      [0, 0, 16, "join"],
      [0, 6, 24]
    ],
    { flow_direction: "forward" }
  ),
  river(
    "北支流",
    [
      [5, -2, 3],
      [0, 0, 8, "join"]
    ],
    { flow_direction: "forward" }
  ),
  river(
    "南支流",
    [
      [-5, 3, 3],
      [0, 0, 5, "join"]
    ],
    { flow_direction: "forward" }
  )
];
add(network, "显式连接的水面连续，内部没有端帽、高光或叠色斑块。");
const mixed = structuredClone(network);
mixed.meta.id = "mixed-junction";
mixed.meta.name = "不同颜色的交汇";
mixed.features.rivers[1].color = "#538D7E";
add(mixed, "交汇重叠区由宽河优先，同宽使用固定对象顺序。");
const mouths = map("mouths", "细河、宽河与斜入海", 8, (r, c) => ({
  terrain: c >= 3 ? "sea" : c === 2 ? "beach" : "plain",
  biome: c >= 3 ? "marine" : null
}));
mouths.features.rivers = [
  river("细河", [
    [5, -5, 2],
    [3, 2, 3],
    [2, 5, 3]
  ]),
  river("宽河", [
    [0, -6, 12],
    [-1, 0, 24],
    [-2, 5, 32]
  ]),
  river("斜入海", [
    [-6, -1, 4],
    [-5, 1, 9],
    [-4, 6, 14]
  ])
];
add(mouths, "在真实岸线附近渐变，进入海面后不保留独立色带或端帽。");
const lake = map("lake", "入湖、出湖与穿湖", 7, (r, c) => ({
  terrain: Math.abs(r) <= 2 && Math.abs(c) <= 2 ? "lake" : "plain",
  biome: Math.abs(r) <= 2 && Math.abs(c) <= 2 ? "freshwater" : null
}));
lake.features.rivers = [
  river("穿湖河", [
    [0, -6, 4],
    [0, 0, 12],
    [0, 6, 12]
  ]),
  river("入湖支流", [
    [5, -3, 2],
    [0, -1, 5]
  ])
];
add(lake, "湖内保持连续水面，路径信息仍可在编辑器中查看。");
const delta = map("delta", "分汊与三角洲", 7, (r, c) => ({
  terrain: c >= 4 ? "sea" : c >= 1 ? "delta" : "plain",
  biome: c >= 4 ? "marine" : c >= 1 ? "marsh" : null
}));
delta.features.rivers = [
  river(
    "上游",
    [
      [0, -6, 3],
      [0, 0, 18, "split"]
    ],
    { flow_direction: "forward" }
  ),
  river(
    "北汊",
    [
      [0, 0, 10, "split"],
      [2, 2, 8],
      [2, 5, 8]
    ],
    { flow_direction: "forward" }
  ),
  river(
    "南汊",
    [
      [0, 0, 12, "split"],
      [-3, 3, 8],
      [-4, 6, 6]
    ],
    { flow_direction: "forward" }
  )
];
add(delta, "分支由显式连接建立，三角洲仍是地貌而非整格开放水面。");
const bends = map("hairpins", "宽河急弯与折返", 7, () => ({ terrain: "plain" }));
bends.features.rivers = [
  river("急弯", [
    [2, -6, 36],
    [2, 3, 52],
    [1, 3, 52],
    [1, -3, 36]
  ]),
  river("折返", [
    [-3, -5, 16],
    [-3, 1, 28],
    [-4, -2, 20],
    [-4, 5, 8]
  ])
];
add(bends, "宽河转弯无破洞、反向内岸或非法尖刺。");
const crossings = map("crossings", "独立交叉", 7);
crossings.features.rivers = [
  river("横河", [
    [0, -6, 12],
    [0, 6, 12]
  ]),
  river(
    "斜河",
    [
      [-6, 0, 8],
      [6, 0, 8]
    ],
    { color: "#538D7E" }
  )
];
add(crossings, "没有连接标识的交叉保留各自河道层次，不推断汇流。");
const clipped = map("clipped", "离开再进入视口", 10);
clipped.features.rivers = [
  river("多次进出", [
    [-2, -2, 10],
    [-2, 8, 10],
    [8, 8, 10],
    [8, 0, 10],
    [0, 0, 10]
  ])
];
add(clipped, "视口中的两次经过仍是独立片段，不出现假连线。", {
  range: { minRow: -2, maxRow: 2, minCol: -2, maxCol: 2 },
  includeCoordinates: true
});
const widths = map("widths", "沿程宽度锚点", 6);
widths.features.rivers = [
  river("节点细分", [
    [0, -5, 2],
    [0, -4],
    [0, 5, 22]
  ])
];
add(widths, "在起点后一格的无宽度节点处仍为 4；沿程平滑渐宽。");
const all = map("catalogue", "全部地形与生态", 0);
all.cells = [];
TERRAIN_KEYS.forEach((terrain, i) =>
  all.cells.push({
    row: -Math.floor(i / 6) * 2,
    col: (i % 6) * 2,
    terrain,
    biome: null,
    tags: [],
    note: ""
  })
);
BIOME_KEYS.forEach((biome, i) => {
  const terrain =
    TERRAIN_KEYS.find((t) => getAllowedBiomesForTerrain(t).includes(biome)) ?? "plain";
  all.cells.push({
    row: -14 - Math.floor(i / 6) * 2,
    col: (i % 6) * 2,
    terrain,
    biome,
    tags: [],
    note: ""
  });
});
add(all, "36 种地形、30 种生态均可见；完整图例与实际渲染使用同一来源。", {
  includeLegend: true,
  includeShorthand: true,
  title: "地形与生态视觉对照"
});
const target = new URL("../docs/design/editor-v3/fixtures/", import.meta.url);
await fs.mkdir(target, { recursive: true });
await fs.writeFile(
  new URL("cartography-gallery.json", target),
  JSON.stringify(cases, null, 2) + "\n"
);
const output = new URL("../docs/research/2026-10-03/visual-redesign/gallery/", import.meta.url);
await fs.mkdir(output, { recursive: true });
for (const fixture of cases) {
  let runtime = createRuntimeState(fixture.document);
  const range = fixture.options.range;
  if (range) {
    runtime = {
      ...runtime,
      activeCells: runtime.activeCells.filter(
        (c) =>
          c.row >= range.minRow &&
          c.row <= range.maxRow &&
          c.col >= range.minCol &&
          c.col <= range.maxCol
      )
    };
  }
  const scene = buildExportScene({ map: runtime, options: fixture.options });
  const svg = renderSvgString(scene);
  await fs.writeFile(new URL(fixture.id + ".svg", output), svg);
  await sharp(Buffer.from(svg))
    .resize({ width: 960, withoutEnlargement: true })
    .png()
    .toFile(new URL(fixture.id + ".png", output).pathname);
}
console.log("Generated " + cases.length + " fixed visual scenarios.");
