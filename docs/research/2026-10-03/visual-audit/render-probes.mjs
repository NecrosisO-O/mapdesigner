// Reproduce the current renderer's visual behavior without changing maps or application code.
// Build first, then pass an output directory. Historical evidence is not overwritten by default.
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIOME_ENTRIES,
  TERRAIN_ENTRIES,
  createEmptyDocument,
  createRuntimeState,
  expandRiverPath,
  getHexDistance
} from "../../../../packages/map-core/dist/index.js";
import {
  TERRAIN_COLORS,
  buildMapScene,
  renderSvgString,
  getBiomePatternId
} from "../../../../packages/map-render/dist/map-render/src/index.js";
const require = createRequire(new URL("../../../../apps/server/package.json", import.meta.url));
const sharp = require("sharp");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const baseline = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8"
}).trim();
const output =
  path.resolve(process.argv[2] ?? path.join(tmpdir(), "mapdesigner-visual-probes")) + path.sep;
await fs.mkdir(output, { recursive: true });
const escape = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const font = 'font-family="Arial, PingFang SC, Noto Sans CJK SC, sans-serif"';
const text = (x, y, value, size = 16, fill = "#26342e") =>
  '<text x="' +
  x +
  '" y="' +
  y +
  '" font-size="' +
  size +
  '" fill="' +
  fill +
  '" ' +
  font +
  ">" +
  escape(value) +
  "</text>";
const cell = (row, col, terrain = "plain", biome = null) => ({
  row,
  col,
  terrain,
  biome,
  tags: [],
  note: ""
});
const river = (id, points, extra = {}) => ({ id, name: id, points, ...extra });
function runtime(cells, rivers = []) {
  const doc = createEmptyDocument({ id: "visual-audit", name: "Visual audit" });
  doc.cells = cells;
  doc.features.rivers = rivers;
  return createRuntimeState(doc);
}
function scene(cells, rivers = [], options = {}) {
  return buildMapScene(runtime(cells, rivers), {
    includeUndesigned: false,
    includeCoordinates: false,
    includeShorthand: false,
    includeGrid: true,
    size: 36,
    padding: 18,
    ...options
  });
}
function inset(scene, x, y, width, height) {
  const xml = renderSvgString(scene),
    body = xml.slice(xml.indexOf(">") + 1, xml.lastIndexOf("</svg>"));
  return (
    '<svg x="' +
    x +
    '" y="' +
    y +
    '" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    scene.width +
    " " +
    scene.height +
    '">' +
    body +
    "</svg>"
  );
}
async function save(name, width, height, content) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '"><rect width="100%" height="100%" fill="#fafbf8"/>' +
    content +
    "</svg>";
  await fs.writeFile(output + name + ".svg", svg);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(output + name + ".png");
}
const terrains = Object.entries(TERRAIN_ENTRIES);
let atlas = text(24, 32, "现有地形底色与坐标文字 · 源码提交 " + baseline, 22);
terrains.forEach(([key, entry], i) => {
  const x = 24 + (i % 6) * 184,
    y = 56 + Math.floor(i / 6) * 158;
  atlas += text(x, y + 18, entry.label, 15) + text(x, y + 38, key, 11, "#58665e");
  atlas += inset(
    scene([cell(0, 0, key)], [], { includeCoordinates: true, includeShorthand: true, padding: 4 }),
    x,
    y + 44,
    155,
    105
  );
});
await save("terrain-atlas", 1152, 64 + Math.ceil(terrains.length / 6) * 158, atlas);
const biomes = Object.entries(BIOME_ENTRIES);
let textures = text(24, 32, "现有生态纹理 · 统一底色用于辨识对照", 22);
textures += text(24, 54, "仅比较纹理，不代表这些地形与生态组合均可编辑。", 13, "#58665e");
biomes.forEach(([key, entry], i) => {
  const x = 24 + (i % 6) * 184,
    y = 78 + Math.floor(i / 6) * 150;
  textures += text(x, y + 18, entry.label, 15) + text(x, y + 38, key, 11, "#58665e");
  textures += inset(scene([cell(0, 0, "plain", key)], [], { padding: 4 }), x, y + 43, 155, 96);
});
await save("biome-atlas", 1152, 90 + Math.ceil(biomes.length / 6) * 150, textures);
const ground = [];
for (let row = -4; row <= 4; row++)
  for (let col = -4; col <= 4; col++) {
    if (Math.max(Math.abs(row), Math.abs(col), Math.abs(row + col)) <= 4)
      ground.push(cell(row, col));
  }
