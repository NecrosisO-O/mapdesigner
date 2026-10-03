import type { MapHistory } from "./api.js";
import { formatDateTime } from "./useMapWorkspace.js";
const labels: Record<string, string> = {
  set_cell: "修改格子",
  set_cells: "绘制地形",
  patch_cells: "批量修改字段",
  clear_cell: "清空格子",
  replace_terrain: "全图替换地形",
  replace_biome: "全图替换生态",
  annotate_cell: "修改标记与备注",
  create_river: "新建河流",
  update_river: "修改河流",
  delete_river: "删除河流",
  set_river_path: "移动河流节点",
  set_river_width: "调整河宽",
  connect_river_points: "连接河流节点",
  disconnect_river_point: "解除河流连接",
  set_map_style: "切换地图样式",
  commands: "组合编辑",
  restore_rivers: "恢复河流"
};
export function HistoryPanel({ history }: { history: MapHistory | null }) {
  return (
    <div className="history-panel">
      <p>
        已完成 {history?.status.cursor ?? 0} 步 · 可重做{" "}
        {Math.max(0, (history?.status.latest ?? 0) - (history?.status.cursor ?? 0))} 步
      </p>
      {history?.entries.length ? (
        history.entries.map((entry) => (
          <article
            className="history-entry"
            key={entry.seq}
            data-undone={entry.seq > history.status.cursor}
          >
            <strong>
              {entry.seq}. {labels[entry.action] ?? "地图编辑"}
            </strong>
            <span>
              {entry.description ? entry.description + " · " : ""}
              {entry.seq > history.status.cursor ? "已撤销，可重做" : "已应用"}
            </span>
            <span>
              {formatDateTime(entry.timestamp)} ·{" "}
              {{ webui: "编辑器", cli: "命令行", system: "系统" }[entry.source]}
            </span>
          </article>
        ))
      ) : (
        <p>完成一次编辑后，可以在这里查看操作记录。</p>
      )}
    </div>
  );
}
