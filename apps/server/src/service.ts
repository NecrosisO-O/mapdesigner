import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  applyCommand,
  createCellId,
  createDisplayCoord,
  createEmptyDocument,
  createRuntimeState,
  getNeighborCoords,
  parseDocument,
  type AreaInspectionResult,
  type CellChangeDetail,
  type CellInspectionResult,
  stringifyDocument,
  type GridCoordinate,
  type ExportRenderOptions,
  type MapCommand,
  type MapDocument,
  type MapRuntimeState,
  type NeighborInspectionResult,
  type ValidationIssue
} from "@mapdesigner/map-core";
import { buildExportScene, buildMapScene, renderSvgString } from "@mapdesigner/map-render";
import { EXPORT_STORAGE_DIR, MAP_STORAGE_DIR } from "./config.js";
import { badRequest, notFound, revisionConflict, storageError } from "./errors.js";
import {
  assertSafeMapId,
  exportFilePath,
  mapFilePath,
  MAX_INSPECT_AREA_RADIUS,
  normalizeExportOptions,
  validateDocumentForWrite,
  writeFileAtomic
} from "./storage.js";
import { createMapId, slugify } from "./utils.js";

export interface MapListItem {
  id: string;
  name: string;
  fileName: string;
  updatedAt: string;
  revision: number;
  designedCellCount: number;
}

export interface SaveMapInput {
  document: MapDocument;
  expectedRevision: number;
}

export interface SaveMapAsInput {
  document: MapDocument;
  name: string;
  id?: string;
}

export interface ApplyCommandsOptions {
  dryRun?: boolean;
}

export interface ApplyValueSummary {
  before: Record<string, number>;
  after: Record<string, number>;
}

export interface ApplyChangeStats {
  command_count: number;
  changed_count: number;
  created_count: number;
  updated_count: number;
  cleared_count: number;
  terrain_summary: ApplyValueSummary;
  biome_summary: ApplyValueSummary;
}

export interface CommandExecutionReport {
  index: number;
  action: MapCommand["action"];
  changed: GridCoordinate[];
  details: CellChangeDetail[];
  warnings: ValidationIssue[];
}

export interface ApplyCommandsResult {
  map: MapRuntimeState;
  warnings: ValidationIssue[];
  dryRun: boolean;
  command_results: CommandExecutionReport[];
  changes: CellChangeDetail[];
  stats: ApplyChangeStats;
}

async function ensureDirectories(): Promise<void> {
  try {
    await fs.mkdir(MAP_STORAGE_DIR, { recursive: true });
    await fs.mkdir(EXPORT_STORAGE_DIR, { recursive: true });
  } catch (error) {
    throw storageError("failed to prepare storage directories", error);
  }
}

const mapPath = (id: string) => mapFilePath(MAP_STORAGE_DIR, id);
const exportPath = (fileName: string) => exportFilePath(EXPORT_STORAGE_DIR, fileName);

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getFileSystemErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return undefined;
}

