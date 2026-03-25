import type {
  BiomeKey,
  DictionaryEntry,
  TagEntry,
  TagKey,
  TerrainKey
} from "./types.js";

export const TERRAIN_ENTRIES: Record<TerrainKey, DictionaryEntry> = {
  ocean: { key: "ocean", label: "海洋", short: "OCN", category: "water" },
  sea: { key: "sea", label: "近海", short: "SEA", category: "water" },
  coast: { key: "coast", label: "海岸", short: "CST", category: "coast" },
  beach: { key: "beach", label: "沙滩", short: "BCH", category: "coast" },
  tidal_flat: { key: "tidal_flat", label: "潮滩", short: "TFL", category: "coast" },
  reef: { key: "reef", label: "礁体", short: "REF", category: "coast" },
  lagoon: { key: "lagoon", label: "潟湖", short: "LGN", category: "water" },
  estuary: { key: "estuary", label: "河口", short: "EST", category: "water" },
  lake: { key: "lake", label: "湖泊", short: "LAK", category: "water" },
  salt_lake: { key: "salt_lake", label: "盐湖", short: "SLK", category: "water" },
  river: { key: "river", label: "河流", short: "RIV", category: "water" },
  delta: { key: "delta", label: "三角洲", short: "DLT", category: "plain" },
  plain: { key: "plain", label: "平原", short: "PLN", category: "plain" },
  alluvial_plain: { key: "alluvial_plain", label: "冲积平原", short: "ALV", category: "plain" },
  floodplain: { key: "floodplain", label: "泛滥平原", short: "FLD", category: "plain" },
  wetland: { key: "wetland", label: "湿地地貌", short: "WTL", category: "plain" },
  hill: { key: "hill", label: "丘陵", short: "HIL", category: "upland" },
  foothill: { key: "foothill", label: "山麓", short: "FTH", category: "upland" },
  mountain: { key: "mountain", label: "山地", short: "MTN", category: "upland" },
  plateau: { key: "plateau", label: "高原", short: "PLT", category: "upland" },
  basin: { key: "basin", label: "盆地", short: "BAS", category: "upland" },
  valley: { key: "valley", label: "谷地", short: "VAL", category: "upland" },
  canyon: { key: "canyon", label: "峡谷", short: "CYN", category: "cut" },
  rift_valley: { key: "rift_valley", label: "裂谷", short: "RFT", category: "cut" },
  dune: { key: "dune", label: "沙丘地", short: "DUN", category: "arid" },
  gravel_desert: { key: "gravel_desert", label: "砾漠", short: "GVD", category: "arid" },
  salt_flat: { key: "salt_flat", label: "盐原", short: "SFT", category: "arid" },
  badlands: { key: "badlands", label: "恶地", short: "BDL", category: "arid" },
  karst: { key: "karst", label: "喀斯特", short: "KST", category: "upland" },
  loess: { key: "loess", label: "黄土地貌", short: "LOS", category: "arid" },
  rocky_barren: { key: "rocky_barren", label: "岩石荒地", short: "RKB", category: "upland" },
  glacier: { key: "glacier", label: "冰川地貌", short: "GLC", category: "cold" },
  permafrost: { key: "permafrost", label: "永冻土地貌", short: "PRM", category: "cold" },
  volcanic: { key: "volcanic", label: "火山地貌", short: "VLC", category: "volcanic" },
  lava_field: { key: "lava_field", label: "熔岩原", short: "LVF", category: "volcanic" },
  geothermal: { key: "geothermal", label: "地热地貌", short: "GTH", category: "volcanic" }
};

