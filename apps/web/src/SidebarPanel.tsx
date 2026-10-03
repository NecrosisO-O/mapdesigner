import { Dialog } from "./Dialog.js";
import type { ReactNode } from "react";
import {
  TAG_ENTRIES,
  type ExportRenderOptions,
  type MapRuntimeState,
  type MapSummary,
  type MapStyle,
  type TagKey
} from "@mapdesigner/map-core";
import { formatDateTime } from "./useMapWorkspace.js";

interface SidebarPanelProps {
  tab: "materials" | "objects" | "legend" | "display";
  onTabChange: (tab: "materials" | "objects" | "legend" | "display") => void;
  panelHeader: ReactNode;
  resizeHandle: ReactNode;
  materialLibrary: ReactNode;
  objectBrowser: ReactNode;
  legend: ReactNode;
  layers: { terrain: boolean; biomes: boolean; rivers: boolean; tags: boolean };
  onLayerChange: (key: "terrain" | "biomes" | "rivers" | "tags", visible: boolean) => void;
  onClose: () => void;
  onSelectRiver: (id: string) => void;
  onExportJson: () => void;
  loading: boolean;
  message: string;
  currentMap: MapRuntimeState | null;
  mapSummary: MapSummary | null;
  mapDirty: boolean;
  showCoordinates: boolean;
  showShorthand: boolean;
  showGrid: boolean;
  showUndesigned: boolean;
  onMapStyleChange: (style: MapStyle) => void;
  onShowCoordinatesChange: (checked: boolean) => void;
  onShowShorthandChange: (checked: boolean) => void;
  onShowGridChange: (checked: boolean) => void;
  onShowUndesignedChange: (checked: boolean) => void;
  exportPanelOpen: boolean;
  isExportingPng: boolean;
  exportProgress: string;
  exportResult: string;
  onCancelExport: () => void;
  pngOptions: ExportRenderOptions;
  pngRangeMode: "visible" | "full";
  lastOpaqueBackground: string;
  tagFilter: TagKey[];
  onToggleExportPanel: () => void;
  onExportPng: () => void;
  onPngRangeModeChange: (mode: "visible" | "full") => void;
  onPresetChange: (preset: ExportRenderOptions["preset"]) => void;
  onScaleChange: (scale: number) => void;
  onPaddingChange: (padding: number) => void;
  onBackgroundChange: (background: string) => void;
  onIncludeGridChange: (checked: boolean) => void;
  onIncludeUndesignedChange: (checked: boolean) => void;
  onIncludeCoordinatesChange: (checked: boolean) => void;
  onIncludeShorthandChange: (checked: boolean) => void;
  onTagFilterChange: (tag: TagKey, checked: boolean) => void;
  onClearTagFilter: () => void;
}

