import { api } from "./api.js";
import { useEffect, useState } from "react";
import {
  TERRAIN_KEYS,
  TERRAIN_ENTRIES,
  TERRAIN_DESCRIPTIONS,
  BIOME_KEYS,
  BIOME_ENTRIES,
  BIOME_DESCRIPTIONS,
  TAG_KEYS,
  TAG_ENTRIES,
  type MapRuntimeState,
  type MapMaterialUsage,
  type BiomeKey,
  type TerrainKey,
  type TagKey
} from "@mapdesigner/map-core";
import { MaterialSample } from "./MaterialLibrary.js";
export interface LegendHighlight {
  kind: "terrain" | "biome" | "tag";
  key: string;
}
export function LegendPanel({
  map,
  highlight,
  onHighlight
}: {
  map: MapRuntimeState | null;
  highlight: LegendHighlight | null;
  onHighlight: (value: LegendHighlight | null) => void;
}) {
  const [usage, setUsage] = useState<MapMaterialUsage | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setUsage(null);
    setError("");
    if (map)
      void api.getMaterialUsage(map.document.meta.id).then((result) => {
        if (!active) return;
        if (result.ok && result.result) setUsage(result.result);
        else setError("无法读取全图图例，点击重试。");
      });
    return () => {
      active = false;
    };
  }, [map?.document.meta.id, map?.document.meta.revision, retry]);
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState<LegendHighlight["kind"]>("terrain");
  const cells = map?.document.cells ?? [];
  const keys = kind === "terrain" ? TERRAIN_KEYS : kind === "biome" ? BIOME_KEYS : TAG_KEYS;
  const used = new Set(
    usage
      ? kind === "terrain"
        ? usage.terrains
        : kind === "biome"
          ? usage.biomes
          : usage.tags
      : cells.flatMap((cell) =>
          kind === "terrain"
            ? [cell.terrain]
            : kind === "biome"
              ? cell.biome
                ? [cell.biome]
                : []
              : cell.tags
        )
  );
  return (
    <div className="legend-panel">
      <h3>读懂这幅地图</h3>
      <p>底色表示地貌，细纹表示生态，徽记表示特殊地点。颜色不代表实测海拔或水深。</p>
      <label className="checkbox-row">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        显示完整图例
      </label>
      <p className="muted">
        {all ? "全部类型" : usage ? "本图使用的全部类型" : "正在读取全图；暂显示当前区域"}
      </p>
      {error && <button onClick={() => setRetry((v) => v + 1)}>{error}</button>}
      <div className="segmented-control" role="group" aria-label="图例类别">
        {(["terrain", "biome", "tag"] as const).map((value) => (
          <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>
            {{ terrain: "地形", biome: "生态", tag: "标记" }[value]}
          </button>
        ))}
      </div>
      <div className="legend-list">
        {keys
          .filter((key) => all || used.has(key))
          .map((key) => {
            const entry =
              kind === "terrain"
                ? TERRAIN_ENTRIES[key as TerrainKey]
                : kind === "biome"
                  ? BIOME_ENTRIES[key as BiomeKey]
                  : TAG_ENTRIES[key as TagKey];
            const terrain =
              kind === "terrain"
                ? (key as TerrainKey)
                : kind === "biome"
                  ? ["marine", "coral", "seagrass", "pack_ice"].includes(key)
                    ? "sea"
                    : "plain"
                  : "plain";
            const description =
              kind === "terrain"
                ? TERRAIN_DESCRIPTIONS[key as TerrainKey]
                : kind === "biome"
                  ? BIOME_DESCRIPTIONS[key as BiomeKey]
                  : "标记在地形与生态之上；同格多个标记以数量补充。";
            const selected = highlight?.key === key && highlight.kind === kind;
            return (
              <button
                className="legend-item"
                key={key}
                aria-pressed={selected}
                onClick={() => onHighlight(selected ? null : { kind, key })}
                title="点击临时高亮对应格子"
              >
                <MaterialSample
                  material={{ terrain, biome: kind === "biome" ? (key as BiomeKey) : null }}
                  tags={kind === "tag" ? [key as TagKey] : []}
                  style={map?.document.meta.map_style ?? "classic-v1"}
                />
                <span>
                  <strong>{entry.label}</strong>
                  <small>{description}</small>
                </span>
              </button>
            );
          })}
      </div>
      {highlight && <button onClick={() => onHighlight(null)}>取消图例高亮</button>}
      <section className="editor-section">
        <h3>河流与水面</h3>
        <p>
          河流对象是可弯曲、变宽的路径；湖泊与海洋是水域格子。河流宽度以绘图单位保存，不表示实际流量。视觉交叉只在明确连接后表示汇流。
        </p>
      </section>
    </div>
  );
}