export const BIOME_ENTRIES: Record<BiomeKey, DictionaryEntry> = {
  bare: { key: "bare", label: "裸地", short: "BAR", category: "dry" },
  grassland: { key: "grassland", label: "草原", short: "GRS", category: "vegetation" },
  steppe: { key: "steppe", label: "干草原", short: "STP", category: "vegetation" },
  savanna: { key: "savanna", label: "稀树草原", short: "SAV", category: "vegetation" },
  deciduous_forest: { key: "deciduous_forest", label: "温带落叶林", short: "DFR", category: "forest" },
  mixed_forest: { key: "mixed_forest", label: "温带混交林", short: "MFR", category: "forest" },
  conifer_forest: { key: "conifer_forest", label: "针叶林", short: "CFR", category: "forest" },
  temperate_rainforest: { key: "temperate_rainforest", label: "温带雨林", short: "TRF", category: "forest" },
  tropical_rainforest: { key: "tropical_rainforest", label: "热带雨林", short: "RNF", category: "forest" },
  monsoon_forest: { key: "monsoon_forest", label: "季雨林", short: "MSF", category: "forest" },
  cloud_forest: { key: "cloud_forest", label: "云雾林", short: "CLD", category: "forest" },
  shrubland: { key: "shrubland", label: "灌丛", short: "SHB", category: "vegetation" },
  mediterranean: { key: "mediterranean", label: "地中海生态", short: "MED", category: "vegetation" },
  xeric_shrubland: { key: "xeric_shrubland", label: "旱灌丛", short: "XSH", category: "vegetation" },
  arid: { key: "arid", label: "荒漠生态", short: "ARD", category: "dry" },
  semi_arid: { key: "semi_arid", label: "半干旱生态", short: "SAR", category: "dry" },
  tundra: { key: "tundra", label: "苔原", short: "TND", category: "cold" },
  alpine: { key: "alpine", label: "高山生态", short: "ALN", category: "cold" },
  polar: { key: "polar", label: "极地生态", short: "POL", category: "cold" },
  marsh: { key: "marsh", label: "沼泽", short: "MSH", category: "wet" },
  swamp: { key: "swamp", label: "林泽", short: "SWP", category: "wet" },
  bog: { key: "bog", label: "泥炭沼", short: "BOG", category: "wet" },
  reedbed: { key: "reedbed", label: "芦苇湿地", short: "RDB", category: "wet" },
  mangrove: { key: "mangrove", label: "红树林", short: "MNG", category: "wet" },
  freshwater: { key: "freshwater", label: "淡水生态", short: "FWR", category: "water" },
  marine: { key: "marine", label: "海洋生态", short: "MRN", category: "water" },
  brackish: { key: "brackish", label: "咸淡水生态", short: "BRK", category: "water" },
  coral: { key: "coral", label: "珊瑚生态", short: "CRL", category: "water" },
  seagrass: { key: "seagrass", label: "海草床", short: "SGR", category: "water" },
  pack_ice: { key: "pack_ice", label: "浮冰生态", short: "ICE", category: "cold" }
};

export const TAG_ENTRIES: Record<TagKey, TagEntry> = {
  island: { key: "island", label: "岛屿", short: "ISL", display: "detail" },
  peninsula: { key: "peninsula", label: "半岛", short: "PEN", display: "detail" },
  bay: { key: "bay", label: "海湾", short: "BAY", display: "detail" },
  strait: { key: "strait", label: "海峡", short: "STR", display: "detail" },
  cape: { key: "cape", label: "海角", short: "CAP", display: "detail" },
  peak: { key: "peak", label: "山峰", short: "PEK", display: "primary" },
  cliff: { key: "cliff", label: "悬崖", short: "CLF", display: "detail" },
  waterfall: { key: "waterfall", label: "瀑布", short: "WFL", display: "primary" },
  oasis: { key: "oasis", label: "绿洲", short: "OAS", display: "primary" },
  crater: { key: "crater", label: "陨坑", short: "CRT", display: "primary" },
  cave_entrance: { key: "cave_entrance", label: "洞穴入口", short: "CAV", display: "primary" },
  fault_line: { key: "fault_line", label: "断层线", short: "FLT", display: "detail" }
};

export const PRIMARY_TAG_PRIORITY: TagKey[] = [
  "waterfall",
  "oasis",
  "peak",
  "cave_entrance",
  "crater"
];

export const TERRAIN_KEYS = Object.keys(TERRAIN_ENTRIES) as TerrainKey[];
export const BIOME_KEYS = Object.keys(BIOME_ENTRIES) as BiomeKey[];
export const TAG_KEYS = Object.keys(TAG_ENTRIES) as TagKey[];
