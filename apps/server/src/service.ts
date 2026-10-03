import {
  createCellId,
  createDisplayCoord,
  createRuntimeState,
  findRiversAtCell,
  getNeighborCoords,
  parseDocument,
  type ActiveCell,
  type AreaInspectionResult,
  type CellInspectionResult,
  type CellRange,
  type CellRangeResult,
  type ExportRenderOptions,
  type GridCoordinate,
  type MapCommand,
  type MapDocument,
  type MapFeaturePage,
  type MapRuntimeState,
  type MapSummary,
  type NeighborInspectionResult,
  type ValidationIssue
} from "@mapdesigner/map-core";
import { buildExportScene, buildMapScene, renderSvgString } from "@mapdesigner/map-render";
import fs from "node:fs/promises";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { MAX_IMPORT_BYTES, assertImportBudget, assertPixelBudget } from "./resource-limits.js";
import { executeCommands, moveHistory } from "./command-executor.js";
import type {
  ApplyCommandsOptions,
  ApplyCommandsResult,
  HistoryMoveResult,
  LightweightApplyCommandsResult,
  LightweightHistoryMoveResult
} from "./command-types.js";
import { EXPORT_STORAGE_DIR, MAP_STORAGE_DIR } from "./config.js";
import { badRequest, revisionConflict, storageError } from "./errors.js";
import {
  createMapDocument,
  deleteMapDocument,
  getMapDocument,
  getMapSummarySync,
  getCellsInRange as getRepositoryCellsInRange,
  getHistoryStatus as getRepositoryHistoryStatus,
  getMapFeatures as getRepositoryMapFeatures,
  getMapFeaturesInRange as getRepositoryMapFeaturesInRange,
  getMapHistory as getRepositoryMapHistory,
  getMapSummary as getRepositoryMapSummary,
  importMapDocument,
  listMapRows,
  mapExists,
  saveMapDocument,
  saveMapDocumentSync,
  updateMapMetadataSync,
  withMapTransaction,
  writeMapDocumentJsonExport,
  type FeaturePageOptions,
  type HistoryStatus,
  type MapHistory,
  type MapListItem
} from "./repository.js";
import {
  assertSafeMapId,
  exportFilePath,
  MAX_INSPECT_AREA_RADIUS,
  normalizeExportOptions,
  validateDocumentForWrite,
  writeFileAtomic
} from "./storage.js";
import { createMapId, slugify } from "./utils.js";

const PNG_EXPORT_TIMEOUT_SECONDS = 20;
const MAX_WHOLE_MAP_PNG_EXPORT_CELLS = 10_000;

export type { MapListItem } from "./repository.js";
export { searchMapFeatures } from "./repository.js";

export interface SaveMapInput {
  document: MapDocument;
  expectedRevision: number;
}

export interface SaveMapAsInput {
  document?: MapDocument;
  sourceId?: string;
  name: string;
  id?: string;
}

export interface UpdateMapMetadataInput {
  id: string;
  expectedRevision: number;
  name?: string;
  description?: string;
  tags?: string[];
}

export type {
  ApplyChangeStats,
  ApplyCommandsOptions,
  ApplyCommandsResult,
  ApplyValueSummary,
  CommandExecutionReport,
  HistoryMoveResult,
  LightweightApplyCommandsResult,
  LightweightHistoryMoveResult
} from "./command-types.js";

async function ensureDirectories(): Promise<void> {
  try {
    await fs.mkdir(MAP_STORAGE_DIR, { recursive: true });
    await fs.mkdir(EXPORT_STORAGE_DIR, { recursive: true });
  } catch (error) {
    throw storageError("failed to prepare storage directories", error);
  }
}

const exportPath = (fileName: string) => exportFilePath(EXPORT_STORAGE_DIR, fileName);

function runtimeFromDocument(document: MapDocument): MapRuntimeState {
  return createRuntimeState(document);
}

function designedRecordFromActiveCell(cell: ActiveCell): MapDocument["cells"][number] | null {
  if (cell.status !== "designed" || !cell.terrain) {
    return null;
  }
  return {
    row: cell.row,
    col: cell.col,
    terrain: cell.terrain,
    biome: cell.biome,
    tags: [...cell.tags],
    note: cell.note
  };
}

