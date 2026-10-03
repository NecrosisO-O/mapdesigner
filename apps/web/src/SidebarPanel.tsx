import type { ReactNode } from "react";
import {
  TAG_ENTRIES,
  type MapRuntimeState,
  type MapStyle,
  type TagKey
} from "@mapdesigner/map-core";

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
  currentMap: MapRuntimeState | null;
  showCoordinates: boolean;
  showShorthand: boolean;
  showGrid: boolean;
  showUndesigned: boolean;
  onMapStyleChange: (style: MapStyle) => void;
  onShowCoordinatesChange: (checked: boolean) => void;
  onShowShorthandChange: (checked: boolean) => void;
  onShowGridChange: (checked: boolean) => void;
  onShowUndesignedChange: (checked: boolean) => void;
  tagFilter: TagKey[];
  onTagFilterChange: (tag: TagKey, checked: boolean) => void;
  onClearTagFilter: () => void;
}

export function SidebarPanel(props: SidebarPanelProps) {
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
    </aside>
  );
}