function isMissingFileError(error: unknown): boolean {
  const code = getFileSystemErrorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

async function loadMapDocument(id: string): Promise<MapDocument> {
  await ensureDirectories();
  const normalizedId = assertSafeMapId(id);
  let raw: string;
  try {
    raw = await fs.readFile(mapPath(normalizedId), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw notFound(`map ${normalizedId} was not found`, error);
    }
    throw storageError(`failed to read map ${normalizedId}`, error);
  }
  const parsed = parseDocument(raw);
  if (!parsed.document) {
    throw badRequest(parsed.errors.map((entry) => entry.message).join("; "));
  }
  return parsed.document;
}

function runtimeFromDocument(document: MapDocument): MapRuntimeState {
  return createRuntimeState(document);
}

function cloneActiveCell(cell: MapRuntimeState["activeCells"][number]) {
  return {
    ...cell,
    tags: [...cell.tags]
  };
}

function getCellFromRuntime(runtime: MapRuntimeState, target: GridCoordinate) {
  const found = runtime.activeCells.find((cell) => cell.row === target.row && cell.col === target.col);
  if (found) {
    return cloneActiveCell(found);
  }
  return {
    row: target.row,
    col: target.col,
    id: createCellId(target.row, target.col),
    display_coord: createDisplayCoord(target.row, target.col),
    status: "undesigned" as const,
    terrain: null,
    biome: null,
    tags: [],
    note: "",
    is_seed: false
  };
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

function buildAreaCells(runtime: MapRuntimeState, center: GridCoordinate, radius: number) {
  const cells = [];
  for (let row = center.row - radius; row <= center.row + radius; row += 1) {
    for (let col = center.col - radius; col <= center.col + radius; col += 1) {
      const target = { row, col };
      if (hexDistance(center, target) <= radius) {
        cells.push(getCellFromRuntime(runtime, target));
      }
    }
  }
  return cells.sort((left, right) => compareCoords(left, right));
}

function incrementCount(bucket: Record<string, number>, key: string | null | undefined): void {
  if (!key) {
    return;
  }
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function buildApplyChangeStats(
  commands: MapCommand[],
  changes: CellChangeDetail[]
): ApplyChangeStats {
  const terrainSummary: ApplyValueSummary = { before: {}, after: {} };
  const biomeSummary: ApplyValueSummary = { before: {}, after: {} };
  let createdCount = 0;
  let updatedCount = 0;
  let clearedCount = 0;

  for (const change of changes) {
    const beforeDesigned = change.before?.status === "designed";
    const afterDesigned = change.after?.status === "designed";

    if (!beforeDesigned && afterDesigned) {
      createdCount += 1;
    } else if (beforeDesigned && !afterDesigned) {
      clearedCount += 1;
    } else if (beforeDesigned && afterDesigned) {
      updatedCount += 1;
    }

    incrementCount(terrainSummary.before, beforeDesigned ? change.before?.terrain : null);
    incrementCount(terrainSummary.after, afterDesigned ? change.after?.terrain : null);
    incrementCount(biomeSummary.before, beforeDesigned ? change.before?.biome : null);
    incrementCount(biomeSummary.after, afterDesigned ? change.after?.biome : null);
  }

  return {
    command_count: commands.length,
    changed_count: changes.length,
    created_count: createdCount,
    updated_count: updatedCount,
    cleared_count: clearedCount,
    terrain_summary: terrainSummary,
    biome_summary: biomeSummary
  };
}

export async function listMaps(): Promise<MapListItem[]> {
  await ensureDirectories();
  let files: string[];
  try {
    files = (await fs.readdir(MAP_STORAGE_DIR)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    throw storageError("failed to list maps", error);
  }
  const items = await Promise.all(
    files.map(async (fileName) => {
      let raw: string;
      try {
        raw = await fs.readFile(path.join(MAP_STORAGE_DIR, fileName), "utf8");
      } catch (error) {
        if (isMissingFileError(error)) {
          return null;
        }
        throw storageError(`failed to read map file ${fileName}`, error);
      }
      const parsed = parseDocument(raw);
      if (!parsed.document) {
        return null;
      }
      return {
        id: parsed.document.meta.id,
        name: parsed.document.meta.name,
        fileName,
        updatedAt: parsed.document.meta.updated_at,
        revision: parsed.document.meta.revision,
        designedCellCount: parsed.document.cells.length
      } satisfies MapListItem;
    })
  );
  return items.filter((item): item is MapListItem => item !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createMap(input: {
  name: string;
  description?: string;
  id?: string;
}): Promise<MapRuntimeState> {
  await ensureDirectories();
  const id = assertSafeMapId(input.id ?? createMapId(input.name));
  const filePath = mapPath(id);
  if (await fileExists(filePath)) {
    throw badRequest(`map id ${id} already exists`);
  }
  const document = createEmptyDocument({
    id,
    name: input.name,
    description: input.description ?? ""
  });
  validateDocumentForWrite(document);
  await writeFileAtomic(filePath, stringifyDocument(document));
  return runtimeFromDocument(document);
}

export async function getMap(id: string): Promise<MapRuntimeState> {
  const document = await loadMapDocument(assertSafeMapId(id));
  return runtimeFromDocument(document);
}

export async function saveMap(input: SaveMapInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const normalizedId = assertSafeMapId(input.document.meta.id);
  validateDocumentForWrite(input.document);
  const current = await loadMapDocument(normalizedId);
  if (current.meta.revision !== input.expectedRevision) {
    throw revisionConflict(
      `revision conflict: expected ${input.expectedRevision}, current is ${current.meta.revision}`
    );
  }
  await writeFileAtomic(mapPath(normalizedId), stringifyDocument(input.document));
  return runtimeFromDocument(input.document);
}

export async function saveMapAs(input: SaveMapAsInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const now = new Date().toISOString();
  const nextId = assertSafeMapId(input.id ?? createMapId(input.name));
  const nextPath = mapPath(nextId);
  if (await fileExists(nextPath)) {
    throw badRequest(`map id ${nextId} already exists`);
  }

  const document: MapDocument = {
    ...input.document,
    meta: {
      ...input.document.meta,
      id: nextId,
      name: input.name,
      created_at: now,
      updated_at: now,
      revision: 1
    }
  };

  validateDocumentForWrite(document);
  await writeFileAtomic(nextPath, stringifyDocument(document));
  return runtimeFromDocument(document);
}

export async function deleteMap(id: string): Promise<void> {
  const normalizedId = assertSafeMapId(id);
  try {
    await fs.unlink(mapPath(normalizedId));
  } catch (error) {
    if (isMissingFileError(error)) {
      throw notFound(`map ${normalizedId} was not found`, error);
    }
    throw storageError(`failed to delete map ${normalizedId}`, error);
  }
}

export async function duplicateMap(id: string): Promise<MapRuntimeState> {
  const existing = await loadMapDocument(assertSafeMapId(id));
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
  await writeFileAtomic(mapPath(duplicateId), stringifyDocument(document));
  return runtimeFromDocument(document);
}

export async function importMap(input: {
  content: string;
  generateNewId?: boolean;
}): Promise<{ map: MapRuntimeState; warnings: ValidationIssue[] }> {
  await ensureDirectories();
  const parsed = parseDocument(input.content);
  if (!parsed.document) {
    throw badRequest(parsed.errors.map((entry) => entry.message).join("; "));
  }
  let document = parsed.document;
  const currentPath = mapPath(document.meta.id);
  if ((await fileExists(currentPath)) && !input.generateNewId) {
    throw badRequest(`meta.id conflict for ${document.meta.id}`);
  }
  if (await fileExists(currentPath)) {
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
  await writeFileAtomic(mapPath(document.meta.id), stringifyDocument(document));
  return {
    map: runtimeFromDocument(document),
    warnings: parsed.errors.filter((entry) => entry.severity === "warning")
  };
}

export async function exportJson(id: string): Promise<{ fileName: string; path: string }> {
  const document = await loadMapDocument(assertSafeMapId(id));
  const fileName = `${slugify(document.meta.name) || assertSafeMapId(document.meta.id)}.json`;
  const filePath = exportPath(fileName);
  await writeFileAtomic(filePath, stringifyDocument(document));
  return { fileName, path: filePath };
}

export async function exportPng(
  id: string,
  options: Partial<ExportRenderOptions> = {}
): Promise<{ fileName: string; path: string }> {
  const runtime = await getMap(assertSafeMapId(id));
  const baseOptions: ExportRenderOptions = {
    preset: "clean",
    includeCoordinates: false,
    includeShorthand: false,
    includeGrid: true,
    includeUndesigned: false,
    background: "#F4F0E6",
    padding: 32,
    scale: 2
  };
  const resolved: ExportRenderOptions = { ...baseOptions, ...normalizeExportOptions(options) };
  if (resolved.preset === "reference") {
    resolved.includeCoordinates = true;
    resolved.includeShorthand = true;
  }
  const scene = buildExportScene({
    map: runtime,
    options: resolved
  });
  const svg = renderSvgString(scene);
  const fileName = `${slugify(runtime.document.meta.name) || assertSafeMapId(runtime.document.meta.id)}-${resolved.preset}.png`;
  const filePath = exportPath(fileName);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFileAtomic(filePath, png);
  return { fileName, path: filePath };
}

export async function applyCommands(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<ApplyCommandsResult> {
  const normalizedId = assertSafeMapId(id);
  const document = await loadMapDocument(normalizedId);
  let state = createRuntimeState(document);
  const warnings: ValidationIssue[] = [];
  const commandResults: CommandExecutionReport[] = [];
  const changes: CellChangeDetail[] = [];

  for (const [index, command] of commands.entries()) {
    const result = applyCommand(state, command);
    if (!result.ok) {
      throw badRequest(result.errors.map((entry) => entry.message).join("; "), result.errors);
    }
    warnings.push(...result.warnings);
    commandResults.push({
      index,
      action: command.action,
      changed: result.changed.map((coord) => ({ row: coord.row, col: coord.col })),
      details: result.details.map((detail) => ({
        ...detail,
        coord: { row: detail.coord.row, col: detail.coord.col },
        before: detail.before ? cloneActiveCell(detail.before) : null,
        after: detail.after ? cloneActiveCell(detail.after) : null
      })),
      warnings: result.warnings
    });
    changes.push(
      ...result.details.map((detail) => ({
        ...detail,
        coord: { row: detail.coord.row, col: detail.coord.col },
        before: detail.before ? cloneActiveCell(detail.before) : null,
        after: detail.after ? cloneActiveCell(detail.after) : null
      }))
    );
    state = result.map;
  }

  if (!options.dryRun) {
    validateDocumentForWrite(state.document);
    await writeFileAtomic(mapPath(normalizedId), stringifyDocument(state.document));
  }
  return {
    map: state,
    warnings,
    dryRun: options.dryRun ?? false,
    command_results: commandResults,
    changes,
    stats: buildApplyChangeStats(commands, changes)
  };
}

export async function inspectCell(id: string, target: GridCoordinate): Promise<CellInspectionResult> {
  const runtime = await getMap(assertSafeMapId(id));
  return {
    cell: getCellFromRuntime(runtime, target),
    neighbors: getNeighborCoords(target)
      .map((coord) => getCellFromRuntime(runtime, coord))
      .sort((left, right) => compareCoords(left, right))
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
  const runtime = await getMap(assertSafeMapId(id));
  return {
    center: { row: center.row, col: center.col },
    radius,
    cells: buildAreaCells(runtime, center, radius)
  };
}

export async function getNeighbors(id: string, center: GridCoordinate): Promise<NeighborInspectionResult> {
  const runtime = await getMap(assertSafeMapId(id));
  return {
    center: getCellFromRuntime(runtime, center),
    neighbors: getNeighborCoords(center)
      .map((coord) => getCellFromRuntime(runtime, coord))
      .sort((left, right) => compareCoords(left, right))
  };
}

export async function renderInlineSvg(id: string): Promise<string> {
  const runtime = await getMap(assertSafeMapId(id));
  const scene = buildMapScene(runtime);
  return renderSvgString(scene);
}
