import fs from "node:fs/promises";
import sharp from "sharp";
import {
  applyCommand,
  buildHexLine,
  createCellId,
  createDisplayCoord,
  createRuntimeState,
  findRiversAtCell,
  getNeighborCoords,
  parseDocument,
  isBiomeKey,
  isRiverId,
  isTagKey,
  isTerrainKey,
  sameCoord,
  validateCoordinate,
  validateRiverFeature,
  validateRiverPoint,
  validateTerrainBiomePair,
  type AreaInspectionResult,
  type ActiveCell,
  type CellRange,
  type CellRangeResult,
  type CellChangeDetail,
  type CellInspectionResult,
  type DesignedCellRecord,
  type GridCoordinate,
  type ExportRenderOptions,
  type HistorySource,
  type MapCommand,
  type MapFeaturePage,
  type MapDocument,
  type MapFeatures,
  type MapSummary,
  type MapRuntimeState,
  type NeighborInspectionResult,
  type RiverFeature,
  type TagKey,
  type ValidationIssue
} from "@mapdesigner/map-core";
import { buildExportScene, buildMapScene, renderSvgString } from "@mapdesigner/map-render";
import { EXPORT_STORAGE_DIR, MAP_STORAGE_DIR } from "./config.js";
import { badRequest, revisionConflict, storageError } from "./errors.js";
import {
  assertSafeMapId,
  exportFilePath,
  MAX_INSPECT_AREA_RADIUS,
  normalizeExportOptions,
  validateDocumentForWrite,
  writeFileAtomic
} from "./storage.js";
import {
  createMapDocument,
  deleteMapDocument,
  applyCellAndFeatureWriteChanges,
  applyCellWriteChanges,
  applyFeatureWriteChanges,
  getCellsInRange as getRepositoryCellsInRange,
  getDesignedCellsAt,
  getDesignedCellsByBiome,
  getDesignedCellsByTerrain,
  getMapFeatures as getRepositoryMapFeatures,
  getMapFeaturesInRange as getRepositoryMapFeaturesInRange,
  getRiverFeatures,
  getMapHistory as getRepositoryMapHistory,
  getHistoryStatus as getRepositoryHistoryStatus,
  getMapDocument,
  getMapSummary as getRepositoryMapSummary,
  getRedoOperation,
  getUndoOperation,
  listMapRows,
  mapExists,
  moveHistoryCursor,
  recordOperation,
  importMapDocument,
  saveMapDocument,
  updateMapMetadata,
  writeMapDocumentJsonExport,
  type FeaturePageOptions,
  type HistoryStatus,
  type MapHistory,
  type MapListItem
} from "./repository.js";
import { createMapId, slugify } from "./utils.js";

const PNG_EXPORT_TIMEOUT_SECONDS = 20;
const MAX_WHOLE_MAP_PNG_EXPORT_CELLS = 10_000;

export type { MapListItem } from "./repository.js";

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
  feature_stats: {
    river_created_count: number;
    river_updated_count: number;
    river_deleted_count: number;
  };
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

export interface LightweightApplyCommandsResult {
  mapId: string;
  summary: MapSummary;
  features?: MapFeatures;
  warnings: ValidationIssue[];
  dryRun: boolean;
  command_results: CommandExecutionReport[];
  changes: CellChangeDetail[];
  stats: ApplyChangeStats;
}

export interface HistoryMoveResult {
  map: MapRuntimeState;
  warnings: ValidationIssue[];
  operation: {
    seq: number;
    action: string;
    source: HistorySource;
    timestamp: string;
  };
  status: HistoryStatus;
}

export interface LightweightHistoryMoveResult {
  mapId: string;
  summary: MapSummary;
  features?: MapFeatures;
  warnings: ValidationIssue[];
  operation: {
    seq: number;
    action: string;
    source: HistorySource;
    timestamp: string;
  };
  status: HistoryStatus;
}

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
  const [summary, features, rangeResult] = await Promise.all([
    getMapSummary(id),
    getMapFeaturesInRange(id, range),
    getCellsInRange(id, range, { includeUndesigned: true })
  ]);
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

