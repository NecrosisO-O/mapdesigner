import {
  getHistoryLimitForDesignedCellCount,
  type ActiveCell,
  type CellRange,
  type DesignedCellRecord,
  type MapCommand,
  type MapFeatures,
  type MapRuntimeState,
  type MapSummary
} from "@mapdesigner/map-core";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { api, type MapHistory, type MapListItem } from "./api.js";

const RANGE_CHUNK_SIZE = 24;
const RANGE_OVERSCAN = 6;
const MAX_RANGE_SPAN = 160;

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function formatStatusMessage(message: string | undefined, fallback: string): string {
  if (!message) {
    return fallback;
  }
  if (message === "map id is required") {
    return "请先选择一张地图";
  }
  if (message.includes("ENOENT:") || message.includes("/storage/maps/")) {
    return "地图文件不存在或暂时无法读取";
  }
  return message;
}

function rangeKey(range: CellRange): string {
  return `${range.minRow}:${range.maxRow}:${range.minCol}:${range.maxCol}`;
}

function clampRangeSpan(min: number, max: number): { min: number; max: number } {
  if (max - min + 1 <= MAX_RANGE_SPAN) {
    return { min, max };
  }
  const center = Math.floor((min + max) / 2);
  const half = Math.floor(MAX_RANGE_SPAN / 2);
  return {
    min: center - half,
    max: center + half - 1
  };
}

function normalizeVisibleRange(range: CellRange): CellRange {
  const rowSpan = clampRangeSpan(range.minRow - RANGE_OVERSCAN, range.maxRow + RANGE_OVERSCAN);
  const colSpan = clampRangeSpan(range.minCol - RANGE_OVERSCAN, range.maxCol + RANGE_OVERSCAN);
  return {
    minRow: Math.floor(rowSpan.min / RANGE_CHUNK_SIZE) * RANGE_CHUNK_SIZE,
    maxRow: Math.ceil((rowSpan.max + 1) / RANGE_CHUNK_SIZE) * RANGE_CHUNK_SIZE - 1,
    minCol: Math.floor(colSpan.min / RANGE_CHUNK_SIZE) * RANGE_CHUNK_SIZE,
    maxCol: Math.ceil((colSpan.max + 1) / RANGE_CHUNK_SIZE) * RANGE_CHUNK_SIZE - 1
  };
}

function initialVisibleRangeFromSummary(summary: MapSummary): CellRange {
  const { bounds, grid } = summary;
  if (
    bounds.min_row === null ||
    bounds.max_row === null ||
    bounds.min_col === null ||
    bounds.max_col === null
  ) {
    return {
      minRow: grid.origin.row - 1,
      maxRow: grid.origin.row + 1,
      minCol: grid.origin.col - 1,
      maxCol: grid.origin.col + 1
    };
  }
  return {
    minRow: bounds.min_row,
    maxRow: bounds.max_row,
    minCol: bounds.min_col,
    maxCol: bounds.max_col
  };
}

function summaryFromRuntime(map: MapRuntimeState): MapSummary {
  const rows = map.document.cells.map((cell) => cell.row);
  const cols = map.document.cells.map((cell) => cell.col);
  return {
    meta: map.document.meta,
    grid: map.document.grid,
    bounds:
      map.document.cells.length === 0
        ? { min_row: null, max_row: null, min_col: null, max_col: null }
        : {
            min_row: Math.min(...rows),
            max_row: Math.max(...rows),
            min_col: Math.min(...cols),
            max_col: Math.max(...cols)
          },
    designed_cell_count: map.document.cells.length,
    feature_counts: {
      rivers: map.document.features.rivers.length
    }
  };
}

function createEmptyFeatures(): MapFeatures {
  return { rivers: [] };
}

function sortActiveCells(left: ActiveCell, right: ActiveCell): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }
  return left.col - right.col;
}

