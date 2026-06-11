import {
  BIOME_ENTRIES,
  BIOME_KEYS,
  TAG_ENTRIES,
  TERRAIN_CATEGORY_ORDER,
  TERRAIN_ENTRIES,
  applyCommand,
  getAllowedBiomesForTerrain,
  getAllowedTerrainCategoriesForBiome,
  getFilteredTerrainEntries,
  getTerrainCategoryKey,
  type ActiveCell,
  type BiomeKey,
  type MapRuntimeState,
  type TagKey,
  type TerrainCategoryKey,
  type TerrainKey
} from "@mapdesigner/map-core";
import { useEffect, useMemo, useState } from "react";

const NONE_BIOME_VALUE = "__none__";

export interface BatchEditDraft {
  terrainCategory: string;
  terrain: string;
  biome: string;
  tags: TagKey[];
  note: string;
}

export interface ReplaceTerrainDraft {
  matchTerrain: string;
  replacementCategory: string;
  replacementTerrain: string;
}

export interface ReplaceBiomeDraft {
  matchBiome: string;
  replacementBiome: string;
}

function sortCells(left: ActiveCell, right: ActiveCell): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }
  return left.col - right.col;
}

function terrainCategoryOf(terrain: string): string {
  if (!terrain || !(terrain in TERRAIN_ENTRIES)) {
    return "";
  }
  return getTerrainCategoryKey(terrain as TerrainKey);
}

function biomeValueToCommand(value: string): BiomeKey | null {
  return value === NONE_BIOME_VALUE ? null : (value as BiomeKey);
}

export function getNoneBiomeValue(): string {
  return NONE_BIOME_VALUE;
}

