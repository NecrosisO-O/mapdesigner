import { createHash, randomUUID } from "node:crypto";
import {
  type MergeMapInput,
  type MergeMapPreview,
  type MapSummary,
  type CellRange,
  type RiverFeature,
  normalizeStoredRiver
} from "@mapdesigner/map-core";
import { getDatabase } from "./db.js";
import { badRequest, revisionConflict } from "./errors.js";
import { assertSafeMapId } from "./storage.js";
import {
  getMapSummary,
  getMapSummarySync,
  recordOperationSync,
  advanceMapRevisionSync,
  withMapTransaction,
  getHistoryStatusSync
} from "./repository.js";
import { getOverview } from "./overview.js";
import { ensureDerivedData } from "./derived-data.js";
import { MAX_STREAM_IMPORT_CELLS } from "./resource-limits.js";

export function normalizeMergeInput(value: MergeMapInput): MergeMapInput {
  if (!value || typeof value !== "object" || typeof value.sourceId !== "string")
    throw badRequest("请选择来源地图");
  for (const offset of [value.offsetRow, value.offsetCol])
    if (!Number.isSafeInteger(offset) || Math.abs(offset) > 1_000_000_000)
      throw badRequest("平移量必须是有效整数");
  if (!["keep-target", "replace-target"].includes(value.conflict))
    throw badRequest("请选择重叠格处理方式");
  for (const revision of [value.expectedSourceRevision, value.expectedTargetRevision])
    if (revision !== undefined && !Number.isSafeInteger(revision))
      throw badRequest("地图版本无效，请重新预览");
  return {
    sourceId: assertSafeMapId(value.sourceId),
    offsetRow: value.offsetRow,
    offsetCol: value.offsetCol,
    conflict: value.conflict,
    expectedSourceRevision: value.expectedSourceRevision,
    expectedTargetRevision: value.expectedTargetRevision
  };
}
function rangeOf(summary: MapSummary): CellRange {
  const b = summary.render_bounds ?? summary.bounds;
  return {
    minRow: b.min_row ?? 0,
    maxRow: b.max_row ?? 0,
    minCol: b.min_col ?? 0,
    maxCol: b.max_col ?? 0
  };
}
function* riverRows(id: string): Generator<{ feature_id: string; json: string }> {
  const read = getDatabase().prepare(
    "SELECT feature_id,json FROM features WHERE map_id=? AND kind='river' AND feature_id>? ORDER BY feature_id LIMIT 1"
  );
  let last = "";
  for (;;) {
    const row = read.get(id, last) as { feature_id: string; json: string } | undefined;
    if (!row) return;
    last = row.feature_id;
    yield row;
  }
}
function mergeStats(targetId: string, input: MergeMapInput) {
  if (targetId === input.sourceId) throw badRequest("请选择另一张地图作为来源");
  const target = getMapSummarySync(targetId),
    source = getMapSummarySync(input.sourceId);
  if (target.grid.layout !== source.grid.layout)
    throw badRequest("地图网格不兼容，仅支持相同六边形网格");
  if (
    (input.expectedSourceRevision !== undefined &&
      input.expectedSourceRevision !== source.meta.revision) ||
    (input.expectedTargetRevision !== undefined &&
      input.expectedTargetRevision !== target.meta.revision)
  )
    throw revisionConflict("来源或目标地图已改变，请重新预览");
  const r = rangeOf(source);
  if (
    ![
      r.minRow + input.offsetRow,
      r.maxRow + input.offsetRow,
      r.minCol + input.offsetCol,
      r.maxCol + input.offsetCol
    ].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000_000)
  )
    throw badRequest("平移后的地图超出坐标范围");
  const overlapping = (
    getDatabase()
      .prepare(
        `SELECT count(*) n FROM cells s JOIN cells t ON t.map_id=? AND t.row=s.row+? AND t.col=s.col+? WHERE s.map_id=?`
      )
      .get(targetId, input.offsetRow, input.offsetCol, input.sourceId) as { n: number }
  ).n;
  const added = source.designed_cell_count - overlapping;
  if (target.designed_cell_count + added > MAX_STREAM_IMPORT_CELLS)
    throw badRequest("合并结果超过 2500 万格，请分区整理地图");
  if (target.feature_counts.rivers + source.feature_counts.rivers > 20_000)
    throw badRequest("合并结果超过 2 万条河流");
  let samples = 0;
  for (const id of [targetId, input.sourceId])
    for (const entry of riverRows(id)) {
      const river = JSON.parse(entry.json) as RiverFeature;
      for (let i = 1; i < river.points.length; i++) {
        const a = river.points[i - 1]!,
          b = river.points[i]!;
        samples +=
          Math.max(
            Math.abs(a.row - b.row),
            Math.abs(a.col - b.col),
            Math.abs(a.row + a.col - b.row - b.col)
          ) + 1;
      }
      if (samples > 500_000) throw badRequest("合并后的河流路径总长度超过 50 万格");
    }
  return {
    target,
    source,
    added,
    overlapping,
    replaced: input.conflict === "replace-target" ? overlapping : 0,
    rivers: source.feature_counts.rivers
  };
}
export async function previewMapMerge(
  targetId: string,
  raw: MergeMapInput
): Promise<MergeMapPreview> {
  const input = normalizeMergeInput(raw);
  await getMapSummary(targetId);
  await getMapSummary(input.sourceId);
  const stats = mergeStats(targetId, input);
  const [targetOverview, sourceOverview] = await Promise.all([
    getOverview(targetId, rangeOf(stats.target)),
    getOverview(input.sourceId, rangeOf(stats.source))
  ]);
  const conflicts = getDatabase()
    .prepare(
      `SELECT t.row,t.col FROM cells s JOIN cells t ON t.map_id=? AND t.row=s.row+? AND t.col=s.col+? WHERE s.map_id=? LIMIT 500`
    )
    .all(targetId, input.offsetRow, input.offsetCol, input.sourceId) as Array<{
    row: number;
    col: number;
  }>;
  return {
    ...stats,
    input: {
      ...input,
      expectedTargetRevision: stats.target.meta.revision,
      expectedSourceRevision: stats.source.meta.revision
    },
    targetOverview,
    sourceOverview,
    conflicts
  };
}

