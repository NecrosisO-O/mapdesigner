import {
  BIOME_ENTRIES,
  PRIMARY_TAG_PRIORITY,
  TAG_ENTRIES,
  TERRAIN_ENTRIES,
  type ActiveCell,
  type BiomeKey,
  type TagKey,
  type TerrainKey
} from "@mapdesigner/map-core";

export const TERRAIN_COLORS: Record<TerrainKey, string> = {
  ocean: "#2F5D7C",
  sea: "#467EA6",
  coast: "#79AFC3",
  beach: "#D8C28C",
  tidal_flat: "#9AA89A",
  reef: "#4FAAA2",
  lagoon: "#72C1C7",
  estuary: "#6F938D",
  lake: "#5D8FBF",
  salt_lake: "#B9C7CF",
  river: "#6EA7D6",
  delta: "#A9BA7E",
  plain: "#A7C47A",
  alluvial_plain: "#B6CB8B",
  floodplain: "#91B575",
  wetland: "#6E9C7B",
  hill: "#8FA56B",
  foothill: "#99845F",
  mountain: "#7F766E",
  plateau: "#AF9160",
  basin: "#95886E",
  valley: "#96A86F",
  canyon: "#B56742",
  rift_valley: "#8B533A",
  dune: "#D6B16B",
  gravel_desert: "#A38E68",
  salt_flat: "#DDD4C2",
  badlands: "#B96B49",
  karst: "#B9C7B1",
  loess: "#C9A36A",
  rocky_barren: "#8F857B",
  glacier: "#DDEDF5",
  permafrost: "#C6D1DA",
  volcanic: "#5E504A",
  lava_field: "#3D332F",
  geothermal: "#978467"
};

const BIOME_PATTERN_IDS: Record<BiomeKey, string> = {
  bare: "pattern-dots-light",
  grassland: "pattern-grass",
  steppe: "pattern-steppe",
  savanna: "pattern-savanna",
  deciduous_forest: "pattern-forest-round",
  mixed_forest: "pattern-forest-mixed",
  conifer_forest: "pattern-forest-conifer",
  temperate_rainforest: "pattern-forest-dense",
  tropical_rainforest: "pattern-rainforest",
  monsoon_forest: "pattern-forest-dense",
  cloud_forest: "pattern-cloud-forest",
  shrubland: "pattern-shrub",
  mediterranean: "pattern-mediterranean",
  xeric_shrubland: "pattern-shrub-dry",
  arid: "pattern-arid",
  semi_arid: "pattern-semi-arid",
  tundra: "pattern-tundra",
  alpine: "pattern-alpine",
  polar: "pattern-polar",
  marsh: "pattern-marsh",
  swamp: "pattern-swamp",
  bog: "pattern-bog",
  reedbed: "pattern-reedbed",
  mangrove: "pattern-mangrove",
  freshwater: "pattern-freshwater",
  marine: "pattern-marine",
  brackish: "pattern-brackish",
  coral: "pattern-coral",
  seagrass: "pattern-seagrass",
  pack_ice: "pattern-pack-ice"
};

export function getTerrainColor(terrain: TerrainKey | null): string {
  return terrain ? TERRAIN_COLORS[terrain] : "#EEE8DA";
}

export function getBiomePatternId(biome: BiomeKey | null): string | null {
  return biome ? BIOME_PATTERN_IDS[biome] : null;
}

export function getCellShorthand(cell: ActiveCell): string | null {
  if (!cell.terrain || cell.status === "undesigned") {
    return null;
  }
  const terrain = TERRAIN_ENTRIES[cell.terrain].short;
  const biome = cell.biome ? BIOME_ENTRIES[cell.biome].short : "";
  return biome ? `${terrain}-${biome}` : terrain;
}

export function getPrimaryTag(cell: ActiveCell): TagKey | null {
  for (const tag of PRIMARY_TAG_PRIORITY) {
    if (cell.tags.includes(tag)) {
      return tag;
    }
  }
  return null;
}

export function getPrimaryTagLabel(tag: TagKey | null): string | null {
  return tag ? TAG_ENTRIES[tag].short : null;
}