async function buildAreaCellsFromRange(id: string, center: GridCoordinate, radius: number): Promise<ActiveCell[]> {
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
  let riverCreatedCount = 0;
  let riverUpdatedCount = 0;
  let riverDeletedCount = 0;

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

  for (const command of commands) {
    switch (command.action) {
      case "create_river":
        riverCreatedCount += 1;
        break;
      case "update_river":
      case "set_river_path":
      case "set_river_width":
        riverUpdatedCount += 1;
        break;
      case "delete_river":
        riverDeletedCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    command_count: commands.length,
    changed_count: changes.length,
    created_count: createdCount,
    updated_count: updatedCount,
    cleared_count: clearedCount,
    feature_stats: {
      river_created_count: riverCreatedCount,
      river_updated_count: riverUpdatedCount,
      river_deleted_count: riverDeletedCount
    },
    terrain_summary: terrainSummary,
    biome_summary: biomeSummary
  };
}

function activeCellFromDesignedRecord(cell: DesignedCellRecord): ActiveCell {
  return {
    row: cell.row,
    col: cell.col,
    id: createCellId(cell.row, cell.col),
    display_coord: createDisplayCoord(cell.row, cell.col),
    status: "designed",
    terrain: cell.terrain,
    biome: cell.biome,
    tags: [...cell.tags],
    note: cell.note,
    is_seed: false
  };
}

function normalizeTags(tags: unknown, target: string): { tags: TagKey[]; errors: ValidationIssue[] } {
  if (!Array.isArray(tags)) {
    return {
      tags: [],
      errors: [
        {
          code: "invalid_tags",
          message: "tags must be an array",
          severity: "invalid",
          target
        }
      ]
    };
  }
  const invalid = tags.filter((tag) => !isTagKey(tag));
  if (invalid.length > 0) {
    return {
      tags: [],
      errors: [
        {
          code: "invalid_tag_value",
          message: `unknown tag values: ${invalid.join(", ")}`,
          severity: "invalid",
          target
        }
      ]
    };
  }
  return { tags: [...new Set(tags as TagKey[])], errors: [] };
}

function buildCellChangeDetail(
  target: GridCoordinate,
  before: DesignedCellRecord | null,
  after: DesignedCellRecord | null
): CellChangeDetail {
  return {
    coord: { row: target.row, col: target.col },
    cell_id: createCellId(target.row, target.col),
    display_coord: createDisplayCoord(target.row, target.col),
    before: before ? activeCellFromDesignedRecord(before) : undesignedCell(target),
    after: after ? activeCellFromDesignedRecord(after) : undesignedCell(target)
  };
}

function commandTargets(command: MapCommand): GridCoordinate[] | null {
  switch (command.action) {
    case "set_cell":
    case "clear_cell":
    case "annotate_cell":
      return [command.target];
    case "set_cells":
      return command.targets;
    case "replace_terrain":
    case "replace_biome":
      return [];
    default:
      return null;
  }
}

function isSameDesignedCell(left: DesignedCellRecord | null, right: DesignedCellRecord | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.row === right.row &&
    left.col === right.col &&
    left.terrain === right.terrain &&
    left.biome === right.biome &&
    left.note === right.note &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

async function loadCellsForCommand(
  id: string,
  command: MapCommand
): Promise<DesignedCellRecord[] | null> {
  const targets = commandTargets(command);
  if (targets === null) {
    return null;
  }
  switch (command.action) {
    case "replace_terrain":
      return getDesignedCellsByTerrain(id, command.match.terrain);
    case "replace_biome":
      return getDesignedCellsByBiome(id, command.match.biome);
    default:
      return getDesignedCellsAt(id, targets);
  }
}

function designedCellKey(coord: GridCoordinate): string {
  return `${coord.row},${coord.col}`;
}

function getDesignedCell(cells: Map<string, DesignedCellRecord>, coord: GridCoordinate): DesignedCellRecord | null {
  return cells.get(designedCellKey(coord)) ?? null;
}

function setDesignedCell(cells: Map<string, DesignedCellRecord>, cell: DesignedCellRecord): void {
  cells.set(designedCellKey(cell), cell);
}

function deleteDesignedCell(cells: Map<string, DesignedCellRecord>, coord: GridCoordinate): void {
  cells.delete(designedCellKey(coord));
}

function cloneDesignedCell(cell: DesignedCellRecord): DesignedCellRecord {
  return {
    row: cell.row,
    col: cell.col,
    terrain: cell.terrain,
    biome: cell.biome,
    tags: [...cell.tags],
    note: cell.note
  };
}

function isRiverCommand(command: MapCommand): boolean {
  return ["create_river", "update_river", "delete_river", "set_river_path", "set_river_width"].includes(command.action);
}

function isCellCommand(command: MapCommand): boolean {
  return ["set_cell", "set_cells", "clear_cell", "annotate_cell", "replace_terrain", "replace_biome"].includes(command.action);
}

function createRiverIdFromFeatures(name: string, existing: RiverFeature[]): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "river";
  const existingIds = new Set(existing.map((river) => river.id));
  if (!existingIds.has(slug)) {
    return slug;
  }
  let suffix = 2;
  while (existingIds.has(`${slug}-${suffix}`)) {
    suffix += 1;
  }
  return `${slug}-${suffix}`;
}

function normalizeRiverPoint(point: RiverFeature["points"][number]): RiverFeature["points"][number] {
  return {
    row: point.row,
    col: point.col,
    ...(typeof point.width === "number" ? { width: point.width } : {})
  };
}

function normalizeRiverFeature(river: RiverFeature): RiverFeature {
  return {
    id: river.id,
    name: river.name.trim(),
    points: river.points.map(normalizeRiverPoint),
    ...(river.color ? { color: river.color } : {}),
    ...(typeof river.opacity === "number" ? { opacity: river.opacity } : {})
  };
}

function cloneRiverFeature(river: RiverFeature): RiverFeature {
  return {
    id: river.id,
    name: river.name,
    points: river.points.map((point) => ({
      row: point.row,
      col: point.col,
      ...(typeof point.width === "number" ? { width: point.width } : {})
    })),
    ...(river.color ? { color: river.color } : {}),
    ...(typeof river.opacity === "number" ? { opacity: river.opacity } : {})
  };
}

function insertRiverWidthAnchor(river: RiverFeature, target: GridCoordinate, width: number): boolean {
  for (let index = 0; index < river.points.length - 1; index += 1) {
    const line = buildHexLine(river.points[index]!, river.points[index + 1]!);
    const lineIndex = line.findIndex((coord) => sameCoord(coord, target));
    if (lineIndex > 0 && lineIndex < line.length - 1) {
      river.points.splice(index + 1, 0, {
        row: target.row,
        col: target.col,
        width
      });
      return true;
    }
  }
  return false;
}

function riverCommandReport(index: number, action: MapCommand["action"]): CommandExecutionReport {
  return {
    index,
    action,
    changed: [],
    details: [],
    warnings: []
  };
}

function featuresFromWorkingRivers(rivers: Map<string, RiverFeature | null>): MapFeatures {
  return {
    rivers: [...rivers.values()]
      .filter((river): river is RiverFeature => river !== null)
      .map(cloneRiverFeature)
      .sort((left, right) => left.id.localeCompare(right.id))
  };
}

interface LightweightRiverCommandOptions extends ApplyCommandsOptions {
  recordHistory?: boolean;
}

interface LightweightMixedCommandOptions extends ApplyCommandsOptions {
  recordHistory?: boolean;
}

interface LightweightRiverApplyResult extends LightweightApplyCommandsResult {
  featureWriteChanges: Array<{ kind: "river"; featureId: string; river: RiverFeature | null }>;
  inverseCommands: MapCommand[];
  revisionIncrement: number;
}

async function applyLightweightRiverCommands(
  id: string,
  commands: MapCommand[],
  options: LightweightRiverCommandOptions = {}
): Promise<LightweightRiverApplyResult | null> {
  if (commands.length === 0 || !commands.every(isRiverCommand)) {
    return null;
  }
  const normalizedId = assertSafeMapId(id);
  const commandResults: CommandExecutionReport[] = [];
  const writeChanges = new Map<string, RiverFeature | null>();
  const workingRivers = new Map<string, RiverFeature | null>();
  const inverseCommands: MapCommand[] = [];
  for (const river of await getRiverFeatures(normalizedId)) {
    workingRivers.set(river.id, cloneRiverFeature(river));
  }
  let revisionIncrement = 0;

  for (const [index, command] of commands.entries()) {
    switch (command.action) {
      case "create_river": {
        const existing = [...workingRivers.values()].filter((river): river is RiverFeature => river !== null);
        const river = normalizeRiverFeature({
          id: command.river.id ?? createRiverIdFromFeatures(command.river.name, existing),
          name: command.river.name,
          points: command.river.points,
          color: command.river.color,
          opacity: command.river.opacity
        });
        const errors: ValidationIssue[] = [];
        if (workingRivers.get(river.id) !== null && workingRivers.has(river.id)) {
          errors.push({
            code: "duplicate_river",
            message: `river ${river.id} already exists`,
            severity: "invalid",
            target: "river.id"
          });
        }
        errors.push(...validateRiverFeature(river));
        if (errors.length > 0) {
          throw badRequest(errors.map((entry) => entry.message).join("; "), errors);
        }
        workingRivers.set(river.id, river);
        writeChanges.set(river.id, river);
        inverseCommands.push({ action: "delete_river", source: "system", river_id: river.id });
        revisionIncrement += 1;
        break;
      }
      case "update_river": {
        if (!isRiverId(command.river_id)) {
          throw badRequest("river_id must be a valid river id", [{ code: "invalid_river_id", message: "river_id must be a valid river id", severity: "invalid", target: "river_id" }]);
        }
        const existing = workingRivers.get(command.river_id) ?? null;
        if (!existing) {
          throw badRequest(`river ${command.river_id} was not found`, [{ code: "missing_river", message: `river ${command.river_id} was not found`, severity: "invalid", target: "river_id" }]);
        }
        const previous = cloneRiverFeature(existing);
        const next = normalizeRiverFeature({
          ...existing,
          name: command.changes.name ?? existing.name,
          points: command.changes.points ?? existing.points,
          color: command.changes.color === undefined ? existing.color : command.changes.color,
          opacity: command.changes.opacity === undefined ? existing.opacity : command.changes.opacity
        });
        const errors = validateRiverFeature(next);
        if (errors.length > 0) {
          throw badRequest(errors.map((entry) => entry.message).join("; "), errors);
        }
        workingRivers.set(command.river_id, next);
        writeChanges.set(command.river_id, next);
        inverseCommands.push({
          action: "update_river",
          source: "system",
          river_id: command.river_id,
          changes: {
            name: previous.name,
            points: previous.points,
            color: previous.color ?? null,
            opacity: previous.opacity ?? null
          }
        });
        revisionIncrement += 1;
        break;
      }
      case "delete_river": {
        if (!isRiverId(command.river_id)) {
          throw badRequest("river_id must be a valid river id", [{ code: "invalid_river_id", message: "river_id must be a valid river id", severity: "invalid", target: "river_id" }]);
        }
        const existing = workingRivers.get(command.river_id) ?? null;
        if (!existing) {
          throw badRequest(`river ${command.river_id} was not found`, [{ code: "missing_river", message: `river ${command.river_id} was not found`, severity: "invalid", target: "river_id" }]);
        }
        workingRivers.set(command.river_id, null);
        writeChanges.set(command.river_id, null);
        inverseCommands.push({ action: "create_river", source: "system", river: cloneRiverFeature(existing) });
        revisionIncrement += 1;
        break;
      }
      case "set_river_path": {
        if (!isRiverId(command.river_id)) {
          throw badRequest("river_id must be a valid river id", [{ code: "invalid_river_id", message: "river_id must be a valid river id", severity: "invalid", target: "river_id" }]);
        }
        const existing = workingRivers.get(command.river_id) ?? null;
        if (!existing) {
          throw badRequest(`river ${command.river_id} was not found`, [{ code: "missing_river", message: `river ${command.river_id} was not found`, severity: "invalid", target: "river_id" }]);
        }
        const errors = command.points.flatMap((point, pointIndex) => validateRiverPoint(point, `points[${pointIndex}]`));
        if (command.points.length < 2) {
          errors.push({ code: "invalid_river_points", message: "river requires at least two points", severity: "invalid", target: "points" });
        }
        if (errors.length > 0) {
          throw badRequest(errors.map((entry) => entry.message).join("; "), errors);
        }
        const previous = cloneRiverFeature(existing);
        const next = normalizeRiverFeature({ ...existing, points: command.points });
        const featureErrors = validateRiverFeature(next);
        if (featureErrors.length > 0) {
          throw badRequest(featureErrors.map((entry) => entry.message).join("; "), featureErrors);
        }
        workingRivers.set(command.river_id, next);
        writeChanges.set(command.river_id, next);
        inverseCommands.push({
          action: "update_river",
          source: "system",
          river_id: command.river_id,
          changes: {
            name: previous.name,
            points: previous.points,
            color: previous.color ?? null,
            opacity: previous.opacity ?? null
          }
        });
        revisionIncrement += 1;
        break;
      }
      case "set_river_width": {
        if (!isRiverId(command.river_id)) {
          throw badRequest("river_id must be a valid river id", [{ code: "invalid_river_id", message: "river_id must be a valid river id", severity: "invalid", target: "river_id" }]);
        }
        const errors = [
          ...validateCoordinate(command.target, "target"),
          ...validateRiverPoint({ ...command.target, width: command.width }, "target")
        ];
        if (errors.length > 0) {
          throw badRequest(errors.map((entry) => entry.message).join("; "), errors);
        }
        const existing = workingRivers.get(command.river_id) ?? null;
        if (!existing) {
          throw badRequest(`river ${command.river_id} was not found`, [{ code: "missing_river", message: `river ${command.river_id} was not found`, severity: "invalid", target: "river_id" }]);
        }
        const previous = cloneRiverFeature(existing);
        const next = cloneRiverFeature(existing);
        const pointIndex = next.points.findIndex((point) => point.row === command.target.row && point.col === command.target.col);
        if (pointIndex === -1) {
          if (!insertRiverWidthAnchor(next, command.target, command.width)) {
            throw badRequest("set_river_width target must be on the river path", [{ code: "missing_river_point", message: "set_river_width target must be on the river path", severity: "invalid", target: "target" }]);
          }
        } else {
          next.points[pointIndex] = { ...next.points[pointIndex]!, width: command.width };
        }
        const normalized = normalizeRiverFeature(next);
        workingRivers.set(command.river_id, normalized);
        writeChanges.set(command.river_id, normalized);
        inverseCommands.push({
          action: "update_river",
          source: "system",
          river_id: command.river_id,
          changes: {
            name: previous.name,
            points: previous.points,
            color: previous.color ?? null,
            opacity: previous.opacity ?? null
          }
        });
        revisionIncrement += 1;
        break;
      }
      default:
        return null;
    }
    commandResults.push(riverCommandReport(index, command.action));
  }

  const summary = await applyFeatureWriteChanges(
    normalizedId,
    [...writeChanges.entries()].map(([featureId, river]) => ({ kind: "river", featureId, river })),
    { dryRun: options.dryRun, revisionIncrement }
  );
  const orderedInverseCommands = inverseCommands.reverse();
  if (!options.dryRun && options.recordHistory !== false && commands.length > 0) {
    await recordOperation(normalizedId, {
      source: getCommandSource(commands),
      action: getOperationAction(commands),
      commands,
      inverseCommands: orderedInverseCommands,
      summary: buildApplyChangeStats(commands, [])
    });
  }
  return {
    mapId: normalizedId,
    summary,
    features: featuresFromWorkingRivers(workingRivers),
    warnings: [],
    dryRun: options.dryRun ?? false,
    command_results: commandResults,
    changes: [],
    stats: buildApplyChangeStats(commands, []),
    featureWriteChanges: [...writeChanges.entries()].map(([featureId, river]) => ({ kind: "river", featureId, river })),
    inverseCommands: orderedInverseCommands,
    revisionIncrement
  };
}

interface LightweightCellApplyResult extends LightweightApplyCommandsResult {
  cellWriteChanges: Array<{ row: number; col: number; cell: DesignedCellRecord | null }>;
  inverseCommands: MapCommand[];
  revisionIncrement: number;
}

async function applyLightweightCellCommands(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<LightweightCellApplyResult | null> {
  const normalizedId = assertSafeMapId(id);
  const warnings: ValidationIssue[] = [];
  const commandResults: CommandExecutionReport[] = [];
  const changes: CellChangeDetail[] = [];
  const writeChanges = new Map<string, { row: number; col: number; cell: DesignedCellRecord | null }>();
  const workingCells = new Map<string, DesignedCellRecord | null>();
  let revisionIncrement = 0;

  for (const [index, command] of commands.entries()) {
    const source = command.source ?? "system";
    const loadedCells = await loadCellsForCommand(normalizedId, command);
    if (loadedCells === null) {
      return null;
    }
    for (const cell of loadedCells) {
      const key = designedCellKey(cell);
      if (!workingCells.has(key)) {
        workingCells.set(key, cloneDesignedCell(cell));
      }
    }
    const cellsByCoord = new Map(
      [...workingCells.entries()]
        .filter((entry): entry is [string, DesignedCellRecord] => entry[1] !== null)
        .map(([key, cell]) => [key, cloneDesignedCell(cell)])
    );
    const commandDetails: CellChangeDetail[] = [];
    const commandWarnings: ValidationIssue[] = [];
    const errors: ValidationIssue[] = [];

    switch (command.action) {
      case "set_cell":
      case "set_cells": {
        const targets = command.action === "set_cell" ? [command.target] : command.targets;
        targets.forEach((target, targetIndex) => {
          errors.push(...validateCoordinate(target, command.action === "set_cell" ? "target" : `targets[${targetIndex}]`));
        });
        if (!isTerrainKey(command.changes.terrain)) {
          errors.push({
            code: "invalid_terrain",
            message: "terrain must be a known terrain key",
            severity: "invalid",
            target: "changes.terrain"
          });
        }
        if (
          command.changes.biome !== undefined &&
          command.changes.biome !== null &&
          !isBiomeKey(command.changes.biome)
        ) {
          errors.push({
            code: "invalid_biome",
            message: "biome must be null or a known biome key",
            severity: "invalid",
            target: "changes.biome"
          });
        }
        const tagResult = command.changes.tags === undefined
          ? { tags: [], errors: [] }
          : normalizeTags(command.changes.tags, "changes.tags");
        errors.push(...tagResult.errors);
        if (errors.length > 0) {
          throw badRequest(errors.map((entry) => entry.message).join("; "), errors);
        }
        const terrain = command.changes.terrain;
        const biome = command.changes.biome ?? null;
        commandWarnings.push(...validateTerrainBiomePair(terrain, biome, "changes"));
        const invalidWarnings = commandWarnings.filter((entry) => entry.severity === "invalid");
        if (invalidWarnings.length > 0) {
          throw badRequest(invalidWarnings.map((entry) => entry.message).join("; "), invalidWarnings);
        }
        for (const target of targets) {
          const before = getDesignedCell(cellsByCoord, target);
          const after: DesignedCellRecord = {
            row: target.row,
            col: target.col,
            terrain,
            biome,
            tags: command.changes.tags === undefined ? [] : tagResult.tags,
            note: command.changes.note ?? ""
          };
          setDesignedCell(cellsByCoord, after);
          if (!isSameDesignedCell(before, after)) {
            commandDetails.push(buildCellChangeDetail(target, before, after));
            writeChanges.set(designedCellKey(target), { row: target.row, col: target.col, cell: after });
            workingCells.set(designedCellKey(target), after);
          }
        }
        break;
      }
      case "clear_cell": {
        errors.push(...validateCoordinate(command.target, "target"));
        if (errors.length > 0) {
          throw badRequest(errors.map((entry) => entry.message).join("; "), errors);
        }
        const before = getDesignedCell(cellsByCoord, command.target);
        if (before) {
          deleteDesignedCell(cellsByCoord, command.target);
          commandDetails.push(buildCellChangeDetail(command.target, before, null));
          writeChanges.set(designedCellKey(command.target), { row: command.target.row, col: command.target.col, cell: null });
          workingCells.set(designedCellKey(command.target), null);
        }
        break;
      }
      case "annotate_cell": {
        errors.push(...validateCoordinate(command.target, "target"));
        const tagResult = command.changes.tags === undefined
          ? { tags: [], errors: [] }
          : normalizeTags(command.changes.tags, "changes.tags");
        errors.push(...tagResult.errors);
        if (command.changes.note !== undefined && typeof command.changes.note !== "string") {
          errors.push({
            code: "invalid_note",
            message: "note must be a string",
            severity: "invalid",
            target: "changes.note"
          });
        }
        if (errors.length > 0) {
          throw badRequest(errors.map((entry) => entry.message).join("; "), errors);
        }
        const before = getDesignedCell(cellsByCoord, command.target);
        if (!before) {
          throw badRequest("annotate_cell requires an existing designed cell", [
            {
              code: "missing_cell",
              message: "annotate_cell requires an existing designed cell",
              severity: "invalid",
              target: "target"
            }
          ]);
        }
        const after: DesignedCellRecord = {
          ...before,
          tags: command.changes.tags === undefined ? before.tags : tagResult.tags,
          note: command.changes.note ?? before.note
        };
        if (!isSameDesignedCell(before, after)) {
          commandDetails.push(buildCellChangeDetail(command.target, before, after));
          writeChanges.set(designedCellKey(command.target), { row: command.target.row, col: command.target.col, cell: after });
          workingCells.set(designedCellKey(command.target), after);
        }
        break;
      }
      case "replace_terrain": {
        if (!isTerrainKey(command.match.terrain) || !isTerrainKey(command.changes.terrain)) {
          throw badRequest("replace_terrain requires known terrain keys", [
            {
              code: "invalid_terrain",
              message: "replace_terrain requires known terrain keys",
              severity: "invalid",
              target: "match/changes"
            }
          ]);
        }
        for (const before of cellsByCoord.values()) {
          if (before.terrain !== command.match.terrain) {
            continue;
          }
          const after: DesignedCellRecord = {
            ...before,
            terrain: command.changes.terrain
          };
          commandWarnings.push(...validateTerrainBiomePair(after.terrain, after.biome, createCellId(after.row, after.col)));
          if (!isSameDesignedCell(before, after)) {
            commandDetails.push(buildCellChangeDetail(before, before, after));
            writeChanges.set(designedCellKey(before), { row: before.row, col: before.col, cell: after });
            workingCells.set(designedCellKey(before), after);
          }
        }
        const invalidWarnings = commandWarnings.filter((entry) => entry.severity === "invalid");
        if (invalidWarnings.length > 0) {
          throw badRequest(invalidWarnings.map((entry) => entry.message).join("; "), invalidWarnings);
        }
        break;
      }
      case "replace_biome": {
        if (command.match.biome !== null && !isBiomeKey(command.match.biome)) {
          throw badRequest("match.biome must be null or a known biome key", [
            {
              code: "invalid_biome",
              message: "match.biome must be null or a known biome key",
              severity: "invalid",
              target: "match.biome"
            }
          ]);
        }
        if (command.changes.biome !== null && !isBiomeKey(command.changes.biome)) {
          throw badRequest("changes.biome must be null or a known biome key", [
            {
              code: "invalid_biome",
              message: "changes.biome must be null or a known biome key",
              severity: "invalid",
              target: "changes.biome"
            }
          ]);
        }
        for (const before of cellsByCoord.values()) {
          if (before.biome !== command.match.biome) {
            continue;
          }
          const after: DesignedCellRecord = {
            ...before,
            biome: command.changes.biome
          };
          commandWarnings.push(...validateTerrainBiomePair(after.terrain, after.biome, createCellId(after.row, after.col)));
          if (!isSameDesignedCell(before, after)) {
            commandDetails.push(buildCellChangeDetail(before, before, after));
            writeChanges.set(designedCellKey(before), { row: before.row, col: before.col, cell: after });
            workingCells.set(designedCellKey(before), after);
          }
        }
        const invalidWarnings = commandWarnings.filter((entry) => entry.severity === "invalid");
        if (invalidWarnings.length > 0) {
          throw badRequest(invalidWarnings.map((entry) => entry.message).join("; "), invalidWarnings);
        }
        break;
      }
      default:
        return null;
    }

    if (commandDetails.length > 0) {
      revisionIncrement += 1;
    }
    warnings.push(...commandWarnings.filter((entry) => entry.severity === "warning"));
    commandResults.push({
      index,
      action: command.action,
      changed: commandDetails.map((detail) => ({ row: detail.coord.row, col: detail.coord.col })),
      details: commandDetails,
      warnings: commandWarnings.filter((entry) => entry.severity === "warning")
    });
    changes.push(...commandDetails);
  }

  const summary = await applyCellWriteChanges(normalizedId, [...writeChanges.values()], {
    dryRun: options.dryRun,
    revisionIncrement
  });
  const inverseCommands = buildInverseCellCommands(changes, "system").reverse();
  if (!options.dryRun && commands.length > 0) {
    await recordOperation(normalizedId, {
      source: getCommandSource(commands),
      action: getOperationAction(commands),
      commands,
      inverseCommands,
      summary: buildApplyChangeStats(commands, changes)
    });
  }
  return {
    mapId: normalizedId,
    summary,
    warnings,
    dryRun: options.dryRun ?? false,
    command_results: commandResults,
    changes,
    stats: buildApplyChangeStats(commands, changes),
    cellWriteChanges: [...writeChanges.values()],
    inverseCommands,
    revisionIncrement
  };
}

async function applyLightweightMixedCommands(
  id: string,
  commands: MapCommand[],
  options: LightweightMixedCommandOptions = {}
): Promise<LightweightApplyCommandsResult | null> {
  if (
    commands.length === 0 ||
    !commands.some(isCellCommand) ||
    !commands.some(isRiverCommand) ||
    !commands.every((command) => isCellCommand(command) || isRiverCommand(command))
  ) {
    return null;
  }
  const normalizedId = assertSafeMapId(id);
  const cellEntries = commands
    .map((command, index) => ({ command, index }))
    .filter((entry) => isCellCommand(entry.command));
  const riverEntries = commands
    .map((command, index) => ({ command, index }))
    .filter((entry) => isRiverCommand(entry.command));
  const cellCommands = cellEntries.map((entry) => entry.command);
  const riverCommands = riverEntries.map((entry) => entry.command);
  const cellPreview = await applyLightweightCellCommands(normalizedId, cellCommands, { dryRun: true });
  const riverPreview = await applyLightweightRiverCommands(normalizedId, riverCommands, {
    dryRun: true,
    recordHistory: false
  });
  if (!cellPreview || !riverPreview) {
    return null;
  }
  const stats = buildApplyChangeStats(commands, cellPreview.changes);
  const commandResults = [
    ...cellPreview.command_results.map((report) => ({
      ...report,
      index: cellEntries[report.index]?.index ?? report.index
    })),
    ...riverPreview.command_results.map((report) => ({
      ...report,
      index: riverEntries[report.index]?.index ?? report.index
    }))
  ]
    .sort((left, right) => {
      return left.index - right.index;
    });
  const warnings = [...cellPreview.warnings, ...riverPreview.warnings];

  const summary = await applyCellAndFeatureWriteChanges(
    normalizedId,
    cellPreview.cellWriteChanges,
    riverPreview.featureWriteChanges,
    {
      dryRun: options.dryRun,
      cellRevisionIncrement: cellPreview.revisionIncrement,
      featureRevisionIncrement: riverPreview.revisionIncrement
    }
  );
  if (!options.dryRun && options.recordHistory !== false) {
    await recordOperation(normalizedId, {
      source: getCommandSource(commands),
      action: getOperationAction(commands),
      commands,
      inverseCommands: [...riverPreview.inverseCommands, ...cellPreview.inverseCommands],
      summary: stats
    });
  }
  return {
    mapId: normalizedId,
    summary,
    features: riverPreview.features,
    warnings,
    dryRun: options.dryRun ?? false,
    command_results: commandResults,
    changes: cellPreview.changes,
    stats
  };
}

function activeCellToSetCellCommand(cell: NonNullable<CellChangeDetail["after"]>, source: HistorySource): MapCommand {
  if (cell.status !== "designed" || !cell.terrain) {
    return {
      action: "clear_cell",
      source,
      target: { row: cell.row, col: cell.col }
    };
  }
  return {
    action: "set_cell",
    source,
    target: { row: cell.row, col: cell.col },
    changes: {
      terrain: cell.terrain,
      biome: cell.biome,
      tags: [...cell.tags],
      note: cell.note
    }
  };
}

function buildInverseCellCommands(changes: CellChangeDetail[], source: HistorySource): MapCommand[] {
  return changes
    .map((change): MapCommand | null => {
      if (!change.before || change.before.status !== "designed" || !change.before.terrain) {
        return {
          action: "clear_cell",
          source,
          target: { row: change.coord.row, col: change.coord.col }
        };
      }
      return activeCellToSetCellCommand(change.before, source);
    })
    .filter((command): command is MapCommand => command !== null);
}

function designedRecordFromChangeCell(cell: CellChangeDetail["after"]): DesignedCellRecord | null {
  if (!cell || cell.status !== "designed" || !cell.terrain) {
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

function revisionIncrementFromCommandReports(reports: CommandExecutionReport[]): number {
  return reports.filter((report) => report.details.length > 0).length;
}

function findRiverById(document: MapDocument, id: string) {
  return document.features.rivers.find((river) => river.id === id) ?? null;
}

function buildInverseFeatureCommands(before: MapDocument, after: MapDocument, commands: MapCommand[], source: HistorySource): MapCommand[] {
  const inverse: MapCommand[] = [];
  for (const command of commands) {
    switch (command.action) {
      case "create_river": {
        const riverId = command.river.id ?? after.features.rivers.at(-1)?.id;
        if (riverId && findRiverById(after, riverId)) {
          inverse.push({
            action: "delete_river",
            source,
            river_id: riverId
          });
        }
        break;
      }
      case "update_river":
      case "set_river_path":
      case "set_river_width": {
        const previous = findRiverById(before, command.river_id);
        if (previous) {
          inverse.push({
            action: "update_river",
            source,
            river_id: command.river_id,
            changes: {
              name: previous.name,
              points: previous.points,
              color: previous.color ?? null,
              opacity: previous.opacity ?? null
            }
          });
        }
        break;
      }
      case "delete_river": {
        const previous = findRiverById(before, command.river_id);
        if (previous) {
          inverse.push({
            action: "create_river",
            source,
            river: previous
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return inverse.reverse();
}

function buildInverseCommands(before: MapDocument, after: MapDocument, commands: MapCommand[], changes: CellChangeDetail[]): MapCommand[] {
  const source: HistorySource = "system";
  return [
    ...buildInverseCellCommands(changes, source).reverse(),
    ...buildInverseFeatureCommands(before, after, commands, source)
  ];
}

function getCommandSource(commands: MapCommand[]): HistorySource {
  return commands.find((command) => command.source)?.source ?? "system";
}

function getOperationAction(commands: MapCommand[]): string {
  if (commands.length === 1) {
    return commands[0]?.action ?? "empty";
  }
  return "commands";
}

async function applyCommandsWithoutHistory(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<ApplyCommandsResult & { beforeDocument: MapDocument }> {
  const normalizedId = assertSafeMapId(id);
  const document = await getMapDocument(normalizedId);
  const beforeDocument = structuredClone(document);
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
    state = runtimeFromDocument(await saveMapDocument(state.document));
  }
  return {
    map: state,
    warnings,
    dryRun: options.dryRun ?? false,
    command_results: commandResults,
    changes,
    stats: buildApplyChangeStats(commands, changes),
    beforeDocument
  };
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
  const current = await getMapDocument(normalizedId);
  if (current.meta.revision !== input.expectedRevision) {
    throw revisionConflict(
      `revision conflict: expected ${input.expectedRevision}, current is ${current.meta.revision}`
    );
  }
  const document = await saveMapDocument(input.document);
  return runtimeFromDocument(document);
}

export async function saveMapAs(input: SaveMapAsInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const now = new Date().toISOString();
  const nextId = assertSafeMapId(input.id ?? createMapId(input.name));
  if (await mapExists(nextId)) {
    throw badRequest(`map id ${nextId} already exists`);
  }
  const sourceDocument = input.document ?? (input.sourceId ? await getMapDocument(assertSafeMapId(input.sourceId)) : null);
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
  const current = await getRepositoryMapSummary(normalizedId);
  if (current.meta.revision !== input.expectedRevision) {
    throw revisionConflict(
      `revision conflict: expected ${input.expectedRevision}, current is ${current.meta.revision}`
    );
  }
  if (input.name !== undefined && !input.name.trim()) {
    throw badRequest("name must be a non-empty string");
  }
  return updateMapMetadata(normalizedId, {
    name: input.name?.trim(),
    description: input.description,
    tags: input.tags
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
}): Promise<{ map?: MapRuntimeState; summary: MapSummary; warnings: ValidationIssue[] }> {
  await ensureDirectories();
  const parsed = parseDocument(input.content);
  if (!parsed.document) {
    throw badRequest(parsed.errors.map((entry) => entry.message).join("; "));
  }
  let document = parsed.document;
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
  document = await importMapDocument(document);
  const summary = await getMapSummary(document.meta.id);
  return {
    ...(input.includeMap === false ? {} : { map: runtimeFromDocument(document) }),
    summary,
    warnings: parsed.errors.filter((entry) => entry.severity === "warning")
  };
}

export async function exportJson(id: string): Promise<{ fileName: string; path: string }> {
  const normalizedId = assertSafeMapId(id);
  const summary = await getMapSummary(normalizedId);
  const fileName = `${slugify(summary.meta.name) || normalizedId}.json`;
  const filePath = exportPath(fileName);
  await writeMapDocumentJsonExport(normalizedId, filePath);
  return { fileName, path: filePath };
}

export async function exportPng(
  id: string,
  options: Partial<ExportRenderOptions> = {}
): Promise<{ fileName: string; path: string }> {
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
  const runtime = resolved.range ? await buildRangeRuntime(normalizedId, resolved.range) : await getMap(normalizedId);
  const scene = buildExportScene({
    map: runtime,
    options: resolved
  });
  const svg = renderSvgString(scene);
  const fileName = `${slugify(summary.meta.name) || normalizedId}-${resolved.preset}${exportRangeFileSuffix(resolved.range)}.png`;
  const filePath = exportPath(fileName);
  const png = await sharp(Buffer.from(svg))
    .timeout({ seconds: PNG_EXPORT_TIMEOUT_SECONDS })
    .png()
    .toBuffer();
  await writeFileAtomic(filePath, png);
  return { fileName, path: filePath };
}

export async function applyCommands(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<ApplyCommandsResult> {
  const result = await applyCommandsWithoutHistory(id, commands, options);
  if (!options.dryRun && commands.length > 0) {
    await recordOperation(assertSafeMapId(id), {
      source: getCommandSource(commands),
      action: getOperationAction(commands),
      commands,
      inverseCommands: buildInverseCommands(result.beforeDocument, result.map.document, commands, result.changes),
      summary: result.stats
    });
  }
  return result;
}

export async function applyCommandsLight(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {}
): Promise<LightweightApplyCommandsResult> {
  const lightweightCells = await applyLightweightCellCommands(id, commands, options);
  if (lightweightCells) {
    return lightweightCells;
  }
  const lightweightRivers = await applyLightweightRiverCommands(id, commands, options);
  if (lightweightRivers) {
    return lightweightRivers;
  }
  const lightweightMixed = await applyLightweightMixedCommands(id, commands, options);
  if (lightweightMixed) {
    return lightweightMixed;
  }
  const result = await applyCommands(id, commands, options);
  return {
    mapId: result.map.document.meta.id,
    summary: summaryFromRuntime(result.map),
    features: result.map.document.features,
    warnings: result.warnings,
    dryRun: result.dryRun,
    command_results: result.command_results,
    changes: result.changes,
    stats: result.stats
  };
}

export async function getHistoryStatus(id: string): Promise<HistoryStatus> {
  return getRepositoryHistoryStatus(assertSafeMapId(id));
}

export async function getMapHistory(id: string, limit?: number): Promise<MapHistory> {
  return getRepositoryMapHistory(assertSafeMapId(id), limit);
}

export async function undoMap(id: string): Promise<HistoryMoveResult | null> {
  const normalizedId = assertSafeMapId(id);
  const operation = await getUndoOperation(normalizedId);
  if (!operation) {
    return null;
  }
  const result = await applyCommandsWithoutHistory(normalizedId, operation.inverseCommands);
  await moveHistoryCursor(normalizedId, operation.seq - 1);
  return {
    map: result.map,
    warnings: result.warnings,
    operation: {
      seq: operation.seq,
      action: operation.action,
      source: operation.source,
      timestamp: operation.timestamp
    },
    status: await getHistoryStatus(normalizedId)
  };
}

export async function undoMapLight(id: string): Promise<LightweightHistoryMoveResult | null> {
  const normalizedId = assertSafeMapId(id);
  const operation = await getUndoOperation(normalizedId);
  if (!operation) {
    return null;
  }
  const lightweight = await applyLightweightCellCommands(normalizedId, operation.inverseCommands, { dryRun: true });
  if (!lightweight) {
    const lightweightRivers = await applyLightweightRiverCommands(normalizedId, operation.inverseCommands, {
      dryRun: true,
      recordHistory: false
    });
    if (lightweightRivers) {
      const appliedRivers = await applyLightweightRiverCommands(normalizedId, operation.inverseCommands, {
        recordHistory: false
      });
      await moveHistoryCursor(normalizedId, operation.seq - 1);
      return {
        mapId: normalizedId,
        summary: appliedRivers?.summary ?? await getMapSummary(normalizedId),
        features: appliedRivers?.features,
        warnings: appliedRivers?.warnings ?? [],
        operation: {
          seq: operation.seq,
          action: operation.action,
          source: operation.source,
          timestamp: operation.timestamp
        },
        status: await getHistoryStatus(normalizedId)
      };
    }
    const lightweightMixed = await applyLightweightMixedCommands(normalizedId, operation.inverseCommands, {
      dryRun: true,
      recordHistory: false
    });
    if (lightweightMixed) {
      const appliedMixed = await applyLightweightMixedCommands(normalizedId, operation.inverseCommands, {
        recordHistory: false
      });
      await moveHistoryCursor(normalizedId, operation.seq - 1);
      return {
        mapId: normalizedId,
        summary: appliedMixed?.summary ?? await getMapSummary(normalizedId),
        features: appliedMixed?.features,
        warnings: appliedMixed?.warnings ?? [],
        operation: {
          seq: operation.seq,
          action: operation.action,
          source: operation.source,
          timestamp: operation.timestamp
        },
        status: await getHistoryStatus(normalizedId)
      };
    }
    const full = await undoMap(normalizedId);
    return full
      ? {
          mapId: full.map.document.meta.id,
          summary: summaryFromRuntime(full.map),
          features: full.map.document.features,
          warnings: full.warnings,
          operation: full.operation,
          status: full.status
        }
      : null;
  }
  await applyCellWriteChanges(
    normalizedId,
    lightweight.changes.map((change) => ({
      row: change.coord.row,
      col: change.coord.col,
      cell: designedRecordFromChangeCell(change.after)
    })),
    { revisionIncrement: revisionIncrementFromCommandReports(lightweight.command_results) }
  );
  await moveHistoryCursor(normalizedId, operation.seq - 1);
  return {
    mapId: normalizedId,
    summary: await getMapSummary(normalizedId),
    warnings: lightweight.warnings,
    operation: {
      seq: operation.seq,
      action: operation.action,
      source: operation.source,
      timestamp: operation.timestamp
    },
    status: await getHistoryStatus(normalizedId)
  };
}

export async function redoMap(id: string): Promise<HistoryMoveResult | null> {
  const normalizedId = assertSafeMapId(id);
  const operation = await getRedoOperation(normalizedId);
  if (!operation) {
    return null;
  }
  const result = await applyCommandsWithoutHistory(normalizedId, operation.commands);
  await moveHistoryCursor(normalizedId, operation.seq);
  return {
    map: result.map,
    warnings: result.warnings,
    operation: {
      seq: operation.seq,
      action: operation.action,
      source: operation.source,
      timestamp: operation.timestamp
    },
    status: await getHistoryStatus(normalizedId)
  };
}

export async function redoMapLight(id: string): Promise<LightweightHistoryMoveResult | null> {
  const normalizedId = assertSafeMapId(id);
  const operation = await getRedoOperation(normalizedId);
  if (!operation) {
    return null;
  }
  const lightweight = await applyLightweightCellCommands(normalizedId, operation.commands, { dryRun: true });
  if (!lightweight) {
    const lightweightRivers = await applyLightweightRiverCommands(normalizedId, operation.commands, {
      dryRun: true,
      recordHistory: false
    });
    if (lightweightRivers) {
      const appliedRivers = await applyLightweightRiverCommands(normalizedId, operation.commands, {
        recordHistory: false
      });
      await moveHistoryCursor(normalizedId, operation.seq);
      return {
        mapId: normalizedId,
        summary: appliedRivers?.summary ?? await getMapSummary(normalizedId),
        features: appliedRivers?.features,
        warnings: appliedRivers?.warnings ?? [],
        operation: {
          seq: operation.seq,
          action: operation.action,
          source: operation.source,
          timestamp: operation.timestamp
        },
        status: await getHistoryStatus(normalizedId)
      };
    }
    const lightweightMixed = await applyLightweightMixedCommands(normalizedId, operation.commands, {
      dryRun: true,
      recordHistory: false
    });
    if (lightweightMixed) {
      const appliedMixed = await applyLightweightMixedCommands(normalizedId, operation.commands, {
        recordHistory: false
      });
      await moveHistoryCursor(normalizedId, operation.seq);
      return {
        mapId: normalizedId,
        summary: appliedMixed?.summary ?? await getMapSummary(normalizedId),
        features: appliedMixed?.features,
        warnings: appliedMixed?.warnings ?? [],
        operation: {
          seq: operation.seq,
          action: operation.action,
          source: operation.source,
          timestamp: operation.timestamp
        },
        status: await getHistoryStatus(normalizedId)
      };
    }
    const full = await redoMap(normalizedId);
    return full
      ? {
          mapId: full.map.document.meta.id,
          summary: summaryFromRuntime(full.map),
          features: full.map.document.features,
          warnings: full.warnings,
          operation: full.operation,
          status: full.status
        }
      : null;
  }
  await applyCellWriteChanges(
    normalizedId,
    lightweight.changes.map((change) => ({
      row: change.coord.row,
      col: change.coord.col,
      cell: designedRecordFromChangeCell(change.after)
    })),
    { revisionIncrement: revisionIncrementFromCommandReports(lightweight.command_results) }
  );
  await moveHistoryCursor(normalizedId, operation.seq);
  return {
    mapId: normalizedId,
    summary: await getMapSummary(normalizedId),
    warnings: lightweight.warnings,
    operation: {
      seq: operation.seq,
      action: operation.action,
      source: operation.source,
      timestamp: operation.timestamp
    },
    status: await getHistoryStatus(normalizedId)
  };
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

export async function inspectCell(id: string, target: GridCoordinate): Promise<CellInspectionResult> {
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

export async function getNeighbors(id: string, center: GridCoordinate): Promise<NeighborInspectionResult> {
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
