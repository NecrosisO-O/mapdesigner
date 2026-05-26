import {
  BIOME_ENTRIES,
  BIOME_KEYS,
  TAG_ENTRIES,
  TAG_ENTRIES,
  TERRAIN_ENTRIES,
  TERRAIN_CATEGORY_LABELS,
  TERRAIN_CATEGORY_ORDER,
  applyCommand,
  createCellId,
  getAllowedBiomesForTerrain,
  getAllowedTerrainCategoriesForBiome,
  getAllowedTerrainsForBiome,
  getFilteredTerrainEntries,
  getTerrainCategoryKey,
  type ActiveCell,
  type ExportRenderOptions,
  type MapRuntimeState,
  redo
} from "@mapdesigner/map-core";
import { startTransition, useEffect, useRef, useState } from "react";
import { api, type MapListItem, type CellRange } from "./api.js";
import { MapCanvas } from "./MapCanvas.js";

interface CellDraft {
  terrain: string;
  biome: string;
  tags: string[];
  note: string;
}

interface FormatBrushScope {
  terrain: boolean;
  biome: boolean;
}

const DEFAULT_PNG_OPTIONS: ExportRenderOptions = {
  preset: "clean",
  includeCoordinates: false,
  includeShorthand: false,
  includeGrid: true,
  includeUndesigned: false,
  background: "#F4F0E6",
  transparent: false,
  padding: 32,
  scale: 2
};

const HISTORY_LABELS: Record<string, string> = {
  set_cell: "设置单元格",
  set_cells: "批量设置单元格",
  clear_cell: "清空单元格",
  replace_terrain: "批量替换地形",
  replace_biome: "批量替换生态",
  annotate_cell: "更新标记/备注"
};

function toDraft(cell: ActiveCell | null): CellDraft {
  return {
    terrain: cell?.terrain ?? "",
    biome: cell?.biome ?? "",
    tags: cell?.tags ?? [],
    note: cell?.note ?? ""
  };
}