export function useAdvancedEditor(
  currentMap: MapRuntimeState | null,
  setCurrentMap: (map: MapRuntimeState | null) => void,
  setMessage: (message: string) => void
) {
  const [batchSelectedCellIds, setBatchSelectedCellIds] = useState<Set<string>>(() => new Set());
  const [batchDraft, setBatchDraft] = useState<BatchEditDraft>({
    terrainCategory: "",
    terrain: "",
    biome: "",
    tags: [],
    note: ""
  });
  const [replaceTerrainDraft, setReplaceTerrainDraft] = useState<ReplaceTerrainDraft>({
    matchTerrain: "",
    replacementCategory: "",
    replacementTerrain: ""
  });
  const [replaceBiomeDraft, setReplaceBiomeDraft] = useState<ReplaceBiomeDraft>({
    matchBiome: "",
    replacementBiome: ""
  });

  const batchSelectedCells = useMemo(() => {
    if (!currentMap) {
      return [];
    }
    return currentMap.activeCells
      .filter((cell) => batchSelectedCellIds.has(cell.id))
      .sort(sortCells);
  }, [batchSelectedCellIds, currentMap]);

  const batchFilteredTerrainCategories = batchDraft.biome
    ? getAllowedTerrainCategoriesForBiome(batchDraft.biome)
    : TERRAIN_CATEGORY_ORDER;
  const batchTerrainOptions = batchDraft.terrainCategory
    ? getFilteredTerrainEntries(batchDraft.terrainCategory, batchDraft.biome || undefined)
    : [];
  const batchBiomeOptions = batchDraft.terrain ? getAllowedBiomesForTerrain(batchDraft.terrain) : BIOME_KEYS;
  const replaceTerrainOptions = replaceTerrainDraft.replacementCategory
    ? getFilteredTerrainEntries(replaceTerrainDraft.replacementCategory)
    : [];

  function toggleBatchCell(cell: ActiveCell): void {
    setBatchSelectedCellIds((current) => {
      const next = new Set(current);
      if (next.has(cell.id)) {
        next.delete(cell.id);
      } else {
        next.add(cell.id);
      }
      return next;
    });
  }

  function clearBatchSelection(): void {
    setBatchSelectedCellIds(new Set());
  }

  function setBatchTerrainCategory(nextCategory: string): void {
    setBatchDraft((current) => {
      const allowedTerrains = new Set(
        getFilteredTerrainEntries(nextCategory, current.biome || undefined).map((entry) => entry.key)
      );
      return {
        ...current,
        terrainCategory: nextCategory,
        terrain: current.terrain && allowedTerrains.has(current.terrain as TerrainKey) ? current.terrain : ""
      };
    });
  }

  function setBatchTerrain(nextTerrain: string): void {
    setBatchDraft((current) => {
      const allowedBiomes = new Set(nextTerrain ? getAllowedBiomesForTerrain(nextTerrain) : []);
      return {
        ...current,
        terrainCategory: nextTerrain ? terrainCategoryOf(nextTerrain) : current.terrainCategory,
        terrain: nextTerrain,
        biome: current.biome && !allowedBiomes.has(current.biome as BiomeKey) ? "" : current.biome
      };
    });
  }

  function setBatchBiome(nextBiome: string): void {
    setBatchDraft((current) => {
      const filteredCategories = nextBiome ? getAllowedTerrainCategoriesForBiome(nextBiome) : TERRAIN_CATEGORY_ORDER;
      const allowedTerrains = nextBiome ? new Set(getFilteredTerrainEntries(current.terrainCategory, nextBiome).map((entry) => entry.key)) : null;
      return {
        ...current,
        biome: nextBiome,
        terrainCategory:
          current.terrainCategory && filteredCategories.includes(current.terrainCategory as TerrainCategoryKey)
            ? current.terrainCategory
            : "",
        terrain:
          nextBiome && current.terrain && allowedTerrains && !allowedTerrains.has(current.terrain as TerrainKey)
            ? ""
            : current.terrain
      };
    });
  }

  function setBatchTag(tag: TagKey, checked: boolean): void {
    setBatchDraft((current) => ({
      ...current,
      tags: checked
        ? current.tags.includes(tag) ? current.tags : [...current.tags, tag]
        : current.tags.filter((entry) => entry !== tag)
    }));
  }

  function applyBatchEdit(): MapRuntimeState | null {
    if (!currentMap) {
      return null;
    }
    if (batchSelectedCells.length === 0) {
      setMessage("请先选择要批量编辑的单元格");
      return null;
    }
    if (!batchDraft.terrain) {
      setMessage("批量设置必须选择 terrain");
      return null;
    }
    const result = applyCommand(currentMap, {
      action: "set_cells",
      source: "webui",
      targets: batchSelectedCells.map((cell) => ({ row: cell.row, col: cell.col })),
      changes: {
        terrain: batchDraft.terrain as TerrainKey,
        biome: batchDraft.biome ? (batchDraft.biome as BiomeKey) : null,
        tags: batchDraft.tags,
        note: batchDraft.note
      }
    });
    if (!result.ok) {
      setMessage(result.errors[0]?.message ?? "批量设置失败");
      return null;
    }
    setCurrentMap(result.map);
    setMessage(result.warnings[0]?.message ?? `已批量设置 ${result.changed.length} 个单元格，等待保存到文件`);
    return result.map;
  }

  function setReplacementTerrainCategory(nextCategory: string): void {
    setReplaceTerrainDraft((current) => {
      const allowedTerrains = new Set(getFilteredTerrainEntries(nextCategory).map((entry) => entry.key));
      return {
        ...current,
        replacementCategory: nextCategory,
        replacementTerrain: allowedTerrains.has(current.replacementTerrain as TerrainKey)
          ? current.replacementTerrain
          : ""
      };
    });
  }

  function setReplacementTerrain(nextTerrain: string): void {
    setReplaceTerrainDraft((current) => ({
      ...current,
      replacementCategory: nextTerrain ? terrainCategoryOf(nextTerrain) : current.replacementCategory,
      replacementTerrain: nextTerrain
    }));
  }

  function applyTerrainReplacement(): MapRuntimeState | null {
    if (!currentMap) {
      return null;
    }
    if (!replaceTerrainDraft.matchTerrain || !replaceTerrainDraft.replacementTerrain) {
      setMessage("请选择要匹配和替换的 terrain");
      return null;
    }
    if (replaceTerrainDraft.matchTerrain === replaceTerrainDraft.replacementTerrain) {
      setMessage("匹配 terrain 与目标 terrain 相同");
      return null;
    }
    const matchCount = currentMap.document.cells.filter(
      (cell) => cell.terrain === replaceTerrainDraft.matchTerrain
    ).length;
    if (matchCount === 0) {
      setMessage("没有匹配的 terrain");
      return null;
    }
    const result = applyCommand(currentMap, {
      action: "replace_terrain",
      source: "webui",
      match: {
        terrain: replaceTerrainDraft.matchTerrain as TerrainKey
      },
      changes: {
        terrain: replaceTerrainDraft.replacementTerrain as TerrainKey
      }
    });
    if (!result.ok) {
      setMessage(result.errors[0]?.message ?? "地形替换失败");
      return null;
    }
    setCurrentMap(result.map);
    setMessage(result.warnings[0]?.message ?? `已替换 ${result.changed.length} 个地形，等待保存到文件`);
    return result.map;
  }

  function applyBiomeReplacement(): MapRuntimeState | null {
    if (!currentMap) {
      return null;
    }
    if (!replaceBiomeDraft.matchBiome || !replaceBiomeDraft.replacementBiome) {
      setMessage("请选择要匹配和替换的 biome");
      return null;
    }
    const matchBiome = biomeValueToCommand(replaceBiomeDraft.matchBiome);
    const replacementBiome = biomeValueToCommand(replaceBiomeDraft.replacementBiome);
    if (matchBiome === replacementBiome) {
      setMessage("匹配 biome 与目标 biome 相同");
      return null;
    }
    const matchCount = currentMap.document.cells.filter((cell) => cell.biome === matchBiome).length;
    if (matchCount === 0) {
      setMessage("没有匹配的 biome");
      return null;
    }
    const result = applyCommand(currentMap, {
      action: "replace_biome",
      source: "webui",
      match: {
        biome: matchBiome
      },
      changes: {
        biome: replacementBiome
      }
    });
    if (!result.ok) {
      setMessage(result.errors[0]?.message ?? "生态替换失败");
      return null;
    }
    setCurrentMap(result.map);
    setMessage(result.warnings[0]?.message ?? `已替换 ${result.changed.length} 个生态，等待保存到文件`);
    return result.map;
  }

  useEffect(() => {
    if (!currentMap) {
      setBatchSelectedCellIds(new Set());
    }
  }, [currentMap]);

  useEffect(() => {
    setBatchSelectedCellIds(new Set());
  }, [currentMap?.document.meta.id]);

  useEffect(() => {
    if (!currentMap) {
      return;
    }
    const activeIds = new Set(currentMap.activeCells.map((cell) => cell.id));
    setBatchSelectedCellIds((current) => {
      const next = new Set([...current].filter((id) => activeIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [currentMap]);

  return {
    batchSelectedCellIds,
    batchSelectedCells,
    batchDraft,
    replaceTerrainDraft,
    replaceBiomeDraft,
    batchFilteredTerrainCategories,
    batchTerrainOptions,
    batchBiomeOptions,
    replaceTerrainOptions,
    setBatchDraft,
    setReplaceTerrainDraft,
    setReplaceBiomeDraft,
    toggleBatchCell,
    clearBatchSelection,
    setBatchTerrainCategory,
    setBatchTerrain,
    setBatchBiome,
    setBatchTag,
    applyBatchEdit,
    setReplacementTerrainCategory,
    setReplacementTerrain,
    applyTerrainReplacement,
    applyBiomeReplacement,
    terrainEntries: TERRAIN_ENTRIES,
    biomeEntries: BIOME_ENTRIES,
    tagEntries: TAG_ENTRIES,
    noneBiomeValue: NONE_BIOME_VALUE
  };
}
