import type { ActiveCell, ExportRenderOptions, MapRuntimeState, TagKey } from "@mapdesigner/map-core";

export interface HexLayoutOptions {
  size: number;
  padding?: number;
}

export interface HexCellLayout {
  cell: ActiveCell;
  centerX: number;
  centerY: number;
  points: string;
}

export interface MapRenderOptions {
  size?: number;
  padding?: number;
  background?: string;
  includeCoordinates?: boolean;
  includeShorthand?: boolean;
  includeGrid?: boolean;
  includeUndesigned?: boolean;
  selectedCellId?: string | null;
  hoveredCellId?: string | null;
}

export interface MapScene {
  width: number;
  height: number;
  minX: number;
  minY: number;
  background: string;
  layout: HexCellLayout[];
  defs: string[];
  options: Required<MapRenderOptions>;
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
