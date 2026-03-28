import {
  BIOME_ENTRIES,
  BIOME_KEYS,
  TAG_ENTRIES,
  TERRAIN_ENTRIES,
  TERRAIN_CATEGORY_ORDER,
  applyCommand,
  createCellId,
  getAllowedBiomesForTerrain,
  getAllowedTerrainCategoriesForBiome,
  getAllowedTerrainsForBiome,
  getFilteredTerrainEntries,
  getTerrainCategoryKey,
  type ActiveCell,
  type MapRuntimeState
} from "@mapdesigner/map-core";
import { useEffect, useState } from "react";

export interface CellDraft {
  terrain: string;
  biome: string;
  tags: string[];
  note: string;
}

export interface FormatBrushScope {
  terrain: boolean;
  biome: boolean;
}

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

export function useCellEditor(
  currentMap: MapRuntimeState | null,
  setCurrentMap: (map: MapRuntimeState | null) => void,
  setMessage: (message: string) => void
) {
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CellDraft>(toDraft(null));
  const [terrainCategory, setTerrainCategory] = useState<string>("");
  const [formatBrushEnabled, setFormatBrushEnabled] = useState(false);
  const [formatBrushScope, setFormatBrushScope] = useState<FormatBrushScope>({
    terrain: true,
    biome: true
  });

  const selectedCell =
    currentMap?.activeCells.find((cell) => cell.id === selectedCellId) ?? null;

  const cellDirty =
    selectedCell !== null &&
    (draft.terrain !== (selectedCell.terrain ?? "") ||
      draft.biome !== (selectedCell.biome ?? "") ||
      draft.note !== selectedCell.note ||
      draft.tags.join("|") !== selectedCell.tags.join("|"));

  const filteredTerrainCategories = draft.biome
    ? getAllowedTerrainCategoriesForBiome(draft.biome)
    : TERRAIN_CATEGORY_ORDER;

  const terrainOptions = terrainCategory
    ? getFilteredTerrainEntries(terrainCategory, draft.biome || undefined)
    : [];

  const biomeOptions = draft.terrain ? getAllowedBiomesForTerrain(draft.terrain) : BIOME_KEYS;
  const canUseFormatBrush = selectedCell?.status === "designed";

  function syncDraftFromCell(cell: ActiveCell | null): void {
    setDraft(toDraft(cell));
    setTerrainCategory(resolveTerrainCategory(cell?.terrain));
  }

  function resetEditor(): void {
    setSelectedCellId(null);
    syncDraftFromCell(null);
    setFormatBrushEnabled(false);
  }

  function disableFormatBrush(): void {
    setFormatBrushEnabled(false);
  }

  function ensureCanLeaveSelection(): boolean {
    if (!cellDirty) {
      return true;
    }
    return window.confirm("当前单元格有未保存编辑，是否放弃这些修改？");
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
      const allowedTerrains = new Set(
        getFilteredTerrainEntries(nextCategory, current.biome || undefined).map((entry) => entry.key)
      );
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

  function handleCanvasCellSelect(cell: ActiveCell): void {
    if (formatBrushEnabled) {
      applyFormatBrush(cell);
      return;
    }
    if (!ensureCanLeaveSelection()) {
      return;
    }
    setSelectedCellId(cell.id);
    syncDraftFromCell(cell);
  }

  useEffect(() => {
    if (formatBrushEnabled && !canUseFormatBrush) {
      setFormatBrushEnabled(false);
    }
  }, [canUseFormatBrush, formatBrushEnabled]);

  useEffect(() => {
    if (!currentMap && selectedCellId) {
      resetEditor();
      return;
    }
    if (currentMap && selectedCellId && !selectedCell) {
      resetEditor();
    }
  }, [currentMap, selectedCell, selectedCellId]);

  return {
    selectedCellId,
    selectedCell,
    draft,
    terrainCategory,
    formatBrushEnabled,
    formatBrushScope,
    cellDirty,
    filteredTerrainCategories,
    terrainOptions,
    biomeOptions,
    canUseFormatBrush,
    setDraft,
    syncDraftFromCell,
    resetEditor,
    disableFormatBrush,
    ensureCanLeaveSelection,
    setFormatBrushScopeField,
    getFormatBrushLabel,
    handleTerrainCategoryChange,
    handleTerrainChange,
    handleBiomeChange,
    applyDraft,
    clearSelected,
    toggleFormatBrush,
    handleCanvasCellSelect
  };
}
