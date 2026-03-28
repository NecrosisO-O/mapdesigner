import type { MapRuntimeState } from "@mapdesigner/map-core";
import { startTransition, useEffect, useRef, useState } from "react";
import { api, type MapListItem } from "./api.js";

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

export function useMapWorkspace(setMessage: (message: string) => void) {
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [currentMap, setCurrentMap] = useState<MapRuntimeState | null>(null);
  const [currentMapId, setCurrentMapId] = useState<string>("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [persistedRevision, setPersistedRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
          designedCellCount: currentMap.document.cells.length,
          updatedAt: currentMap.document.meta.updated_at
        }
      : map
  );

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

  function loadMapIntoWorkspace(map: MapRuntimeState): void {
    setCurrentMap(map);
    setCurrentMapId(map.document.meta.id);
    setPersistedRevision(map.document.meta.revision);
    setIsRenaming(false);
    setRenameDraft(map.document.meta.name);
  }

  async function openMap(id: string): Promise<MapRuntimeState | null> {
    setLoading(true);
    const response = await api.getMap(id);
    setLoading(false);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "打开地图失败"));
      return null;
    }
    loadMapIntoWorkspace(response.result);
    setMessage(`已打开 ${response.result.document.meta.name}`);
    return response.result;
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
    setMessage(`已新建 ${response.result.document.meta.name}`);
    return response.result;
  }

  async function saveMap(): Promise<MapRuntimeState | null> {
    if (!currentMap || persistedRevision === null) {
      return null;
    }
    const response = await api.saveMap(currentMap.document.meta.id, {
      document: currentMap.document,
      expectedRevision: persistedRevision
    });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "保存失败"));
      return null;
    }
    setCurrentMap(response.result);
    setPersistedRevision(response.result.document.meta.revision);
    setIsRenaming(false);
    setRenameDraft(response.result.document.meta.name);
    await refreshMaps(response.result.document.meta.id);
    setMessage("保存成功");
    return response.result;
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
      document: currentMap.document,
      name: name.trim()
    });
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "另存为失败"));
      return null;
    }
    await refreshMaps(response.result.document.meta.id);
    loadMapIntoWorkspace(response.result);
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
      setMessage("导入成功");
      return retryResponse.result;
    }
    await refreshMaps(response.result.document.meta.id);
    loadMapIntoWorkspace(response.result);
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
    setPersistedRevision(null);
    setIsRenaming(false);
    setRenameDraft("");
    await refreshMaps();
    setMessage("地图已删除");
    return true;
  }

  useEffect(() => {
    void refreshMaps();
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

  return {
    maps,
    currentMap,
    currentMapId,
    displayMaps,
    isRenaming,
    renameDraft,
    loading,
    mapDirty,
    fileInputRef,
    setCurrentMap,
    setRenameDraft,
    refreshMaps,
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
    deleteCurrentMap
  };
}
