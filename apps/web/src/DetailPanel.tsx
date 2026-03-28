import {
  BIOME_ENTRIES,
  TAG_ENTRIES,
  TERRAIN_CATEGORY_LABELS,
  type ActiveCell,
  type MapRuntimeState
} from "@mapdesigner/map-core";
import type { CellDraft, FormatBrushScope } from "./useCellEditor.js";
import { formatDateTime } from "./useMapWorkspace.js";

const HISTORY_LABELS: Record<string, string> = {
  set_cell: "设置单元格",
  set_cells: "批量设置单元格",
  clear_cell: "清空单元格",
  replace_terrain: "批量替换地形",
  replace_biome: "批量替换生态",
  annotate_cell: "更新标记/备注"
};

interface DetailPanelProps {
  currentMap: MapRuntimeState | null;
  selectedCell: ActiveCell | null;
  draft: CellDraft;
  terrainCategory: string;
  filteredTerrainCategories: string[];
  terrainOptions: Array<{ key: string; label: string; short: string }>;
  biomeOptions: string[];
  formatBrushEnabled: boolean;
  formatBrushScope: FormatBrushScope;
  canUseFormatBrush: boolean;
  cellDirty: boolean;
  onApplyDraft: () => void;
  onRevertDraft: () => void;
  onClearSelected: () => void;
  onToggleFormatBrush: () => void;
  onFormatBrushScopeChange: (field: keyof FormatBrushScope, value: boolean) => void;
  onTerrainCategoryChange: (value: string) => void;
  onTerrainChange: (value: string) => void;
  onBiomeChange: (value: string) => void;
  onTagChange: (tagKey: string, checked: boolean) => void;
  onNoteChange: (value: string) => void;
  getFormatBrushLabel: () => string;
}

export function DetailPanel(props: DetailPanelProps) {
  return (
    <aside className="detail-panel">
      <section className="panel">
        <div className="panel-header">
          <div className="action-row action-row-inline">
            <button onClick={props.onApplyDraft} disabled={!props.selectedCell}>
              保存
            </button>
            <button onClick={props.onRevertDraft} disabled={!props.selectedCell || !props.cellDirty}>
              撤销
            </button>
            <button onClick={props.onClearSelected} disabled={!props.selectedCell}>
              清空
            </button>
            <button
              type="button"
              className={props.formatBrushEnabled ? "toggle-button-active" : undefined}
              aria-pressed={props.formatBrushEnabled}
              onClick={props.onToggleFormatBrush}
              disabled={!props.canUseFormatBrush}
            >
              格式刷
            </button>
          </div>
        </div>
        <div className="format-brush-panel">
          <div className="format-brush-options">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={props.formatBrushScope.terrain}
                onChange={(event) => props.onFormatBrushScopeChange("terrain", event.target.checked)}
                disabled={!props.selectedCell}
              />
              刷地形
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={props.formatBrushScope.biome}
                onChange={(event) => props.onFormatBrushScopeChange("biome", event.target.checked)}
                disabled={!props.selectedCell}
              />
              刷生态
            </label>
          </div>
          {props.formatBrushEnabled && props.selectedCell ? (
            <p className="format-brush-summary">
              格式刷源格：{props.selectedCell.display_coord} | 当前刷入：{props.getFormatBrushLabel()}
            </p>
          ) : (
            <p className="format-brush-summary">
              选中已设计单元格后可进入格式刷模式；再次点击按钮即可退出。
            </p>
          )}
        </div>
        <label>
          Terrain 分类
          <select
            value={props.terrainCategory}
            onChange={(event) => props.onTerrainCategoryChange(event.target.value)}
            disabled={!props.selectedCell}
          >
            <option value="">请选择分类</option>
            {props.filteredTerrainCategories.map((categoryKey) => (
              <option key={categoryKey} value={categoryKey}>
                {TERRAIN_CATEGORY_LABELS[categoryKey]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Terrain
          <select
            value={props.draft.terrain}
            onChange={(event) => props.onTerrainChange(event.target.value)}
            disabled={!props.selectedCell || !props.terrainCategory}
          >
            <option value="">{props.terrainCategory ? "未设置" : "请先选择 Terrain 分类"}</option>
            {props.terrainOptions.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.short})
              </option>
            ))}
          </select>
        </label>
        <label>
          Biome
          <select
            value={props.draft.biome}
            onChange={(event) => props.onBiomeChange(event.target.value)}
            disabled={!props.selectedCell}
          >
            <option value="">未设置</option>
            {props.biomeOptions.map((key) => (
              <option key={key} value={key}>
                {BIOME_ENTRIES[key].label} ({BIOME_ENTRIES[key].short})
              </option>
            ))}
          </select>
        </label>
        <div className="tag-grid">
          {Object.entries(TAG_ENTRIES).map(([key, entry]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={props.draft.tags.includes(key)}
                disabled={!props.selectedCell}
                onChange={(event) => props.onTagChange(key, event.target.checked)}
              />
              {entry.label}
            </label>
          ))}
        </div>
        <label>
          Note
          <textarea
            rows={6}
            value={props.draft.note}
            disabled={!props.selectedCell}
            onChange={(event) => props.onNoteChange(event.target.value)}
          />
        </label>
      </section>

      <section className="panel">
        <h2>编辑历史</h2>
        {props.currentMap ? (
          <>
            <p>
              已记录 {props.currentMap.history.past.length} 步 | 可重做 {props.currentMap.history.future.length} 步
            </p>
            {props.currentMap.history.past.length > 0 ? (
              <div className="history-list">
                {props.currentMap.history.past
                  .slice(-5)
                  .reverse()
                  .map((entry) => (
                    <div key={`${entry.timestamp}-${entry.label}`} className="history-entry">
                      <strong>{HISTORY_LABELS[entry.label] ?? entry.label}</strong>
                      <span>{entry.source} · {formatDateTime(entry.timestamp)}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p>当前会话还没有编辑历史。</p>
            )}
          </>
        ) : (
          <p>打开地图后会显示当前会话历史。</p>
        )}
      </section>
    </aside>
  );
}
