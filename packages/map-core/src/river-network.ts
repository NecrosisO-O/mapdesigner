import type { RiverFeature, RiverPoint, RiverPointReference, ValidationIssue } from "./types.js";

const invalid = (message: string, target?: string): ValidationIssue => ({
  code: "invalid_river_connection",
  severity: "invalid",
  message,
  target
});

/** A visual crossing has no topology unless both controls explicitly name a junction. */
export function validateRiverNetwork(rivers: RiverFeature[]): ValidationIssue[] {
  const nodes = new Map<string, RiverPoint>();
  const issues: ValidationIssue[] = [];
  for (const river of rivers) {
    if (!river || !Array.isArray(river.points)) continue;
    river.points.forEach((point, index) => {
      if (!point?.junction_id) return;
      const previous = nodes.get(point.junction_id);
      if (previous && (previous.row !== point.row || previous.col !== point.col))
        issues.push(
          invalid("connected river points must share a coordinate", `${river.id}.points[${index}]`)
        );
      else nodes.set(point.junction_id, point);
    });
  }
  return issues;
}

/** Move all members when an existing shared control moves. New attachments must already coincide. */
export function propagateRiverJunctions(
  rivers: RiverFeature[],
  before: RiverFeature,
  after: RiverFeature
): void {
  const oldNodes = new Map(
    before.points.filter((p) => p.junction_id).map((p) => [p.junction_id!, p])
  );
  for (const moved of after.points) {
    if (!moved.junction_id) continue;
    const previous = oldNodes.get(moved.junction_id);
    if (!previous || (previous.row === moved.row && previous.col === moved.col)) continue;
    for (const river of rivers) {
      if (river.id === after.id) continue;
      for (const point of river.points) {
        if (point.junction_id === moved.junction_id) {
          point.row = moved.row;
          point.col = moved.col;
        }
      }
    }
  }
}

/** Join at the first reference, including every existing member of merged junctions. */
export function connectRiverPoints(
  rivers: RiverFeature[],
  refs: RiverPointReference[]
): ValidationIssue[] {
  const points = refs.map(
    (ref) => rivers.find((r) => r.id === ref.river_id)?.points[ref.point_index]
  );
  if (points.some((p) => !p)) return [invalid("a referenced river point was not found")];
  if (new Set(refs.map((ref) => `${ref.river_id}:${ref.point_index}`)).size < 2)
    return [invalid("a connection needs two distinct controls")];
  const selected = points as RiverPoint[];
  const first = selected[0]!;
  const oldIds = new Set(selected.flatMap((p) => (p.junction_id ? [p.junction_id] : [])));
  const used = new Set(
    rivers.flatMap((r) => r.points.flatMap((p) => (p.junction_id ? [p.junction_id] : [])))
  );
  let id = first.junction_id;
  if (!id) {
    let index = 1;
    while (used.has(`junction-${index}`)) index += 1;
    id = `junction-${index}`;
  }
  const selectedSet = new Set(selected);
  for (const river of rivers)
    for (const point of river.points) {
      if (selectedSet.has(point) || (point.junction_id && oldIds.has(point.junction_id))) {
        point.junction_id = id;
        point.row = first.row;
        point.col = first.col;
      }
    }
  return [];
}
