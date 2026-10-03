import { advanceMapRevisionSync } from "./repository.js";
import {
  applyCommand,
  createCellId,
  createRuntimeState,
  validateCommandInput,
  validateCoordinate,
  type CellChangeDetail,
  type DesignedCellRecord,
  type MapCommand,
  type MapDocument,
  type MapRuntimeState,
  type RiverFeature
} from "@mapdesigner/map-core";
import { buildApplyChangeStats } from "./command-stats.js";
import type {
  ApplyCommandsOptions,
  CommandExecutionReport,
  LightweightApplyCommandsResult,
  LightweightHistoryMoveResult
} from "./command-types.js";
import { badRequest, revisionConflict } from "./errors.js";
import {
  applyCellWriteChangesSync,
  applyFeatureWriteChangesSync,
  getDesignedCellsAtSync,
  getDesignedCellsByBiomeSync,
  getDesignedCellsByTerrainSync,
  getHistoryStatusSync,
  getMapDocumentSync,
  getMapFeaturesSync,
  getMapSummarySync,
  getRedoOperationSync,
  getUndoOperationSync,
  moveHistoryCursorSync,
  previewCellChangesSync,
  recordOperationSync,
  withMapTransaction,
  type CellWriteChange,
  type FeatureWriteChange
} from "./repository.js";
import { assertSafeMapId } from "./storage.js";

type ExecutionResult = LightweightApplyCommandsResult & { map?: MapRuntimeState };

function inverseCell(change: CellChangeDetail): MapCommand {
  const before = change.before;
  if (!before || before.status !== "designed" || !before.terrain) {
    return { action: "clear_cell", source: "system", target: change.coord };
  }
  return {
    action: "set_cell",
    source: "system",
    target: change.coord,
    changes: {
      terrain: before.terrain,
      biome: before.biome,
      tags: before.tags,
      note: before.note
    }
  };
}

function riverDiff(before: RiverFeature[], after: RiverFeature[]) {
  const previous = new Map(before.map((r) => [r.id, r]));
  const next = new Map(after.map((r) => [r.id, r]));
  const writes: FeatureWriteChange[] = [];
  const inverse: MapCommand[] = [];
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const a = previous.get(id),
      b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    writes.push({ kind: "river", featureId: id, river: b ?? null });
    if (!a) inverse.push({ action: "delete_river", source: "system", river_id: id });
    else if (!b) inverse.push({ action: "create_river", source: "system", river: a });
    else
      inverse.push({
        action: "update_river",
        source: "system",
        river_id: id,
        changes: {
          name: a.name,
          points: a.points,
          width_mode: a.width_mode ?? "legacy",
          color: a.color ?? null,
          opacity: a.opacity ?? null
        }
      });
  }
  return { writes, inverse };
}

/** Use the shared command rules on only the entities needed by this operation. */
function loadDocument(id: string, commands: MapCommand[]): MapDocument {
  const summary = getMapSummarySync(id);
  const cells = new Map<string, DesignedCellRecord>();
  for (const command of commands) {
    if (!command || typeof command !== "object") throw badRequest("command must be an object");
    let loaded: DesignedCellRecord[] = [];
    if (
      command.action === "set_cell" ||
      command.action === "clear_cell" ||
      command.action === "annotate_cell" ||
      command.action === "set_cells" ||
      command.action === "patch_cells"
    ) {
      const targets =
        command.action === "set_cells" || command.action === "patch_cells"
          ? command.targets
          : [command.target];
      if (!Array.isArray(targets)) throw badRequest("targets must be an array");
      const errors = targets.flatMap((target, i) =>
        validateCoordinate(target, "targets[" + i + "]")
      );
      if (errors.length) throw badRequest(errors.map((e) => e.message).join("; "), errors);
      loaded = getDesignedCellsAtSync(id, targets);
    } else if (command.action === "replace_terrain") {
      loaded = getDesignedCellsByTerrainSync(id, command.match?.terrain);
    } else if (command.action === "replace_biome") {
      loaded = getDesignedCellsByBiomeSync(id, command.match?.biome);
    }
    for (const cell of loaded) cells.set(createCellId(cell.row, cell.col), cell);
  }
  return {
    schema_version: 1,
    meta: summary.meta,
    grid: summary.grid,
    cells: [...cells.values()],
    features: commands.some((c) => c.action.includes("river"))
      ? getMapFeaturesSync(id)
      : { rivers: [] }
  };
}

