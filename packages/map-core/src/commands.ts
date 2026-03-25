import { createCellId } from "./coords.js";
import { pushHistory } from "./history.js";
import { cloneDocument, normalizeDocument } from "./serialization.js";
import type {
  CommandResult,
  DesignedCellRecord,
  GridCoordinate,
  MapCommand,
  MapRuntimeState,
  ValidationIssue
} from "./types.js";
import {
  isBiomeKey,
  isTagKey,
  isTerrainKey,
  validateCoordinate,
  validateTerrainBiomePair
} from "./validation.js";

function findIndex(cells: DesignedCellRecord[], target: GridCoordinate): number {
  return cells.findIndex((cell) => cell.row === target.row && cell.col === target.col);
}

function upsertCell(cells: DesignedCellRecord[], cell: DesignedCellRecord): void {
  const index = findIndex(cells, cell);
  if (index >= 0) {
    cells[index] = cell;
  } else {
    cells.push(cell);
  }
}

function removeCell(cells: DesignedCellRecord[], target: GridCoordinate): boolean {
  const index = findIndex(cells, target);
  if (index === -1) {
    return false;
  }
  cells.splice(index, 1);
  return true;
}

function validateTags(tags: unknown, target: string): ValidationIssue[] {
  if (!Array.isArray(tags)) {
    return [
      {
        code: "invalid_tags",
        message: "tags must be an array",
        severity: "invalid",
        target
      }
    ];
  }

  const invalid = tags.filter((tag) => !isTagKey(tag));
  if (invalid.length > 0) {
    return [
      {
        code: "invalid_tag_value",
        message: `unknown tag values: ${invalid.join(", ")}`,
        severity: "invalid",
        target
      }
    ];
  }

  return [];
}

function finalize(
  previous: MapRuntimeState,
  document: typeof previous.document,
  changed: GridCoordinate[],
  warnings: ValidationIssue[],
  errors: ValidationIssue[],
  label: string,
  source: "webui" | "cli" | "system" = "system"
): CommandResult {
  if (errors.some((entry) => entry.severity === "invalid")) {
    return {
      ok: false,
      map: previous,
      changed: [],
      warnings,
      errors
    };
  }

  const normalized = normalizeDocument(document);
  const map = pushHistory(previous, previous.document, normalized, label, source);
  return {
    ok: true,
    map,
    changed,
    warnings,
    errors
  };
}