export function buildSvgDefs(): string[] {
  return [
    `<pattern id="pattern-grass" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="2" cy="2" r="1" fill="#466B2D" opacity="0.35"/><circle cx="7" cy="5" r="1" fill="#466B2D" opacity="0.25"/></pattern>`,
    `<pattern id="pattern-steppe" patternUnits="userSpaceOnUse" width="12" height="12"><path d="M1 10 L4 8 M7 4 L10 2" stroke="#705A2B" stroke-width="1" opacity="0.3"/></pattern>`,
    `<pattern id="pattern-savanna" patternUnits="userSpaceOnUse" width="14" height="14"><circle cx="4" cy="4" r="1" fill="#6C5A28" opacity="0.25"/><circle cx="10" cy="9" r="2" fill="none" stroke="#6C5A28" stroke-width="1" opacity="0.25"/></pattern>`,
    `<pattern id="pattern-forest-round" patternUnits="userSpaceOnUse" width="16" height="16"><circle cx="5" cy="5" r="2" fill="#24411C" opacity="0.25"/><circle cx="11" cy="10" r="2.4" fill="#24411C" opacity="0.25"/></pattern>`,
    `<pattern id="pattern-forest-mixed" patternUnits="userSpaceOnUse" width="16" height="16"><circle cx="5" cy="6" r="2" fill="#26431D" opacity="0.22"/><path d="M11 4 L13 8 L9 8 Z" fill="#26431D" opacity="0.3"/></pattern>`,
    `<pattern id="pattern-forest-conifer" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M4 10 L7 3 L10 10 Z" fill="#203B1A" opacity="0.3"/></pattern>`,
    `<pattern id="pattern-forest-dense" patternUnits="userSpaceOnUse" width="12" height="12"><circle cx="3" cy="4" r="2" fill="#173316" opacity="0.28"/><circle cx="8" cy="8" r="2" fill="#173316" opacity="0.28"/></pattern>`,
    `<pattern id="pattern-rainforest" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="2" cy="3" r="1.8" fill="#163414" opacity="0.32"/><circle cx="7" cy="5" r="2.1" fill="#163414" opacity="0.28"/></pattern>`,
    `<pattern id="pattern-cloud-forest" patternUnits="userSpaceOnUse" width="18" height="18"><circle cx="5" cy="6" r="2" fill="#1A3A1A" opacity="0.28"/><path d="M9 11 C12 8, 15 14, 7 14" stroke="#DDE5E8" stroke-width="1.2" fill="none" opacity="0.55"/></pattern>`,
    `<pattern id="pattern-shrub" patternUnits="userSpaceOnUse" width="12" height="12"><path d="M3 8 C4 6, 5 6, 6 8" stroke="#556638" stroke-width="1" fill="none" opacity="0.32"/></pattern>`,
    `<pattern id="pattern-mediterranean" patternUnits="userSpaceOnUse" width="12" height="12"><path d="M2 10 L5 7 M6 7 L9 4" stroke="#546538" stroke-width="1" opacity="0.28"/></pattern>`,
    `<pattern id="pattern-shrub-dry" patternUnits="userSpaceOnUse" width="12" height="12"><path d="M3 9 L6 8" stroke="#6E5B38" stroke-width="1" opacity="0.25"/></pattern>`,
    `<pattern id="pattern-arid" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M0 12 Q4 9 8 12 T16 12" stroke="#8A6B3F" stroke-width="1" fill="none" opacity="0.22"/></pattern>`,
    `<pattern id="pattern-semi-arid" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M1 11 Q5 8 9 11" stroke="#8A6B3F" stroke-width="1" fill="none" opacity="0.16"/><circle cx="11" cy="4" r="1" fill="#8A6B3F" opacity="0.16"/></pattern>`,
    `<pattern id="pattern-tundra" patternUnits="userSpaceOnUse" width="12" height="12"><circle cx="4" cy="5" r="1" fill="#6E8192" opacity="0.24"/><circle cx="8" cy="9" r="1" fill="#6E8192" opacity="0.2"/></pattern>`,
    `<pattern id="pattern-alpine" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M3 10 L5 8 M7 6 L9 4 M10 11 L12 8" stroke="#5B6470" stroke-width="1" opacity="0.28"/></pattern>`,
    `<pattern id="pattern-polar" patternUnits="userSpaceOnUse" width="16" height="16"><path d="M4 4 L7 7 L4 10 M12 4 L9 7 L12 10" stroke="#E8F3FA" stroke-width="1" opacity="0.5" fill="none"/></pattern>`,
    `<pattern id="pattern-marsh" patternUnits="userSpaceOnUse" width="12" height="12"><circle cx="3" cy="3" r="1.2" fill="#284F48" opacity="0.24"/><ellipse cx="8" cy="8" rx="2" ry="1" fill="#284F48" opacity="0.18"/></pattern>`,
    `<pattern id="pattern-swamp" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M2 11 C4 8, 7 10, 9 7" stroke="#1F4039" stroke-width="1" fill="none" opacity="0.28"/></pattern>`,
    `<pattern id="pattern-bog" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="2" cy="3" r="1" fill="#3A4137" opacity="0.28"/><circle cx="7" cy="7" r="1.2" fill="#3A4137" opacity="0.28"/></pattern>`,
    `<pattern id="pattern-reedbed" patternUnits="userSpaceOnUse" width="10" height="10"><path d="M2 10 L2 2 M5 10 L5 1 M8 10 L8 3" stroke="#556F3A" stroke-width="1" opacity="0.3"/></pattern>`,
    `<pattern id="pattern-mangrove" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M7 2 L7 7 M7 7 L4 10 M7 7 L10 10" stroke="#42563D" stroke-width="1" opacity="0.3"/></pattern>`,
    `<pattern id="pattern-freshwater" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M1 6 Q4 4 7 6 T13 6" stroke="#D6EDF7" stroke-width="1" fill="none" opacity="0.45"/></pattern>`,
    `<pattern id="pattern-marine" patternUnits="userSpaceOnUse" width="16" height="16"><path d="M1 6 Q5 3 9 6 T17 6 M1 11 Q5 8 9 11 T17 11" stroke="#E2F6FF" stroke-width="1.1" fill="none" opacity="0.45"/></pattern>`,
    `<pattern id="pattern-brackish" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M1 6 Q4 4 7 6 T13 6" stroke="#E2F6FF" stroke-width="1" fill="none" opacity="0.34"/><circle cx="4" cy="10" r="1" fill="#E2F6FF" opacity="0.24"/></pattern>`,
    `<pattern id="pattern-coral" patternUnits="userSpaceOnUse" width="16" height="16"><circle cx="4" cy="5" r="2.2" fill="none" stroke="#FFE0D1" stroke-width="1" opacity="0.5"/><circle cx="10" cy="10" r="2" fill="none" stroke="#FFE0D1" stroke-width="1" opacity="0.4"/></pattern>`,
    `<pattern id="pattern-seagrass" patternUnits="userSpaceOnUse" width="14" height="14"><path d="M3 11 C4 8 5 7 6 3 M8 12 C8 9 9 7 11 4" stroke="#DDF1D5" stroke-width="1" fill="none" opacity="0.45"/></pattern>`,
    `<pattern id="pattern-pack-ice" patternUnits="userSpaceOnUse" width="18" height="18"><path d="M4 6 L8 4 L12 7 L10 11 L5 10 Z" fill="none" stroke="#F5FBFF" stroke-width="1" opacity="0.55"/></pattern>`,
    `<pattern id="pattern-dots-light" patternUnits="userSpaceOnUse" width="12" height="12"><circle cx="4" cy="4" r="1" fill="#766C63" opacity="0.18"/><circle cx="8" cy="9" r="1" fill="#766C63" opacity="0.18"/></pattern>`
  ];
}

export function buildPatternOverlay(biome: BiomeKey | null): string | null {
  const id = getBiomePatternId(biome);
  return id ? `url(#${id})` : null;
}

export function buildCellStroke(cell: ActiveCell, isSelected: boolean, isHovered: boolean): string {
  if (isSelected) {
    return "#D84F2A";
  }
  if (isHovered) {
    return "#3A5D74";
  }
  return cell.status === "designed" ? "#675E52" : "#B7B0A4";
}

export function buildCellOpacity(cell: ActiveCell): number {
  return cell.status === "designed" ? 1 : 0.58;
}

export function getPrimaryTagSymbol(tag: TagKey | null): string | null {
  return tag ? TAG_ENTRIES[tag].short : null;
}
