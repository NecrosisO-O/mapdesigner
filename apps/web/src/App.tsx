import {
  BIOME_ENTRIES,
  BIOME_KEYS,
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
  redo,
  undo
} from "@mapdesigner/map-core";
import { startTransition, useEffect, useRef, useState } from "react";
import { api, type MapListItem } from "./api.js";
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    const response = await api.createMap({ name });
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
    setMessage(`已新建 ${response.result.document.meta.name}`);
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

  function applyDraft(): void {
    if (!currentMap || !selectedCell) {
      return;
    }
    if (!draft.terrain) {
      setMessage("设置为 designed 时必须选择 terrain");
      return;
    }
    const result = applyCommand(currentMap, {
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
    if (!result.ok) {
      setMessage(result.errors[0]?.message ?? "应用修改失败");
      return;
    }
    setCurrentMap(result.map);
    setSelectedCellId(createCellId(selectedCell.row, selectedCell.col));
    syncDraftFromCell(
      result.map.activeCells.find((cell) => cell.row === selectedCell.row && cell.col === selectedCell.col) ?? null
    );
    setMessage(result.warnings[0]?.message ?? "单元格修改已应用，等待保存到文件");
  }

  function clearSelected(): void {
    if (!currentMap || !selectedCell) {
      return;
    }
    const result = applyCommand(currentMap, {
      action: "clear_cell",
      source: "webui",
      target: { row: selectedCell.row, col: selectedCell.col }
    });
    if (!result.ok) {
      setMessage(result.errors[0]?.message ?? "清空失败");
      return;
    }
    setCurrentMap(result.map);
    const updatedCell =
      result.map.activeCells.find((cell) => cell.row === selectedCell.row && cell.col === selectedCell.col) ?? null;
    setSelectedCellId(updatedCell?.id ?? null);
    syncDraftFromCell(updatedCell);
    if (updatedCell?.status !== "designed") {
      setFormatBrushEnabled(false);
    }
    setMessage("单元格已清空，等待保存到文件");
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
    setMessage(`已进入格式刷模式：${selectedCell.display_coord}，当前刷入 ${getFormatBrushLabel()}`);
  }

  function applyFormatBrush(targetCell: ActiveCell): void {
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

    const result = applyCommand(currentMap, {
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

    if (!result.ok) {
      setMessage(result.errors[0]?.message ?? "格式刷应用失败");
      return;
    }

    setCurrentMap(result.map);
    setSelectedCellId(createCellId(selectedCell.row, selectedCell.col));
    syncDraftFromCell(
      result.map.activeCells.find((cell) => cell.row === selectedCell.row && cell.col === selectedCell.col) ?? null
    );
    setMessage(
      result.warnings[0]?.message ??
        `已将 ${selectedCell.display_coord} 的${getFormatBrushLabel()}刷到 ${targetCell.display_coord}，等待保存到文件`
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
            另存为
          </button>
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
                确认重命名
              </button>
              <button
                onClick={() => {
                  setIsRenaming(false);
                  setRenameDraft(currentMap?.document.meta.name ?? "");
                }}
                type="button"
              >
                取消重命名
              </button>
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
              重命名
            </button>
          )}
          <button
            onClick={() => void handleExportPng()}
            disabled={!currentMap || currentMap.document.cells.length === 0}
          >
            导出图片
          </button>
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
            onClick={() => {
              if (!currentMap) {
                return;
              }
              setCurrentMap(undo(currentMap));
              setMessage("已撤销");
            }}
            disabled={!currentMap || currentMap.history.past.length === 0}
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
            <p>{loading ? "加载中..." : message}</p>
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
                  背景色
                  <input
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
                    checked={pngOptions.includeGrid}
                    onChange={(event) =>
                      setPngOptions((current) => ({
                        ...current,
                        includeGrid: event.target.checked
                      }))
                    }
                  />
                  导出网格线
                </label>
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
                  导出简写
                </label>
              </div>
            ) : (
              <p className="panel-collapsed-hint">展开后可配置 PNG 导出的预设、比例和参考信息。</p>
            )}
          </section>
          <section className="panel">
            <h2>说明</h2>
            <p>滚轮缩放，拖拽平移。默认展示扩展坐标，内部编号用于程序定位。</p>
            <p>编辑单元格后只会先更新当前地图内存，点击顶部“保存”才会写回 `storage/maps`。</p>
          </section>
        </aside>

        <section className="canvas-panel">
          {currentMap ? (
            <MapCanvas
              map={currentMap}
              selectedCellId={selectedCellId}
              onHoverCellChange={setHoveredCell}
              onSelectCell={(cell) => {
                if (formatBrushEnabled) {
                  applyFormatBrush(cell);
                  return;
                }
                if (!ensureCanLeaveSelection()) {
                  return;
                }
                setSelectedCellId(cell.id);
                syncDraftFromCell(cell);
              }}
              showCoordinates={showCoordinates}
              showShorthand={showShorthand}
              showGrid={showGrid}
              showUndesigned={showUndesigned}
            />
          ) : (
            <div className="empty-state">
              <h2>还没有打开地图</h2>
              <p>从顶部新建地图，或导入已有 JSON 文件开始。</p>
            </div>
          )}
        </section>

        <aside className="detail-panel">
          <section className="panel">
            <h2>当前选中</h2>
            {selectedCell ? (
              <div className="meta-list">
                <p>坐标：{selectedCell.display_coord} | ID：{selectedCell.id}</p>
                <p>状态：{selectedCell.status}</p>
              </div>
            ) : (
              <p>请选择一个单元格</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="action-row action-row-inline">
                <button onClick={applyDraft} disabled={!selectedCell}>
                  保存
                </button>
                <button onClick={() => syncDraftFromCell(selectedCell)} disabled={!selectedCell || !cellDirty}>
                  撤销
                </button>
                <button onClick={clearSelected} disabled={!selectedCell}>
                  清空
                </button>
                <button
                  type="button"
                  className={formatBrushEnabled ? "toggle-button-active" : undefined}
                  aria-pressed={formatBrushEnabled}
                  onClick={toggleFormatBrush}
                  disabled={!canUseFormatBrush}
                >
                  格式刷
                </button>
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
                  刷地形
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={formatBrushScope.biome}
                    onChange={(event) => setFormatBrushScopeField("biome", event.target.checked)}
                    disabled={!selectedCell}
                  />
                  刷生态
                </label>
              </div>
              {formatBrushEnabled && selectedCell ? (
                <p className="format-brush-summary">
                  格式刷源格：{selectedCell.display_coord} | 当前刷入：{getFormatBrushLabel()}
                </p>
              ) : (
                <p className="format-brush-summary">
                  选中已设计单元格后可进入格式刷模式；再次点击按钮即可退出。
                </p>
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
                  已记录 {currentMap.history.past.length} 步 | 可重做 {currentMap.history.future.length} 步
                </p>
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