function resolveTerrainCategory(terrain: string | null | undefined): string {
  if (!terrain || !(terrain in TERRAIN_ENTRIES)) {
    return "";
  }
  return getTerrainCategoryKey(terrain as keyof typeof TERRAIN_ENTRIES);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatCellValue<T extends string>(
  key: T | null,
  entries: Record<T, { label: string; short: string }>
): string {
  if (!key) {
    return "未设置";
  }
  const entry = entries[key];
  return `${entry.label} (${entry.short})`;
}

function formatStatusMessage(message: string | undefined, fallback: string): string {
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

function triggerDownload(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function App() {
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [currentMap, setCurrentMap] = useState<MapRuntimeState | null>(null);
  const [currentMapId, setCurrentMapId] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [persistedRevision, setPersistedRevision] = useState<number | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CellDraft>(toDraft(null));
  const [terrainCategory, setTerrainCategory] = useState<string>("");
  const [message, setMessage] = useState<string>("准备就绪");
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showShorthand, setShowShorthand] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showUndesigned, setShowUndesigned] = useState(true);
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const [formatBrushEnabled, setFormatBrushEnabled] = useState(false);
  const [formatBrushScope, setFormatBrushScope] = useState<FormatBrushScope>({
    terrain: true,
    biome: true
  });
  const [hoveredCell, setHoveredCell] = useState<ActiveCell | null>(null);
  const [pngOptions, setPngOptions] = useState<ExportRenderOptions>(DEFAULT_PNG_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);

  // Merge state
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeRowOffset, setMergeRowOffset] = useState(0);
  const [mergeColOffset, setMergeColOffset] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Apply dark mode class
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  const selectedCell =
    currentMap?.activeCells.find((cell) => cell.id === selectedCellId) ?? null;
  const cellDirty =
    selectedCell !== null &&
    (draft.terrain !== (selectedCell.terrain ?? "") ||
      draft.biome !== (selectedCell.biome ?? "") ||
      draft.note !== selectedCell.note ||
      draft.tags.join("|") !== selectedCell.tags.join("|"));
  const mapDirty =
    currentMap !== null &&
    persistedRevision !== null &&
    currentMap.document.meta.revision !== persistedRevision;
  const filteredTerrainCategories = draft.biome
    ? getAllowedTerrainCategoriesForBiome(draft.biome)
    : TERRAIN_CATEGORY_ORDER;
  const terrainOptions = terrainCategory ? getFilteredTerrainEntries(terrainCategory, draft.biome || undefined) : [];
  const biomeOptions = draft.terrain ? getAllowedBiomesForTerrain(draft.terrain) : BIOME_KEYS;
  const canUseFormatBrush = selectedCell?.status === "designed";
  const displayMaps = maps.map((map) =>
    currentMap && map.id === currentMap.document.meta.id
      ? {
          ...map,
          name: currentMap.document.meta.name,
          revision: currentMap.document.meta.revision,
          designedCellCount: currentMap.document.cells.length,
          updatedAt: currentMap.document.meta.updated_at
        }
      : map
  );

  function syncDraftFromCell(cell: ActiveCell | null): void {
    setDraft(toDraft(cell));
    setTerrainCategory(resolveTerrainCategory(cell?.terrain));
  }

  function setFormatBrushScopeField(field: keyof FormatBrushScope, value: boolean): void {
    setFormatBrushScope((current) => {
      if (!value && !current[field === "terrain" ? "biome" : "terrain"]) {
        return current;
      }
      return {
        ...current,
        [field]: value
      };
    });
  }

  function getFormatBrushLabel(): string {
    if (formatBrushScope.terrain && formatBrushScope.biome) {
      return "地形 + 生态";
    }
    if (formatBrushScope.terrain) {
      return "地形";
    }
    return "生态";
  }

  function handleTerrainCategoryChange(nextCategory: string): void {
    setTerrainCategory(nextCategory);
    setDraft((current) => {
      if (!current.terrain) {
        return current;
      }
      const allowedTerrains = new Set(getFilteredTerrainEntries(nextCategory, current.biome || undefined).map((entry) => entry.key));
      return {
        ...current,
        terrain: allowedTerrains.has(current.terrain as keyof typeof TERRAIN_ENTRIES) ? current.terrain : ""
      };
    });
  }

  function handleTerrainChange(nextTerrain: string): void {
    setTerrainCategory(nextTerrain ? resolveTerrainCategory(nextTerrain) : terrainCategory);
    setDraft((current) => {
      if (!nextTerrain) {
        return {
          ...current,
          terrain: ""
        };
      }
      const allowedBiomes = new Set(getAllowedBiomesForTerrain(nextTerrain));
      return {
        ...current,
        terrain: nextTerrain,
        biome: current.biome && !allowedBiomes.has(current.biome as keyof typeof BIOME_ENTRIES) ? "" : current.biome
      };
    });
  }

  function handleBiomeChange(nextBiome: string): void {
    const filteredCategories = nextBiome ? getAllowedTerrainCategoriesForBiome(nextBiome) : TERRAIN_CATEGORY_ORDER;
    setTerrainCategory((current) => {
      if (!current || filteredCategories.includes(current as (typeof filteredCategories)[number])) {
        return current;
      }
      return "";
    });
    setDraft((current) => {
      const allowedTerrains = nextBiome ? new Set(getAllowedTerrainsForBiome(nextBiome)) : null;
      return {
        ...current,
        biome: nextBiome,
        terrain:
          nextBiome && current.terrain && allowedTerrains && !allowedTerrains.has(current.terrain as keyof typeof TERRAIN_ENTRIES)
            ? ""
            : current.terrain
      };
    });
  }

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

  async function openMap(id: string): Promise<void> {
    setLoading(true);
    const response = await api.getMap(id);
    setLoading(false);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "打开地图失败"));
      return;
    }
    setCurrentMap(response.result);
    setCurrentMapId(response.result.document.meta.id);
    setPersistedRevision(response.result.document.meta.revision);
    setSelectedCellId(null);
    syncDraftFromCell(null);
    setFormatBrushEnabled(false);
    setHoveredCell(null);
    setIsRenaming(false);
    setRenameDraft(response.result.document.meta.name);
    setMessage(`已打开 ${response.result.document.meta.name}`);
  }

  useEffect(() => {
    void (async () => {
      await refreshMaps();
    })();
  }, []);

  useEffect(() => {
    if (maps.length === 0 || currentMapId) {
      return;
    }
    void openMap(maps[0]!.id);
  }, [currentMapId, maps]);

  useEffect(() => {
    if (!isRenaming) {
      setRenameDraft(currentMap?.document.meta.name ?? "");
    }
  }, [currentMap?.document.meta.name, isRenaming]);

  useEffect(() => {
    if (formatBrushEnabled && !canUseFormatBrush) {
      setFormatBrushEnabled(false);
    }
  }, [canUseFormatBrush, formatBrushEnabled]);

  function ensureCanLeaveSelection(): boolean {
    if (!cellDirty) {
      return true;
    }
    return window.confirm("当前单元格有未保存编辑，是否放弃这些修改？");
  }

  function ensureCanLeaveMap(): boolean {
    if (!mapDirty) {
      return true;
    }
    return window.confirm("当前地图有未保存改动，是否放弃并切换？");
  }

  async function handleCreateMap(): Promise<void> {
    const name = window.prompt("输入新地图名称");
    if (!name) {
      return;
    }
    const isSquare = window.confirm("使用方格网格吗？\n\n确定 = 方格 | 取消 = 六边形");
    const layout = isSquare ? "square" : undefined;
    const response = await api.createMap({ name, layout });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "新建地图失败"));
      return;
    }
    await refreshMaps(response.result.document.meta.id);
    setCurrentMap(response.result);
    setCurrentMapId(response.result.document.meta.id);
    setPersistedRevision(response.result.document.meta.revision);
    setSelectedCellId(null);
    syncDraftFromCell(null);
    setFormatBrushEnabled(false);
    setMessage(`已新建${isSquare ? "方格" : "六边形"}地图：${response.result.document.meta.name}`);
  }

  async function handleSaveMap(): Promise<void> {
    if (!currentMap || persistedRevision === null) {
      return;
    }
    const response = await api.saveMap(currentMap.document.meta.id, {
      document: currentMap.document,
      expectedRevision: persistedRevision
    });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "保存失败"));
      return;
    }
    setCurrentMap(response.result);
    setPersistedRevision(response.result.document.meta.revision);
    setHoveredCell(null);
    setIsRenaming(false);
    setRenameDraft(response.result.document.meta.name);
    await refreshMaps(response.result.document.meta.id);
    setMessage("保存成功");
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

  async function handleSaveAs(): Promise<void> {
    if (!currentMap) {
      return;
    }
    if (
      cellDirty &&
      !window.confirm("当前单元格表单还有未应用修改，另存为不会包含这些修改。是否继续？")
    ) {
      return;
    }
    const name = window.prompt("输入副本地图名称", `${currentMap.document.meta.name} Copy`);
    if (!name?.trim()) {
      return;
    }
    const response = await api.saveMapAs(currentMap.document.meta.id, {
      document: currentMap.document,
      name: name.trim()
    });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "另存为失败"));
      return;
    }
    await refreshMaps(response.result.document.meta.id);
    setCurrentMap(response.result);
    setCurrentMapId(response.result.document.meta.id);
    setPersistedRevision(response.result.document.meta.revision);
    setSelectedCellId(null);
    syncDraftFromCell(null);
    setFormatBrushEnabled(false);
    setHoveredCell(null);
    setIsRenaming(false);
    setRenameDraft(response.result.document.meta.name);
    setMessage(`已另存为 ${response.result.document.meta.name}`);
  }

  async function handleExportPng(): Promise<void> {
    if (!currentMap) {
      return;
    }
    const response = await api.exportPng(currentMap.document.meta.id, pngOptions);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "导出失败"));
      return;
    }
    triggerDownload(
      response.result.downloadUrl ?? `/api/exports/${encodeURIComponent(response.result.fileName)}`,
      response.result.fileName
    );
    setMessage(`PNG 已导出并开始下载：${response.result.fileName}`);
  }

  async function handleApplyDraft(): Promise<void> {
    if (!currentMap || !selectedCell) {
      return;
    }
    if (!draft.terrain) {
      setMessage("设置为 designed 时必须选择 terrain");
      return;
    }

    // Apply locally for instant feedback
    const localResult = applyCommand(currentMap, {
      action: "set_cell",
      source: "webui",
      target: { row: selectedCell.row, col: selectedCell.col },
      changes: {
        terrain: draft.terrain as keyof typeof TERRAIN_ENTRIES,
        biome: draft.biome ? (draft.biome as keyof typeof BIOME_ENTRIES) : null,
        tags: draft.tags as Array<keyof typeof TAG_ENTRIES>,
        note: draft.note
      }
    });
    if (!localResult.ok) {
      setMessage(localResult.errors[0]?.message ?? "应用修改失败");
      return;
    }
    setCurrentMap(localResult.map);
    setSelectedCellId(createCellId(selectedCell.row, selectedCell.col));
    syncDraftFromCell(
      localResult.map.activeCells.find((cell) => cell.row === selectedCell.row && cell.col === selectedCell.col) ?? null
    );

    // Persist via server command
    const response = await api.executeCommand(currentMap.document.meta.id, {
      action: "set_cell",
      source: "webui",
      target: { row: selectedCell.row, col: selectedCell.col },
      changes: {
        terrain: draft.terrain,
        biome: draft.biome || null,
        tags: draft.tags,
        note: draft.note
      }
    });
    if (response.ok && response.result) {
      setPersistedRevision(response.result.state.document.meta.revision);
    }
    setMessage(
      (localResult.warnings[0]?.message ?? "单元格修改已应用") +
      (response.ok ? "" : "，但保存到服务器失败")
    );
  }

  async function handleClearSelected(): Promise<void> {
    if (!currentMap || !selectedCell) {
      return;
    }

    // Apply locally for instant feedback
    const localResult = applyCommand(currentMap, {
      action: "clear_cell",
      source: "webui",
      target: { row: selectedCell.row, col: selectedCell.col }
    });
    if (!localResult.ok) {
      setMessage(localResult.errors[0]?.message ?? "清空失败");
      return;
    }
    setCurrentMap(localResult.map);
    const updatedCell =
      localResult.map.activeCells.find((cell) => cell.row === selectedCell.row && cell.col === selectedCell.col) ?? null;
    setSelectedCellId(updatedCell?.id ?? null);
    syncDraftFromCell(updatedCell);
    if (updatedCell?.status !== "designed") {
      setFormatBrushEnabled(false);
    }

    // Persist via server command
    const response = await api.executeCommand(currentMap.document.meta.id, {
      action: "clear_cell",
      source: "webui",
      target: { row: selectedCell.row, col: selectedCell.col }
    });
    if (response.ok && response.result) {
      setPersistedRevision(response.result.state.document.meta.revision);
    }
    setMessage(
      "单元格已清空" + (response.ok ? "" : "，但保存到服务器失败")
    );
  }

  function toggleFormatBrush(): void {
    if (formatBrushEnabled) {
      setFormatBrushEnabled(false);
      setMessage("已退出格式刷模式");
      return;
    }
    if (!canUseFormatBrush || !selectedCell) {
      setMessage("请选择一个已设计单元格作为格式刷源格");
      return;
    }
    setFormatBrushEnabled(true);
    setMessage(`已进入格式刷模式，当前刷{selectedCell.display_coord}，当前刷：${getFormatBrushLabel()}`);
  }

  async function handleApplyFormatBrush(targetCell: ActiveCell): Promise<void> {
    if (!currentMap || !selectedCell || selectedCell.status !== "designed") {
      setFormatBrushEnabled(false);
      return;
    }
    if (targetCell.id === selectedCell.id) {
      return;
    }
    if (!formatBrushScope.terrain && !formatBrushScope.biome) {
      setMessage("请至少选择地形或生态");
      return;
    }
    if (!formatBrushScope.terrain && !targetCell.terrain) {
      setMessage("只刷生态时，目标格必须已有地形");
      return;
    }

    const nextTerrain = formatBrushScope.terrain ? selectedCell.terrain : targetCell.terrain;
    const nextBiome = formatBrushScope.biome ? selectedCell.biome : targetCell.biome;
    if (!nextTerrain) {
      setMessage("格式刷结果缺少 terrain，无法应用");
      return;
    }

    // Apply locally
    const localResult = applyCommand(currentMap, {
      action: "set_cell",
      source: "webui",
      target: { row: targetCell.row, col: targetCell.col },
      changes: {
        terrain: nextTerrain as keyof typeof TERRAIN_ENTRIES,
        biome: nextBiome ? (nextBiome as keyof typeof BIOME_ENTRIES) : null,
        tags: targetCell.tags as Array<keyof typeof TAG_ENTRIES>,
        note: targetCell.note
      }
    });

    if (!localResult.ok) {
      setMessage(localResult.errors[0]?.message ?? "格式刷应用失败");
      return;
    }

    setCurrentMap(localResult.map);
    setSelectedCellId(createCellId(selectedCell.row, selectedCell.col));
    syncDraftFromCell(
      localResult.map.activeCells.find((cell) => cell.row === selectedCell.row && cell.col === selectedCell.col) ?? null
    );

    // Persist via server
    const response = await api.executeCommand(currentMap.document.meta.id, {
      action: "set_cell",
      source: "webui",
      target: { row: targetCell.row, col: targetCell.col },
      changes: {
        terrain: nextTerrain,
        biome: nextBiome || null,
        tags: targetCell.tags,
        note: targetCell.note
      }
    });
    if (response.ok && response.result) {
      setPersistedRevision(response.result.state.document.meta.revision);
    }
    setMessage(
      (localResult.warnings[0]?.message ??
        `已将 ${selectedCell.display_coord} 的 {getFormatBrushLabel()}刷到 ${targetCell.display_coord}`) +
      (response.ok ? "" : "，但保存到服务器失败")
    );
  }

  async function handleImportFile(file: File): Promise<void> {
    const content = await file.text();
    const response = await api.importMap(content);
    if (!response.ok || !response.result) {
      const retry = window.confirm(`${response.errors[0]?.message ?? "导入失败"}。是否生成新 ID 后重试？`);
      if (!retry) {
        setMessage(formatStatusMessage(response.errors[0]?.message, "导入失败"));
        return;
      }
      const retryResponse = await api.importMap(content, true);
      if (!retryResponse.ok || !retryResponse.result) {
        setMessage(formatStatusMessage(retryResponse.errors[0]?.message, "导入失败"));
        return;
      }
      await refreshMaps(retryResponse.result.document.meta.id);
      setCurrentMap(retryResponse.result);
      setCurrentMapId(retryResponse.result.document.meta.id);
      setPersistedRevision(retryResponse.result.document.meta.revision);
      syncDraftFromCell(null);
      setFormatBrushEnabled(false);
      setHoveredCell(null);
      setIsRenaming(false);
      setRenameDraft(retryResponse.result.document.meta.name);
      setMessage("导入成功");
      return;
    }
    await refreshMaps(response.result.document.meta.id);
    setCurrentMap(response.result);
    setCurrentMapId(response.result.document.meta.id);
    setPersistedRevision(response.result.document.meta.revision);
    syncDraftFromCell(null);
    setFormatBrushEnabled(false);
    setHoveredCell(null);
    setIsRenaming(false);
    setRenameDraft(response.result.document.meta.name);
    setMessage("导入成功");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>MapDesigner</strong>
          <span>{mapDirty ? "未保存修改" : "已保存"}</span>
        </div>
        <div className="toolbar">
          <button onClick={() => void handleCreateMap()}>新建地图</button>
          <select
            value={currentMapId}
            onChange={(event) => {
              const nextId = event.target.value.trim();
              if (!nextId) {
                return;
              }
              if (!ensureCanLeaveMap() || !ensureCanLeaveSelection()) {
                return;
              }
              void openMap(nextId);
            }}
          >
            <option value="">选择地图</option>
            {displayMaps.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </select>
          <button onClick={() => void handleSaveMap()} disabled={!mapDirty}>
            保存
          </button>
          <button onClick={() => void handleSaveAs()} disabled={!currentMap}>
            另存为          </button>
          {isRenaming ? (
            <div className="rename-editor">
              <input
                aria-label="地图名称"
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    renameCurrentMap(renameDraft);
                  }
                  if (event.key === "Escape") {
                    setIsRenaming(false);
                    setRenameDraft(currentMap?.document.meta.name ?? "");
                  }
                }}
                placeholder="输入地图名称"
              />
              <button
                onClick={() => renameCurrentMap(renameDraft)}
                disabled={!currentMap || !renameDraft.trim()}
                type="button"
              >
                确认重命名              </button>
              <button
                onClick={() => {
                  setIsRenaming(false);
                  setRenameDraft(currentMap?.document.meta.name ?? "");
                }}
                type="button"
              >
                取消重命名              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                if (!currentMap) {
                  return;
                }
                setIsRenaming(true);
                setRenameDraft(currentMap.document.meta.name);
              }}
              disabled={!currentMap}
            >
              重命名            </button>
          )}
          <button onClick={() => fileInputRef.current?.click()}>导入 JSON</button>
          <button
            onClick={async () => {
              if (!currentMap) {
                return;
              }
              const response = await api.duplicateMap(currentMap.document.meta.id);
              if (!response.ok || !response.result) {
                setMessage(formatStatusMessage(response.errors[0]?.message, "复制失败"));
                return;
              }
              await refreshMaps(response.result.document.meta.id);
              setCurrentMap(response.result);
              setCurrentMapId(response.result.document.meta.id);
              setPersistedRevision(response.result.document.meta.revision);
              setFormatBrushEnabled(false);
              setMessage("复制成功");
            }}
            disabled={!currentMap}
          >
            复制地图
          </button>
          <button
            onClick={async () => {
              if (!currentMap) {
                return;
              }
              if (!window.confirm(`确认删除 ${currentMap.document.meta.name} 吗？`)) {
                return;
              }
              const response = await api.deleteMap(currentMap.document.meta.id);
              if (!response.ok) {
                setMessage(formatStatusMessage(response.errors[0]?.message, "删除失败"));
                return;
              }
              setCurrentMap(null);
              setCurrentMapId("");
              setPersistedRevision(null);
              setSelectedCellId(null);
              setFormatBrushEnabled(false);
              setHoveredCell(null);
              syncDraftFromCell(null);
              await refreshMaps();
              setMessage("地图已删除");
            }}
            disabled={!currentMap}
          >
            删除地图
          </button>
          <button
            onClick={async () => {
              if (!currentMap) {
                return;
              }
              const response = await api.undoMap(currentMap.document.meta.id);
              if (response.ok && response.result) {
                // Re-open map to get fresh state from server
                await openMap(currentMap.document.meta.id);
                setMessage(`已撤销：${response.result.label}`);
              } else {
                setMessage("撤销失败");
              }
            }}
            disabled={!currentMap}
          >
            撤销
          </button>
          <button
            onClick={() => {
              if (!currentMap) {
                return;
              }
              setCurrentMap(redo(currentMap));
              setMessage("已重做");
            }}
            disabled={!currentMap || currentMap.history.future.length === 0}
          >
            重做
          </button>
          <button
            onClick={() => setDarkMode((prev) => !prev)}
            title={darkMode ? "切换为浅色模式" : "切换为深色模式"}
          >
            {darkMode ? "浅色" : "深色"}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            void handleImportFile(file);
            event.currentTarget.value = "";
          }}
        />
      </header>

      <main className="layout">
        <aside className="sidebar">
          <section className="panel status-panel" aria-label="当前状态">
            <h2>当前状态</h2>
            <div className="status-message-banner" aria-live="polite">
              {loading ? "加载中.." : message}
            </div>
            {currentMap ? (
              <div className="meta-list">
                <p>
                  当前地图：<strong>{currentMap.document.meta.name}</strong>
                </p>
                <p>ID：{currentMap.document.meta.id}</p>
                <p>Designed：{currentMap.document.cells.length}</p>
                <p>Revision：{currentMap.document.meta.revision}</p>
                <p>更新时间：{formatDateTime(currentMap.document.meta.updated_at)}</p>
                <p>保存状态：{mapDirty ? "未保存修改" : "已保存"}</p>
              </div>
            ) : (
              <p>当前没有打开地图。</p>
            )}
          </section>
          <section className="panel">
            <h2>显示控制</h2>
            <label className="checkbox-row"><input type="checkbox" checked={showCoordinates} onChange={(event) => setShowCoordinates(event.target.checked)} />显示坐标</label>
            <label className="checkbox-row"><input type="checkbox" checked={showShorthand} onChange={(event) => setShowShorthand(event.target.checked)} />显示简写</label>
            <label className="checkbox-row"><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />显示网格线</label>
            <label className="checkbox-row"><input type="checkbox" checked={showUndesigned} onChange={(event) => setShowUndesigned(event.target.checked)} />显示 undesigned</label>
          </section>
          <section className="panel">
            <h2>Tag 筛选</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 8px" }}>
              点击 Tag 筛选显示对应单元格（多选）
            </p>
            <div className="tag-filter-bar">
              {Object.entries(TAG_ENTRIES).map(([key, entry]) => (
                <button
                  key={key}
                  className={`tag-chip${activeTagFilters.includes(key) ? " active" : ""}`}
                  onClick={() => {
                    setActiveTagFilters((prev) =>
                      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]
                    );
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            {activeTagFilters.length > 0 ? (
              <button
                onClick={() => setActiveTagFilters([])}
                style={{ fontSize: "0.85rem", padding: "4px 10px" }}
              >
                清除筛选              </button>
            ) : null}
          </section>
          <section className="panel collapsible-panel">
            <div className="panel-header">
              <h2>图片导出</h2>
              <button
                type="button"
                className="panel-toggle"
                onClick={() => setExportPanelOpen((current) => !current)}
                aria-expanded={exportPanelOpen}
                aria-controls="export-panel-content"
              >
                {exportPanelOpen ? "收起" : "展开"}
              </button>
            </div>
            {exportPanelOpen ? (
              <div id="export-panel-content">
                <div className="export-action-row">
                  <button
                    onClick={() => void handleExportPng()}
                    disabled={!currentMap || currentMap.document.cells.length === 0}
                  >
                    导出图片
                  </button>
                </div>
                <label>
                  预设
                  <select
                    value={pngOptions.preset}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        preset: event.target.value as ExportRenderOptions["preset"],
                        includeCoordinates: event.target.value === "reference" ? true : current.includeCoordinates,
                        includeShorthand: event.target.value === "reference" ? true : current.includeShorthand
                      }))
                    }
                  >
                    <option value="clean">clean</option>
                    <option value="reference">reference</option>
                  </select>
                </label>
                <label>
                  Scale
                  <select
                    value={pngOptions.scale}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        scale: Number(event.target.value)
                      }))
                    }
                  >
                    <option value="1">1x</option>
                    <option value="2">2x</option>
                    <option value="3">3x</option>
                  </select>
                </label>
                <label>
                  Padding
                  <select
                    value={pngOptions.padding}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        padding: Number(event.target.value)
                      }))
                    }
                  >
                    <option value="16">16</option>
                    <option value="32">32</option>
                    <option value="48">48</option>
                    <option value="64">64</option>
                  </select>
                </label>
                <label>
                  背景色                  <input
                    type="color"
                    value={pngOptions.background}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        background: event.target.value
                      }))
                    }
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pngOptions.transparent ?? false}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        transparent: event.target.checked
                      }))
                    }
                  />
                  透明背景（PNG 无背景色）                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pngOptions.includeGrid}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        includeGrid: event.target.checked
                      }))
                    }
                  />
                  导出网格线                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pngOptions.includeUndesigned}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        includeUndesigned: event.target.checked
                      }))
                    }
                  />
                  导出 undesigned
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pngOptions.includeCoordinates}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        includeCoordinates: event.target.checked
                      }))
                    }
                  />
                  导出坐标
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={pngOptions.includeShorthand}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        includeShorthand: event.target.checked
                      }))
                    }
                  />
                  导出简写                </label>
              </div>
            ) : null}
          </section>
          <section className="panel collapsible-panel">
            <div className="panel-header">
              <h2>地图合并</h2>
              <button
                type="button"                className="panel-toggle"                onClick={() => setMergePanelOpen((c) => !c)}
                aria-expanded={mergePanelOpen}
              >
                {mergePanelOpen ? "收起" : "展开"}
              </button>
            </div>
            {mergePanelOpen ? (
              <div>
                <p style={{ fontSize: "0.85em", margin: "0 0 8px" }}>
                  将另一张地图的单元格合并到当前地图中。                </p>
                <label>
                  来源地图
                  <select
                    value={mergeSourceId}
                    onChange={(e) => setMergeSourceId(e.target.value)}
                    disabled={!currentMap}
                  >
                    <option value="">选择来源地图</option>
                    {displayMaps
                      .filter((m) => currentMap && m.id !== currentMap.document.meta.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.designedCellCount} cells)
                        </option>
                      ))}
                  </select>
                </label>
                <div className="action-row">
                  <label>
                    行偏移                    <input
                      type="number"                      value={mergeRowOffset}
                      onChange={(e) => setMergeRowOffset(Number(e.target.value))}
                      disabled={!currentMap}
                      style={{ width: 70 }}
                    />
                  </label>
                  <label>
                    列偏移                    <input
                      type="number"                      value={mergeColOffset}
                      onChange={(e) => setMergeColOffset(Number(e.target.value))}
                      disabled={!currentMap}
                      style={{ width: 70 }}
                    />
                  </label>
                </div>
                <button
                  onClick={async () => {
                    if (!currentMap || !mergeSourceId) return;
                    const ok = window.confirm(
                      `确认将来源地图合并到当前地图？\n\n来源地图的所有单元格将以偏移 (行: ${mergeRowOffset}, 列: ${mergeColOffset})) 合并到当前地图中。重叠位置来源覆盖。`
                    );
                    if (!ok) return;
                    const response = await api.mergeMap(
                      currentMap.document.meta.id,
                      mergeSourceId,
                      mergeRowOffset,
                      mergeColOffset
                    );
                    if (!response.ok) {
                      setMessage(formatStatusMessage(response.errors[0]?.message, "合并失败"));
                      return;
                    }
                    // Refresh map state
                    await openMap(currentMap.document.meta.id);
                    setMessage(
                      `合并完成：新增 ${response.result!.cellsAdded} 个单元格，覆盖 ${response.result!.cellsOverwritten} 个单元格`
                    );
                  }}
                  disabled={!currentMap || !mergeSourceId}
                >
                  执行合并
                </button>
              </div>
            ) : null}
          </section>
          <section className="panel">
            <h2>说明</h2>
            <p>滚轮缩放，拖拽平移。默认展示扩展坐标，内部编号用于程序定位。</p>
            <p>编辑单元格后点击"保存"或直接编辑（远程命令自动保存），修改会写入数据库。</p>
          </section>
        </aside>

        <section className="canvas-panel">
          {currentMap ? (
            <MapCanvas
              map={currentMap}
              selectedCell={selectedCell}
              selectedCellId={selectedCellId}
              onHoverCellChange={setHoveredCell}
              onSelectCell={(cell) => {
                if (formatBrushEnabled) {
                  void handleApplyFormatBrush(cell);
                  return;
                }
                if (!ensureCanLeaveSelection()) {
                  return;
                }
                setSelectedCellId(cell.id);
                syncDraftFromCell(cell);
              }}
              tagFilters={activeTagFilters.length > 0 ? activeTagFilters : undefined}
              showCoordinates={showCoordinates}
              showShorthand={showShorthand}
              showGrid={showGrid}
              showUndesigned={showUndesigned}
            />
          ) : (
            <div className="empty-state">
              <h2>还没有打开地图</h2>
              <p>从顶部新建地图，或导入已有的 JSON 文件开始。</p>
            </div>
          )}
        </section>

        <aside className="detail-panel">
          <section className="panel">
            <div className="panel-header">
              <div className="action-row action-row-inline">
                <button onClick={() => void handleApplyDraft()} disabled={!selectedCell}>
                  保存
                </button>
                <button onClick={() => syncDraftFromCell(selectedCell)} disabled={!selectedCell || !cellDirty}>
                  撤销
                </button>
                <button onClick={() => void handleClearSelected()} disabled={!selectedCell}>
                  清空
                </button>
                <button
                  type="button"
                  className={formatBrushEnabled ? "toggle-button-active" : undefined}
                  aria-pressed={formatBrushEnabled}
                  onClick={toggleFormatBrush}
                  disabled={!canUseFormatBrush}
                >
                  格式刷                </button>
              </div>
            </div>
            <div className="format-brush-panel">
              <div className="format-brush-options">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={formatBrushScope.terrain}
                    onChange={(event) => setFormatBrushScopeField("terrain", event.target.checked)}
                    disabled={!selectedCell}
                  />
                  刷地形                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={formatBrushScope.biome}
                    onChange={(event) => setFormatBrushScopeField("biome", event.target.checked)}
                    disabled={!selectedCell}
                  />
                  刷生态                </label>
              </div>
              {formatBrushEnabled && selectedCell ? (
                <p className="format-brush-summary">
                  格式刷源格：{selectedCell.display_coord} | 当前刷入：{getFormatBrushLabel()}
                </p>
              ) : (
                <p className="format-brush-summary">
                  选中已设计单元格后可进入格式刷模式；再次点击按钮即可退出。</p>
              )}
            </div>
            <label>
              Terrain 分类
              <select
                value={terrainCategory}
                onChange={(event) => handleTerrainCategoryChange(event.target.value)}
                disabled={!selectedCell}
              >
                <option value="">请选择分类</option>
                {filteredTerrainCategories.map((categoryKey) => (
                  <option key={categoryKey} value={categoryKey}>
                    {TERRAIN_CATEGORY_LABELS[categoryKey]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Terrain
              <select
                value={draft.terrain}
                onChange={(event) => handleTerrainChange(event.target.value)}
                disabled={!selectedCell || !terrainCategory}
              >
                <option value="">{terrainCategory ? "未设置" : "请先选择 Terrain 分类"}</option>
                {terrainOptions.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label} ({entry.short})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Biome
              <select
                value={draft.biome}
                onChange={(event) => handleBiomeChange(event.target.value)}
                disabled={!selectedCell}
              >
                <option value="">未设置</option>
                {biomeOptions.map((key) => (
                  <option key={key} value={key}>
                    {BIOME_ENTRIES[key].label} ({BIOME_ENTRIES[key].short})
                  </option>
                ))}
              </select>
            </label>
            <div className="tag-grid">
              {Object.entries(TAG_ENTRIES).map(([key, entry]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={draft.tags.includes(key)}
                    disabled={!selectedCell}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        tags: event.target.checked
                          ? [...current.tags, key]
                          : current.tags.filter((tag) => tag !== key)
                      }));
                    }}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
            <label>
              Note
              <textarea
                rows={6}
                value={draft.note}
                disabled={!selectedCell}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
              />
            </label>
          </section>

          <section className="panel">
            <h2>编辑历史</h2>
            {currentMap ? (
              <>
                <p>
                  已记录 ${currentMap.history.past.length} 个 | 可重做 ${currentMap.history.future.length} 个                </p>
                {currentMap.history.past.length > 0 ? (
                  <div className="history-list">
                    {currentMap.history.past
                      .slice(-5)
                      .reverse()
                      .map((entry) => (
                        <div key={`${entry.timestamp}-${entry.label}`} className="history-entry">
                          <strong>{HISTORY_LABELS[entry.label] ?? entry.label}</strong>
                          <span>{entry.source} · {formatDateTime(entry.timestamp)}</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p>当前会话还没有编辑历史。</p>
                )}
              </>
            ) : (
              <p>打开地图后会显示当前会话历史。</p>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
