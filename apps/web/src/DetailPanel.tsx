import type { ReactNode } from "react";
import { MaterialSample } from "./MaterialLibrary.js";
import type { BatchField, FieldMode } from "./useAdvancedEditor.js";
import {
  BIOME_ENTRIES,
  TAG_ENTRIES,
  TERRAIN_CATEGORY_LABELS,
  TERRAIN_CATEGORY_ORDER,
  getTerrainEntriesByCategory,
  type ActiveCell,
  type BiomeKey,
  type MapRuntimeState,
  type TerrainKey,
  type TagKey
} from "@mapdesigner/map-core";
import type { TerrainCategoryKey } from "@mapdesigner/map-core";
import { AdvancedEditPanel } from "./AdvancedEditPanel.js";
import type { MapHistory } from "./api.js";
import type {
  BatchEditDraft,
  ReplaceBiomeDraft,
  ReplaceTerrainDraft
} from "./useAdvancedEditor.js";
import type { CellDraft, FormatBrushScope } from "./useCellEditor.js";
import { formatDateTime } from "./useMapWorkspace.js";

interface DetailPanelProps {
  activeTab: "cell" | "batch" | "river";
  panelHeader: ReactNode;
  resizeHandle: ReactNode;
  materialNotice?: string | null;
  onClose: () => void;
  pending: boolean;
  currentMap: MapRuntimeState | null;
  mapHistory: MapHistory | null;
  selectedCell: ActiveCell | null;
  draft: CellDraft;
  terrainCategory: string;
  filteredTerrainCategories: TerrainCategoryKey[];
  terrainOptions: Array<{ key: string; label: string; short: string }>;
  biomeOptions: BiomeKey[];
  formatBrushEnabled: boolean;
  formatBrushScope: FormatBrushScope;
  riverPanel: ReactNode;
  batchModeActive: boolean;
  batchSelectedCount: number;
  batchMixedFields: Record<BatchField, boolean>;
  batchPlannedCount: number;
  batchDraft: BatchEditDraft;
  batchTagMode: "replace" | "add" | "remove";
  onBatchTagModeChange: (mode: "replace" | "add" | "remove") => void;
  batchModes: Record<BatchField, FieldMode>;
  onBatchFieldModeChange: (field: BatchField, mode: FieldMode) => void;
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
    <aside className="detail-panel" aria-label="属性面板">
      {props.panelHeader}
      {props.resizeHandle}
      <section className="panel cell-editor-panel" hidden={props.activeTab !== "cell"}>
        <div className="cell-editor-heading">
          <div>
            <h2>当前单元格</h2>
            <p>
              {props.selectedCell
                ? `${props.selectedCell.display_coord} · ${props.selectedCell.status === "designed" ? "已设计" : "待设计"}`
                : "未选择单元格"}
            </p>
          </div>
          {props.cellDirty ? <span className="status-chip status-chip-dirty">未应用</span> : null}
        </div>

        <div className="cell-editor-fields">
          {props.draft.terrain && (
            <div className="object-preview">
              <MaterialSample
                material={{
                  terrain: props.draft.terrain as TerrainKey,
                  biome: (props.draft.biome as BiomeKey) || null
                }}
                style={props.currentMap?.document.meta.map_style ?? "classic-v1"}
              />
              <span>修改预览</span>
            </div>
          )}
          {props.materialNotice && (
            <p className="field-notice" role="status">
              {props.materialNotice}
            </p>
          )}
          <div className="format-brush-panel" hidden={!props.formatBrushEnabled}>
            <div className="format-brush-options">
              <label className="checkbox-row switch-row">
                <input
                  type="checkbox"
                  checked={props.formatBrushScope.terrain}
                  onChange={(event) =>
                    props.onFormatBrushScopeChange("terrain", event.target.checked)
                  }
                  disabled={!props.selectedCell || props.pending}
                />
                刷地形
              </label>
              <label className="checkbox-row switch-row">
                <input
                  type="checkbox"
                  checked={props.formatBrushScope.biome}
                  onChange={(event) =>
                    props.onFormatBrushScopeChange("biome", event.target.checked)
                  }
                  disabled={!props.selectedCell || props.pending}
                />
                刷生态
              </label>
              <label className="checkbox-row switch-row">
                <input
                  type="checkbox"
                  checked={props.formatBrushScope.tags}
                  onChange={(event) => props.onFormatBrushScopeChange("tags", event.target.checked)}
                  disabled={!props.selectedCell || props.pending}
                />
                刷标签
              </label>
              <label className="checkbox-row switch-row">
                <input
                  type="checkbox"
                  checked={props.formatBrushScope.note}
                  onChange={(event) => props.onFormatBrushScopeChange("note", event.target.checked)}
                  disabled={!props.selectedCell || props.pending}
                />
                刷备注
              </label>
            </div>
            {props.formatBrushEnabled && props.selectedCell ? (
              <p className="format-brush-summary">
                格式刷源格：{props.selectedCell.display_coord} | 当前刷入：
                {props.getFormatBrushLabel()}
              </p>
            ) : (
              <p className="format-brush-summary">
                选中已设计单元格后可进入格式刷模式；再次点击按钮即可退出。
              </p>
            )}
          </div>

