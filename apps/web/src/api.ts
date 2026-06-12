import type {
  CellRange,
  CellRangeResult,
  ExportRenderOptions,
  MapCommand,
  MapDocument,
  MapRuntimeState,
  MapSummary
} from "@mapdesigner/map-core";

export interface ApiEnvelope<T> {
  ok: boolean;
  result?: T;
  warnings: Array<{ code: string; message: string; severity: "warning" | "invalid"; target?: string }>;
  errors: Array<{ code: string; message: string; severity: "warning" | "invalid"; target?: string }>;
}

export interface MapListItem {
  id: string;
  name: string;
  fileName: string;
  updatedAt: string;
  revision: number;
  designedCellCount: number;
}

export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
  cursor: number;
  latest: number;
}

export interface HistoryEntry {
  seq: number;
  action: string;
  source: string;
  timestamp: string;
}

export interface MapHistory {
  status: HistoryStatus;
  entries: HistoryEntry[];
}

export interface HistoryMoveResult {
  map: MapRuntimeState;
  warnings: ApiEnvelope<unknown>["warnings"];
  operation: {
    seq: number;
    action: string;
    source: string;
    timestamp: string;
  };
  status: HistoryStatus;
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const headers =
    init?.body === undefined
      ? init?.headers
      : {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        };
  const response = await fetch(input, {
    ...init,
    headers
  });
  return response.json() as Promise<ApiEnvelope<T>>;
}

export const api = {
  listMaps: () => request<MapListItem[]>("/api/maps"),
  getMap: (id: string) => request<MapRuntimeState>(`/api/maps/${id}`),
  getMapSummary: (id: string) => request<MapSummary>(`/api/maps/${id}/summary`),
  getMapHistory: (id: string, limit = 5) => request<MapHistory>(`/api/maps/${id}/history?limit=${limit}`),
  getHistoryStatus: (id: string) => request<HistoryStatus>(`/api/maps/${id}/history-status`),
  getCellsInRange: (id: string, range: CellRange, includeUndesigned = true) =>
    request<CellRangeResult>(
      `/api/maps/${id}/cells?minRow=${range.minRow}&maxRow=${range.maxRow}&minCol=${range.minCol}&maxCol=${range.maxCol}&includeUndesigned=${includeUndesigned}`
    ),
  createMap: (input: { name: string; description?: string }) =>
    request<MapRuntimeState>("/api/maps", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  saveMap: (id: string, input: { document: MapDocument; expectedRevision: number }) =>
    request<MapRuntimeState>(`/api/maps/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  saveMapAs: (id: string, input: { document: MapDocument; name: string; id?: string }) =>
    request<MapRuntimeState>(`/api/maps/${id}/save-as`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  applyCommands: (id: string, commands: MapCommand[], dryRun = false) =>
    request<{
      map: MapRuntimeState;
      dryRun: boolean;
      warnings: ApiEnvelope<unknown>["warnings"];
      stats: {
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
      };
    }>(`/api/maps/${id}/commands${dryRun ? "/dry-run" : ""}`, {
      method: "POST",
      body: JSON.stringify({ commands })
    }),
  duplicateMap: (id: string) =>
    request<MapRuntimeState>(`/api/maps/${id}/duplicate`, {
      method: "POST"
    }),
  deleteMap: (id: string) =>
    request<{ deleted: true }>(`/api/maps/${id}`, {
      method: "DELETE"
    }),
  undoMap: (id: string) =>
    request<HistoryMoveResult | null>(`/api/maps/${id}/undo`, {
      method: "POST"
    }),
  redoMap: (id: string) =>
    request<HistoryMoveResult | null>(`/api/maps/${id}/redo`, {
      method: "POST"
    }),
  importMap: (content: string, generateNewId = false) =>
    request<MapRuntimeState>("/api/maps/import", {
      method: "POST",
      body: JSON.stringify({ content, generateNewId })
    }),
  exportJson: (id: string) =>
    request<{ fileName: string; path: string; downloadUrl: string }>(`/api/maps/${id}/export-json`, {
      method: "POST"
    }),
  exportPng: (id: string, options: Partial<ExportRenderOptions>) =>
    request<{ fileName: string; path: string; downloadUrl: string }>(`/api/maps/${id}/export-png`, {
      method: "POST",
      body: JSON.stringify(options)
    })
};
