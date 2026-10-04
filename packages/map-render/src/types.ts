import type {
  ActiveCell,
  CellRange,
  ExportRenderOptions,
  GridCoordinate,
  MapRuntimeState,
  MapStyle,
  RiverFeature,
  TagKey
} from "@mapdesigner/map-core";

export interface HexLayoutOptions {
  frame?: PixelFrame;
  size: number;
  padding?: number;
  extraCoords?: GridCoordinate[];
  boundsCoords?: GridCoordinate[];
}
export interface PixelFrame {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface HexCellLayout {
  cell: ActiveCell;
  centerX: number;
  centerY: number;
  points: string;
}

export interface RiverBodyLayout {
  id: string;
  riverId: string;
  networkId: string;
  riverName: string;
  bankPath: string | null;
  bodyPath: string;
  highlightPath: string | null;
  centerPath: string;
  color: string;
  bankColor: string;
  highlightColor: string;
  opacity: number;
  preview: boolean;
  pointCount: number;
  outlineWidth: number;
  highlightWidth: number;
  widthRange: {
    min: number;
    max: number;
  };
  connectedStart: boolean;
  connectedEnd: boolean;
}

export interface RiverControlPointLayout {
  id: string;
  riverId: string;
  riverName: string;
  x: number;
  y: number;
  radius: number;
  label: string;
  position: "start" | "middle" | "end";
  color: string;
  opacity: number;
  preview: boolean;
}

export interface MapRenderOptions {
  frame?: PixelFrame;
  mapStyle?: MapStyle;
  includeTerrain?: boolean;
  includeTerrainSymbols?: boolean;
  includeBiomes?: boolean;
  includeRivers?: boolean;
  includeTags?: boolean;
  size?: number;
  padding?: number;
  background?: string;
  usePatternOverlays?: boolean;
  includeCoordinates?: boolean;
  includeShorthand?: boolean;
  includeGrid?: boolean;
  includeUndesigned?: boolean;
  selectedCellId?: string | null;
  hoveredCellId?: string | null;
  previewRivers?: RiverFeature[];
  boundsCoords?: GridCoordinate[];
  riverClipRange?: CellRange;
  riverDetail?: "high" | "low";
}

export interface MapScene {
  width: number;
  height: number;
  minX: number;
  minY: number;
  background: string;
  layout: HexCellLayout[];
  water: { surfacePath: string; shorePath: string };
  riverBodies: RiverBodyLayout[];
  riverControlPoints: RiverControlPointLayout[];
  defs: string[];
  options: Required<
    Omit<MapRenderOptions, "previewRivers" | "boundsCoords" | "riverClipRange" | "frame">
  > & {
    frame?: PixelFrame;
    previewRivers: RiverFeature[];
    boundsCoords?: GridCoordinate[];
    riverClipRange?: CellRange;
  };
  composition?: {
    mapWidth: number;
    mapHeight: number;
    headerHeight: number;
    legendWidth: number;
    footerHeight: number;
    titleLines: string[];
    captionLines: string[];
    scale: number;
    northArrow: boolean;
    gridScale: boolean;
    legend: Array<{ kind: "terrain" | "biome" | "tag" | "river"; key: string }>;
  };
}

export interface RenderLabel {
  primary: string;
  secondary?: string;
}

export interface ExportSceneInput {
  map: MapRuntimeState;
  options: ExportRenderOptions;
}

export type PrimaryTagSymbol = Record<TagKey, string>;