export function SidebarPanel(props: SidebarPanelProps) {
  const backgroundColorValue =
    props.pngOptions.background === "transparent"
      ? props.lastOpaqueBackground
      : props.pngOptions.background;
  const designedCellCount =
    props.mapSummary?.designed_cell_count ?? props.currentMap?.document.cells.length ?? 0;

  return (
    <aside className="sidebar">
      {props.panelHeader}
      {props.resizeHandle}
      <div className="sidebar-tabs" role="tablist" aria-label="内容导航">
        {(["materials", "objects", "legend", "display"] as const).map((tab) => (
          <button
            role="tab"
            key={tab}
            aria-selected={props.tab === tab}
            onClick={() => props.onTabChange(tab)}
          >
            {{ materials: "材料", objects: "对象", legend: "图例", display: "显示" }[tab]}
          </button>
        ))}
      </div>
      <div className="sidebar-scroll">
        {props.tab === "materials" && props.materialLibrary}
        {props.tab === "objects" && props.objectBrowser}
        {props.tab === "legend" && props.legend}
        <section className="panel tool-panel" hidden={props.tab !== "display"}>
          <h2>地图显示</h2>
          <p>这里的显示开关只影响编辑视图。图片导出有独立选项。</p>
          <div className="layer-switches">
            {(["terrain", "biomes", "rivers", "tags"] as const).map((key) => (
              <label key={key} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={props.layers[key]}
                  onChange={(event) => props.onLayerChange(key, event.target.checked)}
                />
                {{ terrain: "地貌", biomes: "生态纹理", rivers: "河流", tags: "地点标记" }[key]}
              </label>
            ))}
          </div>
          <label>
            地图样式
            <select
              value={props.currentMap?.document.meta.map_style ?? "classic-v1"}
              onChange={(event) => props.onMapStyleChange(event.target.value as MapStyle)}
              disabled={!props.currentMap}
            >
              <option value="atlas-v1">自然地图</option>
              <option value="classic-v1">经典配色</option>
            </select>
          </label>
          <label className="checkbox-row switch-row">
            <input
              type="checkbox"
              checked={props.showCoordinates}
              onChange={(event) => props.onShowCoordinatesChange(event.target.checked)}
            />
            显示坐标
          </label>
          <label className="checkbox-row switch-row">
            <input
              type="checkbox"
              checked={props.showShorthand}
              onChange={(event) => props.onShowShorthandChange(event.target.checked)}
            />
            显示简写
          </label>
          <label className="checkbox-row switch-row">
            <input
              type="checkbox"
              checked={props.showGrid}
              onChange={(event) => props.onShowGridChange(event.target.checked)}
            />
            显示网格线
          </label>
          <label className="checkbox-row switch-row">
            <input
              type="checkbox"
              checked={props.showUndesigned}
              onChange={(event) => props.onShowUndesignedChange(event.target.checked)}
            />
            显示待设计格
          </label>
          <div className="tag-filter-block" aria-label="标签筛选">
            <div className="panel-subtitle-row">
              <h3>标签筛选</h3>
              <button
                type="button"
                onClick={props.onClearTagFilter}
                disabled={props.tagFilter.length === 0}
              >
                清除
              </button>
            </div>
            <div className="tag-filter-grid">
              {Object.entries(TAG_ENTRIES).map(([key, entry]) => {
                const tag = key as TagKey;
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={props.tagFilter.includes(tag)}
                      onChange={(event) => props.onTagFilterChange(tag, event.target.checked)}
                    />
                    {entry.label}
                  </label>
                );
              })}
            </div>
          </div>
        </section>
      </div>
      {props.exportPanelOpen && (
        <Dialog title="导出地图" onClose={props.onToggleExportPanel}>
          <div id="export-panel-content">
            {props.isExportingPng && (
              <div className="export-progress" role="status">
                <span>{props.exportProgress || "准备导出"}</span>
                <button onClick={props.onCancelExport}>取消任务</button>
              </div>
            )}
            {props.exportResult && (
              <p className="export-result" role="status">
                导出结果：{props.exportResult}
              </p>
            )}
            <div className="export-action-row">
              <button
                className="primary-button"
                onClick={props.onExportPng}
                disabled={!props.currentMap || props.isExportingPng}
              >
                {props.isExportingPng ? "导出中..." : "导出图片"}
              </button>
              <button
                onClick={props.onExportJson}
                disabled={!props.currentMap || props.isExportingPng}
              >
                导出 JSON
              </button>
            </div>
            <label>
              导出范围
              <select
                value={props.pngRangeMode}
                onChange={(event) =>
                  props.onPngRangeModeChange(event.target.value as "visible" | "full")
                }
              >
                <option value="visible">当前可见区域</option>
                <option value="full">全图</option>
              </select>
            </label>
            <p className="export-range-note">
              {props.pngRangeMode === "visible"
                ? "适合大地图，会按当前视口附近区域导出。"
                : "大地图全图导出可能被服务端拒绝。"}
            </p>
            <label>
              预设
              <select
                value={props.pngOptions.preset}
                onChange={(event) =>
                  props.onPresetChange(event.target.value as ExportRenderOptions["preset"])
                }
              >
                <option value="clean">纯净地图</option>
                <option value="reference">参考地图（坐标与简写）</option>
              </select>
            </label>
            <label>
              缩放倍率
              <select
                value={props.pngOptions.scale}
                onChange={(event) => props.onScaleChange(Number(event.target.value))}
              >
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="3">3x</option>
              </select>
            </label>
            <label>
              边距
              <select
                value={props.pngOptions.padding}
                onChange={(event) => props.onPaddingChange(Number(event.target.value))}
              >
                <option value="16">16</option>
                <option value="32">32</option>
                <option value="48">48</option>
                <option value="64">64</option>
              </select>
            </label>
            <label>
              背景色
              <input
                type="color"
                value={backgroundColorValue}
                onChange={(event) => props.onBackgroundChange(event.target.value)}
                disabled={props.pngOptions.background === "transparent"}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={props.pngOptions.background === "transparent"}
                onChange={(event) =>
                  props.onBackgroundChange(
                    event.target.checked ? "transparent" : props.lastOpaqueBackground
                  )
                }
              />
              透明背景
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={props.pngOptions.includeGrid}
                onChange={(event) => props.onIncludeGridChange(event.target.checked)}
              />
              导出网格线
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={props.pngOptions.includeUndesigned}
                onChange={(event) => props.onIncludeUndesignedChange(event.target.checked)}
              />
              导出待设计格
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={props.pngOptions.includeCoordinates}
                onChange={(event) => props.onIncludeCoordinatesChange(event.target.checked)}
              />
              导出坐标
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={props.pngOptions.includeShorthand}
                onChange={(event) => props.onIncludeShorthandChange(event.target.checked)}
              />
              导出简写
            </label>
          </div>
        </Dialog>
      )}
    </aside>
  );
}