          <div className="core-fields">
            <label>
              地形
              <select
                value={props.draft.terrain}
                onChange={(event) => props.onTerrainChange(event.target.value)}
                disabled={!props.selectedCell || props.pending}
              >
                <option value="">选择地形</option>
                {TERRAIN_CATEGORY_ORDER.map((category) => (
                  <optgroup key={category} label={TERRAIN_CATEGORY_LABELS[category]}>
                    {getTerrainEntriesByCategory(category).map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              生态
              <select
                value={props.draft.biome}
                onChange={(event) => props.onBiomeChange(event.target.value)}
                disabled={!props.selectedCell || props.pending}
              >
                <option value="">无生态纹理</option>
                {props.biomeOptions.map((key) => (
                  <option key={key} value={key}>
                    {BIOME_ENTRIES[key].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="editor-section">
            <summary>地点标记 · {props.draft.tags.length}</summary>
            <div className="tag-grid">
              {Object.entries(TAG_ENTRIES).map(([key, entry]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={props.draft.tags.includes(key)}
                    disabled={!props.selectedCell || props.pending}
                    onChange={(event) => props.onTagChange(key, event.target.checked)}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
          </details>

          <details className="editor-section">
            <summary>备注{props.draft.note ? " · 已填写" : ""}</summary>
            <label>
              备注
              <textarea
                rows={6}
                value={props.draft.note}
                disabled={!props.selectedCell || props.pending}
                onChange={(event) => props.onNoteChange(event.target.value)}
              />
            </label>
          </details>
        </div>
        <div className="panel-header">
          <div className="action-row action-row-inline">
            <button
              className="primary-button"
              onClick={props.onApplyDraft}
              disabled={!props.selectedCell || props.pending}
            >
              应用修改
            </button>
            <button
              onClick={props.onRevertDraft}
              disabled={!props.selectedCell || !props.cellDirty}
            >
              还原
            </button>
            <details className="cell-more-actions">
              <summary>更多</summary>
              <div
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button")) {
                    const details = event.currentTarget.parentElement as HTMLDetailsElement;
                    details.open = false;
                    details.querySelector("summary")?.focus();
                  }
                }}
              >
                <button
                  className="danger-button"
                  onClick={props.onClearSelected}
                  disabled={!props.selectedCell || props.pending}
                >
                  清空格子
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
            </details>
          </div>
        </div>
      </section>

      <div className="inspector-scroll-panel" hidden={props.activeTab !== "batch"}>
        <AdvancedEditPanel
          currentMap={props.currentMap}
          batchModeActive={props.batchModeActive}
          selectedCount={props.batchSelectedCount}
          mixedFields={props.batchMixedFields}
          plannedCount={props.batchPlannedCount}
          batchTagMode={props.batchTagMode}
          onBatchTagModeChange={props.onBatchTagModeChange}
          batchDraft={props.batchDraft}
          batchModes={props.batchModes}
          onBatchFieldModeChange={props.onBatchFieldModeChange}
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
      </div>
      <div className="river-inspector-slot" hidden={props.activeTab !== "river"}>
        {props.activeTab === "river" && props.riverPanel}
      </div>
    </aside>
  );
}
