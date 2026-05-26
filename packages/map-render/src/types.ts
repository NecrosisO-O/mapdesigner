import type { ActiveCell, ExportRenderOptions, GridCoordinate, MapRuntimeState, RiverFeature, TagKey } from "@mapdesigner/map-core";

export interface HexLayoutOptions {
  size: number;
  padding?: number;
  extraCoords?: GridCoordinate[];
}

export interface HexCellLayout {
  cell: ActiveCell;
  centerX: number;
  centerY: number;
  points: string;
}

export interface RiverSegmentLayout {
  id: string;
  riverId: string;
  riverName: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
  opacity: number;
  preview: boolean;
}

export interface RiverEndpointLayout {
  id: string;
  riverId: string;
  riverName: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
  position: "start" | "end";
  kind: "water";
  preview: boolean;
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
  size?: number;
  padding?: number;
  background?: string;
  includeCoordinates?: boolean;
  includeShorthand?: boolean;
  includeGrid?: boolean;
  includeUndesigned?: boolean;
  selectedCellId?: string | null;
  hoveredCellId?: string | null;
  previewRivers?: RiverFeature[];
}

export interface MapScene {
  width: number;
  height: number;
  minX: number;
  minY: number;
  background: string;
  layout: HexCellLayout[];
  riverSegments: RiverSegmentLayout[];
  riverEndpoints: RiverEndpointLayout[];
  riverControlPoints: RiverControlPointLayout[];
  defs: string[];
  options: Required<Omit<MapRenderOptions, "previewRivers">> & { previewRivers: RiverFeature[] };
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
