import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { JSONParser, TokenType } from "@streamparser/json";
import Database from "better-sqlite3";
import {
  normalizeDocument,
  normalizeStoredRiver,
  validateMapDocument,
  validateDesignedCellRecord,
  validateRiverFeature,
  type DesignedCellRecord,
  type MapDocument,
  type MapBounds,
  type RiverFeature,
  type ValidationIssue
} from "@mapdesigner/map-core";
import { badRequest } from "./errors.js";
import { assertSafeMapId } from "./storage.js";
import { getMapSummary, mapExists, publishStagedMap } from "./repository.js";
import { createMapId } from "./utils.js";
import {
  MAX_STREAM_IMPORT_BYTES,
  MAX_STREAM_IMPORT_CELLS,
  MAX_IMPORT_RECORD_BYTES
} from "./resource-limits.js";

export interface ImportFileControl {
  stagingPrefix?: string;
  generateNewId?: boolean;
  progress?: (stage: string) => void;
  checkCancelled?: () => void;
  beforeCommit?: () => void;
}

export async function removeImportStage(filePath: string): Promise<void> {
  for (const suffix of [
    ".stage.sqlite",
    ".stage.sqlite-journal",
    ".stage.sqlite-wal",
    ".stage.sqlite-shm"
  ])
    await fs.rm(filePath + suffix, { force: true });
}

