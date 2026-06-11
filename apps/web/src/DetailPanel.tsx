import {
  BIOME_ENTRIES,
  TAG_ENTRIES,
  TERRAIN_CATEGORY_LABELS,
  type ActiveCell,
  type BiomeKey,
  type MapRuntimeState,
  type RiverFeature,
  type TagKey
} from "@mapdesigner/map-core";
import type { TerrainCategoryKey } from "@mapdesigner/map-core";
import { AdvancedEditPanel } from "./AdvancedEditPanel.js";
import type {
  BatchEditDraft,
  ReplaceBiomeDraft,
  ReplaceTerrainDraft
} from "./useAdvancedEditor.js";
import type { CellDraft, FormatBrushScope } from "./useCellEditor.js";
import type { RiverDraft } from "./useRiverEditor.js";
import { formatDateTime } from "./useMapWorkspace.js";

const HISTORY_LABELS: Record<string, string> = {
  set_cell: "设置单元格",
  set_cells: "批量设置单元格",
  clear_cell: "清空单元格",
  replace_terrain: "批量替换地形",
  replace_biome: "批量替换生态",
  annotate_cell: "更新标记/备注",
  create_river: "创建河流",
  update_river: "更新河流",
  delete_river: "删除河流",
  set_river_path: "更新河流路径",
  set_river_width: "更新河流宽度"
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
  rivers: RiverFeature[];
  selectedRiverId: string;
  riverDraft: RiverDraft;
  riverDirty: boolean;
  riverDrawingStatus: "idle" | "drawing";
  riverDrawingPointCount: number;
  batchModeActive: boolean;
  batchSelectedCount: number;
  batchDraft: BatchEditDraft;
  replaceTerrainDraft: ReplaceTerrainDraft;
  replaceBiomeDraft: ReplaceBiomeDraft;
  batchFilteredTerrainCategories: TerrainCategoryKey[];
  batchTerrainOptions: Array<{ key: string; label: string; short: string }>;
  batchBiomeOptions: BiomeKey[];
  replaceTerrainOptions: Array<{ key: string; label: string; short: string }>;
  noneBiomeValue: string;
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
  onSelectRiver: (id: string) => void;
  onStartNewRiver: () => void;
  onRiverDraftChange: (patch: Partial<RiverDraft>) => void;
  onApplyRiverDraft: () => void;
  onDeleteSelectedRiver: () => void;
  onStartRiverDrawing: () => void;
  onFinishRiverDrawing: () => void;
  onCancelRiverDrawing: () => void;
  onToggleBatchMode: () => void;
  onClearBatchSelection: () => void;
  onApplyBatchEdit: () => void;
  onBatchTerrainCategoryChange: (value: string) => void;
  onBatchTerrainChange: (value: string) => void;
  onBatchBiomeChange: (value: string) => void;
  onBatchTagChange: (tag: TagKey, checked: boolean) => void;
  onBatchNoteChange: (value: string) => void;
  onReplaceTerrainMatchChange: (value: string) => void;
  onReplacementTerrainCategoryChange: (value: string) => void;
  onReplacementTerrainChange: (value: string) => void;
  onApplyTerrainReplacement: () => void;
  onReplaceBiomeMatchChange: (value: string) => void;
  onReplacementBiomeChange: (value: string) => void;
  onApplyBiomeReplacement: () => void;
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
            <label className="checkbox-row switch-row">
              <input
                type="checkbox"
                checked={props.formatBrushScope.tags}
                onChange={(event) => props.onFormatBrushScopeChange("tags", event.target.checked)}
                disabled={!props.selectedCell}
              />
              刷标签
            </label>
            <label className="checkbox-row switch-row">
              <input
                type="checkbox"
                checked={props.formatBrushScope.note}
                onChange={(event) => props.onFormatBrushScopeChange("note", event.target.checked)}
                disabled={!props.selectedCell}
              />
              刷备注
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

      <AdvancedEditPanel
        currentMap={props.currentMap}
        batchModeActive={props.batchModeActive}
        selectedCount={props.batchSelectedCount}
        batchDraft={props.batchDraft}
        replaceTerrainDraft={props.replaceTerrainDraft}
        replaceBiomeDraft={props.replaceBiomeDraft}
        batchFilteredTerrainCategories={props.batchFilteredTerrainCategories}
        batchTerrainOptions={props.batchTerrainOptions}
        batchBiomeOptions={props.batchBiomeOptions}
        replaceTerrainOptions={props.replaceTerrainOptions}
        noneBiomeValue={props.noneBiomeValue}
        onToggleBatchMode={props.onToggleBatchMode}
        onClearBatchSelection={props.onClearBatchSelection}
        onApplyBatchEdit={props.onApplyBatchEdit}
        onBatchTerrainCategoryChange={props.onBatchTerrainCategoryChange}
        onBatchTerrainChange={props.onBatchTerrainChange}
        onBatchBiomeChange={props.onBatchBiomeChange}
        onBatchTagChange={props.onBatchTagChange}
        onBatchNoteChange={props.onBatchNoteChange}
        onReplaceTerrainMatchChange={props.onReplaceTerrainMatchChange}
        onReplacementTerrainCategoryChange={props.onReplacementTerrainCategoryChange}
        onReplacementTerrainChange={props.onReplacementTerrainChange}
        onApplyTerrainReplacement={props.onApplyTerrainReplacement}
        onReplaceBiomeMatchChange={props.onReplaceBiomeMatchChange}
        onReplacementBiomeChange={props.onReplacementBiomeChange}
        onApplyBiomeReplacement={props.onApplyBiomeReplacement}
      />

      <section className="panel river-editor-panel">
        <div className="cell-editor-heading">
          <div>
            <h2>河流覆盖层</h2>
            <p>{props.rivers.length} 条河流</p>
          </div>
          {props.riverDirty ? <span className="status-chip status-chip-dirty">未应用</span> : null}
        </div>

        <div className="editor-section">
          <label>
            River
            <select
              value={props.selectedRiverId}
              onChange={(event) => props.onSelectRiver(event.target.value)}
              disabled={!props.currentMap || props.riverDrawingStatus === "drawing"}
            >
              <option value="">新建河流</option>
              {props.rivers.map((river) => (
                <option key={river.id} value={river.id}>
                  {river.name} ({river.id})
                </option>
              ))}
            </select>
          </label>
          <div className="action-row action-row-inline">
            <button type="button" onClick={props.onStartNewRiver} disabled={!props.currentMap || props.riverDrawingStatus === "drawing"}>
              新建
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={props.onApplyRiverDraft}
              disabled={!props.currentMap || props.riverDrawingStatus === "drawing"}
            >
              应用河流
            </button>
            <button
              type="button"
              onClick={props.onDeleteSelectedRiver}
              disabled={!props.currentMap || !props.selectedRiverId || props.riverDrawingStatus === "drawing"}
            >
              删除河流
            </button>
          </div>
          <div className="action-row action-row-inline river-draw-actions">
            <button
              type="button"
              className={props.riverDrawingStatus === "drawing" ? "toggle-button-active" : undefined}
              aria-pressed={props.riverDrawingStatus === "drawing"}
              onClick={props.onStartRiverDrawing}
              disabled={!props.currentMap || props.riverDrawingStatus === "drawing"}
            >
              绘制
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={props.onFinishRiverDrawing}
              disabled={!props.currentMap || props.riverDrawingStatus !== "drawing" || props.riverDrawingPointCount < 2}
            >
              完成
            </button>
            <button
              type="button"
              onClick={props.onCancelRiverDrawing}
              disabled={!props.currentMap || props.riverDrawingStatus !== "drawing"}
            >
              取消
            </button>
          </div>
          {props.riverDrawingStatus === "drawing" ? (
            <p className="river-draw-summary">路径点：{props.riverDrawingPointCount}</p>
          ) : null}
        </div>

        <div className="editor-section">
          <h3>属性</h3>
          <label>
            Name
            <input
              value={props.riverDraft.name}
              disabled={!props.currentMap}
              onChange={(event) => props.onRiverDraftChange({ name: event.target.value })}
            />
          </label>
          <div className="compact-field-grid">
            <label>
              Color
              <input
                type="color"
                value={props.riverDraft.color}
                disabled={!props.currentMap}
                onChange={(event) => props.onRiverDraftChange({ color: event.target.value })}
              />
            </label>
            <label>
              Opacity
              <input
                type="number"
                min="0.1"
                max="1"
                step="0.05"
                value={props.riverDraft.opacity}
                disabled={!props.currentMap}
                onChange={(event) => props.onRiverDraftChange({ opacity: event.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="editor-section">
          <h3>路径</h3>
          <label>
            Points
            <textarea
              rows={3}
              value={props.riverDraft.pointsText}
              disabled={!props.currentMap}
              placeholder="R0C0, R1C0, R2C1"
              onChange={(event) => props.onRiverDraftChange({ pointsText: event.target.value })}
            />
          </label>
          <label>
            Width anchors
            <textarea
              rows={2}
              value={props.riverDraft.widthsText}
              disabled={!props.currentMap}
              placeholder="R0C0:2, R2C1:8"
              onChange={(event) => props.onRiverDraftChange({ widthsText: event.target.value })}
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
