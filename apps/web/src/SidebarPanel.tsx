import type { ExportRenderOptions, MapRuntimeState } from "@mapdesigner/map-core";
import { formatDateTime } from "./useMapWorkspace.js";

interface SidebarPanelProps {
  loading: boolean;
  message: string;
  currentMap: MapRuntimeState | null;
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
  pngOptions: ExportRenderOptions;
  onToggleExportPanel: () => void;
  onExportPng: () => void;
  onPresetChange: (preset: ExportRenderOptions["preset"]) => void;
  onScaleChange: (scale: number) => void;
  onPaddingChange: (padding: number) => void;
  onBackgroundChange: (background: string) => void;
  onIncludeGridChange: (checked: boolean) => void;
  onIncludeUndesignedChange: (checked: boolean) => void;
  onIncludeCoordinatesChange: (checked: boolean) => void;
  onIncludeShorthandChange: (checked: boolean) => void;
}

export function SidebarPanel(props: SidebarPanelProps) {
  return (
    <aside className="sidebar">
      <section className="panel status-panel" aria-label="当前状态">
        <h2>当前状态</h2>
        <div className="status-message-banner" aria-live="polite">
          {props.loading ? "加载中..." : props.message}
        </div>
        {props.currentMap ? (
          <div className="meta-list">
            <p>
              当前地图：<strong>{props.currentMap.document.meta.name}</strong>
            </p>
            <p>ID：{props.currentMap.document.meta.id}</p>
            <p>Designed：{props.currentMap.document.cells.length}</p>
            <p>Revision：{props.currentMap.document.meta.revision}</p>
            <p>更新时间：{formatDateTime(props.currentMap.document.meta.updated_at)}</p>
            <p>保存状态：{props.mapDirty ? "未保存修改" : "已保存"}</p>
          </div>
        ) : (
          <p>当前没有打开地图。</p>
        )}
      </section>

      <section className="panel">
        <h2>显示控制</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={props.showCoordinates}
            onChange={(event) => props.onShowCoordinatesChange(event.target.checked)}
          />
          显示坐标
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={props.showShorthand}
            onChange={(event) => props.onShowShorthandChange(event.target.checked)}
          />
          显示简写
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={props.showGrid}
            onChange={(event) => props.onShowGridChange(event.target.checked)}
          />
          显示网格线
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={props.showUndesigned}
            onChange={(event) => props.onShowUndesignedChange(event.target.checked)}
          />
          显示 undesigned
        </label>
      </section>

      <section className="panel collapsible-panel">
        <div className="panel-header">
          <h2>图片导出</h2>
          <button
            type="button"
            className="panel-toggle"
            onClick={props.onToggleExportPanel}
            aria-expanded={props.exportPanelOpen}
            aria-controls="export-panel-content"
          >
            {props.exportPanelOpen ? "收起" : "展开"}
          </button>
        </div>
        {props.exportPanelOpen ? (
          <div id="export-panel-content">
            <div className="export-action-row">
              <button
                onClick={props.onExportPng}
                disabled={!props.currentMap || props.currentMap.document.cells.length === 0}
              >
                导出图片
              </button>
            </div>
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
                value={props.pngOptions.background}
                onChange={(event) => props.onBackgroundChange(event.target.value)}
              />
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
        ) : null}
      </section>

      <section className="panel">
        <h2>说明</h2>
        <p>滚轮缩放，拖拽平移。默认展示扩展坐标，内部编号用于程序定位。</p>
        <p>编辑单元格后只会先更新当前地图内存，点击顶部“保存”才会写回 `storage/maps`。</p>
      </section>
    </aside>
  );
}
