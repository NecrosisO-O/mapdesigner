import {
  BIOME_ENTRIES,
  BIOME_KEYS,
  TAG_ENTRIES,
  TERRAIN_CATEGORY_ORDER,
  TERRAIN_ENTRIES,
  getAllowedBiomesForTerrain,
  getAllowedTerrainCategoriesForBiome,
  getFilteredTerrainEntries,
  getTerrainCategoryKey,
  type ActiveCell,
  type BiomeKey,
  type MapCommand,
  type MapRuntimeState,
  type TagKey,
  type TerrainKey
} from "@mapdesigner/map-core";
import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import { useEditorTask } from "./useEditorTask.js";

export type BatchField = "terrain" | "biome" | "tags" | "note";
export type FieldMode = "keep" | "set" | "clear";
const INITIAL_MODES: Record<BatchField, FieldMode> = {
  terrain: "keep",
  biome: "keep",
  tags: "keep",
  note: "keep"
};
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
  applyCommands: (commands: MapCommand[]) => Promise<MapRuntimeState | null>,
  setMessage: (message: string) => void,
  confirmReplacement?: (commands: MapCommand[]) => Promise<boolean>
) {
  const [selection, setSelection] = useState<Map<string, ActiveCell>>(() => new Map());
  const batchSelectedCellIds = useMemo(() => new Set(selection.keys()), [selection]);
  const [batchTagMode, setBatchTagMode] = useState<"replace" | "add" | "remove">("replace");
  const [batchModes, setBatchModes] = useState(INITIAL_MODES);
  const task = useEditorTask(currentMap?.document.meta.id);
  const [batchDraft, updateBatchDraft] = useState<BatchEditDraft>({
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

  const batchSelectedCells = useMemo(() => [...selection.values()].sort(sortCells), [selection]);
  const mixedFields = useMemo(
    () =>
      Object.fromEntries(
        (["terrain", "biome", "tags", "note"] as const).map((field) => [
          field,
          new Set(
            batchSelectedCells.map((cell) =>
              JSON.stringify(field === "tags" ? [...cell.tags].sort() : cell[field])
            )
          ).size > 1
        ])
      ) as Record<BatchField, boolean>,
    [batchSelectedCells]
  );
  const draftRef = useRef(batchDraft);
  draftRef.current = batchDraft;
  function setBatchDraft(action: SetStateAction<BatchEditDraft>): void {
    const previous = draftRef.current;
    const next = typeof action === "function" ? action(previous) : action;
    draftRef.current = next;
    updateBatchDraft(next);
    setBatchModes((modes) => {
      const updated = { ...modes };
      for (const field of ["terrain", "biome", "tags", "note"] as const) {
        if (next[field] !== previous[field])
          updated[field] =
            next[field] === "" || (Array.isArray(next[field]) && !next[field].length)
              ? field === "terrain"
                ? "keep"
                : "clear"
              : "set";
      }
      return updated;
    });
  }
  function setBatchFieldMode(field: BatchField, mode: FieldMode): void {
    if (field === "terrain" && mode === "clear") return;
    setBatchModes((modes) => ({ ...modes, [field]: mode }));
  }

  const batchFilteredTerrainCategories = TERRAIN_CATEGORY_ORDER;
  const batchTerrainOptions = batchDraft.terrainCategory
    ? getFilteredTerrainEntries(batchDraft.terrainCategory)
    : [];
  const batchBiomeOptions = batchDraft.terrain
    ? getAllowedBiomesForTerrain(batchDraft.terrain)
    : BIOME_KEYS;
  const replaceTerrainOptions = replaceTerrainDraft.replacementCategory
    ? getFilteredTerrainEntries(replaceTerrainDraft.replacementCategory)
    : [];

  function toggleBatchCell(cell: ActiveCell): void {
    setSelection((current) => {
      const next = new Map(current);
      if (next.has(cell.id)) next.delete(cell.id);
      else next.set(cell.id, cell);
      return next;
    });
  }

  function clearBatchSelection(): void {
    setSelection(new Map());
  }

  function setBatchTerrainCategory(nextCategory: string): void {
    setBatchDraft((current) => ({ ...current, terrainCategory: nextCategory }));
  }
  function setBatchTerrain(nextTerrain: string): void {
    setBatchDraft((current) => ({
      ...current,
      terrainCategory: terrainCategoryOf(nextTerrain),
      terrain: nextTerrain
    }));
  }
  function setBatchBiome(nextBiome: string): void {
    setBatchDraft((current) => ({ ...current, biome: nextBiome }));
  }

  function setBatchTag(tag: TagKey, checked: boolean): void {
    setBatchDraft((current) => ({
      ...current,
      tags: checked
        ? current.tags.includes(tag)
          ? current.tags
          : [...current.tags, tag]
        : current.tags.filter((entry) => entry !== tag)
    }));
  }

  function plannedChanges(): Extract<MapCommand, { action: "patch_cells" }>["changes"] {
    return {
      ...(batchModes.terrain === "set" ? { terrain: batchDraft.terrain as TerrainKey } : {}),
      ...(batchModes.biome !== "keep"
        ? { biome: batchModes.biome === "clear" ? null : (batchDraft.biome as BiomeKey) }
        : {}),
      ...(batchModes.tags !== "keep"
        ? { tags: batchModes.tags === "clear" ? [] : batchDraft.tags }
        : {}),
      ...(batchModes.note !== "keep"
        ? { note: batchModes.note === "clear" ? "" : batchDraft.note }
        : {})
    };
  }
  function projectedCell(cell: ActiveCell): ActiveCell {
    const changes = plannedChanges();
    if (changes.tags && batchModes.tags !== "clear")
      changes.tags =
        batchTagMode === "add"
          ? [...new Set([...cell.tags, ...changes.tags])]
          : batchTagMode === "remove"
            ? cell.tags.filter((tag) => !changes.tags!.includes(tag))
            : changes.tags;
    return { ...cell, ...changes, status: changes.terrain ? "designed" : cell.status };
  }
  const plannedCount = batchSelectedCells.filter((cell) => {
    const next = projectedCell(cell);
    return (["terrain", "biome", "tags", "note"] as const).some(
      (field) =>
        JSON.stringify(field === "tags" ? [...next.tags].sort() : next[field]) !==
        JSON.stringify(field === "tags" ? [...cell.tags].sort() : cell[field])
    );
  }).length;
  async function applyBatchEdit(): Promise<MapRuntimeState | null> {
    if (!currentMap) {
      return null;
    }
    if (plannedCount === 0) {
      setMessage("所选内容没有变化");
      return null;
    }
    if (batchSelectedCells.length === 0) {
      setMessage("请先选择要批量编辑的单元格");
      return null;
    }
    const changes: Extract<MapCommand, { action: "patch_cells" }>["changes"] = {};
    if (batchModes.terrain === "set") changes.terrain = batchDraft.terrain as TerrainKey;
    if (batchModes.biome !== "keep")
      changes.biome = batchModes.biome === "clear" ? null : (batchDraft.biome as BiomeKey);
    if (batchModes.tags !== "keep")
      changes.tags = batchModes.tags === "clear" ? [] : batchDraft.tags;
    if (batchModes.note !== "keep")
      changes.note = batchModes.note === "clear" ? "" : batchDraft.note;
    if (!Object.keys(changes).length) {
      setMessage("请选择需要修改的字段");
      return null;
    }
    const submitted = draftRef.current;
    const result = await task.run(() =>
      applyCommands([
        {
          action: "patch_cells",
          source: "webui",
          ...(changes.tags && batchModes.tags !== "clear" && batchTagMode !== "replace"
            ? { tagMode: batchTagMode }
            : {}),
          targets: batchSelectedCells.map((cell) => ({ row: cell.row, col: cell.col })),
          changes
        }
      ])
    );
    if (!result) {
      return null;
    }
    setSelection(
      (current) =>
        new Map(
          [...current].map(([id, cell]) => [
            id,
            batchSelectedCellIds.has(id) ? projectedCell(cell) : cell
          ])
        )
    );
    if (draftRef.current === submitted) setBatchModes(INITIAL_MODES);
    setMessage(`已批量设置 ${batchSelectedCells.length} 个单元格并保存到服务器`);
    return result;
  }

  function setReplacementTerrainCategory(nextCategory: string): void {
    setReplaceTerrainDraft((current) => {
      const allowedTerrains = new Set(
        getFilteredTerrainEntries(nextCategory).map((entry) => entry.key)
      );
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
      replacementCategory: nextTerrain
        ? terrainCategoryOf(nextTerrain)
        : current.replacementCategory,
      replacementTerrain: nextTerrain
    }));
  }

  async function applyTerrainReplacement(): Promise<MapRuntimeState | null> {
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
    const commands: MapCommand[] = [
      {
        action: "replace_terrain",
        source: "webui",
        match: {
          terrain: replaceTerrainDraft.matchTerrain as TerrainKey
        },
        changes: {
          terrain: replaceTerrainDraft.replacementTerrain as TerrainKey
        }
      }
    ];
    const result = await task.run(async () => {
      if (confirmReplacement && !(await confirmReplacement(commands))) return null;
      return applyCommands(commands);
    });
    if (!result) {
      return null;
    }
    setMessage("地形替换已保存到服务器");
    return result;
  }

  async function applyBiomeReplacement(): Promise<MapRuntimeState | null> {
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
    const commands: MapCommand[] = [
      {
        action: "replace_biome",
        source: "webui",
        match: {
          biome: matchBiome
        },
        changes: {
          biome: replacementBiome
        }
      }
    ];
    const result = await task.run(async () => {
      if (confirmReplacement && !(await confirmReplacement(commands))) return null;
      return applyCommands(commands);
    });
    if (!result) {
      return null;
    }
    setMessage("生态替换已保存到服务器");
    return result;
  }

  useEffect(() => {
    setSelection(new Map());
    setBatchModes(INITIAL_MODES);
    updateBatchDraft({ terrainCategory: "", terrain: "", biome: "", tags: [], note: "" });
  }, [currentMap?.document.meta.id]);

  return {
    mixedFields,
    plannedCount,
    pending: task.pending,
    batchModes,
    setBatchFieldMode,
    batchTagMode,
    setBatchTagMode,
    batchDirty:
      batchSelectedCells.length > 0 && Object.values(batchModes).some((mode) => mode !== "keep"),
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
