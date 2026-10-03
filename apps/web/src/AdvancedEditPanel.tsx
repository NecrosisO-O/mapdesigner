import type { BatchField, FieldMode } from "./useAdvancedEditor.js";
import {
  BIOME_ENTRIES,
  BIOME_KEYS,
  TAG_ENTRIES,
  TERRAIN_CATEGORY_LABELS,
  TERRAIN_ENTRIES,
  TERRAIN_KEYS,
  type BiomeKey,
  type MapRuntimeState,
  type TagKey,
  type TerrainCategoryKey,
  type TerrainKey
} from "@mapdesigner/map-core";
import type {
  BatchEditDraft,
  ReplaceBiomeDraft,
  ReplaceTerrainDraft
} from "./useAdvancedEditor.js";

interface AdvancedEditPanelProps {
  currentMap: MapRuntimeState | null;
  batchModeActive: boolean;
  selectedCount: number;
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
}

function formatBiomeOption(value: string, noneBiomeValue: string): string {
  if (value === noneBiomeValue) {
    return "无生态";
  }
  const entry = BIOME_ENTRIES[value as BiomeKey];
  return `${entry.label} (${entry.short})`;
}

export function AdvancedEditPanel(props: AdvancedEditPanelProps) {
  return (
    <section className="panel advanced-editor-panel">
      <div className="cell-editor-heading">
        <div>
          <h2>高级编辑</h2>
          <p>已选 {props.selectedCount} 格</p>
        </div>
        {props.batchModeActive ? (
          <span className="status-chip status-chip-dirty">批量选择</span>
        ) : null}
      </div>

      <div className="editor-section">
        <h3>批量设置</h3>
        <p>未启用的字段保持原值。清空仅作用于所选字段。</p>
        <div className="batch-field-modes">
          {(["terrain", "biome", "tags", "note"] as const).map((field) => (
            <label key={field}>
              {{ terrain: "地形", biome: "生态", tags: "标签", note: "备注" }[field]}操作
              <select
                value={props.batchModes[field]}
                onChange={(event) =>
                  props.onBatchFieldModeChange(field, event.target.value as FieldMode)
                }
              >
                <option value="keep">保持原值</option>
                <option value="set">设置</option>
                {field !== "terrain" && <option value="clear">清空</option>}
              </select>
            </label>
          ))}
        </div>
        <div className="action-row action-row-inline">
          <button
            type="button"
            className={props.batchModeActive ? "toggle-button-active" : undefined}
            aria-pressed={props.batchModeActive}
            onClick={props.onToggleBatchMode}
            disabled={!props.currentMap}
          >
            批量选择
          </button>
          <button
            type="button"
            onClick={props.onClearBatchSelection}
            disabled={props.selectedCount === 0}
          >
            清空选择
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={props.onApplyBatchEdit}
            disabled={
              !props.currentMap ||
              props.selectedCount === 0 ||
              Object.values(props.batchModes).every((mode) => mode === "keep")
            }
          >
            应用到选中格
          </button>
        </div>

        <label>
          批量地形分类
          <select
            value={props.batchDraft.terrainCategory}
            onChange={(event) => props.onBatchTerrainCategoryChange(event.target.value)}
            disabled={!props.currentMap}
          >
            <option value="">请选择分类</option>
            {props.batchFilteredTerrainCategories.map((categoryKey) => (
              <option key={categoryKey} value={categoryKey}>
                {TERRAIN_CATEGORY_LABELS[categoryKey]}
              </option>
            ))}
          </select>
        </label>
        <label>
          批量地形
          <select
            value={props.batchDraft.terrain}
            onChange={(event) => props.onBatchTerrainChange(event.target.value)}
            disabled={!props.currentMap || !props.batchDraft.terrainCategory}
          >
            <option value="">
              {props.batchDraft.terrainCategory ? "未设置" : "请先选择 地形分类"}
            </option>
            {props.batchTerrainOptions.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.short})
              </option>
            ))}
          </select>
        </label>
        <label>
          批量生态
          <select
            value={props.batchDraft.biome}
            onChange={(event) => props.onBatchBiomeChange(event.target.value)}
            disabled={!props.currentMap}
          >
            <option value="">未设置</option>
            {props.batchBiomeOptions.map((key) => (
              <option key={key} value={key}>
                {BIOME_ENTRIES[key].label} ({BIOME_ENTRIES[key].short})
              </option>
            ))}
          </select>
        </label>
        <label>
          标签处理
          <select
            value={props.batchTagMode}
            onChange={(event) =>
              props.onBatchTagModeChange(event.target.value as "replace" | "add" | "remove")
            }
          >
            <option value="replace">替换标签</option>
            <option value="add">追加标签</option>
            <option value="remove">移除指定标签</option>
          </select>
        </label>
        <div className="tag-grid compact-tag-grid">
          {Object.entries(TAG_ENTRIES).map(([key, entry]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={props.batchDraft.tags.includes(key as TagKey)}
                disabled={!props.currentMap}
                onChange={(event) => props.onBatchTagChange(key as TagKey, event.target.checked)}
              />
              {entry.label}
            </label>
          ))}
        </div>
        <label>
          批量备注
          <textarea
            rows={3}
            value={props.batchDraft.note}
            disabled={!props.currentMap}
            onChange={(event) => props.onBatchNoteChange(event.target.value)}
          />
        </label>
      </div>

      <div className="editor-section">
        <h3>替换地形</h3>
        <label>
          匹配地形
          <select
            value={props.replaceTerrainDraft.matchTerrain}
            onChange={(event) => props.onReplaceTerrainMatchChange(event.target.value)}
            disabled={!props.currentMap}
          >
            <option value="">请选择地形</option>
            {TERRAIN_KEYS.map((key) => (
              <option key={key} value={key}>
                {TERRAIN_ENTRIES[key].label} ({TERRAIN_ENTRIES[key].short})
              </option>
            ))}
          </select>
        </label>
        <label>
          目标地形分类
          <select
            value={props.replaceTerrainDraft.replacementCategory}
            onChange={(event) => props.onReplacementTerrainCategoryChange(event.target.value)}
            disabled={!props.currentMap}
          >
            <option value="">请选择分类</option>
            {Object.entries(TERRAIN_CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标地形
          <select
            value={props.replaceTerrainDraft.replacementTerrain}
            onChange={(event) => props.onReplacementTerrainChange(event.target.value)}
            disabled={!props.currentMap || !props.replaceTerrainDraft.replacementCategory}
          >
            <option value="">请选择地形</option>
            {props.replaceTerrainOptions.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.short})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary-button full-width-button"
          onClick={props.onApplyTerrainReplacement}
          disabled={!props.currentMap}
        >
          替换地形
        </button>
      </div>

      <div className="editor-section">
        <h3>替换生态</h3>
        <label>
          匹配生态
          <select
            value={props.replaceBiomeDraft.matchBiome}
            onChange={(event) => props.onReplaceBiomeMatchChange(event.target.value)}
            disabled={!props.currentMap}
          >
            <option value="">请选择生态</option>
            {[props.noneBiomeValue, ...BIOME_KEYS].map((value) => (
              <option key={value} value={value}>
                {formatBiomeOption(value, props.noneBiomeValue)}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标生态
          <select
            value={props.replaceBiomeDraft.replacementBiome}
            onChange={(event) => props.onReplacementBiomeChange(event.target.value)}
            disabled={!props.currentMap}
          >
            <option value="">请选择生态</option>
            {[props.noneBiomeValue, ...BIOME_KEYS].map((value) => (
              <option key={value} value={value}>
                {formatBiomeOption(value, props.noneBiomeValue)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary-button full-width-button"
          onClick={props.onApplyBiomeReplacement}
          disabled={!props.currentMap}
        >
          替换生态
        </button>
      </div>
    </section>
  );
}
