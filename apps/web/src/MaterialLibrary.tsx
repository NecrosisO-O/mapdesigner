import { useMemo, useState } from "react";
import {
  BIOME_KEYS,
  BIOME_ENTRIES,
  BIOME_DESCRIPTIONS,
  TERRAIN_KEYS,
  TERRAIN_ENTRIES,
  TERRAIN_DESCRIPTIONS,
  TERRAIN_CATEGORY_ORDER,
  TERRAIN_CATEGORY_LABELS,
  getAllowedBiomesForTerrain,
  type MapStyle,
  type TerrainKey,
  type BiomeKey
} from "@mapdesigner/map-core";
import { renderMaterialSvg } from "@mapdesigner/map-render";
import type { useMaterialBrush, Material } from "./useMaterialBrush.js";

export function MaterialSample(props: {
  material: Material;
  style: MapStyle;
  tags?: Parameters<typeof renderMaterialSvg>[2];
}) {
  const svg = useMemo(
    () =>
      renderMaterialSvg(
        props.material.terrain,
        props.material.biome,
        props.tags ?? [],
        props.style
      ),
    [props.material.terrain, props.material.biome, props.style, props.tags]
  );
  return (
    <span
      className="material-sample"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function MaterialLibrary({
  brush,
  style,
  onPaint
}: {
  brush: ReturnType<typeof useMaterialBrush>;
  style: MapStyle;
  onPaint: () => void;
}) {
  const [kind, setKind] = useState<"terrain" | "biome">("terrain");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const entries = (kind === "terrain" ? TERRAIN_KEYS : BIOME_KEYS).filter((key) => {
    const entry =
      kind === "terrain" ? TERRAIN_ENTRIES[key as TerrainKey] : BIOME_ENTRIES[key as BiomeKey];
    return (
      (!category || entry.category === category) &&
      (entry.label + " " + entry.key).toLowerCase().includes(search.toLowerCase())
    );
  });
  const allowed = getAllowedBiomesForTerrain(brush.material.terrain);
  return (
    <div className="material-library">
      <div className="current-material">
        <MaterialSample material={brush.material} style={style} />
        <div>
          <span className="eyebrow">当前材料</span>
          <strong>{TERRAIN_ENTRIES[brush.material.terrain].label}</strong>
          <span>
            {brush.material.biome ? BIOME_ENTRIES[brush.material.biome].label : "无生态纹理"}
          </span>
        </div>
      </div>
      <button className="primary-button full-width-button" onClick={onPaint}>
        使用材料绘制
      </button>
      <div className="segmented-control" role="group" aria-label="材料类型">
        <button
          aria-pressed={kind === "terrain"}
          onClick={() => {
            setKind("terrain");
            setCategory("");
          }}
        >
          地形 · 36
        </button>
        <button
          aria-pressed={kind === "biome"}
          onClick={() => {
            setKind("biome");
            setCategory("");
          }}
        >
          生态 · 30
        </button>
      </div>
      <label className="search-field">
        <span className="sr-only">搜索材料</span>
        <input
          type="search"
          placeholder="搜索名称或关键词"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        <span className="sr-only">材料分组</span>
        <select
          aria-label="材料分组"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">全部{kind === "terrain" ? "地形" : "生态"}</option>
          {kind === "terrain"
            ? TERRAIN_CATEGORY_ORDER.map((key) => (
                <option key={key} value={key}>
                  {TERRAIN_CATEGORY_LABELS[key]}
                </option>
              ))
            : Object.entries({
                forest: "森林",
                vegetation: "草地与灌丛",
                wet: "湿地",
                water: "水域",
                dry: "干旱与裸地",
                cold: "寒冷环境"
              }).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
        </select>
      </label>
      {brush.notice && (
        <p className="field-notice" role="status">
          {brush.notice}
        </p>
      )}
      {kind === "biome" && (
        <button className="quiet-button" onClick={() => brush.chooseBiome(null)}>
          移除生态纹理
        </button>
      )}
      <div className="material-grid">
        {entries.map((key) => {
          const terrain = kind === "terrain" ? (key as TerrainKey) : brush.material.terrain;
          const biome = kind === "biome" ? (key as BiomeKey) : null;
          const entry = kind === "terrain" ? TERRAIN_ENTRIES[terrain] : BIOME_ENTRIES[biome!];
          const description =
            kind === "terrain" ? TERRAIN_DESCRIPTIONS[terrain] : BIOME_DESCRIPTIONS[biome!];
          const compatible = kind === "terrain" || allowed.includes(biome!);
          const active =
            kind === "terrain"
              ? brush.material.terrain === terrain
              : brush.material.biome === biome;
          return (
            <button
              className="material-card"
              key={key}
              aria-label={entry.label}
              aria-pressed={active}
              title={description + (compatible ? "" : " 当前地形不适用，请先选择合适地形。")}
              onClick={() => {
                if (compatible) {
                  kind === "terrain" ? brush.chooseTerrain(terrain) : brush.chooseBiome(biome);
                }
              }}
              aria-disabled={!compatible}
            >
              <MaterialSample material={{ terrain, biome }} style={style} />
              <strong>{entry.label}</strong>
              <small>{compatible ? description : "当前地形不适用"}</small>
            </button>
          );
        })}
      </div>
      {!entries.length && (
        <p className="empty-copy">没有符合搜索条件的材料。可清除搜索或切换分组。</p>
      )}
      {!!brush.recent.length && (
        <section className="recent-materials">
          <h3>最近使用</h3>
          <div>
            {brush.recent.map((item) => (
              <button
                key={item.terrain + item.biome}
                onClick={() => brush.choose(item)}
                title={
                  TERRAIN_ENTRIES[item.terrain].label +
                  (item.biome ? " · " + BIOME_ENTRIES[item.biome].label : "")
                }
              >
                <MaterialSample material={item} style={style} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
