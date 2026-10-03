import { BIOME_KEYS, type BiomeKey, type TerrainKey, type TagKey } from "@mapdesigner/map-core";

const BIOME_MARKS: Record<BiomeKey, string> = {
  bare: "",
  grassland: "M3 9l-2-3m2 3V4m0 5l3-4",
  steppe: "M2 9l2-3m0 3l3-2",
  savanna: "M5 11V6M0 6Q5 0 10 6Z",
  deciduous_forest: "M5 12V9M5 2C-1 2-1 9 5 9C11 9 11 2 5 2Z",
  mixed_forest: "M2 11V8M2 2C-2 2-2 8 2 8C6 8 6 2 2 2ZM8 10V3l-3 6h6Z",
  conifer_forest: "M5 12V9M5 1L0 10h10Z",
  temperate_rainforest: "M3 12V9M3 2C-2 2-2 9 3 9C8 9 8 2 3 2ZM9 12V4l-3 7h6Z",
  tropical_rainforest: "M4 12V7M-1 7C-3 3 0 1 2 3C3-1 8-1 8 3C12 1 13 6 9 7ZM9 13V8",
  monsoon_forest: "M5 12V9M5 2C-1 2-1 9 5 9C11 9 11 2 5 2ZM11 2l2 3m-1 1l2 2",
  cloud_forest: "M5 12V8M5 0L0 8h10ZM-2 11q3-2 6 0t7 0",
  shrubland: "M0 9Q-1 3 3 5Q5 0 7 5Q12 3 10 9Z",
  mediterranean: "M1 10Q-2 4 3 6Q4 1 7 6Q12 4 10 10ZM13 3l2-2",
  xeric_shrubland: "M5 11V4M5 9L1 6m4 2l4-3",
  arid: "M0 9q5-5 10 0m-7 3h5",
  semi_arid: "M0 10q3-3 6 0m4 0V5m0 3l2-2",
  tundra: "M0 8q2-3 4 0m1 2q2-3 4 0m-3-7h.2",
  alpine: "M0 9l3-5 3 5m2 1l2-4 2 4",
  polar: "M5 1v10M1 3l8 6M1 9l8-6",
  marsh: "M0 11h11M3 9V3m0 4L1 5m2 1l2-2M8 9V2",
  swamp: "M5 10V7M5 1C0 1 0 7 5 7C10 7 10 1 5 1ZM0 12h11",
  bog: "M0 10q3-2 6 0t6 0M3 5h.1m5 1h.1",
  reedbed: "M1 11V2m4 9V0m4 11V3M0 2h2M4 0h2M8 3h2",
  mangrove: "M5 8V5M5 8l-4 4m4-4l4 4M0 5Q-1 0 5 0Q11 0 10 5ZM0 13h10",
  freshwater: "M0 6q3-2 6 0t6 0",
  marine: "M0 4q3-2 6 0t6 0M4 10q3-2 6 0t6 0",
  brackish: "M0 5q3-2 6 0t6 0M3 11h.1m5 0h.1",
  coral: "M5 11V3M5 7L1 4V1m4 8l4-3V2m0 4l3-2",
  seagrass: "M2 12Q7 6 2 1M6 12Q10 7 8 3M10 12Q14 8 12 4",
  pack_ice: "M1 3l6-2 4 4-3 5-7-2Z"
};

export function buildAtlasPatterns(): string[] {
  return BIOME_KEYS.filter((key) => key !== "bare").map((key) => {
    const water = ["freshwater", "marine", "brackish", "coral", "seagrass", "pack_ice"].includes(
      key
    );
    const color = water
      ? "#EAF6F4"
      : ["arid", "semi_arid", "xeric_shrubland"].includes(key)
        ? "#806945"
        : "#435B40";
    const spacing = key.includes("forest") ? 40 : water ? 52 : 42;
    return (
      '<pattern id="atlas-' +
      key +
      '" patternUnits="userSpaceOnUse" width="' +
      spacing +
      '" height="' +
      spacing +
      '"><path d="' +
      BIOME_MARKS[key] +
      '" transform="translate(6 6)" fill="none" stroke="' +
      color +
      '" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/></pattern>'
    );
  });
}