function activeCellsToDesignedRecords(cells: ActiveCell[]): DesignedCellRecord[] {
  return cells
    .filter((cell): cell is ActiveCell & { terrain: NonNullable<ActiveCell["terrain"]> } =>
      cell.status === "designed" && Boolean(cell.terrain)
    )
    .sort(sortActiveCells)
    .map((cell) => ({
      row: cell.row,
      col: cell.col,
      terrain: cell.terrain,
      biome: cell.biome,
      tags: [...cell.tags],
      note: cell.note
    }));
}

function buildPartialRuntime(
  summary: MapSummary,
  features: MapFeatures,
  activeCells: ActiveCell[]
): MapRuntimeState {
  const sortedActiveCells = [...activeCells].sort(sortActiveCells);
  return {
    document: {
      schema_version: 1,
      meta: summary.meta,
      grid: summary.grid,
      cells: activeCellsToDesignedRecords(sortedActiveCells),
      features
    },
    activeCells: sortedActiveCells,
    history: {
      past: [],
      future: [],
      limit: getHistoryLimitForDesignedCellCount(summary.designed_cell_count)
    }
  };
}

export function useMapWorkspace(setMessage: (message: string) => void) {
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [currentMap, setCurrentMap] = useState<MapRuntimeState | null>(null);
  const [currentMapId, setCurrentMapId] = useState<string>("");
  const [mapSummary, setMapSummary] = useState<MapSummary | null>(null);
  const [mapFeatures, setMapFeatures] = useState<MapFeatures>(() => createEmptyFeatures());
  const [mapHistory, setMapHistory] = useState<MapHistory | null>(null);
  const [cellCache, setCellCache] = useState<Map<string, ActiveCell>>(() => new Map());
  const [visibleCellIds, setVisibleCellIds] = useState<string[]>([]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [persistedRevision, setPersistedRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const suppressAutoOpenRef = useRef(false);
  const lastVisibleRangeRef = useRef<CellRange | null>(null);
  const lastVisibleRangeKeyRef = useRef("");
  const visibleRangeRequestSeqRef = useRef(0);

  const mapDirty =
    currentMap !== null &&
    persistedRevision !== null &&
    currentMap.document.meta.revision !== persistedRevision;

  const displayMaps = maps.map((map) =>
    currentMap && map.id === currentMap.document.meta.id
      ? {
          ...map,
          name: currentMap.document.meta.name,
          revision: currentMap.document.meta.revision,
          designedCellCount: mapSummary?.designed_cell_count ?? currentMap.document.cells.length,
          updatedAt: currentMap.document.meta.updated_at
        }
      : map
  );

  const visibleMap = useMemo(() => {
    if (!currentMap || visibleCellIds.length === 0) {
      return currentMap;
    }
    const activeCells = visibleCellIds
      .map((id) => cellCache.get(id))
      .filter((cell): cell is ActiveCell => Boolean(cell));
    if (activeCells.length === 0) {
      return currentMap;
    }
    return buildPartialRuntime(mapSummary ?? summaryFromRuntime(currentMap), mapFeatures, activeCells);
  }, [cellCache, currentMap, mapFeatures, mapSummary, visibleCellIds]);

  async function refreshMaps(selectId?: string): Promise<void> {
    const response = await api.listMaps();
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "加载地图列表失败"));
      return;
    }
    startTransition(() => {
      setMaps(response.result ?? []);
    });
    if (selectId) {
      setCurrentMapId(selectId);
    }
  }

  function loadMapIntoWorkspace(map: MapRuntimeState, summary: MapSummary | null = null): void {
    visibleRangeRequestSeqRef.current += 1;
    suppressAutoOpenRef.current = false;
    setCurrentMap(map);
    setCurrentMapId(map.document.meta.id);
    setMapSummary(summary ?? summaryFromRuntime(map));
    setMapFeatures(map.document.features ?? createEmptyFeatures());
    setCellCache(new Map());
    setVisibleCellIds([]);
    lastVisibleRangeRef.current = null;
    lastVisibleRangeKeyRef.current = "";
    setPersistedRevision(map.document.meta.revision);
    setIsRenaming(false);
    setRenameDraft(map.document.meta.name);
  }

  function loadPartialMapIntoWorkspace(
    summary: MapSummary,
    features: MapFeatures,
    activeCells: ActiveCell[] = [],
    loadedRange: CellRange | null = null
  ): MapRuntimeState {
    visibleRangeRequestSeqRef.current += 1;
    const runtime = buildPartialRuntime(summary, features, activeCells);
    suppressAutoOpenRef.current = false;
    setCurrentMap(runtime);
    setCurrentMapId(summary.meta.id);
    setMapSummary(summary);
    setMapFeatures(features);
    setCellCache(new Map(activeCells.map((cell) => [cell.id, cell])));
    setVisibleCellIds(activeCells.map((cell) => cell.id));
    lastVisibleRangeRef.current = loadedRange;
    lastVisibleRangeKeyRef.current = loadedRange ? `${summary.meta.id}:${rangeKey(loadedRange)}` : "";
    setPersistedRevision(summary.meta.revision);
    setIsRenaming(false);
    setRenameDraft(summary.meta.name);
    return runtime;
  }

  async function refreshMapSummary(id = currentMap?.document.meta.id): Promise<MapSummary | null> {
    if (!id) {
      setMapSummary(null);
      return null;
    }
    const response = await api.getMapSummary(id);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "刷新地图摘要失败"));
      return null;
    }
    setMapSummary(response.result);
    return response.result;
  }

  async function refreshMapFeatures(id = currentMap?.document.meta.id): Promise<MapFeatures | null> {
    if (!id) {
      setMapFeatures(createEmptyFeatures());
      return null;
    }
    const response = await api.getMapFeatures(id);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "刷新地图要素失败"));
      return null;
    }
    setMapFeatures(response.result);
    return response.result;
  }

  async function refreshMapHistory(id = currentMap?.document.meta.id): Promise<MapHistory | null> {
    if (!id) {
      setMapHistory(null);
      return null;
    }
    const response = await api.getMapHistory(id);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "刷新历史失败"));
      return null;
    }
    setMapHistory(response.result);
    return response.result;
  }

  async function openMap(id: string): Promise<MapRuntimeState | null> {
    setLoading(true);
    const [summaryResponse, featuresResponse] = await Promise.all([
      api.getMapSummary(id),
      api.getMapFeatures(id)
    ]);
    setLoading(false);
    if (!summaryResponse.ok || !summaryResponse.result) {
      setMessage(formatStatusMessage(summaryResponse.errors[0]?.message, "打开地图失败"));
      return null;
    }
    if (!featuresResponse.ok || !featuresResponse.result) {
      setMessage(formatStatusMessage(featuresResponse.errors[0]?.message, "打开地图要素失败"));
      return null;
    }
    const initialRange = normalizeVisibleRange(initialVisibleRangeFromSummary(summaryResponse.result));
    const cellsResponse = await api.getCellsInRange(summaryResponse.result.meta.id, initialRange, true);
    if (!cellsResponse.ok || !cellsResponse.result) {
      setMessage(formatStatusMessage(cellsResponse.errors[0]?.message, "加载可视单元格失败"));
      return null;
    }
    const runtime = loadPartialMapIntoWorkspace(
      summaryResponse.result,
      featuresResponse.result,
      cellsResponse.result.cells,
      initialRange
    );
    await refreshMapHistory(summaryResponse.result.meta.id);
    setMessage(`已打开 ${summaryResponse.result.meta.name}`);
    return runtime;
  }

  function ensureCanLeaveMap(): boolean {
    if (!mapDirty) {
      return true;
    }
    return window.confirm("当前地图有未保存改动，是否放弃并切换？");
  }

  async function createMap(): Promise<MapRuntimeState | null> {
    const name = window.prompt("输入新地图名称");
    if (!name) {
      return null;
    }
    const response = await api.createMap({ name });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "新建地图失败"));
      return null;
    }
    await refreshMaps(response.result.document.meta.id);
    loadMapIntoWorkspace(response.result);
    await refreshMapHistory(response.result.document.meta.id);
    setMessage(`已新建 ${response.result.document.meta.name}`);
    return response.result;
  }

  async function saveMap(): Promise<MapRuntimeState | null> {
    if (!currentMap || persistedRevision === null) {
      return null;
    }
    const response = await api.saveMapMeta(currentMap.document.meta.id, {
      expectedRevision: persistedRevision,
      name: currentMap.document.meta.name,
      description: currentMap.document.meta.description,
      tags: currentMap.document.meta.tags
    });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "保存失败"));
      return null;
    }
    const nextRuntime = buildPartialRuntime(response.result, mapFeatures, currentMap.activeCells);
    setCurrentMap(nextRuntime);
    setMapSummary(response.result);
    setPersistedRevision(response.result.meta.revision);
    setIsRenaming(false);
    setRenameDraft(response.result.meta.name);
    await refreshMaps(response.result.meta.id);
    await refreshMapHistory(response.result.meta.id);
    setMessage("保存成功");
    return nextRuntime;
  }

  function startRenaming(): void {
    if (!currentMap) {
      return;
    }
    setIsRenaming(true);
    setRenameDraft(currentMap.document.meta.name);
  }

  function cancelRenaming(): void {
    setIsRenaming(false);
    setRenameDraft(currentMap?.document.meta.name ?? "");
  }

  function renameCurrentMap(name: string): void {
    if (!currentMap) {
      return;
    }
    const nextName = name.trim();
    if (!nextName || nextName === currentMap.document.meta.name) {
      return;
    }

    const nextDocument = structuredClone(currentMap.document);
    nextDocument.meta.name = nextName;
    nextDocument.meta.updated_at = new Date().toISOString();
    nextDocument.meta.revision += 1;
    setCurrentMap({ ...currentMap, document: nextDocument });
    setIsRenaming(false);
    setRenameDraft(nextName);
    setMessage("地图名称已更新，等待保存");
  }

  async function saveMapAs(): Promise<MapRuntimeState | null> {
    if (!currentMap) {
      return null;
    }
    const name = window.prompt("输入副本地图名称", `${currentMap.document.meta.name} Copy`);
    if (!name?.trim()) {
      return null;
    }
    const response = await api.saveMapAs(currentMap.document.meta.id, {
      name: name.trim()
    });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "另存为失败"));
      return null;
    }
    await refreshMaps(response.result.document.meta.id);
    loadMapIntoWorkspace(response.result);
    await refreshMapHistory(response.result.document.meta.id);
    setMessage(`已另存为 ${response.result.document.meta.name}`);
    return response.result;
  }

  async function importFile(file: File): Promise<MapRuntimeState | null> {
    const content = await file.text();
    const response = await api.importMap(content);
    if (!response.ok || !response.result) {
      const retry = window.confirm(`${response.errors[0]?.message ?? "导入失败"}。是否生成新 ID 后重试？`);
      if (!retry) {
        setMessage(formatStatusMessage(response.errors[0]?.message, "导入失败"));
        return null;
      }
      const retryResponse = await api.importMap(content, true);
      if (!retryResponse.ok || !retryResponse.result) {
        setMessage(formatStatusMessage(retryResponse.errors[0]?.message, "导入失败"));
        return null;
      }
      await refreshMaps(retryResponse.result.document.meta.id);
      loadMapIntoWorkspace(retryResponse.result);
      await refreshMapHistory(retryResponse.result.document.meta.id);
      setMessage("导入成功");
      return retryResponse.result;
    }
    await refreshMaps(response.result.document.meta.id);
    loadMapIntoWorkspace(response.result);
    await refreshMapHistory(response.result.document.meta.id);
    setMessage("导入成功");
    return response.result;
  }

  async function duplicateMap(): Promise<MapRuntimeState | null> {
    if (!currentMap) {
      return null;
    }
    const response = await api.duplicateMap(currentMap.document.meta.id);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "复制失败"));
      return null;
    }
    await refreshMaps(response.result.document.meta.id);
    loadMapIntoWorkspace(response.result);
    await refreshMapHistory(response.result.document.meta.id);
    setMessage("复制成功");
    return response.result;
  }

  async function deleteCurrentMap(): Promise<boolean> {
    if (!currentMap) {
      return false;
    }
    if (!window.confirm(`确认删除 ${currentMap.document.meta.name} 吗？`)) {
      return false;
    }
    const response = await api.deleteMap(currentMap.document.meta.id);
    if (!response.ok) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "删除失败"));
      return false;
    }
    setCurrentMap(null);
    setCurrentMapId("");
    setMapSummary(null);
    setMapFeatures(createEmptyFeatures());
    setCellCache(new Map());
    setVisibleCellIds([]);
    visibleRangeRequestSeqRef.current += 1;
    lastVisibleRangeRef.current = null;
    lastVisibleRangeKeyRef.current = "";
    setPersistedRevision(null);
    setIsRenaming(false);
    setRenameDraft("");
    suppressAutoOpenRef.current = true;
    await refreshMaps();
    setMapHistory(null);
    setMessage("地图已删除");
    return true;
  }

  async function applyCommands(commands: MapCommand[]): Promise<MapRuntimeState | null> {
    if (!currentMap) {
      setMessage("请先选择一张地图");
      return null;
    }
    const response = await api.applyCommands(currentMap.document.meta.id, commands, { includeMap: false });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "应用修改失败"));
      return null;
    }
    const nextSummary = response.result.summary ?? await refreshMapSummary(currentMap.document.meta.id);
    const nextFeatures = response.result.features ?? await refreshMapFeatures(currentMap.document.meta.id);
    if (!nextSummary || !nextFeatures) {
      return null;
    }
    setMapSummary(nextSummary);
    setMapFeatures(nextFeatures);
    setPersistedRevision(nextSummary.meta.revision);
    await refreshMaps(nextSummary.meta.id);
    let nextRuntime: MapRuntimeState | null = null;
    if (lastVisibleRangeRef.current) {
      nextRuntime = await loadVisibleRange(lastVisibleRangeRef.current, nextSummary.meta.id, nextSummary, nextFeatures, true);
    } else {
      nextRuntime = buildPartialRuntime(nextSummary, nextFeatures, currentMap.activeCells);
      setCurrentMap(nextRuntime);
    }
    await refreshMapHistory(nextSummary.meta.id);
    return nextRuntime;
  }

  async function undoCurrentMap(): Promise<MapRuntimeState | null> {
    if (!currentMap) {
      return null;
    }
    const response = await api.undoMap(currentMap.document.meta.id, false);
    if (!response.ok) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "撤销失败"));
      return null;
    }
    if (!response.result) {
      setMessage("没有可撤销的操作");
      return null;
    }
    const nextSummary = response.result.summary ?? await refreshMapSummary(currentMap.document.meta.id);
    const nextFeatures = response.result.features ?? await refreshMapFeatures(currentMap.document.meta.id);
    if (!nextSummary || !nextFeatures) {
      return null;
    }
    setMapSummary(nextSummary);
    setMapFeatures(nextFeatures);
    setPersistedRevision(nextSummary.meta.revision);
    await refreshMaps(nextSummary.meta.id);
    let nextRuntime: MapRuntimeState | null = null;
    if (lastVisibleRangeRef.current) {
      nextRuntime = await loadVisibleRange(lastVisibleRangeRef.current, nextSummary.meta.id, nextSummary, nextFeatures, true);
    } else {
      nextRuntime = buildPartialRuntime(nextSummary, nextFeatures, currentMap.activeCells);
      setCurrentMap(nextRuntime);
    }
    await refreshMapHistory(nextSummary.meta.id);
    setMessage(response.result.warnings[0]?.message ?? "已撤销");
    return nextRuntime;
  }

  async function redoCurrentMap(): Promise<MapRuntimeState | null> {
    if (!currentMap) {
      return null;
    }
    const response = await api.redoMap(currentMap.document.meta.id, false);
    if (!response.ok) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "重做失败"));
      return null;
    }
    if (!response.result) {
      setMessage("没有可重做的操作");
      return null;
    }
    const nextSummary = response.result.summary ?? await refreshMapSummary(currentMap.document.meta.id);
    const nextFeatures = response.result.features ?? await refreshMapFeatures(currentMap.document.meta.id);
    if (!nextSummary || !nextFeatures) {
      return null;
    }
    setMapSummary(nextSummary);
    setMapFeatures(nextFeatures);
    setPersistedRevision(nextSummary.meta.revision);
    await refreshMaps(nextSummary.meta.id);
    let nextRuntime: MapRuntimeState | null = null;
    if (lastVisibleRangeRef.current) {
      nextRuntime = await loadVisibleRange(lastVisibleRangeRef.current, nextSummary.meta.id, nextSummary, nextFeatures, true);
    } else {
      nextRuntime = buildPartialRuntime(nextSummary, nextFeatures, currentMap.activeCells);
      setCurrentMap(nextRuntime);
    }
    await refreshMapHistory(nextSummary.meta.id);
    setMessage(response.result.warnings[0]?.message ?? "已重做");
    return nextRuntime;
  }

  async function loadVisibleRange(
    range: CellRange,
    mapId = currentMap?.document.meta.id,
    summaryOverride: MapSummary | null = null,
    featuresOverride: MapFeatures | null = null,
    force = false
  ): Promise<MapRuntimeState | null> {
    if (!mapId) {
      return null;
    }
    const normalizedRange = normalizeVisibleRange(range);
    const key = `${mapId}:${rangeKey(normalizedRange)}`;
    lastVisibleRangeRef.current = normalizedRange;
    if (!force && key === lastVisibleRangeKeyRef.current) {
      return currentMap;
    }
    lastVisibleRangeKeyRef.current = key;
    const requestSeq = visibleRangeRequestSeqRef.current + 1;
    visibleRangeRequestSeqRef.current = requestSeq;
    const response = await api.getCellsInRange(mapId, normalizedRange, true);
    if (requestSeq !== visibleRangeRequestSeqRef.current) {
      return null;
    }
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "加载可视单元格失败"));
      return null;
    }
    const nextSummary = summaryOverride ?? mapSummary ?? await refreshMapSummary(mapId);
    const nextFeatures = featuresOverride ?? mapFeatures;
    if (!nextSummary) {
      return null;
    }
    setCellCache((current) => {
      const next = new Map(current);
      for (const cell of response.result!.cells) {
        next.set(cell.id, cell);
      }
      return next;
    });
    setVisibleCellIds(response.result.cells.map((cell) => cell.id));
    const runtime = buildPartialRuntime(nextSummary, nextFeatures, response.result.cells);
    setCurrentMap(runtime);
    return runtime;
  }

  async function requestVisibleRange(range: CellRange, mapId = currentMap?.document.meta.id): Promise<void> {
    await loadVisibleRange(range, mapId);
  }

  useEffect(() => {
    void refreshMaps();
  }, []);

  useEffect(() => {
    if (maps.length === 0 || currentMapId) {
      return;
    }
    if (suppressAutoOpenRef.current) {
      return;
    }
    void openMap(maps[0]!.id);
  }, [currentMapId, maps]);

  useEffect(() => {
    if (!isRenaming) {
      setRenameDraft(currentMap?.document.meta.name ?? "");
    }
  }, [currentMap?.document.meta.name, isRenaming]);

  return {
    maps,
    currentMap,
    visibleMap,
    currentMapId,
    mapSummary,
    mapHistory,
    displayMaps,
    isRenaming,
    renameDraft,
    loading,
    mapDirty,
    fileInputRef,
    setCurrentMap,
    setRenameDraft,
    refreshMaps,
    refreshMapSummary,
    refreshMapFeatures,
    refreshMapHistory,
    requestVisibleRange,
    openMap,
    ensureCanLeaveMap,
    createMap,
    saveMap,
    startRenaming,
    cancelRenaming,
    renameCurrentMap,
    saveMapAs,
    importFile,
    duplicateMap,
    deleteCurrentMap,
    applyCommands,
    undoCurrentMap,
    redoCurrentMap
  };
}
