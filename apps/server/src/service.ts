import fs from "node:fs/promises";
import path from "node:path";
import {
  applyCommand,
  createCellId,
  createDisplayCoord,
  createEmptyDocument,
  createRuntimeState,
  getNeighborCoords,
  getNeighborCoordsForLayout,
  parseDocument,
  stringifyDocument,
  type ActiveCell,
  type AreaInspectionResult,
  type CellChangeDetail,
  type CellInspectionResult,
  type ExportRenderOptions,
  type GridCoordinate,
  type LayoutType,
  type MapCommand,
  type MapDocument,
  type MapRuntimeState,
  type NeighborInspectionResult,
  type ValidationIssue
} from "@mapdesigner/map-core";
import { buildExportScene, buildMapScene, renderSvgString } from "@mapdesigner/map-render";
import { EXPORT_STORAGE_DIR, MAP_STORAGE_DIR } from "./config.js";
import {
  buildDocumentFromDb,
  deleteCellDb,
  deleteMapDb,
  exportMapToFile,
  getCellCountDb,
  getCellDb,
  getCellsForExport,
  getMapDb,
  importJsonMap,
  insertMapDb,
  listMapsDb,
  mergeMapDb,
  queryCellsInRange,
  saveDocumentToDb,
  updateMapMetaDb,
  upsertCellDb,
  pushHistoryDb,
  undoDb,
  canUndoDb,
  type CellRange,
} from "./db.js";
import { createMapId, slugify } from "./utils.js";
import { importLegacyJsonFiles } from "./db.js";

// Expose the legacy import for server startup
export { importLegacyJsonFiles };

/** Maximum designed cells before getMap() returns empty activeCells. */
const LARGE_MAP_THRESHOLD = 500_000;

/* ============================================================
 *  Public types (unchanged from original)
 * ============================================================ */

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
}

/* ============================================================
 *  Helpers
 * ============================================================ */

function assertMapId(id: string): string {
  const normalized = id.trim();
  if (!normalized) throw new Error("map id is required");
  return normalized;
}

async function ensureDirectories(): Promise<void> {
  await fs.mkdir(MAP_STORAGE_DIR, { recursive: true });
  await fs.mkdir(EXPORT_STORAGE_DIR, { recursive: true });
}

function cloneActiveCell(cell: ActiveCell) {
  return { ...cell, tags: [...cell.tags] };
}

function hexDistance(left: GridCoordinate, right: GridCoordinate): number {
  const rowDelta = left.row - right.row;
  const colDelta = left.col - right.col;
  return (Math.abs(rowDelta) + Math.abs(colDelta) + Math.abs(rowDelta + colDelta)) / 2;
}

function manhattanDistance(left: GridCoordinate, right: GridCoordinate): number {
  return Math.abs(left.row - right.row) + Math.abs(left.col - right.col);
}

function compareCoords(left: GridCoordinate, right: GridCoordinate): number {
  if (left.row !== right.row) return left.row - right.row;
  return left.col - right.col;
}

function getActiveCellFromDb(mapId: string, target: GridCoordinate): ActiveCell {
  const row = getCellDb(mapId, target.row, target.col);
  if (row) {
    return {
      id: createCellId(target.row, target.col),
      display_coord: createDisplayCoord(target.row, target.col),
      row: target.row,
      col: target.col,
      status: "designed",
      terrain: row.terrain as ActiveCell["terrain"],
      biome: row.biome as ActiveCell["biome"],
      tags: JSON.parse(row.tags),
      note: row.note,
      is_seed: false
    };
  }
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

function buildAreaCellsFromDb(mapId: string, center: GridCoordinate, radius: number, layout?: LayoutType): ActiveCell[] {
  const distFn = layout === "square" ? manhattanDistance : hexDistance;
  const cells: ActiveCell[] = [];
  for (let row = center.row - radius; row <= center.row + radius; row += 1) {
    for (let col = center.col - radius; col <= center.col + radius; col += 1) {
      const target = { row, col };
      if (distFn(center, target) <= radius) {
        cells.push(getActiveCellFromDb(mapId, target));
      }
    }
  }
  return cells.sort(compareCoords);
}

/* ============================================================
 *  Map CRUD (SQLite-backed)
 * ============================================================ */

export async function listMaps(): Promise<MapListItem[]> {
  const rows = listMapsDb();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fileName: `${r.id}.json`,
    updatedAt: r.updated_at,
    revision: r.revision,
    designedCellCount: getCellCountDb(r.id)
  }));
}

