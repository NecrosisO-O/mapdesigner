import {
  getHistoryLimitForDesignedCellCount,
  type ActiveCell,
  type CellRange,
  type MapFeatures,
  type MapOverview,
  type MapRuntimeState,
  type MapSummary
} from "@mapdesigner/map-core";
import type { MapHistory } from "./api.js";

export interface EditorSession {
  summary: MapSummary;
  overview?: MapOverview | null;
  features: MapFeatures;
  cells: ActiveCell[];
  range: CellRange | null;
  nameDraft: string | null;
  history: MapHistory | null;
}

export function sessionRuntime(session: EditorSession): MapRuntimeState {
  const activeCells = [...session.cells].sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    document: {
      schema_version: 1,
      grid: session.summary.grid,
      meta: {
        ...session.summary.meta,
        ...(session.nameDraft !== null ? { name: session.nameDraft } : {})
      },
      cells: activeCells
        .filter((c) => c.status === "designed" && c.terrain)
        .map((c) => ({
          row: c.row,
          col: c.col,
          terrain: c.terrain!,
          biome: c.biome,
          tags: c.tags,
          note: c.note
        })),
      features: session.features
    },
    activeCells,
    history: {
      past: [],
      future: [],
      limit: getHistoryLimitForDesignedCellCount(session.summary.designed_cell_count)
    }
  };
}

export function runtimeSummary(map: MapRuntimeState): MapSummary {
  const bounds: MapSummary["bounds"] = {
    min_row: null,
    max_row: null,
    min_col: null,
    max_col: null
  };
  for (const cell of map.document.cells) {
    bounds.min_row = bounds.min_row === null ? cell.row : Math.min(bounds.min_row, cell.row);
    bounds.max_row = bounds.max_row === null ? cell.row : Math.max(bounds.max_row, cell.row);
    bounds.min_col = bounds.min_col === null ? cell.col : Math.min(bounds.min_col, cell.col);
    bounds.max_col = bounds.max_col === null ? cell.col : Math.max(bounds.max_col, cell.col);
  }
  return {
    meta: map.document.meta,
    grid: map.document.grid,
    bounds,
    designed_cell_count: map.document.cells.length,
    feature_counts: { rivers: map.document.features.rivers.length }
  };
}

export interface RangeData {
  cells: ActiveCell[];
  features: MapFeatures;
  overview?: MapOverview | null;
}

/** Cache display data only; selections and drafts never depend on its lifetime. */
export class ViewportCache {
  private entries = new Map<string, RangeData>();
  constructor(
    private readonly cellBudget = 60_000,
    private readonly rangeBudget = 8
  ) {}
  clear(): void {
    this.entries.clear();
  }
  get(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }
  set(key: string, value: RangeData): void {
    this.entries.delete(key);
    const weight =
      value.cells.length +
      (value.overview?.tiles.length ?? 0) +
      (value.overview?.rivers?.reduce((n, r) => n + r.paths.reduce((m, p) => m + p.length, 0), 0) ??
        0) +
      value.features.rivers.reduce((sum, river) => sum + river.points.length, 0);
    if (weight > this.cellBudget) return;
    this.entries.set(key, value);
    let count = [...this.entries.values()].reduce(
      (sum, entry) =>
        sum +
        entry.cells.length +
        (entry.overview?.tiles.length ?? 0) +
        (entry.overview?.rivers?.reduce(
          (n, r) => n + r.paths.reduce((m, p) => m + p.length, 0),
          0
        ) ?? 0) +
        entry.features.rivers.reduce((n, river) => n + river.points.length, 0),
      0
    );
    while (
      this.entries.size > 1 &&
      (count > this.cellBudget || this.entries.size > this.rangeBudget)
    ) {
      const oldest = this.entries.keys().next().value!;
      const entry = this.entries.get(oldest)!;
      count -=
        entry.cells.length +
        (entry.overview?.tiles.length ?? 0) +
        (entry.overview?.rivers?.reduce(
          (n, r) => n + r.paths.reduce((m, p) => m + p.length, 0),
          0
        ) ?? 0) +
        entry.features.rivers.reduce((n, river) => n + river.points.length, 0);
      this.entries.delete(oldest);
    }
  }
  get size(): number {
    return this.entries.size;
  }
  get cellCount(): number {
    return [...this.entries.values()].reduce(
      (sum, entry) =>
        sum +
        entry.cells.length +
        (entry.overview?.tiles.length ?? 0) +
        (entry.overview?.rivers?.reduce(
          (n, r) => n + r.paths.reduce((m, p) => m + p.length, 0),
          0
        ) ?? 0) +
        entry.features.rivers.reduce((n, river) => n + river.points.length, 0),
      0
    );
  }
}

export interface WorkspaceMap extends MapRuntimeState {
  confirmedFeatures?: MapFeatures;
}
