import type { ExportRenderOptions, MapDocument, MapRuntimeState } from "@mapdesigner/map-core";

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

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  return response.json() as Promise<ApiEnvelope<T>>;
}

export interface CellRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export interface MapMetaResult {
  /** Full MapRuntimeState for small maps; partial for large maps */
  state: MapRuntimeState;
  /** Map extent (all designed cells bounding box) */
  extent: CellRange | null;
}

export interface CommandResult {
  state: MapRuntimeState;
  changed: Array<{ row: number; col: number }>;
  warnings: Array<{ code: string; message: string; severity: string }>;
}

export const api = {
  listMaps: () => request<MapListItem[]>("/api/maps"),
  getMap: (id: string) => request<MapRuntimeState>(`/api/maps/${id}`),
  createMap: (input: { name: string; description?: string; layout?: string }) =>
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
  duplicateMap: (id: string) =>
    request<MapRuntimeState>(`/api/maps/${id}/duplicate`, {
      method: "POST",
      body: "{}"
    }),
  deleteMap: (id: string) =>
    request<{ deleted: true }>(`/api/maps/${id}`, {
      method: "DELETE"
    }),
  importMap: (content: string, generateNewId = false) =>
    request<MapRuntimeState>("/api/maps/import", {
      method: "POST",
      body: JSON.stringify({ content, generateNewId })
    }),
  exportJson: (id: string) =>
    request<{ fileName: string; path: string }>(`/api/maps/${id}/export-json`, {
      method: "POST",
      body: "{}"
    }),
  exportPng: (id: string, options: Partial<ExportRenderOptions>) =>
    request<{ fileName: string; path: string; downloadUrl: string }>(`/api/maps/${id}/export-png`, {
      method: "POST",
      body: JSON.stringify(options)
    }),

  /** Fetch cells in a viewport range (virtual rendering) */
  getCellsInRange: (id: string, range: CellRange, includeUndesigned = true) =>
    request<{ cells: MapRuntimeState["activeCells"] }>(
      `/api/maps/${encodeURIComponent(id)}/cells?minRow=${range.minRow}&maxRow=${range.maxRow}&minCol=${range.minCol}&maxCol=${range.maxCol}&includeUndesigned=${includeUndesigned}`
    ),

  /** Execute a single command on the server */
  executeCommand: (id: string, command: Record<string, unknown>) =>
    request<CommandResult>(`/api/maps/${encodeURIComponent(id)}/command`, {
      method: "POST",
      body: JSON.stringify({ command })
    }),

  /** Undo last command */
  undoMap: (id: string) =>
    request<{ cellsChanged: number; label: string } | null>(`/api/maps/${encodeURIComponent(id)}/undo`, {
      method: "POST",
      body: "{}"
    }),

  /** Check if undo is available */
  getUndoStatus: (id: string) =>
    request<{ canUndo: boolean }>(`/api/maps/${encodeURIComponent(id)}/undo-status`),

  /** Merge source map into target map with offset */
  mergeMap: (targetId: string, sourceMapId: string, rowOffset: number, colOffset: number) =>
    request<{ cellsAdded: number; cellsOverwritten: number }>(`/api/maps/${encodeURIComponent(targetId)}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourceMapId, rowOffset, colOffset })
    })
};
