import type { CellChangeDetail, GridCoordinate, HistorySource, MapCommand, MapFeatures, MapRuntimeState, MapSummary, ValidationIssue } from "@mapdesigner/map-core";
import type { HistoryStatus } from "./repository.js";

export interface ApplyCommandsOptions {
  dryRun?: boolean;
  expectedRevision?: number;
}

export interface ApplyValueSummary {
  before: Record<string, number>;
  after: Record<string, number>;
}

export interface ApplyChangeStats {
  command_count: number;
  changed_count: number;
  created_count: number;
  updated_count: number;
  cleared_count: number;
  feature_stats: {
    river_created_count: number;
    river_updated_count: number;
    river_deleted_count: number;
  };
  terrain_summary: ApplyValueSummary;
  biome_summary: ApplyValueSummary;
}

export interface CommandExecutionReport {
  index: number;
  action: MapCommand["action"];
  changed: GridCoordinate[];
  details: CellChangeDetail[];
  warnings: ValidationIssue[];
}

export interface ApplyCommandsResult {
  map: MapRuntimeState;
  warnings: ValidationIssue[];
  dryRun: boolean;
  command_results: CommandExecutionReport[];
  changes: CellChangeDetail[];
  stats: ApplyChangeStats;
}

export interface LightweightApplyCommandsResult {
  mapId: string;
  summary: MapSummary;
  features?: MapFeatures;
  warnings: ValidationIssue[];
  dryRun: boolean;
  command_results: CommandExecutionReport[];
  changes: CellChangeDetail[];
  stats: ApplyChangeStats;
}

export interface HistoryMoveResult {
  changes?: CellChangeDetail[];
  map: MapRuntimeState;
  warnings: ValidationIssue[];
  operation: {
    seq: number;
    action: string;
    source: HistorySource;
    timestamp: string;
  };
  status: HistoryStatus;
}

export interface LightweightHistoryMoveResult {
  changes?: CellChangeDetail[];
  mapId: string;
  summary: MapSummary;
  features?: MapFeatures;
  warnings: ValidationIssue[];
  operation: {
    seq: number;
    action: string;
    source: HistorySource;
    timestamp: string;
  };
  status: HistoryStatus;
}
