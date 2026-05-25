import {
  BIOME_ENTRIES,
  TAG_ENTRIES,
  TERRAIN_CATEGORY_LABELS,
  type ActiveCell,
  type BiomeKey,
  type MapRuntimeState
} from "@mapdesigner/map-core";
import type { TerrainCategoryKey } from "@mapdesigner/map-core";
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
  filteredTerrainCategories: TerrainCategoryKey[];
  terrainOptions: Array<{ key: string; label: string; short: string }>;
  biomeOptions: BiomeKey[];
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
      <section className="panel cell-editor-panel">
        <div className="cell-editor-heading">
          <div>
            <h2>当前单元格</h2>
            <p>
              {props.selectedCell
                ? `${props.selectedCell.display_coord} · ${props.selectedCell.status}`
                : "未选择单元格"}
            </p>
          </div>
          {props.cellDirty ? <span className="status-chip status-chip-dirty">未应用</span> : null}
        </div>

        <div className="panel-header">
          <div className="action-row action-row-inline">
            <button className="primary-button" onClick={props.onApplyDraft} disabled={!props.selectedCell}>
              应用
            </button>
            <button onClick={props.onRevertDraft} disabled={!props.selectedCell || !props.cellDirty}>
              还原
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
            <label className="checkbox-row switch-row">
              <input
                type="checkbox"
                checked={props.formatBrushScope.terrain}
                onChange={(event) => props.onFormatBrushScopeChange("terrain", event.target.checked)}
                disabled={!props.selectedCell}
              />
              刷地形
            </label>
            <label className="checkbox-row switch-row">
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

        <div className="editor-section">
          <h3>地貌</h3>
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
        </div>

        <div className="editor-section">
          <h3>生态</h3>
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
        </div>

        <div className="editor-section">
          <h3>标记</h3>
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
        </div>

        <div className="editor-section">
          <h3>备注</h3>
          <label>
            Note
            <textarea
              rows={6}
              value={props.draft.note}
              disabled={!props.selectedCell}
              onChange={(event) => props.onNoteChange(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="panel history-panel">
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
