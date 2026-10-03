import type { ActiveCell, CellChangeDetail, CellRange, MapCommand, MapFeatures, MapRuntimeState, MapSummary } from "@mapdesigner/map-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiEnvelope, type CommandApplyResponse, type HistoryMoveResult, type MapHistory, type MapListItem } from "./api.js";
import { runtimeSummary, sessionRuntime, ViewportCache, type EditorSession, type RangeData } from "./editor-session.js";

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
export function formatStatusMessage(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (message === "map id is required") return "请先选择一张地图";
  if (message.includes("ENOENT:") || message.includes("/storage/maps/")) return "地图文件不存在或暂时无法读取";
  return message;
}
const keyOf = (range: CellRange) => [range.minRow, range.maxRow, range.minCol, range.maxCol].join(":");
function normalizeRange(range: CellRange): CellRange {
  const span = (min: number, max: number) => {
    min -= 6; max += 6;
    return [Math.floor(min / 24) * 24, Math.ceil((max + 1) / 24) * 24 - 1] as const;
  };
  const [minRow, maxRow] = span(range.minRow, range.maxRow), [minCol, maxCol] = span(range.minCol, range.maxCol);
  return { minRow, maxRow, minCol, maxCol };
}
function initialRange(summary: MapSummary): CellRange {
  const bounds = summary.render_bounds ?? summary.bounds;
  return normalizeRange({ minRow: bounds.min_row ?? -1, maxRow: bounds.max_row ?? 1,
    minCol: bounds.min_col ?? -1, maxCol: bounds.max_col ?? 1 });
}
const errorMessage = (response: { errors?: Array<{ message?: string }> }, fallback: string) => formatStatusMessage(response.errors?.[0]?.message, fallback);

