import type { MapDocument } from "@mapdesigner/map-core";
import { badRequest } from "./errors.js";
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_STREAM_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_STREAM_IMPORT_CELLS = 25_000_000;
export const MAX_IMPORT_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_EXPORT_PIXELS = 40_000_000;
export function assertPixelBudget(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 32768 ||
    height > 32768 ||
    width * height > MAX_EXPORT_PIXELS
  ) {
    throw badRequest("图片超出尺寸预算（单边 32768 像素、总计 4000 万像素），请缩小范围或降低倍率");
  }
}
export function assertImportBudget(document: MapDocument): void {
  if (document.cells.length > 500_000 || document.features.rivers.length > 20_000)
    throw badRequest("导入上限为 50 万格、2 万条河流");
  let samples = 0;
  for (const river of document.features.rivers) {
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1]!,
        b = river.points[i]!;
      samples +=
        Math.max(
          Math.abs(a.row - b.row),
          Math.abs(a.col - b.col),
          Math.abs(a.row + a.col - b.row - b.col)
        ) + 1;
    }
  }
  if (samples > 500_000) throw badRequest("河流路径总长度超出 50 万格，请拆分地图");
}
