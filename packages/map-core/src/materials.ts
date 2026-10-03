import { ALLOWED_BIOMES_BY_TERRAIN, TERRAIN_ENTRIES } from "./dictionaries.js";
import type { BiomeKey, TerrainKey } from "./types.js";

/** Descriptions explain this editor's encoding; colors do not encode measured elevation/depth. */
export const TERRAIN_DESCRIPTIONS: Record<TerrainKey, string> = {
  ocean: "开阔海域。深蓝用于区分海陆，不表示实测水深。",
  sea: "近海水面。可叠加海洋、珊瑚或海草生态。",
  coast: "海陆接触地带，整格仍作为岸边地貌处理。",
  beach: "沙质岸滩。颜色表示砂质地表。",
  tidal_flat: "受潮汐影响的滩地，部分时间可能露出水面。",
  reef: "礁石地貌。珊瑚是可另行叠加的生态类型。",
  lagoon: "与外海相隔或有限连通的潟湖水面。",
  estuary: "河流接近海洋的过渡区域；河道和开放海面需分别绘制。",
  lake: "内陆湖泊水面。河道进入湖面后保留可编辑路径。",
  salt_lake: "盐湖水面。浅色用于识别类型，不代表深度。",
  river: "按格子绘制的河道水域；连续弯曲路径请使用河流工具。",
  delta: "河口沉积形成的陆地。配合用户绘制的分汊表达三角洲。",
  plain: "较平坦的地貌；森林或草原等植被由生态层表示。",
  alluvial_plain: "河流沉积形成的平原，不代表整片区域被水覆盖。",
  floodplain: "河道附近可能受洪水影响的平地。",
  wetland: "地表潮湿或浅水交错的区域，适合叠加沼泽和芦苇。",
  hill: "起伏相对柔和的丘陵，用圆弧形线索识别。",
  foothill: "山地向邻近平地过渡的山麓。",
  mountain: "起伏明显的山地，用山峰线形识别。",
  plateau: "顶部较平坦的高地，用平顶形状识别。",
  basin: "四周相对较高的盆地；可位于不同海拔。",
  valley: "两侧地势较高的谷地，不一定有河流。",
  canyon: "狭窄、较深的侵蚀谷地。河道需要单独绘制。",
  rift_valley: "以断裂和下陷为主要线索的裂谷。",
  dune: "风沙堆积的沙丘，使用弧形沙脊。",
  gravel_desert: "以砾石覆盖为主的干旱地表。",
  salt_flat: "盐类沉积的平坦地表，区别于盐湖水面。",
  badlands: "沟壑密集、侵蚀明显的地貌。",
  karst: "以石灰岩溶蚀形态为线索的喀斯特地貌。",
  loess: "黄土覆盖及侵蚀形成的地貌。",
  rocky_barren: "裸露岩石占主导的地表，可另选稀疏植被。",
  glacier: "冰川覆盖的地貌，使用浅色和裂纹形状。",
  permafrost: "多年冻土环境的地貌，不等于永久积雪。",
  volcanic: "火山锥及相关火山地貌，使用火山轮廓。",
  lava_field: "熔岩形成的地表。深色不表示仍在喷发。",
  geothermal: "地热活动相关地貌，使用蒸汽线索。"
};

export const BIOME_DESCRIPTIONS: Record<BiomeKey, string> = {
  bare: "裸露地表，不添加植被纹理。",
  grassland: "以草本植被为主，用草簇表示。",
  steppe: "偏干的草原，草簇更稀疏。",
  savanna: "草地与零散树木并存。",
  deciduous_forest: "圆冠树木表示温带落叶林。",
  mixed_forest: "圆冠与针叶树并列表示混交。",
  conifer_forest: "尖冠树木表示针叶林。",
  temperate_rainforest: "圆冠与高大尖冠组合表示湿润温带森林。",
  tropical_rainforest: "复合树冠表示热带雨林。",
  monsoon_forest: "圆冠配季节性线索，与温带雨林分开。",
  cloud_forest: "树冠与雾线表示云雾林。",
  shrubland: "低矮、成簇的灌木。",
  mediterranean: "以硬叶灌丛等为线索的地中海型生态。",
  xeric_shrubland: "稀疏耐旱灌丛。",
  arid: "干旱环境线索，区别于具体沙丘地貌。",
  semi_arid: "稀疏植被与干旱地表交错。",
  tundra: "低矮苔藓、地衣和草本植被线索。",
  alpine: "高山环境的稀疏植被。",
  polar: "极地生态线索，不自动改变地貌。",
  marsh: "草本湿地，以水线和草丛表示。",
  swamp: "树木与水线结合的林泽。",
  bog: "泥炭湿地，以点簇和浅水线表示。",
  reedbed: "挺立芦苇表示芦苇湿地。",
  mangrove: "分叉根系与树冠表示红树林。",
  freshwater: "淡水环境的单道水纹。",
  marine: "海洋环境的双道水纹。",
  brackish: "咸淡水过渡的水纹与点。",
  coral: "分枝珊瑚形状。",
  seagrass: "弯曲长叶表示水下海草。",
  pack_ice: "不规则碎片表示浮冰。"
};

export function isOpenWaterTerrain(terrain: TerrainKey | null): boolean {
  return (
    terrain !== null && ["ocean", "sea", "lagoon", "lake", "salt_lake", "river"].includes(terrain)
  );
}

export function resolveMaterial(
  terrain: TerrainKey,
  biome: BiomeKey | null
): { terrain: TerrainKey; biome: BiomeKey | null; notice: string | null } {
  const allowed = biome === null || ALLOWED_BIOMES_BY_TERRAIN[terrain].includes(biome);
  return {
    terrain,
    biome: allowed ? biome : null,
    notice: allowed
      ? null
      : "已清除不适用于" + TERRAIN_ENTRIES[terrain].label + "的生态；可重新选择。"
  };
}
