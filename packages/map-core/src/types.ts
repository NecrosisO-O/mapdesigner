export type LayoutType = "flat-top-even-q";
export type CellStatus = "designed" | "undesigned";
export type IssueSeverity = "warning" | "invalid";
export type HistorySource = "webui" | "cli" | "system";

export interface GridCoordinate {
  row: number;
  col: number;
}

export interface MapMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  revision: number;
}

export interface GridConfig {
  layout: LayoutType;
  origin: GridCoordinate;
}

export interface DesignedCellRecord extends GridCoordinate {
  terrain: TerrainKey;
  biome: BiomeKey | null;
  tags: TagKey[];
  note: string;
}

export interface MapDocument {
  schema_version: 1;
  meta: MapMeta;
  grid: GridConfig;
  cells: DesignedCellRecord[];
}

export interface ActiveCell extends GridCoordinate {
  id: string;
  display_coord: string;
  status: CellStatus;
  terrain: TerrainKey | null;
  biome: BiomeKey | null;
  tags: TagKey[];
  note: string;
  is_seed?: boolean;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: IssueSeverity;
  target?: string;
}

export interface CellChangeDetail {
  coord: GridCoordinate;
  cell_id: string;
  display_coord: string;
  before: ActiveCell | null;
  after: ActiveCell | null;
}

export interface CellInspectionResult {
  cell: ActiveCell;
  neighbors: ActiveCell[];
}

export interface AreaInspectionResult {
  center: GridCoordinate;
  radius: number;
  cells: ActiveCell[];
}

export interface NeighborInspectionResult {
  center: ActiveCell;
  neighbors: ActiveCell[];
}

export interface RuntimeHistoryEntry {
  label: string;
  source: HistorySource;
  timestamp: string;
  before: MapDocument;
  after: MapDocument;
}

export interface HistoryState {
  past: RuntimeHistoryEntry[];
  future: RuntimeHistoryEntry[];
  limit: number;
}

export interface MapRuntimeState {
  document: MapDocument;
  activeCells: ActiveCell[];
  history: HistoryState;
}

export interface MapCommandBase {
  action: string;
  source?: HistorySource;
}

export interface SetCellCommand extends MapCommandBase {
  action: "set_cell";
  target: GridCoordinate;
  changes: {
    terrain: TerrainKey;
    biome?: BiomeKey | null;
    tags?: TagKey[];
    note?: string;
  };
}

export interface SetCellsCommand extends MapCommandBase {
  action: "set_cells";
  targets: GridCoordinate[];
  changes: {
    terrain: TerrainKey;
    biome?: BiomeKey | null;
    tags?: TagKey[];
    note?: string;
  };
}

export interface ClearCellCommand extends MapCommandBase {
  action: "clear_cell";
  target: GridCoordinate;
}

export interface ReplaceTerrainCommand extends MapCommandBase {
  action: "replace_terrain";
  match: {
    terrain: TerrainKey;
  };
  changes: {
    terrain: TerrainKey;
  };
}

export interface ReplaceBiomeCommand extends MapCommandBase {
  action: "replace_biome";
  match: {
    biome: BiomeKey | null;
  };
  changes: {
    biome: BiomeKey | null;
  };
}

export interface AnnotateCellCommand extends MapCommandBase {
  action: "annotate_cell";
  target: GridCoordinate;
  changes: {
    tags?: TagKey[];
    note?: string;
  };
}

export type MapCommand =
  | SetCellCommand
  | SetCellsCommand
  | ClearCellCommand
  | ReplaceTerrainCommand
  | ReplaceBiomeCommand
  | AnnotateCellCommand;

export interface CommandResult {
  ok: boolean;
  map: MapRuntimeState;
  changed: GridCoordinate[];
  details: CellChangeDetail[];
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
}

export interface DictionaryEntry {
  key: string;
  label: string;
  short: string;
  category?: string;
}

export interface TagEntry extends DictionaryEntry {
  display: "primary" | "detail";
}

export type TerrainKey =
  | "ocean"
  | "sea"
  | "coast"
  | "beach"
  | "tidal_flat"
  | "reef"
  | "lagoon"
  | "estuary"
  | "lake"
  | "salt_lake"
  | "river"
  | "delta"
  | "plain"
  | "alluvial_plain"
  | "floodplain"
  | "wetland"
  | "hill"
  | "foothill"
  | "mountain"
  | "plateau"
  | "basin"
  | "valley"
  | "canyon"
  | "rift_valley"
  | "dune"
  | "gravel_desert"
  | "salt_flat"
  | "badlands"
  | "karst"
  | "loess"
  | "rocky_barren"
  | "glacier"
  | "permafrost"
  | "volcanic"
  | "lava_field"
  | "geothermal";

export type BiomeKey =
  | "bare"
  | "grassland"
  | "steppe"
  | "savanna"
  | "deciduous_forest"
  | "mixed_forest"
  | "conifer_forest"
  | "temperate_rainforest"
  | "tropical_rainforest"
  | "monsoon_forest"
  | "cloud_forest"
  | "shrubland"
  | "mediterranean"
  | "xeric_shrubland"
  | "arid"
  | "semi_arid"
  | "tundra"
  | "alpine"
  | "polar"
  | "marsh"
  | "swamp"
  | "bog"
  | "reedbed"
  | "mangrove"
  | "freshwater"
  | "marine"
  | "brackish"
  | "coral"
  | "seagrass"
  | "pack_ice";

export type TagKey =
  | "island"
  | "peninsula"
  | "bay"
  | "strait"
  | "cape"
  | "peak"
  | "cliff"
  | "waterfall"
  | "oasis"
  | "crater"
  | "cave_entrance"
  | "fault_line";

export interface ExportRenderOptions {
  preset: "clean" | "reference";
  includeCoordinates: boolean;
  includeShorthand: boolean;
  includeGrid: boolean;
  includeUndesigned: boolean;
  background: string;
  padding: number;
  scale: number;
}