function exportRangeFileSuffix(range: CellRange | null | undefined): string {
  return range ? `-r${range.minRow}_${range.maxRow}-c${range.minCol}_${range.maxCol}` : "";
}

async function buildRangeRuntime(id: string, range: CellRange): Promise<MapRuntimeState> {
  const [summary, firstPage, rangeResult] = await Promise.all([
    getMapSummary(id),
    getMapFeaturesInRange(id, range),
    getCellsInRange(id, range, { includeUndesigned: true })
  ]);
  const features = { rivers: [...firstPage.rivers] };
  let page = firstPage;
  while (page.page.has_more) {
    page = await getMapFeaturesInRange(id, range, {
      offset: page.page.offset + page.page.returned,
      limit: 1000
    });
    features.rivers.push(...page.rivers);
  }
  const document: MapDocument = {
    schema_version: 1,
    meta: summary.meta,
    grid: summary.grid,
    cells: rangeResult.cells
      .map(designedRecordFromActiveCell)
      .filter((cell): cell is MapDocument["cells"][number] => cell !== null),
    features
  };
  return {
    document,
    activeCells: rangeResult.cells,
    history: {
      past: [],
      future: [],
      limit: 0
    }
  };
}

export function summaryFromRuntime(map: MapRuntimeState): MapSummary {
  const rows = map.document.cells.map((cell) => cell.row);
  const cols = map.document.cells.map((cell) => cell.col);
  return {
    meta: map.document.meta,
    grid: map.document.grid,
    bounds:
      map.document.cells.length === 0
        ? { min_row: null, max_row: null, min_col: null, max_col: null }
        : {
            min_row: Math.min(...rows),
            max_row: Math.max(...rows),
            min_col: Math.min(...cols),
            max_col: Math.max(...cols)
          },
    designed_cell_count: map.document.cells.length,
    feature_counts: {
      rivers: map.document.features.rivers.length
    }
  };
}

function cloneActiveCell(cell: MapRuntimeState["activeCells"][number]) {
  return {
    ...cell,
    tags: [...cell.tags]
  };
}

function undesignedCell(target: GridCoordinate): ActiveCell {
  return {
    row: target.row,
    col: target.col,
    id: createCellId(target.row, target.col),
    display_coord: createDisplayCoord(target.row, target.col),
    status: "undesigned",
    terrain: null,
    biome: null,
    tags: [],
    note: "",
    is_seed: false
  };
}

function getCellFromRange(cellsById: Map<string, ActiveCell>, target: GridCoordinate): ActiveCell {
  const found = cellsById.get(createCellId(target.row, target.col));
  return found ? cloneActiveCell(found) : undesignedCell(target);
}

function hexDistance(left: GridCoordinate, right: GridCoordinate): number {
  const rowDelta = left.row - right.row;
  const colDelta = left.col - right.col;
  return (Math.abs(rowDelta) + Math.abs(colDelta) + Math.abs(rowDelta + colDelta)) / 2;
}

function compareCoords(left: GridCoordinate, right: GridCoordinate): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }
  return left.col - right.col;
}

async function getRangeCellsById(id: string, range: CellRange): Promise<Map<string, ActiveCell>> {
  const result = await getCellsInRange(id, range, { includeUndesigned: true });
  return new Map(result.cells.map((cell) => [cell.id, cell]));
}

async function buildAreaCellsFromRange(
  id: string,
  center: GridCoordinate,
  radius: number
): Promise<ActiveCell[]> {
  const cellsById = await getRangeCellsById(id, {
    minRow: center.row - radius,
    maxRow: center.row + radius,
    minCol: center.col - radius,
    maxCol: center.col + radius
  });
  const cells = [];
  for (let row = center.row - radius; row <= center.row + radius; row += 1) {
    for (let col = center.col - radius; col <= center.col + radius; col += 1) {
      const target = { row, col };
      if (hexDistance(center, target) <= radius) {
        cells.push(getCellFromRange(cellsById, target));
      }
    }
  }
  return cells.sort((left, right) => compareCoords(left, right));
}

