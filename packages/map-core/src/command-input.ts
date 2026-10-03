import type { ValidationIssue } from "./types.js";
import { validateCoordinate, validateRiverPoint } from "./validation.js";

/** Check untyped input before command evaluation dereferences or normalizes it. */
export function validateCommandInput(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const invalid = (target: string, message: string) =>
    issues.push({ code: "invalid_command", target, message, severity: "invalid" });
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  if (!record(input)) {
    invalid("command", "command must be an object");
    return issues;
  }
  const action = input.action;
  if (
    ![
      "patch_cells",
      "set_cell",
      "set_cells",
      "clear_cell",
      "annotate_cell",
      "replace_terrain",
      "replace_biome",
      "create_river",
      "update_river",
      "delete_river",
      "set_river_path",
      "set_river_width"
    ].includes(String(action))
  ) {
    invalid("action", "unknown command action");
    return issues;
  }
  if (input.source !== undefined && !["system", "webui", "cli"].includes(String(input.source)))
    invalid("source", "unknown command source");
  if (["set_cell", "clear_cell", "annotate_cell", "set_river_width"].includes(String(action))) {
    issues.push(...validateCoordinate(input.target as never, "target"));
  }
  if (
    action === "patch_cells" &&
    input.tagMode !== undefined &&
    !["replace", "add", "remove"].includes(String(input.tagMode))
  )
    invalid("tagMode", "unknown tag operation");
  if (action === "set_cells" || action === "patch_cells") {
    if (!Array.isArray(input.targets)) invalid("targets", "targets must be an array");
    else
      for (const [i, target] of input.targets.entries())
        issues.push(...validateCoordinate(target, "targets[" + i + "]"));
  }
  if (
    [
      "patch_cells",
      "set_cell",
      "set_cells",
      "annotate_cell",
      "replace_terrain",
      "replace_biome",
      "update_river"
    ].includes(String(action))
  ) {
    if (!record(input.changes)) invalid("changes", "changes must be an object");
    else {
      const changes = input.changes;
      if (
        changes.width_mode !== undefined &&
        changes.width_mode !== "legacy" &&
        changes.width_mode !== "distance"
      )
        invalid("changes.width_mode", "unknown river width interpolation");
      if (changes.note !== undefined && typeof changes.note !== "string")
        invalid("changes.note", "note must be a string");
      if (changes.name !== undefined && (typeof changes.name !== "string" || !changes.name.trim()))
        invalid("changes.name", "name must be a non-empty string");
      if (
        changes.color !== undefined &&
        changes.color !== null &&
        typeof changes.color !== "string"
      )
        invalid("changes.color", "color must be a string or null");
      if (
        changes.opacity !== undefined &&
        changes.opacity !== null &&
        (typeof changes.opacity !== "number" || !Number.isFinite(changes.opacity))
      )
        invalid("changes.opacity", "opacity must be a finite number or null");
    }
  }
  if (action === "replace_terrain" || action === "replace_biome") {
    if (!record(input.match)) invalid("match", "match must be an object");
  }
  if (
    action === "create_river" &&
    (!record(input.river) || typeof input.river.name !== "string" || !input.river.name.trim())
  ) {
    invalid("river", "river must have a non-empty name");
  }
  const points =
    action === "create_river"
      ? record(input.river)
        ? input.river.points
        : undefined
      : action === "set_river_path"
        ? input.points
        : action === "update_river" && record(input.changes)
          ? input.changes.points
          : undefined;
  if (points !== undefined || action === "create_river" || action === "set_river_path") {
    if (!Array.isArray(points)) invalid("points", "points must be an array");
    else
      for (const [i, point] of points.entries())
        issues.push(...validateRiverPoint(point, "points[" + i + "]"));
  }
  return issues;
}