export async function createMap(input: {
  name: string;
  description?: string;
  id?: string;
  layout?: LayoutType;
}): Promise<MapRuntimeState> {
  await ensureDirectories();
  const id = input.id ?? createMapId(input.name);
  if (getMapDb(id)) throw new Error(`map id ${id} already exists`);

  const doc = createEmptyDocument({
    id,
    name: input.name,
    description: input.description ?? "",
    layout: input.layout
  });
  saveDocumentToDb(doc);
  return createRuntimeState(doc);
}

export async function getMap(id: string): Promise<MapRuntimeState> {
  const doc = buildDocumentFromDb(assertMapId(id));
  if (!doc) throw new Error(`map ${id} not found`);

  const cellCount = doc.cells.length;
  if (cellCount > LARGE_MAP_THRESHOLD) {
    // Large map: return document data without full activeCells
    // WebUI should use range-query endpoints instead
    return {
      document: {
        ...doc,
        cells: [] // Don't send millions of cells to client
      },
      activeCells: [],
      history: { past: [], future: [], limit: 100 }
    };
  }
  return createRuntimeState(doc);
}

export async function saveMap(input: SaveMapInput): Promise<MapRuntimeState> {
  const id = assertMapId(input.document.meta.id);
  const current = getMapDb(id);
  if (!current) throw new Error(`map ${id} not found`);
  if (current.revision !== input.expectedRevision) {
    throw new Error(`revision conflict: expected ${input.expectedRevision}, current is ${current.revision}`);
  }
  saveDocumentToDb(input.document);

  // Also export to JSON file in storage/maps for backup
  const filePath = path.join(MAP_STORAGE_DIR, `${id}.json`);
  await fs.writeFile(filePath, stringifyDocument(input.document), "utf8");

  return createRuntimeState(input.document);
}

export async function saveMapAs(input: SaveMapAsInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const now = new Date().toISOString();
  const nextId = input.id ?? createMapId(input.name);
  if (getMapDb(nextId)) throw new Error(`map id ${nextId} already exists`);

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
  saveDocumentToDb(document);

  // Backup to JSON
  const filePath = path.join(MAP_STORAGE_DIR, `${nextId}.json`);
  await fs.writeFile(filePath, stringifyDocument(document), "utf8");

  return createRuntimeState(document);
}

export async function deleteMap(id: string): Promise<void> {
  // Delete from SQLite
  deleteMapDb(assertMapId(id));
  // Also remove the JSON backup file if present
  const jsonPath = path.join(MAP_STORAGE_DIR, `${assertMapId(id)}.json`);
  try {
    await fs.unlink(jsonPath);
  } catch {
    // ignore if not found
  }
}

export async function duplicateMap(id: string): Promise<MapRuntimeState> {
  const doc = buildDocumentFromDb(assertMapId(id));
  if (!doc) throw new Error(`map ${id} not found`);

  const now = new Date().toISOString();
  const duplicateId = createMapId(doc.meta.name);
  const document: MapDocument = {
    ...doc,
    meta: {
      ...doc.meta,
      id: duplicateId,
      name: `${doc.meta.name} Copy`,
      created_at: now,
      updated_at: now,
      revision: 1
    }
  };
  saveDocumentToDb(document);

  const filePath = path.join(MAP_STORAGE_DIR, `${duplicateId}.json`);
  await fs.writeFile(filePath, stringifyDocument(document), "utf8");

  return createRuntimeState(document);
}

/* ============================================================
 *  Map Merge
 * ============================================================ */

export async function mergeMap(
  targetId: string,
  sourceId: string,
  rowOffset: number,
  colOffset: number
): Promise<{ cellsAdded: number; cellsOverwritten: number }> {
  const target = getMapDb(targetId);
  if (!target) throw new Error(`target map ${targetId} not found`);
  const source = getMapDb(sourceId);
  if (!source) throw new Error(`source map ${sourceId} not found`);
  if (targetId === sourceId) throw new Error("cannot merge a map into itself");

  return mergeMapDb(targetId, sourceId, rowOffset, colOffset);
}