export async function listMaps(): Promise<MapListItem[]> {
  await ensureDirectories();
  return listMapRows();
}

export async function createMap(input: {
  name: string;
  description?: string;
  id?: string;
}): Promise<MapRuntimeState> {
  await ensureDirectories();
  const document = await createMapDocument(input);
  validateDocumentForWrite(document);
  return runtimeFromDocument(document);
}

export async function getMap(id: string): Promise<MapRuntimeState> {
  const document = await getMapDocument(assertSafeMapId(id));
  return runtimeFromDocument(document);
}

export async function saveMap(input: SaveMapInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const normalizedId = assertSafeMapId(input.document.meta.id);
  validateDocumentForWrite(input.document);
  return withMapTransaction(normalizedId, () => {
    const current = getMapSummarySync(normalizedId);
    if (current.meta.revision !== input.expectedRevision) {
      throw revisionConflict(
        "revision conflict: expected " +
          input.expectedRevision +
          ", current is " +
          current.meta.revision
      );
    }
    const document = saveMapDocumentSync({
      ...input.document,
      meta: {
        ...input.document.meta,
        revision: current.meta.revision + 1,
        updated_at: new Date().toISOString()
      }
    });
    return runtimeFromDocument(document);
  });
}

export async function saveMapAs(input: SaveMapAsInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const now = new Date().toISOString();
  const nextId = assertSafeMapId(input.id ?? createMapId(input.name));
  if (await mapExists(nextId)) {
    throw badRequest(`map id ${nextId} already exists`);
  }
  const sourceDocument =
    input.document ??
    (input.sourceId ? await getMapDocument(assertSafeMapId(input.sourceId)) : null);
  if (!sourceDocument) {
    throw badRequest("document or sourceId is required");
  }

  const document: MapDocument = {
    ...sourceDocument,
    meta: {
      ...sourceDocument.meta,
      id: nextId,
      name: input.name,
      created_at: now,
      updated_at: now,
      revision: 1
    }
  };

  validateDocumentForWrite(document);
  return runtimeFromDocument(await saveMapDocument(document));
}

export async function updateMapMeta(input: UpdateMapMetadataInput): Promise<MapSummary> {
  await ensureDirectories();
  const normalizedId = assertSafeMapId(input.id);
  return withMapTransaction(normalizedId, () => {
    const current = getMapSummarySync(normalizedId);
    if (current.meta.revision !== input.expectedRevision) {
      throw revisionConflict(
        "revision conflict: expected " +
          input.expectedRevision +
          ", current is " +
          current.meta.revision
      );
    }
    if (input.name !== undefined && !input.name.trim())
      throw badRequest("name must be a non-empty string");
    return updateMapMetadataSync(normalizedId, {
      name: input.name?.trim(),
      description: input.description,
      tags: input.tags
    });
  });
}

export async function deleteMap(id: string): Promise<void> {
  const normalizedId = assertSafeMapId(id);
  await deleteMapDocument(normalizedId);
}

export async function duplicateMap(id: string): Promise<MapRuntimeState> {
  const existing = await getMapDocument(assertSafeMapId(id));
  const now = new Date().toISOString();
  const duplicateId = assertSafeMapId(createMapId(existing.meta.name));
  const document: MapDocument = {
    ...existing,
    meta: {
      ...existing.meta,
      id: duplicateId,
      name: `${existing.meta.name} Copy`,
      created_at: now,
      updated_at: now,
      revision: 1
    }
  };
  validateDocumentForWrite(document);
  return runtimeFromDocument(await saveMapDocument(document));
}