const main = river("main", [
  { row: 4, col: 0, width: 16 },
  { row: 0, col: 0, width: 18 },
  { row: -4, col: 0, width: 22 }
]);
const branch = river("branch", [
  { row: 2, col: -3, width: 9 },
  { row: 0, col: 0, width: 14 }
]);
const mouth = river("mouth", [
  { row: 3, col: -3, width: 8 },
  { row: 1, col: -1, width: 12 },
  { row: 0, col: 2, width: 16 }
]);
const coast = ground.map((c) => ({
  ...c,
  terrain: c.col >= 1 ? "sea" : c.col === 0 ? "coast" : "plain"
}));
const lake = ground.map((c) => ({
  ...c,
  terrain: Math.abs(c.row) <= 1 && Math.abs(c.col) <= 1 ? "lake" : "plain"
}));
const lakeRiver = river("lake-path", [
  { row: 4, col: 0, width: 10 },
  { row: 0, col: 0, width: 18 },
  { row: -4, col: 0, width: 12 }
]);
const turn = river("turn", [
  { row: 3, col: -3, width: 32 },
  { row: 1, col: 0, width: 32 },
  { row: 2, col: -2, width: 32 },
  { row: -3, col: 1, width: 32 }
]);
const sharpTurn = scene(ground, [turn]);
const exitReentry = river("exit-reentry", [
  { row: -2, col: -2, width: 10 },
  { row: -2, col: 8, width: 10 },
  { row: 8, col: 8, width: 10 },
  { row: 8, col: 0, width: 10 },
  { row: 0, col: 0, width: 10 }
]);
const clip = { minRow: -2, maxRow: 2, minCol: -2, maxCol: 2 };
const region = [];
for (let row = -2; row <= 2; row++) for (let col = -2; col <= 2; col++) region.push(cell(row, col));
const clipping = scene(region, [exitReentry], { riverClipRange: clip });
const cases = [
  ["支流汇入", "检查叠色、接缝和高光是否连贯", scene(ground, [main, branch])],
  ["宽河急弯", "检查内岸折叠与河面自交", sharpTurn],
  ["入海", "检查岸线融合与水面上的独立端帽", scene(coast, [mouth])],
  ["穿越湖泊", "检查湖面是否仍出现独立河道色带", scene(lake, [lakeRiver])],
  ["离开范围后再进入", "真实河道绕到范围外，当前过滤后会连起两段", clipping],
  [
    "同形路径的流向",
    "路径只有点序与宽度，尚无明确汇流连接语义",
    scene(ground, [river("reverse", [...main.points].reverse())])
  ]
];
let sheet = text(24, 34, "现有水系渲染 · 场景审查", 24);
cases.forEach(([title, caption, s], i) => {
  const x = 24 + (i % 2) * 590,
    y = 62 + Math.floor(i / 2) * 395;
  sheet +=
    '<rect x="' +
    x +
    '" y="' +
    y +
    '" width="568" height="374" rx="8" fill="#fff" stroke="#dbe1d9"/>';
  sheet +=
    text(x + 16, y + 27, String(i + 1).padStart(2, "0") + "  " + title, 18) +
    text(x + 16, y + 51, caption, 13, "#58665e");
  sheet += inset(s, x + 14, y + 68, 538, 286);
});
await save("river-scenarios", 1220, 1260, sheet);
const simple = river("two-controls", [
  { row: 0, col: 0, width: 2 },
  { row: 0, col: 10, width: 22 }
]);
const inserted = river("insert-control", [
  { row: 0, col: 0, width: 2 },
  { row: 0, col: 1 },
  { row: 0, col: 10, width: 22 }
]);
const bandGround = Array.from({ length: 11 }, (_, col) => cell(0, col));
let widths = text(24, 34, "仅插入一个无宽度值的控制点，河宽就改变", 22);
widths += text(24, 61, "同一路径、同一对宽度锚点：起点 2 → 终点 22。", 15);
widths += text(24, 93, "A：两个控制点。R0C1 的宽度为 4。", 16);
widths += inset(scene(bandGround, [simple], { includeGrid: false }), 24, 108, 1130, 200);
widths += text(24, 341, "B：在 R0C1 插入无宽度控制点。该处宽度变为 12。", 16);
widths += inset(scene(bandGround, [inserted], { includeGrid: false }), 24, 356, 1130, 200);
await save("width-control-dependence", 1180, 590, widths);
// A correct crop retains the original centerline outside the viewport; the current range
// filter drops the outside samples, then builds one path through the remaining sequences.
const full = scene(region, [exitReentry], {
  riverClipRange: { minRow: -3, maxRow: 9, minCol: -3, maxCol: 9 }
});
const referenceBody = renderSvgString(full);
const inner = referenceBody.slice(
  referenceBody.indexOf(">") + 1,
  referenceBody.lastIndexOf("</svg>")
);
let cropped = text(24, 32, "区域裁切对照：完整几何裁切 vs 当前采样过滤", 22);
cropped += text(24, 63, "左：保持原路径后裁切。右：当前渲染把不连续的样本重新连成一条路径。", 14);
const cropX = clipping.minX - full.minX,
  cropY = clipping.minY - full.minY;
