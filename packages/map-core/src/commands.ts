import { createCellId, createDisplayCoord, sameCoord } from "./coords.js";
import { pushHistory } from "./history.js";
import { buildHexLine } from "./rivers.js";
import { cloneDocument, normalizeDocument } from "./serialization.js";
import type {
  ActiveCell,
  CellChangeDetail,
  CommandResult,
  DesignedCellRecord,
  GridCoordinate,
  MapCommand,
  MapRuntimeState,
  RiverFeature,
  RiverPoint,
  ValidationIssue
} from "./types.js";
import {
  isRiverId,
  isBiomeKey,
  isTagKey,
  isTerrainKey,
  validateCoordinate,
  validateRiverFeature,
  validateRiverPoint,
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

function createRiverId(name: string, existing: RiverFeature[]): string {
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

function normalizeRiverPoint(point: RiverPoint): RiverPoint {
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

function findRiverIndex(rivers: RiverFeature[], id: string): number {
  return rivers.findIndex((river) => river.id === id);
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

function cloneActiveCell(cell: ActiveCell): ActiveCell {
  return {
    ...cell,
    tags: [...cell.tags]
  };
}

function synthesizeUndesignedCell(target: GridCoordinate): ActiveCell {
  return {
    row: target.row,
    col: target.col,
    id: createCellId(target.row, target.col),
    display_coord: createDisplayCoord(target.row, target.col),
    status: "undesigned",
    terrain: null,
    biome: null,
    tags: [],
    note: ""
  };
}

function snapshotCell(state: MapRuntimeState, target: GridCoordinate): ActiveCell | null {
  const found = state.activeCells.find((cell) => sameCoord(cell, target));
  if (found) {
    return cloneActiveCell(found);
  }
  const existsInDocument = state.document.cells.some((cell) => sameCoord(cell, target));
  if (existsInDocument) {
    return null;
  }
  return synthesizeUndesignedCell(target);
}

function buildChangeDetails(
  previous: MapRuntimeState,
  next: MapRuntimeState,
  changed: GridCoordinate[]
): CellChangeDetail[] {
  return changed.map((target) => ({
    coord: { row: target.row, col: target.col },
    cell_id: createCellId(target.row, target.col),
    display_coord: createDisplayCoord(target.row, target.col),
    before: snapshotCell(previous, target),
    after: snapshotCell(next, target)
  }));
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
      details: [],
      warnings,
      errors
    };
  }

  const normalized = normalizeDocument(document);
  const map = pushHistory(previous, previous.document, normalized, label, source);
  const details = buildChangeDetails(previous, map, changed);
  return {
    ok: true,
    map,
    changed,
    details,
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

    case "create_river": {
      const river: RiverFeature = normalizeRiverFeature({
        id: command.river.id ?? createRiverId(command.river.name, working.features.rivers),
        name: command.river.name,
        points: command.river.points,
        color: command.river.color,
        opacity: command.river.opacity
      });
      if (working.features.rivers.some((entry) => entry.id === river.id)) {
        errors.push({
          code: "duplicate_river",
          message: `river ${river.id} already exists`,
          severity: "invalid",
          target: "river.id"
        });
      }
      errors.push(...validateRiverFeature(river));
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "create_river", source);
      }
      working.features.rivers.push(river);
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      return finalize(state, working, [], warnings, [], "create_river", source);
    }

    case "update_river": {
      if (!isRiverId(command.river_id)) {
        errors.push({
          code: "invalid_river_id",
          message: "river_id must be a valid river id",
          severity: "invalid",
          target: "river_id"
        });
      }
      const riverIndex = findRiverIndex(working.features.rivers, command.river_id);
      if (riverIndex === -1) {
        errors.push({
          code: "missing_river",
          message: `river ${command.river_id} was not found`,
          severity: "invalid",
          target: "river_id"
        });
      }
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "update_river", source);
      }
      const existing = working.features.rivers[riverIndex]!;
      const next = normalizeRiverFeature({
        ...existing,
        name: command.changes.name ?? existing.name,
        points: command.changes.points ?? existing.points,
        color: command.changes.color === undefined ? existing.color : command.changes.color,
        opacity: command.changes.opacity === undefined ? existing.opacity : command.changes.opacity
      });
      errors.push(...validateRiverFeature(next));
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "update_river", source);
      }
      working.features.rivers[riverIndex] = next;
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      return finalize(state, working, [], warnings, [], "update_river", source);
    }

    case "delete_river": {
      if (!isRiverId(command.river_id)) {
        errors.push({
          code: "invalid_river_id",
          message: "river_id must be a valid river id",
          severity: "invalid",
          target: "river_id"
        });
      }
      const riverIndex = findRiverIndex(working.features.rivers, command.river_id);
      if (riverIndex === -1) {
        errors.push({
          code: "missing_river",
          message: `river ${command.river_id} was not found`,
          severity: "invalid",
          target: "river_id"
        });
      }
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "delete_river", source);
      }
      working.features.rivers.splice(riverIndex, 1);
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      return finalize(state, working, [], warnings, [], "delete_river", source);
    }

    case "set_river_path": {
      if (!isRiverId(command.river_id)) {
        errors.push({
          code: "invalid_river_id",
          message: "river_id must be a valid river id",
          severity: "invalid",
          target: "river_id"
        });
      }
      const riverIndex = findRiverIndex(working.features.rivers, command.river_id);
      if (riverIndex === -1) {
        errors.push({
          code: "missing_river",
          message: `river ${command.river_id} was not found`,
          severity: "invalid",
          target: "river_id"
        });
      }
      command.points.forEach((point, index) => {
        errors.push(...validateRiverPoint(point, `points[${index}]`));
      });
      if (command.points.length < 2) {
        errors.push({
          code: "invalid_river_points",
          message: "river requires at least two points",
          severity: "invalid",
          target: "points"
        });
      }
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "set_river_path", source);
      }
      const existing = working.features.rivers[riverIndex]!;
      const next = normalizeRiverFeature({
        ...existing,
        points: command.points
      });
      errors.push(...validateRiverFeature(next));
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "set_river_path", source);
      }
      working.features.rivers[riverIndex] = next;
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      return finalize(state, working, [], warnings, [], "set_river_path", source);
    }

    case "set_river_width": {
      if (!isRiverId(command.river_id)) {
        errors.push({
          code: "invalid_river_id",
          message: "river_id must be a valid river id",
          severity: "invalid",
          target: "river_id"
        });
      }
      errors.push(...validateCoordinate(command.target, "target"));
      errors.push(...validateRiverPoint({ ...command.target, width: command.width }, "target"));
      const riverIndex = findRiverIndex(working.features.rivers, command.river_id);
      if (riverIndex === -1) {
        errors.push({
          code: "missing_river",
          message: `river ${command.river_id} was not found`,
          severity: "invalid",
          target: "river_id"
        });
      }
      if (errors.length > 0) {
        return finalize(state, working, [], warnings, errors, "set_river_width", source);
      }
      const river = working.features.rivers[riverIndex]!;
      const pointIndex = river.points.findIndex((point) => point.row === command.target.row && point.col === command.target.col);
      if (pointIndex === -1) {
        if (!insertRiverWidthAnchor(river, command.target, command.width)) {
          return finalize(
            state,
            working,
            [],
            warnings,
            [
              {
                code: "missing_river_point",
                message: "set_river_width target must be on the river path",
                severity: "invalid",
                target: "target"
              }
            ],
            "set_river_width",
            source
          );
        }
      } else {
        river.points[pointIndex] = {
          ...river.points[pointIndex]!,
          width: command.width
        };
      }
      working.features.rivers[riverIndex] = normalizeRiverFeature(river);
      working.meta.updated_at = new Date().toISOString();
      working.meta.revision += 1;
      return finalize(state, working, [], warnings, [], "set_river_width", source);
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
