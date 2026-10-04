import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import sharp from "sharp";
import {
  TERRAIN_ENTRIES,
  BIOME_ENTRIES,
  TAG_ENTRIES,
  type CellRange,
  type ExportRenderOptions,
  type MapRuntimeState,
  type TileExportPlan,
  type TileExportPreview
} from "@mapdesigner/map-core";
import {
  buildMapScene,
  renderSvgString,
  renderMaterialSvg,
  escapeXml
} from "@mapdesigner/map-render";
import {
  getCellsInRange,
  getMapFeaturesInRange,
  getMapSummary,
  getMapMaterialUsage
} from "./repository.js";
import { EXPORT_STORAGE_DIR } from "./config.js";
import { badRequest } from "./errors.js";
import { getOverview } from "./overview.js";
import { normalizeExportOptions } from "./storage.js";

export const MAX_TILE_COUNT = 2048;
const MAX_TILED_PIXELS = 32_000_000_000;
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
export function normalizeTileSize(value: unknown = 4096): number {
  if (![1024, 2048, 4096].includes(value as number))
    throw badRequest("分块尺寸应为 1024、2048 或 4096 像素");
  return value as number;
}
export function normalizeTiledOptions(
  input: Partial<ExportRenderOptions> = {}
): Partial<ExportRenderOptions> {
  const result = normalizeExportOptions({ ...input, range: null });
  if (input.range != null) {
    const r = input.range;
    if (
      !r ||
      typeof r !== "object" ||
      ![r.minRow, r.maxRow, r.minCol, r.maxCol].every(
        (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000_000
      ) ||
      r.minRow > r.maxRow ||
      r.minCol > r.maxCol
    )
      throw badRequest("导出区域坐标无效");
    result.range = { minRow: r.minRow, maxRow: r.maxRow, minCol: r.minCol, maxCol: r.maxCol };
  }
  return result;
}
export async function planTiledExport(
  id: string,
  input: Partial<ExportRenderOptions> = {},
  tileSize = 4096
): Promise<TileExportPlan> {
  tileSize = normalizeTileSize(tileSize);
  const summary = await getMapSummary(id);
  const options: ExportRenderOptions = {
    preset: "clean",
    includeCoordinates: false,
    includeShorthand: false,
    includeGrid: true,
    includeUndesigned: false,
    background: "#F4F0E6",
    padding: 32,
    scale: 1,
    range: null,
    ...normalizeTiledOptions(input)
  };
  if (options.expectedRevision !== undefined && options.expectedRevision !== summary.meta.revision)
    throw badRequest("地图已改变，请刷新导出预览后重试");
  if (options.preset === "reference") {
    options.includeCoordinates = true;
    options.includeShorthand = true;
  }
  const b = summary.render_bounds ?? summary.bounds;
  const range = options.range ?? {
    minRow: b.min_row ?? 0,
    maxRow: b.max_row ?? 0,
    minCol: b.min_col ?? 0,
    maxCol: b.max_col ?? 0
  };
  const size = 36 * options.scale;
  const minX = 1.5 * size * range.minCol - size - options.padding;
  const minY =
    -size * Math.sqrt(3) * (range.maxRow + range.maxCol / 2) -
    (size * Math.sqrt(3)) / 2 -
    options.padding;
  const width = Math.ceil(
    (range.maxCol - range.minCol) * size * 1.5 + 2 * size + 2 * options.padding
  );
  const height = Math.ceil(
    (range.maxRow - range.minRow + (range.maxCol - range.minCol) / 2 + 1) * size * Math.sqrt(3) +
      2 * options.padding
  );
  const columns = Math.ceil(width / tileSize),
    rows = Math.ceil(height / tileSize),
    tileCount = columns * rows;
  if (
    ![width, height, tileCount].every(Number.isSafeInteger) ||
    tileCount > MAX_TILE_COUNT ||
    width * height > MAX_TILED_PIXELS
  )
    throw badRequest(
      "导出范围超过分块预算（最多 2048 张、总计 320 亿像素），请降低倍率、增大分块尺寸或分区导出"
    );
  return {
    mapId: summary.meta.id,
    revision: summary.meta.revision,
    range,
    minX,
    minY,
    width,
    height,
    tileSize,
    columns,
    rows,
    tileCount,
    options
  };
}

export async function renderExportTile(
  plan: TileExportPlan,
  row: number,
  col: number,
  checkCancelled?: () => void
): Promise<Buffer> {
  const { options } = plan,
    size = 36 * options.scale;
  const width = Math.min(plan.tileSize, plan.width - col * plan.tileSize),
    height = Math.min(plan.tileSize, plan.height - row * plan.tileSize);
  checkCancelled?.();
  // Small SVG surfaces bound pattern/mask work. Their global pixel frames meet exactly.
  if (plan.tileSize > 1024) {
    const factor = plan.tileSize / 1024,
      parts: Array<{ input: Buffer; left: number; top: number }> = [];
    for (let y = 0; y < Math.ceil(height / 1024); y++)
      for (let x = 0; x < Math.ceil(width / 1024); x++) {
        checkCancelled?.();
        parts.push({
          input: await renderExportTile(
            { ...plan, tileSize: 1024 },
            row * factor + y,
            col * factor + x,
            checkCancelled
          ),
          left: x * 1024,
          top: y * 1024
        });
      }
    return sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite(parts)
      .png()
      .toBuffer();
  }
  const frame = {
    minX: plan.minX + col * plan.tileSize,
    minY: plan.minY + row * plan.tileSize,
    width,
    height
  };
  const loC = Math.floor(frame.minX / (size * 1.5)) - 4,
    hiC = Math.ceil((frame.minX + width) / (size * 1.5)) + 4;
  const range: CellRange = {
    minCol: loC,
    maxCol: hiC,
    minRow: Math.floor(-(frame.minY + height) / (size * Math.sqrt(3)) - hiC / 2) - 4,
    maxRow: Math.ceil(-frame.minY / (size * Math.sqrt(3)) - loC / 2) + 4
  };
  const [summary, cells, first] = await Promise.all([
    getMapSummary(plan.mapId),
    getCellsInRange(plan.mapId, range, { includeUndesigned: options.includeUndesigned }),
    getMapFeaturesInRange(plan.mapId, range, { limit: 2000 })
  ]);
  const rivers = [...first.rivers];
  let page = first;
  while (page.page.has_more) {
    page = await getMapFeaturesInRange(plan.mapId, range, {
      limit: 2000,
      offset: page.page.offset + page.page.returned
    });
    rivers.push(...page.rivers);
  }
  const activeCells = cells.cells.filter(
    (c) =>
      c.row >= plan.range.minRow &&
      c.row <= plan.range.maxRow &&
      c.col >= plan.range.minCol &&
      c.col <= plan.range.maxCol
  );
  const map: MapRuntimeState = {
    document: {
      schema_version: 1,
      meta: summary.meta,
      grid: summary.grid,
      cells: [],
      features: { rivers }
    },
    activeCells,
    history: { past: [], future: [], limit: 0 }
  };
  const scene = buildMapScene(map, { ...options, size, padding: 0, frame, riverClipRange: range });
  return sharp(Buffer.from(renderSvgString(scene)), { limitInputPixels: 20_000_000 })
    .timeout({ seconds: 30 })
    .png()
    .toBuffer();
}

export async function previewTiledExport(
  id: string,
  options: Partial<ExportRenderOptions> = {},
  tileSize = 4096
): Promise<TileExportPreview> {
  const plan = await planTiledExport(id, options, tileSize);
  const overview = await getOverview(id, plan.range);
  const size = 36 * plan.options.scale,
    weights = new Map<number, number>();
  // A bounded overview chooses a populated sample even when the map center is empty.
  for (const tile of overview.tiles) {
    const center = (overview.bucket_size - 1) / 2;
    const r = Math.min(plan.range.maxRow, Math.max(plan.range.minRow, tile.row + center));
    const c = Math.min(plan.range.maxCol, Math.max(plan.range.minCol, tile.col + center));
    const row = Math.max(
      0,
      Math.min(
        plan.rows - 1,
        Math.floor((-size * Math.sqrt(3) * (r + c / 2) - plan.minY) / plan.tileSize)
      )
    );
    const col = Math.max(
      0,
      Math.min(plan.columns - 1, Math.floor((1.5 * size * c - plan.minX) / plan.tileSize))
    );
    const key = row * plan.columns + col;
    weights.set(key, (weights.get(key) ?? 0) + tile.count);
  }
  const selected = [...weights].sort((a, b) => b[1] - a[1])[0]?.[0];
  const sampleRow =
    selected === undefined ? Math.floor(plan.rows / 2) : Math.floor(selected / plan.columns);
  const sampleCol = selected === undefined ? Math.floor(plan.columns / 2) : selected % plan.columns;
  const png = await sharp(await renderExportTile(plan, sampleRow, sampleCol))
    .resize({ width: 900, height: 600, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return {
    ...plan,
    image: "data:image/png;base64," + png.toString("base64"),
    sampleRow,
    sampleCol
  };
}

export async function cleanupTiledExport(taskId: string, removeResult = false): Promise<void> {
  await fs.rm(path.join(EXPORT_STORAGE_DIR, ".tiles-" + taskId), { recursive: true, force: true });
  await fs.rm(path.join(EXPORT_STORAGE_DIR, "tiles-" + taskId + ".zip.tmp"), { force: true });
  if (removeResult)
    await fs.rm(path.join(EXPORT_STORAGE_DIR, "tiles-" + taskId + ".zip"), { force: true });
}

export async function exportTiles(
  id: string,
  options: Partial<ExportRenderOptions> = {},
  tileSize = 4096,
  control: { taskId?: string; progress?: (stage: string) => void; checkCancelled?: () => void } = {}
) {
  const plan = await planTiledExport(id, options, tileSize);
  const taskId = control.taskId ?? process.pid + "-" + randomUUID();
  const directory = path.join(EXPORT_STORAGE_DIR, ".tiles-" + taskId),
    fileName = "tiles-" + taskId + ".zip",
    output = path.join(EXPORT_STORAGE_DIR, fileName);
  await fs.mkdir(directory, { recursive: true });
  const tiles: Array<{
    file: string;
    row: number;
    col: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  let totalBytes = 0;
  try {
    for (let row = 0; row < plan.rows; row++)
      for (let col = 0; col < plan.columns; col++) {
        control.checkCancelled?.();
        control.progress?.(`正在绘制分块 · ${tiles.length + 1}/${plan.tileCount}`);
        const buffer = await renderExportTile(plan, row, col, control.checkCancelled);
        totalBytes += buffer.length;
        if (totalBytes > MAX_ARCHIVE_BYTES) throw badRequest("图片包超过 2 GiB，请缩小导出范围");
        const file = `tile-${String(row + 1).padStart(3, "0")}-${String(col + 1).padStart(3, "0")}.png`;
        await fs.writeFile(path.join(directory, file), buffer);
        tiles.push({
          file,
          row,
          col,
          x: col * tileSize,
          y: row * tileSize,
          width: Math.min(tileSize, plan.width - col * tileSize),
          height: Math.min(tileSize, plan.height - row * tileSize)
        });
      }
    const usage = await getMapMaterialUsage(id);
    const e = escapeXml;
    const mapStyle = (await getMapSummary(id)).meta.map_style;
    const legend = plan.options.includeLegend
      ? [
          ...(options.includeTerrain !== false
            ? usage.terrains.map(
                (t) =>
                  renderMaterialSvg(t, null, [], mapStyle) +
                  `<span>${e(TERRAIN_ENTRIES[t].label)}</span>`
              )
            : []),
          ...(options.includeBiomes !== false
            ? usage.biomes.map(
                (b) =>
                  renderMaterialSvg(
                    ["marine", "coral", "seagrass", "pack_ice"].includes(b) ? "sea" : "plain",
                    b,
                    [],
                    mapStyle
                  ) + `<span>${e(BIOME_ENTRIES[b].label)}</span>`
              )
            : []),
          ...(options.includeTags !== false
            ? usage.tags.map(
                (t) =>
                  renderMaterialSvg("plain", null, [t], mapStyle) +
                  `<span>${e(TAG_ENTRIES[t].label)}</span>`
              )
            : []),
          ...(options.includeRivers !== false && usage.river_count
            ? ["<span>河流 · 可变宽路径</span>"]
            : [])
        ].join("")
      : "";
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(options.title ?? "地图分块")}</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;padding:24px;background:#f4f0e6;color:#25362f}p{line-height:1.7;white-space:pre-wrap}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}figure{margin:0}img{width:100%;background:#fff}a{color:inherit}aside{display:flex;flex-wrap:wrap;align-items:center;gap:12px}aside svg{width:60px;height:52px}</style><h1>${e(options.title ?? "地图分块")}</h1><p>${e(options.caption ?? "")}</p><p>${plan.columns} 列 × ${plan.rows} 行 · 修订 ${plan.revision} · ${plan.width} × ${plan.height} 像素。文件名中的行号从上到下，列号从左到右。按 manifest.json 中 x/y 的像素位置拼接，图片之间没有重叠。${options.northArrow ? " 图面北向：↑。" : ""}${options.gridScale ? " 1 格距 = " + (36 * Math.sqrt(3) * plan.options.scale).toFixed(3) + " 像素（相邻格心距离）。" : ""}</p><aside>${legend}</aside><div class="tiles">${tiles.map((t) => `<figure><a href="${t.file}"><img loading="lazy" src="${t.file}" alt="第 ${t.row + 1} 行第 ${t.col + 1} 列"></a><figcaption>${t.row + 1} 行 · ${t.col + 1} 列 · ${t.width} × ${t.height}</figcaption></figure>`).join("")}</div></html>`;
    await fs.writeFile(path.join(directory, "index.html"), html);
    await fs.writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify({ schema_version: 1, ...plan, tiles }, null, 2)
    );
    control.checkCancelled?.();
    control.progress?.("正在打包图片与位置索引");
    const zip = new ZipFile();
    const writing = pipeline(zip.outputStream, createWriteStream(output + ".tmp"));
    for (const file of [...tiles.map((t) => t.file), "index.html", "manifest.json"])
      zip.addFile(path.join(directory, file), file, { compress: !file.endsWith(".png") });
    zip.end();
    await writing;
    control.checkCancelled?.();
    await fs.rename(output + ".tmp", output);
    return { fileName, path: output, tileCount: plan.tileCount, revision: plan.revision };
  } finally {
    await cleanupTiledExport(taskId);
  }
}