/** The parser retains only one record; uniqueness and junction checks live in staging SQLite. */
export async function importMapFile(filePath: string, control: ImportFileControl = {}) {
  const size = (await fs.stat(filePath)).size;
  if (size > MAX_STREAM_IMPORT_BYTES) throw badRequest("导入文件超过 2 GiB 限制");
  const stagePrefix = control.stagingPrefix ?? filePath;
  const stagePath = stagePrefix + ".stage.sqlite";
  await (await fs.open(stagePath, "wx")).close();
  const db = new Database(stagePath);
  let count = 0,
    riverCount = 0,
    riverSamples = 0,
    bytes = 0,
    boundary = 0,
    depth = 0;
  let document: MapDocument | undefined;
  const warnings: ValidationIssue[] = [];
  let warningCount = 0;
  const bounds: MapBounds = { min_row: null, max_row: null, min_col: null, max_col: null };
  const check = () => control.checkCancelled?.();
  const validate = (issues: ValidationIssue[]) => {
    const error = issues.find((i) => i.severity === "invalid");
    if (error) throw badRequest(`${error.target ?? "地图"}: ${error.message}`);
    warningCount += issues.length;
    for (const warning of issues) if (warnings.length < 100) warnings.push(warning);
  };
  try {
    db.pragma("journal_mode = DELETE");
    db.pragma("cache_size = -8192");
    db.exec(`
      CREATE TABLE cells (row INTEGER, col INTEGER, terrain TEXT, biome TEXT, tags_json TEXT, note TEXT, PRIMARY KEY(row,col)) WITHOUT ROWID;
      CREATE TABLE features (feature_id TEXT PRIMARY KEY, json TEXT, bounds_min_row INTEGER, bounds_max_row INTEGER, bounds_min_col INTEGER, bounds_max_col INTEGER);
      CREATE TABLE junctions (id TEXT PRIMARY KEY, row INTEGER, col INTEGER);
      BEGIN;
    `);
    const cellInsert = db.prepare("INSERT INTO cells VALUES (?, ?, ?, ?, ?, ?)");
    const riverInsert = db.prepare("INSERT INTO features VALUES (?, ?, ?, ?, ?, ?)");
    const junctionInsert = db.prepare("INSERT OR IGNORE INTO junctions VALUES (?, ?, ?)");
    const junctionRead = db.prepare("SELECT row, col FROM junctions WHERE id = ?");
    const parser = new JSONParser({ emitPartialTokens: true, stringBufferSize: 64 * 1024 });
    const rootKeys = new Set<string>();
    let sawRivers = false;
    parser.onToken = ({ token, value, offset, partial }) => {
      if (typeof value === "string" && value.length > MAX_IMPORT_RECORD_BYTES)
        throw badRequest("单个文本或地图记录超过 8 MiB");
      if (partial) return;
      if (offset - boundary > MAX_IMPORT_RECORD_BYTES) throw badRequest("单个地图记录超过 8 MiB");
      if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) depth++;
      if (depth > 32) throw badRequest("JSON 嵌套层数过多");
      if (token === TokenType.RIGHT_BRACE || token === TokenType.RIGHT_BRACKET) depth--;
    };
    parser.onValue = ({ value, key, parent, stack }) => {
      const isCell = stack.length === 2 && stack[1]?.key === "cells";
      const isRiver =
        stack.length === 3 && stack[1]?.key === "features" && stack[2]?.key === "rivers";
      if (isCell) {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw badRequest(`cells[${count}]: 单元格必须是对象`);
        if (++count > MAX_STREAM_IMPORT_CELLS) throw badRequest("导入上限为 2500 万格");
        const cell = value as unknown as DesignedCellRecord;
        validate(validateDesignedCellRecord(cell, count - 1));
        try {
          cellInsert.run(
            cell.row,
            cell.col,
            cell.terrain,
            cell.biome,
            JSON.stringify([...new Set(cell.tags)].sort()),
            cell.note
          );
        } catch (error) {
          if ((error as { code?: string }).code?.startsWith("SQLITE_CONSTRAINT"))
            throw badRequest(`cells[${count - 1}]: 重复坐标 R${cell.row}C${cell.col}`);
          throw error;
        }
        bounds.min_row = Math.min(bounds.min_row ?? cell.row, cell.row);
        bounds.max_row = Math.max(bounds.max_row ?? cell.row, cell.row);
        bounds.min_col = Math.min(bounds.min_col ?? cell.col, cell.col);
        bounds.max_col = Math.max(bounds.max_col ?? cell.col, cell.col);
        if (count % 2000 === 0) {
          check();
          db.exec("COMMIT; BEGIN");
        }
      } else if (isRiver) {
        const river = value as unknown as RiverFeature;
        if (++riverCount > 20_000) throw badRequest("导入上限为 2 万条河流");
        validate(validateRiverFeature(river, riverCount - 1));
        const b = { minRow: Infinity, maxRow: -Infinity, minCol: Infinity, maxCol: -Infinity };
        for (let i = 0; i < river.points.length; i++) {
          const p = river.points[i]!,
            previous = river.points[i - 1];
          b.minRow = Math.min(b.minRow, p.row);
          b.maxRow = Math.max(b.maxRow, p.row);
          b.minCol = Math.min(b.minCol, p.col);
          b.maxCol = Math.max(b.maxCol, p.col);
          if (previous)
            riverSamples +=
              Math.max(
                Math.abs(p.row - previous.row),
                Math.abs(p.col - previous.col),
                Math.abs(p.row + p.col - previous.row - previous.col)
              ) + 1;
          if (p.junction_id) {
            junctionInsert.run(p.junction_id, p.row, p.col);
            const prior = junctionRead.get(p.junction_id) as { row: number; col: number };
            if (prior.row !== p.row || prior.col !== p.col)
              throw badRequest(`交汇 ${p.junction_id} 的节点坐标不一致`);
          }
        }
        if (riverSamples > 500_000) throw badRequest("河流路径总长度超出 50 万格");
        try {
          riverInsert.run(
            river.id,
            JSON.stringify(normalizeStoredRiver(river)),
            b.minRow,
            b.maxRow,
            b.minCol,
            b.maxCol
          );
        } catch (error) {
          if ((error as { code?: string }).code?.startsWith("SQLITE_CONSTRAINT"))
            throw badRequest(`重复河流标识 ${river.id}`);
          throw error;
        }
      }
      if (isCell || isRiver) {
        // The parser's member counter tracks the original index independently of this array.
        (parent as unknown[]).length = 0;
        boundary = bytes;
      } else if (stack.length === 1) {
        if (rootKeys.has(String(key))) throw badRequest(`重复的根字段 ${String(key)}`);
        rootKeys.add(String(key));
        boundary = bytes;
      } else if (stack.length === 2 && stack[1]?.key === "features" && key === "rivers") {
        if (sawRivers) throw badRequest("重复的 rivers 字段");
        sawRivers = true;
        boundary = bytes;
      } else if (stack.length === 0) document = value as unknown as MapDocument;
    };
    let lastProgress = 0;
    for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
      check();
      bytes += chunk.length;
      if (bytes > MAX_STREAM_IMPORT_BYTES) throw badRequest("导入文件超过 2 GiB 限制");
      parser.write(chunk);
      if (bytes - boundary > MAX_IMPORT_RECORD_BYTES) throw badRequest("单个地图记录超过 8 MiB");
      if (Date.now() - lastProgress > 200) {
        control.progress?.(
          `正在校验与写入 · ${count.toLocaleString("zh-CN")} 格 · ${Math.floor((bytes / Math.max(1, size)) * 100)}%`
        );
        lastProgress = Date.now();
      }
    }
    if (!parser.isEnded) parser.end();
    validate(validateMapDocument(document));
    const meta = document!.meta;
    if (
      typeof meta.name !== "string" ||
      typeof meta.id !== "string" ||
      (meta.description !== undefined && typeof meta.description !== "string") ||
      (meta.tags !== undefined &&
        (!Array.isArray(meta.tags) || meta.tags.some((t) => typeof t !== "string"))) ||
      typeof meta.created_at !== "string" ||
      typeof meta.updated_at !== "string"
    )
      throw badRequest("地图名称、标识、时间、描述或标签格式无效");
    document = normalizeDocument(document!);
    assertSafeMapId(document.meta.id);
    if (await mapExists(document.meta.id)) {
      if (!control.generateNewId) throw badRequest(`meta.id conflict for ${document.meta.id}`);
      const now = new Date().toISOString();
      document.meta = {
        ...document.meta,
        id: assertSafeMapId(createMapId(document.meta.name)),
        created_at: now,
        updated_at: now,
        revision: 1
      };
    }
    check();
    db.exec("COMMIT");
    db.close();
    control.progress?.(`正在提交地图 · ${count.toLocaleString("zh-CN")} 格`);
    publishStagedMap(document, stagePath, count, bounds, control.beforeCommit);
    return { summary: await getMapSummary(document.meta.id), warnings, warningCount };
  } finally {
    if (db.open) db.close();
    await removeImportStage(stagePrefix);
  }
}
