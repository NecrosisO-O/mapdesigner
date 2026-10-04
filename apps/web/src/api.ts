import type {
  ExportPreview,
  TileExportPreview,
  MergeMapInput,
  MergeMapPreview,
  MapMaterialUsage,
  CellRange,
  MapOverview,
  CellRangeResult,
  CellChangeDetail,
  ExportRenderOptions,
  MapFeaturePage,
  MapCommand,
  MapDocument,
  MapFeatures,
  MapRuntimeState,
  MapSummary
} from "@mapdesigner/map-core";

export interface ApiEnvelope<T> {
  ok: boolean;
  result?: T;
  warnings: Array<{
    code: string;
    message: string;
    severity: "warning" | "invalid";
    target?: string;
  }>;
  errors: Array<{
    code: string;
    message: string;
    severity: "warning" | "invalid";
    target?: string;
  }>;
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
  description?: string;
}

export interface MapHistory {
  status: HistoryStatus;
  entries: HistoryEntry[];
}

export interface HistoryMoveResult {
  changes?: CellChangeDetail[];
  map?: MapRuntimeState;
  summary?: MapSummary;
  features?: MapFeatures;
  warnings: ApiEnvelope<unknown>["warnings"];
  operation: {
    seq: number;
    action: string;
    source: string;
    timestamp: string;
  };
  status: HistoryStatus;
}

export interface CommandExecutionReport {
  index: number;
  action: MapCommand["action"];
  changed: Array<{ row: number; col: number }>;
  details: CellChangeDetail[];
  warnings: ApiEnvelope<unknown>["warnings"];
}

export interface CommandApplyResponse {
  map?: MapRuntimeState;
  summary?: MapSummary;
  features?: MapFeatures;
  dryRun: boolean;
  warnings: ApiEnvelope<unknown>["warnings"];
  command_results?: CommandExecutionReport[];
  changes?: CellChangeDetail[];
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
}

function failure<T>(message: string, code = "request_failed"): ApiEnvelope<T> {
  return { ok: false, warnings: [], errors: [{ code, message, severity: "invalid" }] };
}

export async function request<T>(input: RequestInfo, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  let token = "";
  try {
    token = sessionStorage.getItem("mapdesigner-access-token") ?? "";
  } catch {
    /* Storage may be unavailable. */
  }
  if (token) headers.set("Authorization", "Bearer " + token);
  try {
    const response = await fetch(input, {
      ...init,
      headers: [...headers.keys()].length ? Object.fromEntries(headers.entries()) : undefined,
      signal: init?.signal ?? AbortSignal.timeout(30000)
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return failure("服务器返回了无法读取的响应（HTTP " + response.status + "）");
    }
    if (!data || typeof data !== "object") return failure("服务器响应格式错误");
    const value = data as Record<string, unknown>;
    if (typeof value.ok !== "boolean")
      return failure(
        typeof value.message === "string"
          ? value.message
          : "请求失败（HTTP " + response.status + "）",
        typeof value.code === "string" ? value.code : "http_error"
      );
    const errors = Array.isArray(value.errors) ? (value.errors as ApiEnvelope<T>["errors"]) : [];
    const ok = value.ok && response.ok !== false;
    return {
      ok,
      ...(value.result !== undefined ? { result: value.result as T } : {}),
      warnings: Array.isArray(value.warnings) ? (value.warnings as ApiEnvelope<T>["warnings"]) : [],
      errors:
        !ok && !errors.length
          ? [
              {
                code: "http_error",
                message: "请求失败（HTTP " + response.status + "）",
                severity: "invalid"
              }
            ]
          : errors
    };
  } catch (error) {
    return failure(
      error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)
        ? "请求已取消或超时，请重试"
        : "无法连接服务器，请检查服务是否运行",
      "network_error"
    );
  }
}