export const TERRAIN_SYMBOLS: Partial<Record<TerrainKey, string>> = {
  mountain: "M-16 9L-5-11 7 9M-5-11l2 10 4-3M3 8l8-15 12 16",
  hill: "M-18 6Q-10-10-2 6M-2 8Q8-13 19 8",
  foothill: "M-19 7Q-12-5-5 7M-2 7L8-9l11 16",
  plateau: "M-19 9l7-16H8l11 16M-10-3H7",
  basin: "M-18-5Q0 18 18-5M-12-5Q0 8 12-5",
  valley: "M-18-8l12 15M18-8L6 7M-3 11h6",
  canyon: "M-17-12l8 8-5 9 9 8M17-12L8-4l5 9-9 8M-12-6l-3 3M12 4l3 3",
  rift_valley: "M-10-12l4 10-5 8 4 9M10-12L6-2l5 8-4 9M-18 0l5 2m26-2l5-2",
  dune: "M-21 8Q-4-17 15 6M-4-5q3 11 17 13M-17 15q12-5 24 0",
  glacier: "M-18 12l7-25h18l11 25M-6-11l-2 8 4 4-4 6M4-11l4 8-3 4 5 8",
  volcanic: "M-20 11L-6-8Q0-4 6-8l14 19M-6-8Q0-12 6-8M0-14q-4-4 0-7",
  lava_field: "M-18-8l12 5-5 9 11-2 8 8M4-12l-2 10 10 1 5 8",
  rocky_barren: "M-15 6l4-8 9 2 2 6ZM6 10l4-7 9 4 1 3Z",
  karst: "M-19 10l3-13 5-6 4 19M-3 10l2-19 5-3 4 22M11 10l4-13 4 13",
  badlands: "M-17 10l6-20 5 20M-2 10l5-14 4 14M11 10l4-21 5 21",
  loess: "M-18 10L-9-8H5l13 18M-9-3L-6 10M2-3l3 13",
  wetland: "M-18 9h36M-9 5V-7m0 7l-4-4M4 5V-10m0 9l4-4M13 5V-3",
  salt_flat: "M-13-3l8-5 9 4-1 10-9 3ZM3-4l10-3 5 9-7 7-8-3",
  geothermal: "M-14 10h28M-8 4q-6-5 0-10M0 4q-6-5 0-10M8 4q-6-5 0-10"
};

export const TAG_SYMBOLS: Record<TagKey, string> = {
  peak: "M-6 5L0-6l6 11ZM0-6v-4l5 2-5 1",
  waterfall: "M-7-4H7M-4-4V6m4-10V8m4-12V6M-7 9H7",
  cave_entrance: "M-7 6Q-8-7 0-7Q8-7 7 6ZM-3 6V1Q0-5 3 1v5",
  oasis: "M-7 6Q0 2 7 6M0 4V-3M-6-3Q0-8 6-3M0-3l-4-5m4 5l4-5",
  crater: "M-7 0Q0-6 7 0Q0 8-7 0ZM-3-1Q0 2 3-1",
  island: "M-7 3Q0-6 7 3Q0 8-7 3ZM-8 8H8",
  peninsula: "M-8-5H2Q9 2 1 5H-8M-8 8H8",
  bay: "M-8-6Q10 0-8 6M0 7H8",
  strait: "M-8-7Q0-5-2 0Q0 5-8 7M8-7Q0-5 2 0Q0 5 8 7",
  cape: "M-8-6L6 0-8 6M0 8H8",
  cliff: "M-7-5H6V7M-3-5V2m4-7V4m5-3l3 2",
  fault_line: "M-7-8L1-2-2 2 7 8M-8 0l3 3m10-6l3 3"
};