cropped += text(24, 100, "完整几何裁切参考", 17) + text(628, 100, "当前区域输出", 17);
const cropRect =
  '<rect x="' +
  cropX +
  '" y="' +
  cropY +
  '" width="' +
  clipping.width +
  '" height="' +
  clipping.height +
  '"/>';
cropped +=
  '<svg x="24" y="120" width="550" height="425" viewBox="' +
  cropX +
  " " +
  cropY +
  " " +
  clipping.width +
  " " +
  clipping.height +
  '"><defs><clipPath id="audit-reference-viewport">' +
  cropRect +
  '</clipPath></defs><g clip-path="url(#audit-reference-viewport)"><rect x="' +
  cropX +
  '" y="' +
  cropY +
  '" width="' +
  clipping.width +
  '" height="' +
  clipping.height +
  '" fill="' +
  escape(full.background) +
  '"/>' +
  inner +
  "</g></svg>";
cropped += inset(clipping, 628, 120, 550, 425);
await save("range-clipping-comparison", 1204, 576, cropped);
function luminance(hex) {
  const rgb = hex
    .replace("#", "")
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const contrast = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const groups = {};
for (const [key] of biomes) (groups[getBiomePatternId(key)] ??= []).push(key);
const samples = expandRiverPath(exitReentry).filter(
  (p) =>
    p.row >= clip.minRow - 1 &&
    p.row <= clip.maxRow + 1 &&
    p.col >= clip.minCol - 1 &&
    p.col <= clip.maxCol + 1
);
const gaps = samples.flatMap((p, i) =>
  i && getHexDistance(samples[i - 1], p) > 1
    ? [{ from: samples[i - 1], to: p, distance: getHexDistance(samples[i - 1], p) }]
    : []
);
const metrics = {
  baseline,
  terrainCount: terrains.length,
  biomeCount: biomes.length,
  note: "Contrast compares opaque foreground and base fill only; texture, anti-aliasing and opacity can change local rendered contrast.",
  mutedContrast: { white: contrast("#718078", "#ffffff"), subtle: contrast("#718078", "#f5f7f5") },
  cellTextContrast: terrains
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      background: TERRAIN_COLORS[key],
      ratio: contrast("#1D1B18", TERRAIN_COLORS[key])
    }))
    .sort((a, b) => a.ratio - b.ratio),
  identicalBiomePatterns: Object.entries(groups).filter(([, keys]) => keys.length > 1),
  pointInsertionWidth: {
    before: expandRiverPath(simple).find((p) => p.row === 0 && p.col === 1).width,
    after: expandRiverPath(inserted).find((p) => p.row === 0 && p.col === 1).width
  },
  clippedDiscontinuities: gaps,
  viewportBodyConnectedFlags: clipping.riverBodies.map((b) => ({
    start: b.connectedStart,
    end: b.connectedEnd
  })),
  exportOnlyProbe: true
};
await fs.writeFile(output + "render-metrics.json", JSON.stringify(metrics, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      terrains: terrains.length,
      biomes: biomes.length,
      mutedContrast: metrics.mutedContrast,
      lowContrastCellLabels: metrics.cellTextContrast.filter((x) => x.ratio < 4.5),
      identicalPatterns: metrics.identicalBiomePatterns,
      widthChange: metrics.pointInsertionWidth,
      clippedGaps: gaps.length
    },
    null,
    2
  )
);
