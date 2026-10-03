import { Dialog } from "./Dialog.js";
import { TAG_ENTRIES, type ExportRenderOptions, type MapRuntimeState, type MapSummary, type TagKey } from "@mapdesigner/map-core";
import { formatDateTime } from "./useMapWorkspace.js";

interface SidebarPanelProps {
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
  onShowCoordinatesChange: (checked: boolean) => void;
  onShowShorthandChange: (checked: boolean) => void;
  onShowGridChange: (checked: boolean) => void;
  onShowUndesignedChange: (checked: boolean) => void;
  exportPanelOpen: boolean;
  isExportingPng: boolean;
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
    props.pngOptions.background === "transparent" ? props.lastOpaqueBackground : props.pngOptions.background;
  const designedCellCount = props.mapSummary?.designed_cell_count ?? props.currentMap?.document.cells.length ?? 0;

  return (
    <aside className="sidebar">
      <div className="panel-heading"><h2>内容与图层</h2><button className="drawer-close" aria-label="关闭内容栏" onClick={props.onClose}>×</button></div>
      <section className="panel map-summary"><span className="eyebrow">当前文档</span><h3>{props.currentMap?.document.meta.name ?? "开始绘制你的世界"}</h3><p>{designedCellCount.toLocaleString()} 个已设计单元格</p></section>
      <section className="panel tool-panel">
        <h2>视图</h2>
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
          显示 undesigned
        </label>
        <div className="tag-filter-block" aria-label="标签筛选">
          <div className="panel-subtitle-row">
            <h3>标签筛选</h3>
            <button type="button" onClick={props.onClearTagFilter} disabled={props.tagFilter.length === 0}>
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

      <section className="panel"><h3>河流 · 当前区域</h3><div className="river-list">{props.currentMap?.document.features.rivers.slice(0, 200).map(river => <button key={river.id} onClick={() => props.onSelectRiver(river.id)}><span aria-hidden="true">≈</span>{river.name}<small>{river.points.length} 点</small></button>)}</div>{!props.currentMap?.document.features.rivers.length && <p className="muted">使用河流工具添加一条路径。</p>}</section>
      {props.exportPanelOpen && <Dialog title="导出地图" onClose={props.onToggleExportPanel}>
          <div id="export-panel-content">
            <div className="export-action-row">
              <button
                className="primary-button"
                onClick={props.onExportPng}
                disabled={!props.currentMap || props.isExportingPng}
              >
                {props.isExportingPng ? "导出中..." : "导出图片"}
              </button>
              <button onClick={props.onExportJson} disabled={!props.currentMap || props.isExportingPng}>导出 JSON</button>
            </div>
            <label>
              导出范围
              <select
                value={props.pngRangeMode}
                onChange={(event) => props.onPngRangeModeChange(event.target.value as "visible" | "full")}
              >
                <option value="visible">当前加载区域</option>
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
                onChange={(event) => props.onPresetChange(event.target.value as ExportRenderOptions["preset"])}
              >
                <option value="clean">clean</option>
                <option value="reference">reference</option>
              </select>
            </label>
            <label>
              Scale
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
              Padding
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
                  props.onBackgroundChange(event.target.checked ? "transparent" : props.lastOpaqueBackground)
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
              导出 undesigned
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
      </Dialog>}
    </aside>
  );
}