export async function importMap(input: {
  content: string;
  generateNewId?: boolean;
  includeMap?: boolean;
  progress?: (stage: string) => void;
  beforeCommit?: () => void;
}): Promise<{ map?: MapRuntimeState; summary: MapSummary; warnings: ValidationIssue[] }> {
  await ensureDirectories();
  if (Buffer.byteLength(input.content) > MAX_IMPORT_BYTES)
    throw badRequest("导入文件超过 64 MiB 限制");
  input.progress?.("正在校验地图");
  const parsed = parseDocument(input.content);
  if (!parsed.document) {
    throw badRequest(parsed.errors.map((entry) => entry.message).join("; "));
  }
  let document = parsed.document;
  assertImportBudget(document);
  const hasConflict = await mapExists(document.meta.id);
  if (hasConflict && !input.generateNewId) {
    throw badRequest(`meta.id conflict for ${document.meta.id}`);
  }
  if (hasConflict) {
    const now = new Date().toISOString();
    document = {
      ...document,
      meta: {
        ...document.meta,
        id: assertSafeMapId(createMapId(document.meta.name)),
        created_at: now,
        updated_at: now,
        revision: 1
      }
    };
  }
  validateDocumentForWrite(document);
  input.progress?.("正在写入地图");
  document = await importMapDocument(document, input.beforeCommit);
  const summary = await getMapSummary(document.meta.id);
  return {
    ...(input.includeMap === false ? {} : { map: runtimeFromDocument(document) }),
    summary,
    warnings: parsed.errors.filter((entry) => entry.severity === "warning")
  };
}

export async function exportJson(id: string): Promise<{ fileName: string; path: string }> {
  await ensureDirectories();
  const normalizedId = assertSafeMapId(id);
  const summary = await getMapSummary(normalizedId);
  const fileName = `${slugify(summary.meta.name) || normalizedId}-${randomUUID()}.json`;
  const filePath = exportPath(fileName);
  await writeMapDocumentJsonExport(normalizedId, filePath);
  return { fileName, path: filePath };
}