export async function importMap(input: {
  content: string;
  generateNewId?: boolean;
}): Promise<{ map: MapRuntimeState; warnings: ValidationIssue[] }> {
  const parsed = parseDocument(input.content);
  if (!parsed.document) {
    throw new Error(parsed.errors.map((entry) => entry.message).join("; "));
  }
  let document = parsed.document;

  // Check for conflict
  if (getMapDb(document.meta.id) && !input.generateNewId) {
    throw new Error(`meta.id conflict for ${document.meta.id}`);
  }
  if (getMapDb(document.meta.id)) {
    const now = new Date().toISOString();
    document = {
      ...document,
      meta: {
        ...document.meta,
        id: createMapId(document.meta.name),
        created_at: now,
        updated_at: now,
        revision: 1
      }
    };
  }

  saveDocumentToDb(document);

  // Backup to JSON
  const filePath = path.join(MAP_STORAGE_DIR, `${document.meta.id}.json`);
  await fs.writeFile(filePath, stringifyDocument(document), "utf8");

  return {
    map: createRuntimeState(document),
    warnings: parsed.errors.filter((entry) => entry.severity === "warning")
  };
}

/* ============================================================
 *  Export
 * ============================================================ */

export async function exportJson(id: string): Promise<{ fileName: string; path: string }> {
  return exportMapToFile(assertMapId(id));
}

export async function exportPng(
  id: string,
  options: Partial<ExportRenderOptions> = {}
): Promise<{ fileName: string; path: string }> {
  const doc = buildDocumentFromDb(assertMapId(id));
  if (!doc) throw new Error(`map ${id} not found`);

  const runtime = createRuntimeState(doc);
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
  const resolved = { ...baseOptions, ...options };
  if (resolved.preset === "reference") {
    resolved.includeCoordinates = true;
    resolved.includeShorthand = true;
  }

  const scene = buildExportScene({ map: runtime, options: resolved });
  const svg = renderSvgString(scene);
  const fileName = `${slugify(runtime.document.meta.name) || runtime.document.meta.id}-${resolved.preset}.png`;
  const filePath = path.join(EXPORT_STORAGE_DIR, fileName);

  const sharp = (await import("sharp")).default;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
  return { fileName, path: filePath };
}

/* ============================================================
 *  Command execution (for WebUI and CLI)
 * ============================================================ */