export interface TaskControl {
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
}
interface JobResult<T> {
  id: string;
  state: string;
  stage: string;
  result?: T;
  error?: string;
}
async function runJob<T>(
  start: Promise<ApiEnvelope<JobResult<T>>>,
  control: TaskControl = {}
): Promise<ApiEnvelope<T>> {
  const response = await start;
  if (!response.ok || !response.result) return { ...response, result: undefined };
  const id = response.result.id;
  let cancellationSent = false;
  for (;;) {
    if (control.signal?.aborted && !cancellationSent) {
      cancellationSent = true;
      await request("/api/jobs/" + id, { method: "DELETE" });
    }
    const state = await request<JobResult<T>>("/api/jobs/" + id);
    if (!state.ok || !state.result) return { ...state, result: undefined };
    control.onProgress?.(state.result.stage);
    if (state.result.state === "done")
      return { ok: true, result: state.result.result, warnings: [], errors: [] };
    if (["failed", "cancelled"].includes(state.result.state))
      return failure(state.result.error ?? "任务已取消");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export const api = {
  previewMerge: (id: string, input: MergeMapInput, control: TaskControl = {}) =>
    runJob<MergeMapPreview>(
      request("/api/jobs/merge", {
        method: "POST",
        body: JSON.stringify({ mapId: id, input, preview: true })
      }),
      control
    ),
  mergeMap: (id: string, input: MergeMapInput, control: TaskControl = {}) =>
    runJob<{ summary: MapSummary; added: number; replaced: number; rivers: number }>(
      request("/api/jobs/merge", { method: "POST", body: JSON.stringify({ mapId: id, input }) }),
      control
    ),
  historyJob: (
    id: string,
    direction: "undo" | "redo",
    expectedRevision: number,
    control: TaskControl = {}
  ) =>
    runJob<HistoryMoveResult | null>(
      request("/api/jobs/history", {
        method: "POST",
        body: JSON.stringify({ mapId: id, direction, expectedRevision })
      }),
      control
    ),
  previewTiles: (
    id: string,
    options: Partial<ExportRenderOptions>,
    tileSize: number,
    control: TaskControl = {}
  ) =>
    runJob<TileExportPreview>(
      request("/api/jobs/export", {
        method: "POST",
        body: JSON.stringify({ kind: "tiles-preview", mapId: id, options, tileSize })
      }),
      control
    ),
  exportTiles: (
    id: string,
    options: Partial<ExportRenderOptions>,
    tileSize: number,
    control: TaskControl = {}
  ) =>
    runJob<{ fileName: string; downloadUrl: string }>(
      request("/api/jobs/export", {
        method: "POST",
        body: JSON.stringify({ kind: "tiles", mapId: id, options, tileSize })
      }),
      control
    ),
  searchMapFeatures: (id: string, search: string, offset = 0, range: CellRange | null = null) => {
    const params = new URLSearchParams({
      search,
      offset: String(offset),
      limit: "50",
      ...(range
        ? Object.fromEntries(Object.entries(range).map(([key, value]) => [key, String(value)]))
        : {})
    });
    return request<MapFeaturePage>("/api/maps/" + id + "/features/search?" + params.toString());
  },
  listMaps: () => request<MapListItem[]>("/api/maps"),
  getMap: (id: string) => request<MapRuntimeState>(`/api/maps/${id}`),
  getMaterialUsage: (id: string) => request<MapMaterialUsage>("/api/maps/" + id + "/materials"),
  previewPng: (id: string, options: Partial<ExportRenderOptions>, control: TaskControl = {}) =>
    runJob<ExportPreview>(
      request("/api/jobs/export", {
        method: "POST",
        body: JSON.stringify({ kind: "preview", mapId: id, options })
      }),
      control
    ),
  getMapSummary: (id: string) => request<MapSummary>(`/api/maps/${id}/summary`),
  getMapFeatures: (id: string) => request<MapFeatures>(`/api/maps/${id}/features`),
  getMapFeaturesInRange: (
    id: string,
    range: CellRange,
    options: { limit?: number; offset?: number } = {}
  ) => {
    const params = new URLSearchParams({
      minRow: String(range.minRow),
      maxRow: String(range.maxRow),
      minCol: String(range.minCol),
      maxCol: String(range.maxCol)
    });
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set("offset", String(options.offset));
    }
    return request<MapFeaturePage>(`/api/maps/${id}/features/range?${params.toString()}`);
  },
  getOverview: (id: string, range: CellRange) =>
    request<MapOverview>(
      "/api/maps/" +
        id +
        "/overview?" +
        new URLSearchParams(
          Object.fromEntries(Object.entries(range).map(([key, value]) => [key, String(value)]))
        ).toString()
    ),
  getMapHistory: (id: string, limit = 5) =>
    request<MapHistory>(`/api/maps/${id}/history?limit=${limit}`),
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
  saveMapMeta: (
    id: string,
    input: { expectedRevision: number; name?: string; description?: string; tags?: string[] }
  ) =>
    request<MapSummary>(`/api/maps/${id}/meta`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }),
  saveMapAs: (id: string, input: { document?: MapDocument; name: string; id?: string }) =>
    request<MapRuntimeState>(`/api/maps/${id}/save-as`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  applyCommands: (
    id: string,
    commands: MapCommand[],
    options: { dryRun?: boolean; includeMap?: boolean; expectedRevision?: number } = {}
  ) =>
    request<CommandApplyResponse>(
      `/api/maps/${id}/commands${options.dryRun ? "/dry-run" : ""}?includeMap=${options.includeMap ?? true}`,
      {
        method: "POST",
        body: JSON.stringify({
          commands,
          ...(options.expectedRevision !== undefined
            ? { expectedRevision: options.expectedRevision }
            : {})
        })
      }
    ),
  duplicateMap: (id: string) =>
    request<MapRuntimeState>(`/api/maps/${id}/duplicate`, {
      method: "POST"
    }),
  deleteMap: (id: string) =>
    request<{ deleted: true }>(`/api/maps/${id}`, {
      method: "DELETE"
    }),
  undoMap: (id: string, includeMap = true) =>
    request<HistoryMoveResult | null>(`/api/maps/${id}/undo?includeMap=${includeMap}`, {
      method: "POST"
    }),
  redoMap: (id: string, includeMap = true) =>
    request<HistoryMoveResult | null>(`/api/maps/${id}/redo?includeMap=${includeMap}`, {
      method: "POST"
    }),
  importMap: (content: string | Blob, generateNewId = false, control: TaskControl = {}) => {
    if (typeof content === "string")
      return request<{ map?: MapRuntimeState; summary: MapSummary }>(
        "/api/maps/import?includeMap=false",
        {
          method: "POST",
          body: JSON.stringify({ content, generateNewId })
        }
      );
    control.onProgress?.("正在上传文件");
    return runJob<{ map?: MapRuntimeState; summary: MapSummary }>(
      request("/api/jobs/import?generateNewId=" + generateNewId, {
        method: "POST",
        body: content,
        headers: { "Content-Type": "application/octet-stream" },
        signal: control.signal
      }),
      control
    );
  },
  exportJson: (id: string, control: TaskControl = {}) =>
    runJob<{ fileName: string; downloadUrl: string }>(
      request("/api/jobs/export", {
        method: "POST",
        body: JSON.stringify({ kind: "json", mapId: id })
      }),
      control
    ),
  exportPng: (id: string, options: Partial<ExportRenderOptions>, control: TaskControl = {}) =>
    runJob<{ fileName: string; downloadUrl: string }>(
      request("/api/jobs/export", {
        method: "POST",
        body: JSON.stringify({ kind: "png", mapId: id, options })
      }),
      control
    )
};