export async function exportPng(
  id: string,
  options: Partial<ExportRenderOptions> = {}
): Promise<{ fileName: string; path: string }> {
  await ensureDirectories();
  const baseOptions: ExportRenderOptions = {
    preset: "clean",
    includeCoordinates: false,
    includeShorthand: false,
    includeGrid: true,
    includeUndesigned: false,
    background: "#F4F0E6",
    padding: 32,
    scale: 2,
    range: null
  };
  const resolved: ExportRenderOptions = { ...baseOptions, ...normalizeExportOptions(options) };
  if (resolved.preset === "reference") {
    resolved.includeCoordinates = true;
    resolved.includeShorthand = true;
  }
  const normalizedId = assertSafeMapId(id);
  const summary = await getMapSummary(normalizedId);
  if (!resolved.range && summary.designed_cell_count > MAX_WHOLE_MAP_PNG_EXPORT_CELLS) {
    throw badRequest(
      `whole-map PNG export is limited to ${MAX_WHOLE_MAP_PNG_EXPORT_CELLS} designed cells; use a range for large maps`
    );
  }
  const runtime = resolved.range
    ? await buildRangeRuntime(normalizedId, resolved.range)
    : await getMap(normalizedId);
  const scene = buildExportScene({
    map: runtime,
    options: resolved
  });
  assertPixelBudget(scene.width, scene.height);
  const svg = renderSvgString(scene);
  const fileName = `${slugify(summary.meta.name) || normalizedId}-${resolved.preset}${exportRangeFileSuffix(resolved.range)}-${randomUUID()}.png`;
  const filePath = exportPath(fileName);
  const temporary = filePath + ".tmp";
  try {
    await sharp(Buffer.from(svg), { limitInputPixels: 40_000_000 })
      .timeout({ seconds: PNG_EXPORT_TIMEOUT_SECONDS })
      .png()
      .toFile(temporary);
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { fileName, path: filePath };
}

export async function applyCommands(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<ApplyCommandsResult> {
  const result = await executeCommands(id, commands, options, true);
  return { ...result, map: result.map! };
}

export async function applyCommandsLight(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<LightweightApplyCommandsResult> {
  return executeCommands(id, commands, options);
}

export async function getHistoryStatus(id: string): Promise<HistoryStatus> {
  return getRepositoryHistoryStatus(assertSafeMapId(id));
}

export async function getMapHistory(id: string, limit?: number): Promise<MapHistory> {
  return getRepositoryMapHistory(assertSafeMapId(id), limit);
}

export async function undoMap(id: string): Promise<HistoryMoveResult | null> {
  const result = await moveHistory(id, "undo", true);
  return result ? { ...result, map: result.map! } : null;
}

export async function undoMapLight(id: string): Promise<LightweightHistoryMoveResult | null> {
  return moveHistory(id, "undo");
}

export async function redoMap(id: string): Promise<HistoryMoveResult | null> {
  const result = await moveHistory(id, "redo", true);
  return result ? { ...result, map: result.map! } : null;
}

export async function redoMapLight(id: string): Promise<LightweightHistoryMoveResult | null> {
  return moveHistory(id, "redo");
}

export async function getMapSummary(id: string): Promise<MapSummary> {
  return getRepositoryMapSummary(assertSafeMapId(id));
}

export async function getMapFeatures(id: string) {
  return getRepositoryMapFeatures(assertSafeMapId(id));
}

export async function getMapFeaturesInRange(
  id: string,
  range: CellRange,
  options: FeaturePageOptions = {}
): Promise<MapFeaturePage> {
  return getRepositoryMapFeaturesInRange(assertSafeMapId(id), range, options);
}

export async function getCellsInRange(
  id: string,
  range: CellRange,
  options: { includeUndesigned?: boolean } = {}
): Promise<CellRangeResult> {
  return getRepositoryCellsInRange(assertSafeMapId(id), range, options);
}

export async function inspectCell(
  id: string,
  target: GridCoordinate
): Promise<CellInspectionResult> {
  const normalizedId = assertSafeMapId(id);
  const neighbors = getNeighborCoords(target);
  const cellsById = await getRangeCellsById(normalizedId, {
    minRow: Math.min(target.row, ...neighbors.map((coord) => coord.row)),
    maxRow: Math.max(target.row, ...neighbors.map((coord) => coord.row)),
    minCol: Math.min(target.col, ...neighbors.map((coord) => coord.col)),
    maxCol: Math.max(target.col, ...neighbors.map((coord) => coord.col))
  });
  const features = await getMapFeatures(normalizedId);
  return {
    cell: getCellFromRange(cellsById, target),
    neighbors: neighbors
      .map((coord) => getCellFromRange(cellsById, coord))
      .sort((left, right) => compareCoords(left, right)),
    rivers: findRiversAtCell(features.rivers, target).map((sample) => ({
      river_id: sample.river_id,
      river_name: sample.river_name,
      width: sample.width,
      path_index: sample.index
    }))
  };
}

export async function inspectArea(
  id: string,
  center: GridCoordinate,
  radius: number
): Promise<AreaInspectionResult> {
  if (!Number.isInteger(radius) || radius < 0) {
    throw badRequest("radius must be a non-negative integer");
  }
  if (radius > MAX_INSPECT_AREA_RADIUS) {
    throw badRequest(`radius must be less than or equal to ${MAX_INSPECT_AREA_RADIUS}`);
  }
  return {
    center: { row: center.row, col: center.col },
    radius,
    cells: await buildAreaCellsFromRange(assertSafeMapId(id), center, radius)
  };
}

export async function getNeighbors(
  id: string,
  center: GridCoordinate
): Promise<NeighborInspectionResult> {
  const normalizedId = assertSafeMapId(id);
  const neighbors = getNeighborCoords(center);
  const cellsById = await getRangeCellsById(normalizedId, {
    minRow: Math.min(center.row, ...neighbors.map((coord) => coord.row)),
    maxRow: Math.max(center.row, ...neighbors.map((coord) => coord.row)),
    minCol: Math.min(center.col, ...neighbors.map((coord) => coord.col)),
    maxCol: Math.max(center.col, ...neighbors.map((coord) => coord.col))
  });
  return {
    center: getCellFromRange(cellsById, center),
    neighbors: neighbors
      .map((coord) => getCellFromRange(cellsById, coord))
      .sort((left, right) => compareCoords(left, right))
  };
}

export async function renderInlineSvg(id: string): Promise<string> {
  const runtime = await getMap(assertSafeMapId(id));
  const scene = buildMapScene(runtime);
  return renderSvgString(scene);
}