const rowJson = (alias: string) =>
  `json_object('terrain',${alias}.terrain,'biome',${alias}.biome,'tags',json(${alias}.tags_json),'note',${alias}.note)`;

/** Restore SQL-backed deltas without constructing per-cell command arrays. Caller owns the transaction. */
export function restoreMergedOperation(id: string, seq: number, direction: "undo" | "redo"): void {
  const db = getDatabase(),
    field = direction === "undo" ? "before_json" : "after_json";
  db.prepare("DELETE FROM derived_maps WHERE map_id=?").run(id);
  db.prepare(
    `DELETE FROM cells WHERE map_id=? AND (row,col) IN (SELECT row,col FROM operation_cells WHERE map_id=? AND seq=? AND ${field} IS NULL)`
  ).run(id, id, seq);
  db.prepare(
    `INSERT INTO cells(map_id,row,col,terrain,biome,tags_json,note)
    SELECT map_id,row,col,json_extract(${field},'$.terrain'),json_extract(${field},'$.biome'),json_extract(${field},'$.tags'),json_extract(${field},'$.note')
    FROM operation_cells WHERE map_id=? AND seq=? AND ${field} IS NOT NULL
    ON CONFLICT(map_id,row,col) DO UPDATE SET terrain=excluded.terrain,biome=excluded.biome,tags_json=excluded.tags_json,note=excluded.note`
  ).run(id, seq);
  if (direction === "undo")
    db.prepare(
      "DELETE FROM features WHERE map_id=? AND feature_id IN (SELECT feature_id FROM operation_features WHERE map_id=? AND seq=?) AND kind='river'"
    ).run(id, id, seq);
  else {
    const read = db.prepare(
      "SELECT feature_id,after_json FROM operation_features WHERE map_id=? AND seq=? AND feature_id>? ORDER BY feature_id LIMIT 1"
    );
    let last = "";
    for (;;) {
      const record = read.get(id, seq, last) as
        { feature_id: string; after_json: string } | undefined;
      if (!record) break;
      last = record.feature_id;
      writeMergedRiver(id, JSON.parse(record.after_json) as RiverFeature);
    }
  }
  refreshAggregates(id);
  advanceMapRevisionSync(id, 1);
}
function refreshAggregates(id: string): void {
  const db = getDatabase();
  const bounds = ["row ASC", "row DESC", "col ASC", "col DESC"].map(
    (order) =>
      (
        db
          .prepare(
            `SELECT ${order.split(" ")[0]} value FROM cells WHERE map_id=? ORDER BY ${order} LIMIT 1`
          )
          .get(id) as { value: number } | undefined
      )?.value ?? null
  );
  db.prepare(
    "UPDATE maps SET designed_cell_count=(SELECT count(*) FROM cells WHERE map_id=?),bounds_min_row=?,bounds_max_row=?,bounds_min_col=?,bounds_max_col=? WHERE id=?"
  ).run(id, ...bounds, id);
  ensureDerivedData(db, id);
}
function writeMergedRiver(id: string, river: RiverFeature): void {
  let minRow = Infinity,
    maxRow = -Infinity,
    minCol = Infinity,
    maxCol = -Infinity;
  for (const p of river.points) {
    minRow = Math.min(minRow, p.row);
    maxRow = Math.max(maxRow, p.row);
    minCol = Math.min(minCol, p.col);
    maxCol = Math.max(maxCol, p.col);
  }
  getDatabase()
    .prepare("INSERT INTO features VALUES (?,'river',?,?,?,?,?,?)")
    .run(id, river.id, JSON.stringify(river), minRow, maxRow, minCol, maxCol);
}
export async function mergeMaps(
  targetId: string,
  raw: MergeMapInput,
  control: {
    beforeCommit?: () => void;
    checkCancelled?: () => void;
    progress?: (stage: string) => void;
  } = {}
) {
  const input = normalizeMergeInput(raw);
  if (input.expectedSourceRevision === undefined || input.expectedTargetRevision === undefined)
    throw badRequest("请先预览并确认地图版本");
  await getMapSummary(input.sourceId);
  return withMapTransaction(targetId, () => {
    const db = getDatabase(),
      stats = mergeStats(targetId, input);
    control.checkCancelled?.();
    if (stats.added + stats.replaced + stats.rivers === 0)
      throw badRequest("没有可合并的内容，请调整位置或重叠策略");
    const op = recordOperationSync(targetId, {
      source: "webui",
      action: "merge_maps",
      commands: [],
      inverseCommands: [],
      summary: {
        rules_version: 3,
        history_description: `合并「${stats.source.meta.name}」 · 新增 ${stats.added} 格 · 替换 ${stats.replaced} 格 · ${stats.rivers} 条河流`
      }
    });
    control.progress?.("正在记录合并内容与撤销历史");
    db.prepare(
      `INSERT INTO operation_cells(map_id,seq,row,col,before_json,after_json)
      SELECT ?,?,s.row+?,s.col+?,CASE WHEN t.row IS NULL THEN NULL ELSE ${rowJson("t")} END,${rowJson("s")}
      FROM cells s LEFT JOIN cells t ON t.map_id=? AND t.row=s.row+? AND t.col=s.col+?
      WHERE s.map_id=? ${input.conflict === "keep-target" ? "AND t.row IS NULL" : ""}`
    ).run(
      targetId,
      op.seq,
      input.offsetRow,
      input.offsetCol,
      targetId,
      input.offsetRow,
      input.offsetCol,
      input.sourceId
    );
    const namespace = randomUUID();
    const identify = (kind: string, id: string) =>
      "m" +
      createHash("sha256")
        .update(namespace + ":" + kind + ":" + id)
        .digest("hex")
        .slice(0, 40);
    const add = db.prepare("INSERT INTO operation_features VALUES (?,?,?,?)");
    for (const entry of riverRows(input.sourceId)) {
      const river = normalizeStoredRiver(JSON.parse(entry.json));
      {
        river.id = identify("river", river.id);
        river.points = river.points.map((p) => ({
          ...p,
          row: p.row + input.offsetRow,
          col: p.col + input.offsetCol,
          ...(p.junction_id ? { junction_id: identify("junction", p.junction_id) } : {})
        }));
        add.run(targetId, op.seq, river.id, JSON.stringify(river));
      }
      control.checkCancelled?.();
    }
    control.progress?.("正在合并地图与更新概览");
    restoreMergedOperation(targetId, op.seq, "redo");
    control.beforeCommit?.();
    return {
      mapId: targetId,
      summary: getMapSummarySync(targetId),
      status: getHistoryStatusSync(targetId),
      added: stats.added,
      replaced: stats.replaced,
      rivers: stats.rivers,
      warnings: []
    };
  });
}
