import type { RiverFeature, ValidationIssue } from "./types.js";
import {
  isRiverId,
  validateCoordinate,
  validateRiverFeature,
  validateRiverPoint
} from "./validation.js";

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
  if (action === "set_map_style" && !["classic-v1", "atlas-v1"].includes(String(input.style)))
    invalid("style", "unknown map style");
  if (
    ![
      "set_map_style",
      "connect_river_points",
      "disconnect_river_point",
      "restore_rivers",
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
  if (action === "connect_river_points" || action === "disconnect_river_point") {
    const refs = action === "connect_river_points" ? input.points : [input.point];
    if (!Array.isArray(refs) || (action === "connect_river_points" && refs.length < 2))
      invalid("points", "a connection needs at least two controls");
    else
      for (const ref of refs)
        if (
          !record(ref) ||
          !isRiverId(ref.river_id) ||
          !Number.isSafeInteger(ref.point_index) ||
          Number(ref.point_index) < 0
        )
          invalid("points", "invalid river point reference");
  }
  if (action === "restore_rivers") {
    if (!Array.isArray(input.rivers) || !Array.isArray(input.remove_ids))
      invalid("rivers", "rivers and remove_ids must be arrays");
    else {
      input.rivers.forEach((river, index) => issues.push(...validateRiverFeature(river, index)));
      if (input.remove_ids.some((id) => !isRiverId(id))) invalid("remove_ids", "invalid river id");
      const ids = input.rivers.map((r) => (record(r) ? r.id : null));
      if (new Set(ids).size !== ids.length) invalid("rivers", "duplicate river ids");
    }
  }
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
      for (const [key, allowed] of Object.entries({
        flow_direction: ["unspecified", "forward", "reverse"],
        start_kind: ["auto", "spring", "water", "open"],
        end_kind: ["auto", "spring", "water", "open"]
      }))
        if (changes[key] !== undefined && !allowed.includes(String(changes[key])))
          invalid(`changes.${key}`, `unknown ${key}`);
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
  if (action === "create_river" && record(input.river))
    issues.push(
      ...validateRiverFeature({ ...input.river, id: input.river.id ?? "pending" } as RiverFeature)
    );
  return issues;
}