export function applyCommand(state: MapRuntimeState, command: MapCommand): CommandResult {
  const working = cloneDocument(state.document);
  const warnings: ValidationIssue[] = [];
  const errors: ValidationIssue[] = [];
  const changed: GridCoordinate[] = [];
  const source = command.source ?? "system";

  switch (command.action) {
    case "set_cell": {
      errors.push(...validateCoordinate(command.target, "target"));
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
      if (command.changes.tags !== undefined) {
        errors.push(...validateTags(command.changes.tags, "changes.tags"));
      }
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "set_cell", source);
      }

      const biome = command.changes.biome ?? null;
      warnings.push(...validateTerrainBiomePair(command.changes.terrain, biome, "changes"));
      if (warnings.some((entry) => entry.severity === "invalid")) {
        return finalize(state, working, [], warnings, warnings.filter((entry) => entry.severity === "invalid"), "set_cell", source);
      }

      upsertCell(working.cells, {
        row: command.target.row,
        col: command.target.col,
        terrain: command.changes.terrain,
        biome,
        tags: [...new Set(command.changes.tags ?? [])],
        note: command.changes.note ?? ""
      });
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      changed.push(command.target);
      return finalize(state, working, changed, warnings.filter((entry) => entry.severity === "warning"), [], "set_cell", source);
    }

    case "set_cells": {
      const targetErrors = command.targets.flatMap((target, index) =>
        validateCoordinate(target, `targets[${index}]`)
      );
      errors.push(...targetErrors);
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
      if (command.changes.tags !== undefined) {
        errors.push(...validateTags(command.changes.tags, "changes.tags"));
      }
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "set_cells", source);
      }

      const biome = command.changes.biome ?? null;
      warnings.push(...validateTerrainBiomePair(command.changes.terrain, biome, "changes"));
      const invalidWarnings = warnings.filter((entry) => entry.severity === "invalid");
      if (invalidWarnings.length > 0) {
        return finalize(state, working, [], warnings.filter((entry) => entry.severity === "warning"), invalidWarnings, "set_cells", source);
      }

      for (const target of command.targets) {
        upsertCell(working.cells, {
          row: target.row,
          col: target.col,
          terrain: command.changes.terrain,
          biome,
          tags: [...new Set(command.changes.tags ?? [])],
          note: command.changes.note ?? ""
        });
        changed.push(target);
      }
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      return finalize(state, working, changed, warnings.filter((entry) => entry.severity === "warning"), [], "set_cells", source);
    }

    case "clear_cell": {
      errors.push(...validateCoordinate(command.target, "target"));
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "clear_cell", source);
      }
      const removed = removeCell(working.cells, command.target);
      if (removed) {
        working.meta.updated_at = new Date().toISOString();
        working.meta.revision += 1;
        changed.push(command.target);
      }
      return finalize(state, working, changed, warnings, [], "clear_cell", source);
    }

    case "replace_terrain": {
      if (!isTerrainKey(command.match.terrain) || !isTerrainKey(command.changes.terrain)) {
        return finalize(
          state,
          working,
          [],
          [],
          [
            {
              code: "invalid_terrain",
              message: "replace_terrain requires known terrain keys",
              severity: "invalid",
              target: "match/changess"
            }
          ],
          "replace_terrain",
          source
        );
      }
      working.cells = working.cells.map((cell) => {
        if (cell.terrain !== command.match.terrain) {
          return cell;
        }
        changed.push({ row: cell.row, col: cell.col });
        warnings.push(...validateTerrainBiomePair(command.changes.terrain, cell.biome, createCellId(cell.row, cell.col)));
        return {
          ...cell,
          terrain: command.changes.terrain
        };
      });
      const invalidWarnings = warnings.filter((entry) => entry.severity === "invalid");
      if (invalidWarnings.length > 0) {
        return finalize(state, state.document, [], warnings.filter((entry) => entry.severity === "warning"), invalidWarnings, "replace_terrain", source);
      }
      if (changed.length > 0) {
        working.meta.updated_at = new Date().toISOString();
        working.meta.revision += 1;
      }
      return finalize(state, working, changed, warnings.filter((entry) => entry.severity === "warning"), [], "replace_terrain", source);
    }

    case "replace_biome": {
      if (command.match.biome !== null && !isBiomeKey(command.match.biome)) {
        return finalize(
          state,
          working,
          [],
          [],
          [
            {
              code: "invalid_biome",
              message: "match.biome must be null or a known biome key",
              severity: "invalid",
              target: "match.biome"
            }
          ],
          "replace_biome",
          source
        );
      }
      if (command.changes.biome !== null && !isBiomeKey(command.changes.biome)) {
        return finalize(
          state,
          working,
          [],
          [],
          [
            {
              code: "invalid_biome",
              message: "changes.biome must be null or a known biome key",
              severity: "invalid",
              target: "changes.biome"
            }
          ],
          "replace_biome",
          source
        );
      }
      working.cells = working.cells.map((cell) => {
        if (cell.biome !== command.match.biome) {
          return cell;
        }
        changed.push({ row: cell.row, col: cell.col });
        warnings.push(...validateTerrainBiomePair(cell.terrain, command.changes.biome, createCellId(cell.row, cell.col)));
        return {
          ...cell,
          biome: command.changes.biome
        };
      });
      const invalidWarnings = warnings.filter((entry) => entry.severity === "invalid");
      if (invalidWarnings.length > 0) {
        return finalize(state, state.document, [], warnings.filter((entry) => entry.severity === "warning"), invalidWarnings, "replace_biome", source);
      }
      if (changed.length > 0) {
        working.meta.updated_at = new Date().toISOString();
        working.meta.revision += 1;
      }
      return finalize(state, working, changed, warnings.filter((entry) => entry.severity === "warning"), [], "replace_biome", source);
    }

    case "annotate_cell": {
      errors.push(...validateCoordinate(command.target, "target"));
      if (command.changes.tags !== undefined) {
        errors.push(...validateTags(command.changes.tags, "changes.tags"));
      }
      if (command.changes.note !== undefined && typeof command.changes.note !== "string") {
        errors.push({
          code: "invalid_note",
          message: "note must be a string",
          severity: "invalid",
          target: "changes.note"
        });
      }
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "annotate_cell", source);
      }
      const index = findIndex(working.cells, command.target);
      if (index === -1) {
        return finalize(
          state,
          working,
          [],
          warnings,
          [
            {
              code: "missing_cell",
              message: "annotate_cell requires an existing designed cell",
              severity: "invalid",
              target: "target"
            }
          ],
          "annotate_cell",
          source
        );
      }
      const existing = working.cells[index]!;
      working.cells[index] = {
        ...existing,
        tags: [...new Set(command.changes.tags ?? existing.tags)],
        note: command.changes.note ?? existing.note
      };
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      changed.push(command.target);
      return finalize(state, working, changed, warnings, [], "annotate_cell", source);
    }

    default:
      return finalize(
        state,
        working,
        [],
        [],
        [
          {
            code: "unknown_command",
            message: `unknown command action ${(command as { action: string }).action}`,
            severity: "invalid",
            target: "action"
          }
        ],
        "unknown",
        source
      );
  }
}