export function useMapWorkspace(setMessage: (message: string) => void) {
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [session, setSession] = useState<EditorSession | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const generation = useRef(0), rangeRequest = useRef(0), listRequest = useRef(0);
  const cache = useRef(new ViewportCache());
  const [loading, setLoading] = useState(false), opening = useRef(false);
  const [pendingCount, setPendingCount] = useState(0), pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(new Map<string, Promise<MapRuntimeState | null>>());
  const suppressAutoOpen = useRef(false);
  const [isRenaming, setIsRenaming] = useState(false), [renameDraft, setRenameDraft] = useState("");
  const importAbort = useRef<AbortController | null>(null);
  const [importProgress, setImportProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentMap = useMemo(() => session ? sessionRuntime(session) : null, [session]);
  const currentMapId = session?.summary.meta.id ?? "";
  const mapDirty = !!session && session.nameDraft !== null && session.nameDraft !== session.summary.meta.name;
  const displayMaps = maps.map(map => map.id === currentMapId && session ? { ...map,
    name: session.nameDraft ?? session.summary.meta.name, revision: session.summary.meta.revision,
    designedCellCount: session.summary.designed_cell_count } : map);

  function publish(value: EditorSession | null): void { sessionRef.current = value; setSession(value); }
  function valid(epoch: number, id?: string): boolean { return epoch === generation.current && (!id || sessionRef.current?.summary.meta.id === id); }
  function beginSwitch(): number {
    const epoch = ++generation.current;
    rangeRequest.current++; cache.current.clear(); queue.current = Promise.resolve(); inFlight.current.clear();
    pending.current = 0; setPendingCount(0); opening.current = true; setLoading(true);
    return epoch;
  }
  function finishSwitch(epoch: number): void { if (valid(epoch)) { opening.current = false; setLoading(false); } }
  async function refreshMaps(_selectId?: string): Promise<void> {
    const seq = ++listRequest.current;
    try {
      const response = await api.listMaps();
      if (seq !== listRequest.current) return;
      if (response.ok && response.result) setMaps(response.result);
      else setMessage(errorMessage(response, "加载地图列表失败"));
    } catch { setMessage("加载地图列表失败，请重试"); }
  }
  async function readFeatures(id: string, range: CellRange, epoch: number): Promise<MapFeatures> {
    const rivers: MapFeatures["rivers"] = [];
    let offset = 0;
    while (valid(epoch)) {
      const response = await api.getMapFeaturesInRange(id, range, offset ? { limit: 1000, offset } : { limit: 1000 });
      if (!response.ok || !response.result) throw new Error(errorMessage(response, "加载地图要素失败"));
      rivers.push(...response.result.rivers);
      if (!response.result.page?.has_more) return { rivers };
      if (!response.result.page.returned) throw new Error("地图要素分页没有进展，请重试");
      offset = response.result.page.offset + response.result.page.returned;
    }
    return { rivers: [] };
  }
  async function refreshMapHistory(id = sessionRef.current?.summary.meta.id): Promise<MapHistory | null> {
    if (!id) return null;
    const epoch = generation.current;
    try {
      const response = await api.getMapHistory(id);
      if (!valid(epoch, id)) return null;
      if (!response.ok || !response.result) { setMessage(errorMessage(response, "刷新历史失败")); return null; }
      publish({ ...sessionRef.current!, history: response.result });
      return response.result;
    } catch { if (valid(epoch, id)) setMessage("刷新历史失败，请重试"); return null; }
  }
  async function refreshMapSummary(id = sessionRef.current?.summary.meta.id): Promise<MapSummary | null> {
    if (!id) return null;
    const epoch = generation.current;
    const response = await api.getMapSummary(id);
    if (!valid(epoch, id) || !response.ok || !response.result) return null;
    publish({ ...sessionRef.current!, summary: response.result });
    return response.result;
  }
  async function refreshMapFeatures(id = sessionRef.current?.summary.meta.id): Promise<MapFeatures | null> {
    const current = sessionRef.current;
    if (!id || !current) return null;
    const epoch = generation.current;
    try {
      const features = await readFeatures(id, current.range ?? initialRange(current.summary), epoch);
      if (!valid(epoch, id)) return null;
      publish({ ...sessionRef.current!, features });
      return features;
    } catch (error) { if (valid(epoch, id)) setMessage((error as Error).message); return null; }
  }
  async function readRange(id: string, range: CellRange, epoch: number): Promise<RangeData> {
    if ((range.maxRow - range.minRow + 1) * (range.maxCol - range.minCol + 1) > 40_000) {
      const response = await api.getOverview(id, range);
      if (!response.ok || !response.result) throw new Error(errorMessage(response, "加载地图概览失败"));
      return { cells: [], features: { rivers: [] }, overview: response.result };
    }
    const [response, features] = await Promise.all([api.getCellsInRange(id, range, true), readFeatures(id, range, epoch)]);
    if (!response.ok || !response.result) throw new Error(errorMessage(response, "加载可视单元格失败"));
    return { cells: response.result.cells, features, overview: null };
  }
  async function openMap(id: string): Promise<MapRuntimeState | null> {
    const epoch = beginSwitch();
    try {
      const response = await api.getMapSummary(id);
      if (!valid(epoch)) return null;
      if (!response.ok || !response.result) throw new Error(errorMessage(response, "打开地图失败"));
      const summary = response.result, range = initialRange(summary);
      const data = await readRange(id, range, epoch);
      if (!valid(epoch)) return null;
      const next: EditorSession = { summary, range, ...data, nameDraft: null, history: null };
      publish(next); suppressAutoOpen.current = false; setIsRenaming(false); setRenameDraft(summary.meta.name);
      cache.current.set(id + ":" + summary.meta.revision + ":" + keyOf(range), data);
      await refreshMapHistory(id);
      if (!valid(epoch, id)) return null;
      setMessage("已打开 " + summary.meta.name);
      return sessionRuntime(sessionRef.current!);
    } catch (error) { if (valid(epoch)) setMessage(formatStatusMessage((error as Error).message, "打开地图失败")); return null; }
    finally { finishSwitch(epoch); }
  }
  async function loadRange(range: CellRange, force = false, normalized = false): Promise<MapRuntimeState | null> {
    const current = sessionRef.current;
    if (!current) return null;
    const epoch = generation.current, id = current.summary.meta.id, seq = ++rangeRequest.current;
    const nextRange = normalized ? range : normalizeRange(range);
    const key = id + ":" + current.summary.meta.revision + ":" + keyOf(nextRange);
    if (!force && current.range && keyOf(current.range) === keyOf(nextRange)) return sessionRuntime(current);
    try {
      let data = force ? undefined : cache.current.get(key);
      if (!data) {
        data = await readRange(id, nextRange, epoch);
        if (!valid(epoch, id) || seq !== rangeRequest.current) return null;
        if (sessionRef.current!.summary.meta.revision !== current.summary.meta.revision) return null;
        cache.current.set(key, data);
      }
      if (!valid(epoch, id) || seq !== rangeRequest.current) return null;
      const next = { ...sessionRef.current!, ...data, range: nextRange };
      publish(next);
      return sessionRuntime(next);
    } catch (error) { if (valid(epoch, id) && seq === rangeRequest.current) setMessage((error as Error).message); return null; }
  }
  async function requestVisibleRange(range: CellRange, id = sessionRef.current?.summary.meta.id): Promise<void> {
    if (!opening.current && id === sessionRef.current?.summary.meta.id) await loadRange(range);
  }
  function enqueue(key: string, task: (current: EditorSession, epoch: number) => Promise<MapRuntimeState | null>): Promise<MapRuntimeState | null> {
    const current = sessionRef.current;
    if (!current || opening.current) return Promise.resolve(null);
    const epoch = generation.current, id = current.summary.meta.id, identity = epoch + ":" + key;
    const duplicate = inFlight.current.get(identity);
    if (duplicate) return duplicate;
    pending.current++; setPendingCount(pending.current);
    const operation = queue.current.then(async () => {
      if (!valid(epoch, id)) return null;
      try { return await task(sessionRef.current!, epoch); }
      catch (error) { if (valid(epoch, id)) setMessage(formatStatusMessage((error as Error).message, "操作失败，请重试")); return null; }
    }).finally(() => {
      inFlight.current.delete(identity);
      if (valid(epoch)) { pending.current--; setPendingCount(pending.current); }
    });
    inFlight.current.set(identity, operation); queue.current = operation;
    return operation;
  }
  async function acceptResult(result: CommandApplyResponse | HistoryMoveResult, epoch: number, id: string): Promise<MapRuntimeState | null> {
    if (!valid(epoch, id)) return null;
    const summary = result.summary ?? (result.map ? runtimeSummary(result.map) : (await api.getMapSummary(id)).result);
    if (!summary || !valid(epoch, id)) return null;
    const old = sessionRef.current!, changes = "changes" in result ? result.changes ?? [] : [];
    const cells = new Map(old.cells.map(cell => [cell.id, cell]));
    for (const change of changes) if (change.after) cells.set(change.cell_id, change.after);
    publish({ ...old, summary, cells: [...cells.values()], features: result.features ?? old.features });
    cache.current.clear(); rangeRequest.current++;
    if (old.range) await loadRange(old.range, true, true);
    if (!valid(epoch, id)) return null;
    await Promise.all([refreshMaps(), refreshMapHistory(id)]);
    if (!valid(epoch, id)) return null;
    const map = sessionRuntime(sessionRef.current!);
    const returned = new Map(map.activeCells.map(cell => [cell.id, cell]));
    for (const change of changes) if (change.after) returned.set(change.cell_id, change.after);
    return { ...map, activeCells: [...returned.values()] };
  }
  function applyCommands(commands: MapCommand[]): Promise<MapRuntimeState | null> {
    return enqueue("commands:" + JSON.stringify(commands), async (current, epoch) => {
      const id = current.summary.meta.id;
      const response = await api.applyCommands(id, commands, { includeMap: false, expectedRevision: current.summary.meta.revision });
      if (!valid(epoch, id)) return null;
      if (!response.ok || !response.result) { setMessage(errorMessage(response, "应用修改失败")); return null; }
      return acceptResult(response.result, epoch, id);
    });
  }
  function historyMove(direction: "undo" | "redo"): Promise<MapRuntimeState | null> {
    return enqueue(direction, async (current, epoch) => {
      const id = current.summary.meta.id;
      const response = await (direction === "undo" ? api.undoMap(id, false) : api.redoMap(id, false));
      if (!valid(epoch, id)) return null;
      if (!response.ok) { setMessage(errorMessage(response, "历史操作失败")); return null; }
      if (!response.result) { setMessage(direction === "undo" ? "没有可撤销的操作" : "没有可重做的操作"); return null; }
      const result = await acceptResult(response.result, epoch, id);
      if (result) setMessage(direction === "undo" ? "已撤销" : "已重做");
      return result;
    });
  }
  function ensureCanLeaveMap(): boolean {
    if (pending.current) { setMessage("请等待当前修改提交完成"); return false; }
    return !mapDirty || window.confirm("当前地图有未保存改动，是否放弃并切换？");
  }
  function renameCurrentMap(name: string): void {
    const current = sessionRef.current;
    if (!current || !name.trim()) return;
    publish({ ...current, nameDraft: name.trim() === current.summary.meta.name ? null : name.trim() });
    setIsRenaming(false); setRenameDraft(name.trim()); setMessage("地图名称已更新，等待保存");
  }
  function saveMap(): Promise<MapRuntimeState | null> {
    const name = sessionRef.current?.nameDraft;
    if (!name) return Promise.resolve(currentMap);
    return enqueue("metadata:" + name, async (current, epoch) => {
      const id = current.summary.meta.id;
      const response = await api.saveMapMeta(id, { expectedRevision: current.summary.meta.revision, name,
        description: current.summary.meta.description, tags: current.summary.meta.tags });
      if (!valid(epoch, id)) return null;
      if (!response.ok || !response.result) { setMessage(errorMessage(response, "保存失败")); return null; }
      publish({ ...sessionRef.current!, summary: response.result, nameDraft: sessionRef.current!.nameDraft === name ? null : sessionRef.current!.nameDraft });
      setIsRenaming(false); await refreshMaps();
      if (!valid(epoch, id)) return null;
      setMessage("保存成功"); return sessionRuntime(sessionRef.current!);
    });
  }
  async function createOrCopy(kind: "create" | "copy" | "duplicate", name?: string): Promise<MapRuntimeState | null> {
    const current = sessionRef.current;
    if (kind !== "create" && !current) return null;
    if (kind !== "duplicate" && !name) name = window.prompt(kind === "create" ? "输入新地图名称" : "输入副本地图名称", kind === "create" ? "" : (current!.nameDraft ?? current!.summary.meta.name) + " Copy") ?? undefined;
    if (kind !== "duplicate" && !name?.trim()) return null;
    const epoch = beginSwitch();
    try {
      const response = kind === "create" ? await api.createMap({ name: name!.trim() }) : kind === "copy" ? await api.saveMapAs(current!.summary.meta.id, { name: name!.trim() }) : await api.duplicateMap(current!.summary.meta.id);
      if (!valid(epoch)) return null;
      if (!response.ok || !response.result) throw new Error(errorMessage(response, "创建地图失败"));
      const map = response.result;
      publish({ summary: runtimeSummary(map), features: map.document.features, cells: map.activeCells, range: null, nameDraft: null, history: null });
      suppressAutoOpen.current = false; setIsRenaming(false); setRenameDraft(map.document.meta.name);
      await Promise.all([refreshMaps(), refreshMapHistory(map.document.meta.id)]);
      if (!valid(epoch)) return null;
      setMessage(kind === "create" ? "已新建 " + map.document.meta.name : kind === "copy" ? "已另存为 " + map.document.meta.name : "复制成功");
      return map;
    } catch (error) { if (valid(epoch)) setMessage((error as Error).message); return null; }
    finally { finishSwitch(epoch); }
  }
  async function importFile(file: File): Promise<MapRuntimeState | null> {
    if (importAbort.current) return null;
    if (file.size > 64 * 1024 * 1024) { setMessage("导入文件超过 64 MiB 限制"); return null; }
    const epoch = beginSwitch();
    const controller = new AbortController(); importAbort.current = controller;
    const control = { signal: controller.signal, onProgress: setImportProgress };
    try {
      const content = file;
      if (!valid(epoch)) return null;
      let response = await api.importMap(content, false, control);
      if (!valid(epoch)) return null;
      if (!response.ok || !response.result) {
        const message = errorMessage(response, "导入失败");
        if (!message.includes("conflict") || !window.confirm(message + "。是否生成新 ID 后重试？")) throw new Error(message);
        response = await api.importMap(content, true, control);
      }
      if (!valid(epoch)) return null;
      if (!response.ok || !response.result) throw new Error(errorMessage(response, "导入失败"));
      const result = await openMap(response.result.summary.meta.id);
      if (result) { const openedEpoch = generation.current; await refreshMaps(); if (valid(openedEpoch, result.document.meta.id)) setMessage("导入成功"); }
      return result;
    } catch (error) { if (valid(epoch)) setMessage((error as Error).message); return null; }
    finally { finishSwitch(epoch); importAbort.current = null; setImportProgress(""); }
  }
  async function deleteCurrentMap(confirmed = false): Promise<boolean> {
    const current = sessionRef.current;
    if (!current || pending.current) return false;
    if (!confirmed && !window.confirm("确认删除 " + (current.nameDraft ?? current.summary.meta.name) + " 吗？")) return false;
    const epoch = generation.current, id = current.summary.meta.id;
    const response = await api.deleteMap(id);
    if (!valid(epoch, id)) return false;
    if (!response.ok) { setMessage(errorMessage(response, "删除失败")); return false; }
    generation.current++; rangeRequest.current++; cache.current.clear(); publish(null);
    suppressAutoOpen.current = true; setIsRenaming(false); setRenameDraft("");
    await refreshMaps(); setMessage("地图已删除"); return true;
  }
  useEffect(() => { void refreshMaps(); return () => { generation.current++; listRequest.current++; rangeRequest.current++; }; }, []);
  useEffect(() => { if (maps.length && !sessionRef.current && !opening.current && !suppressAutoOpen.current) void openMap(maps[0]!.id); }, [maps]);
  useEffect(() => { if (!isRenaming) setRenameDraft(currentMap?.document.meta.name ?? ""); }, [currentMap?.document.meta.name, isRenaming]);
  return {
    importProgress, cancelImport: () => importAbort.current?.abort(),
    overview: session?.overview ?? null,
    maps, currentMap, visibleMap: currentMap, currentMapId, mapSummary: session?.summary ?? null,
    mapHistory: session?.history ?? null, displayMaps, isRenaming, renameDraft, loading, pendingCount, mapDirty,
    visibleRange: session?.range ?? null, fileInputRef, setRenameDraft,
    setCurrentMap: (map: MapRuntimeState | null) => publish(map ? { summary: runtimeSummary(map), features: map.document.features, cells: map.activeCells, range: null, nameDraft: null, history: null } : null),
    refreshMaps, refreshMapSummary, refreshMapFeatures, refreshMapHistory, requestVisibleRange, openMap, ensureCanLeaveMap,
    createMap: (name?: string) => createOrCopy("create", name), saveMap, saveMapAs: (name?: string) => createOrCopy("copy", name),
    duplicateMap: () => createOrCopy("duplicate"), importFile, deleteCurrentMap, applyCommands,
    undoCurrentMap: () => historyMove("undo"), redoCurrentMap: () => historyMove("redo"), renameCurrentMap,
    startRenaming: () => { if (currentMap) { setIsRenaming(true); setRenameDraft(currentMap.document.meta.name); } },
    cancelRenaming: () => { setIsRenaming(false); setRenameDraft(currentMap?.document.meta.name ?? ""); }
  };
}