function executeSync(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions,
  includeMap: boolean,
  recordHistory: boolean,
  legacyRiverWidths = false
): ExecutionResult {
  const initial = getMapSummarySync(id);
  const touchesRivers = commands.some((c) => c.action.includes("river"));
  if (
    options.expectedRevision !== undefined &&
    options.expectedRevision !== initial.meta.revision
  ) {
    throw revisionConflict(
      "revision conflict: expected " +
        options.expectedRevision +
        ", current is " +
        initial.meta.revision
    );
  }
  let state = createRuntimeState(loadDocument(id, commands));
  const writes = new Map<string, CellWriteChange>();
  const featureWrites = new Map<string, FeatureWriteChange>();
  const inverse: MapCommand[] = [];
  const resolved: MapCommand[] = [];
  const reports: CommandExecutionReport[] = [];
  const changes: CellChangeDetail[] = [];
  const warnings: LightweightApplyCommandsResult["warnings"] = [];

  for (const [index, command] of commands.entries()) {
    // Validate values before normalization, including untyped HTTP/CLI input.
    if ("changes" in command && (!command.changes || typeof command.changes !== "object")) {
      throw badRequest("changes must be an object");
    }
    if (
      "changes" in command &&
      "note" in command.changes &&
      typeof command.changes.note !== "string"
    ) {
      throw badRequest("note must be a string");
    }
    const beforeRivers = state.document.features.rivers;
    const result = applyCommand(state, command, { legacyRiverWidths });
    if (!result.ok) throw badRequest(result.errors.map((e) => e.message).join("; "), result.errors);
    const features = riverDiff(beforeRivers, result.map.document.features.rivers);
    for (const write of features.writes) featureWrites.set(write.featureId, write);
    inverse.unshift(...features.inverse, ...result.details.map(inverseCell).reverse());
    for (const change of result.details) {
      const after = change.after;
      writes.set(change.cell_id, {
        ...change.coord,
        cell:
          after?.status === "designed" && after.terrain
            ? {
                ...change.coord,
                terrain: after.terrain,
                biome: after.biome,
                tags: after.tags,
                note: after.note
              }
            : null
      });
    }
    const created =
      command.action === "create_river" ? features.writes.find((w) => w.river)?.river : null;
    resolved.push(created ? { ...command, action: "create_river", river: created } : command);
    changes.push(...result.details);
    warnings.push(...result.warnings);
    reports.push({
      index,
      action: command.action,
      changed: result.changed,
      details: result.details,
      warnings: result.warnings
    });
    state = result.map;
    // The database owns history; temporary rule evaluation must not accumulate snapshots.
    state.history = { past: [], future: [], limit: 0 };
  }
  const increment = state.document.meta.revision - initial.meta.revision;
  const stats = buildApplyChangeStats(commands, changes);
  let summary = previewCellChangesSync(id, [...writes.values()]);
  summary.meta = {
    ...initial.meta,
    revision: initial.meta.revision + increment,
    updated_at: state.document.meta.updated_at
  };
  summary.feature_counts = touchesRivers
    ? { rivers: state.document.features.rivers.length }
    : initial.feature_counts;
  if (!options.dryRun) {
    applyCellWriteChangesSync(id, [...writes.values()], { revisionIncrement: 0 });
    applyFeatureWriteChangesSync(id, [...featureWrites.values()], { revisionIncrement: 0 });
    advanceMapRevisionSync(id, increment);
    if (recordHistory && commands.length)
      recordOperationSync(id, {
        source: commands.find((c) => c.source)?.source ?? "system",
        action: commands.length === 1 ? commands[0]!.action : "commands",
        commands: resolved,
        inverseCommands: inverse,
        summary: { ...stats, rules_version: 2 }
      });
    summary = getMapSummarySync(id);
  }
  let map: MapRuntimeState | undefined;
  if (includeMap) {
    let document = getMapDocumentSync(id);
    if (options.dryRun) {
      const all = new Map(document.cells.map((c) => [createCellId(c.row, c.col), c]));
      for (const [key, write] of writes) {
        if (write.cell) all.set(key, write.cell);
        else all.delete(key);
      }
      document = {
        ...document,
        meta: summary.meta,
        cells: [...all.values()],
        features: touchesRivers ? state.document.features : document.features
      };
    }
    map = createRuntimeState(document);
  }
  return {
    mapId: id,
    ...(map ? { map } : {}),
    summary,
    ...(touchesRivers ? { features: state.document.features } : {}),
    dryRun: options.dryRun ?? false,
    warnings,
    command_results: reports,
    changes,
    stats
  };
}

export async function executeCommands(
  id: string,
  commands: MapCommand[],
  options: ApplyCommandsOptions = {},
  includeMap = false
) {
  const normalizedId = assertSafeMapId(id);
  if (!Array.isArray(commands)) throw badRequest("commands must be an array");
  const errors = commands.flatMap(validateCommandInput);
  if (errors.length) throw badRequest(errors.map((e) => e.message).join("; "), errors);
  return withMapTransaction(normalizedId, () =>
    executeSync(normalizedId, commands, options, includeMap, true)
  );
}

export async function moveHistory(
  id: string,
  direction: "undo" | "redo",
  includeMap = false
): Promise<(LightweightHistoryMoveResult & { map?: MapRuntimeState }) | null> {
  const normalizedId = assertSafeMapId(id);
  return withMapTransaction(normalizedId, () => {
    const operation =
      direction === "undo"
        ? getUndoOperationSync(normalizedId)
        : getRedoOperationSync(normalizedId);
    if (!operation) return null;
    const commands = direction === "undo" ? operation.inverseCommands : operation.commands;
    const legacyRiverWidths =
      !operation.summary ||
      typeof operation.summary !== "object" ||
      !("rules_version" in operation.summary) ||
      operation.summary.rules_version !== 2;
    const result = executeSync(normalizedId, commands, {}, includeMap, false, legacyRiverWidths);
    moveHistoryCursorSync(normalizedId, direction === "undo" ? operation.seq - 1 : operation.seq);
    return {
      ...result,
      operation: {
        seq: operation.seq,
        action: operation.action,
        source: operation.source,
        timestamp: operation.timestamp
      },
      status: getHistoryStatusSync(normalizedId)
    };
  });
}