export async function applyCommands(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<ApplyCommandsResult> {
  const normalizedId = assertMapId(id);
  const doc = buildDocumentFromDb(normalizedId);
  if (!doc) throw new Error(`map ${normalizedId} not found`);

  let state = createRuntimeState(doc);
  const warnings: ValidationIssue[] = [];
  const commandResults: CommandExecutionReport[] = [];
  const changes: CellChangeDetail[] = [];

  for (const [index, command] of commands.entries()) {
    const result = applyCommand(state, command);
    if (!result.ok) {
      throw new Error(result.errors.map((entry) => entry.message).join("; "));
    }
    warnings.push(...result.warnings);
    commandResults.push({
      index,
      action: command.action,
      changed: result.changed.map((c) => ({ row: c.row, col: c.col })),
      details: result.details.map((d) => ({
        ...d,
        coord: { row: d.coord.row, col: d.coord.col },
        before: d.before ? cloneActiveCell(d.before) : null,
        after: d.after ? cloneActiveCell(d.after) : null
      })),
      warnings: result.warnings
    });
    changes.push(
      ...result.details.map((d) => ({
        ...d,
        coord: { row: d.coord.row, col: d.coord.col },
        before: d.before ? cloneActiveCell(d.before) : null,
        after: d.after ? cloneActiveCell(d.after) : null
      }))
    );
    state = result.map;
  }

  if (!options.dryRun) {
    saveDocumentToDb(state.document);
    // Backup to JSON
    const filePath = path.join(MAP_STORAGE_DIR, `${normalizedId}.json`);
    await fs.writeFile(filePath, stringifyDocument(state.document), "utf8");
  }

  return {
    map: state,
    warnings,
    dryRun: options.dryRun ?? false,
    command_results: commandResults,
    changes
  };
}

/** Execute a single command and persist to SQLite. */
export async function executeSingleCommand(
  id: string,
  command: MapCommand
): Promise<{ state: MapRuntimeState; changed: GridCoordinate[]; warnings: ValidationIssue[] }> {
  const doc = buildDocumentFromDb(assertMapId(id));
  if (!doc) throw new Error(`map ${id} not found`);

  let state = createRuntimeState(doc);
  const result = applyCommand(state, command);
  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  state = result.map;
  saveDocumentToDb(state.document);

  // Update revision and persist JSON backup
  const filePath = path.join(MAP_STORAGE_DIR, `${id}.json`);
  await fs.writeFile(filePath, stringifyDocument(state.document), "utf8");

  // Push history
  const changedPairs = result.details.map((d) => ({
    before: d.before
      ? { row: d.before.row, col: d.before.col, terrain: d.before.terrain!, biome: d.before.biome, tags: d.before.tags, note: d.before.note }
      : null,
    after: d.after
      ? { row: d.after.row, col: d.after.col, terrain: d.after.terrain!, biome: d.after.biome, tags: d.after.tags, note: d.after.note }
      : null
  }));
  pushHistoryDb(id, command.action, command.source ?? "webui", changedPairs);

  return {
    state,
    changed: result.changed,
    warnings: result.warnings
  };
}

/* ============================================================
 *  Range query (for virtual rendering)
 * ============================================================ */

export async function getCellsInRange(
  id: string,
  range: CellRange,
  options?: { includeUndesigned?: boolean }
): Promise<ActiveCell[]> {
  assertMapId(id);
  return queryCellsInRange(id, range, options);
}

/* ============================================================
 *  Undo / Redo
 * ============================================================ */

export async function undoMap(id: string): Promise<{ cellsChanged: number; label: string } | null> {
  const result = undoDb(assertMapId(id));
  if (!result) return null;
  return { cellsChanged: result.cellsBefore.length, label: result.label };
}

export async function canUndo(id: string): Promise<boolean> {
  return canUndoDb(assertMapId(id));
}

/* ============================================================
 *  Inspection (adapted for SQLite)
 * ============================================================ */

export async function inspectCell(id: string, target: GridCoordinate): Promise<CellInspectionResult> {
  const mapId = assertMapId(id);
  const mapRow = getMapDb(mapId);
  const layout: LayoutType = mapRow?.layout === "square" ? "square" : "flat-top-even-q";
  return {
    cell: getActiveCellFromDb(mapId, target),
    neighbors: getNeighborCoordsForLayout(target, layout)
      .map((coord) => getActiveCellFromDb(mapId, coord))
      .sort(compareCoords)
  };
}

export async function inspectArea(
  id: string,
  center: GridCoordinate,
  radius: number
): Promise<AreaInspectionResult> {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error("radius must be a non-negative integer");
  }
  const mapId = assertMapId(id);
  const mapRow = getMapDb(mapId);
  const layout: LayoutType = mapRow?.layout === "square" ? "square" : "flat-top-even-q";
  return {
    center: { row: center.row, col: center.col },
    radius,
    cells: buildAreaCellsFromDb(mapId, center, radius, layout)
  };
}

export async function getNeighbors(id: string, center: GridCoordinate): Promise<NeighborInspectionResult> {
  const mapId = assertMapId(id);
  const mapRow = getMapDb(mapId);
  const layout: LayoutType = mapRow?.layout === "square" ? "square" : "flat-top-even-q";
  return {
    center: getActiveCellFromDb(mapId, center),
    neighbors: getNeighborCoordsForLayout(center, layout)
      .map((coord) => getActiveCellFromDb(mapId, coord))
      .sort(compareCoords)
  };
}

export async function renderInlineSvg(id: string): Promise<string> {
  const doc = buildDocumentFromDb(assertMapId(id));
  if (!doc) throw new Error(`map ${id} not found`);
  const runtime = createRuntimeState(doc);
  const scene = buildMapScene(runtime);
  return renderSvgString(scene);
}
