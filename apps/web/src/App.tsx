import {
  BIOME_ENTRIES,
  TAG_ENTRIES,
  TERRAIN_ENTRIES,
  applyCommand,
  createCellId,
  type ActiveCell,
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

function toDraft(cell: ActiveCell | null): CellDraft {
  return {
    terrain: cell?.terrain ?? "",
    biome: cell?.biome ?? "",
    tags: cell?.tags ?? [],
    note: cell?.note ?? ""
  };
}

export default function App() {
  const [maps, setMaps] = useState<MapListItem[]>([]);
  const [currentMap, setCurrentMap] = useState<MapRuntimeState | null>(null);
  const [currentMapId, setCurrentMapId] = useState<string>("");
  const [persistedRevision, setPersistedRevision] = useState<number | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CellDraft>(toDraft(null));
  const [message, setMessage] = useState<string>("准备就绪");
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showShorthand, setShowShorthand] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showUndesigned, setShowUndesigned] = useState(true);
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

  async function refreshMaps(selectId?: string): Promise<void> {
    const response = await api.listMaps();
    if (!response.ok || !response.result) {
      setMessage(response.errors[0]?.message ?? "加载地图列表失败");
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
      setMessage(response.errors[0]?.message ?? "打开地图失败");
      return;
    }
    setCurrentMap(response.result);
    setCurrentMapId(response.result.document.meta.id);
    setPersistedRevision(response.result.document.meta.revision);
    setSelectedCellId(null);
    setDraft(toDraft(null));
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
      setMessage(response.errors[0]?.message ?? "新建地图失败");
      return;
    }
    await refreshMaps(response.result.document.meta.id);
    setCurrentMap(response.result);
    setCurrentMapId(response.result.document.meta.id);
    setPersistedRevision(response.result.document.meta.revision);
    setSelectedCellId(null);
    setDraft(toDraft(null));
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
      setMessage(response.errors[0]?.message ?? "保存失败");
      return;
    }
    setCurrentMap(response.result);
    setPersistedRevision(response.result.document.meta.revision);
    await refreshMaps(response.result.document.meta.id);
    setMessage("保存成功");
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
    setDraft(
      toDraft(
        result.map.activeCells.find((cell) => cell.row === selectedCell.row && cell.col === selectedCell.col) ?? null
      )
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
    setDraft(toDraft(updatedCell));
    setMessage("单元格已清空，等待保存到文件");
  }

  async function handleImportFile(file: File): Promise<void> {
    const content = await file.text();
    const response = await api.importMap(content);
    if (!response.ok || !response.result) {
      const retry = window.confirm(`${response.errors[0]?.message ?? "导入失败"}。是否生成新 ID 后重试？`);
      if (!retry) {
        setMessage(response.errors[0]?.message ?? "导入失败");
        return;
      }
      const retryResponse = await api.importMap(content, true);
      if (!retryResponse.ok || !retryResponse.result) {
        setMessage(retryResponse.errors[0]?.message ?? "导入失败");
        return;
      }
      await refreshMaps(retryResponse.result.document.meta.id);
      setCurrentMap(retryResponse.result);
      setCurrentMapId(retryResponse.result.document.meta.id);
      setPersistedRevision(retryResponse.result.document.meta.revision);
      setMessage("导入成功");
      return;
    }
    await refreshMaps(response.result.document.meta.id);
    setCurrentMap(response.result);
    setCurrentMapId(response.result.document.meta.id);
    setPersistedRevision(response.result.document.meta.revision);
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
              if (!ensureCanLeaveMap() || !ensureCanLeaveSelection()) {
                return;
              }
              void openMap(event.target.value);
            }}
          >
            <option value="">选择地图</option>
            {maps.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </select>
          <button onClick={() => void handleSaveMap()} disabled={!mapDirty}>
            保存
          </button>
          <button
            onClick={async () => {
              if (!currentMap) {
                return;
              }
              const response = await api.exportJson(currentMap.document.meta.id);
              setMessage(response.result ? `JSON 已导出到 ${response.result.path}` : response.errors[0]?.message ?? "导出失败");
            }}
            disabled={!currentMap}
          >
            导出 JSON
          </button>
          <button
            onClick={async () => {
              if (!currentMap) {
                return;
              }
              const response = await api.exportPng(currentMap.document.meta.id, { preset: "clean" });
              setMessage(response.result ? `PNG 已导出到 ${response.result.path}` : response.errors[0]?.message ?? "导出失败");
            }}
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
                setMessage(response.errors[0]?.message ?? "复制失败");
                return;
              }
              await refreshMaps(response.result.document.meta.id);
              setCurrentMap(response.result);
              setCurrentMapId(response.result.document.meta.id);
              setPersistedRevision(response.result.document.meta.revision);
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
                setMessage(response.errors[0]?.message ?? "删除失败");
                return;
              }
              setCurrentMap(null);
              setCurrentMapId("");
              setPersistedRevision(null);
              setSelectedCellId(null);
              setDraft(toDraft(null));
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
          <section className="panel">
            <h2>显示控制</h2>
            <label><input type="checkbox" checked={showCoordinates} onChange={(event) => setShowCoordinates(event.target.checked)} />显示坐标</label>
            <label><input type="checkbox" checked={showShorthand} onChange={(event) => setShowShorthand(event.target.checked)} />显示简写</label>
            <label><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />显示网格线</label>
            <label><input type="checkbox" checked={showUndesigned} onChange={(event) => setShowUndesigned(event.target.checked)} />显示 undesigned</label>
          </section>
          <section className="panel">
            <h2>说明</h2>
            <p>滚轮缩放，拖拽平移。默认展示扩展坐标，内部编号用于程序定位。</p>
            <p>编辑单元格后只会先更新当前地图内存，点击顶部“保存”才会写回 `storage/maps`。</p>
          </section>
          <section className="panel status-panel">
            <h2>状态</h2>
            <p>{loading ? "加载中..." : message}</p>
            {currentMap ? (
              <p>
                当前地图：<strong>{currentMap.document.meta.name}</strong><br />
                Designed: {currentMap.document.cells.length} | Revision: {currentMap.document.meta.revision}
              </p>
            ) : (
              <p>当前没有打开地图。</p>
            )}
          </section>
        </aside>

        <section className="canvas-panel">
          {currentMap ? (
            <MapCanvas
              map={currentMap}
              selectedCellId={selectedCellId}
              onSelectCell={(cell) => {
                if (!ensureCanLeaveSelection()) {
                  return;
                }
                setSelectedCellId(cell.id);
                setDraft(toDraft(cell));
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
                <p>坐标：{selectedCell.display_coord}</p>
                <p>ID：{selectedCell.id}</p>
                <p>状态：{selectedCell.status}</p>
                {selectedCell.status === "undesigned" ? <p>编辑此格会扩展地图边界。</p> : null}
              </div>
            ) : (
              <p>请选择一个单元格</p>
            )}
          </section>

          <section className="panel">
            <h2>基础属性</h2>
            <label>
              Terrain
              <select
                value={draft.terrain}
                onChange={(event) => setDraft((current) => ({ ...current, terrain: event.target.value }))}
                disabled={!selectedCell}
              >
                <option value="">未设置</option>
                {Object.entries(TERRAIN_ENTRIES).map(([key, entry]) => (
                  <option key={key} value={key}>
                    {entry.label} ({entry.short})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Biome
              <select
                value={draft.biome}
                onChange={(event) => setDraft((current) => ({ ...current, biome: event.target.value }))}
                disabled={!selectedCell}
              >
                <option value="">未设置</option>
                {Object.entries(BIOME_ENTRIES).map(([key, entry]) => (
                  <option key={key} value={key}>
                    {entry.label} ({entry.short})
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="panel">
            <h2>附加信息</h2>
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
            <h2>操作</h2>
            <div className="action-row">
              <button onClick={applyDraft} disabled={!selectedCell}>
                保存修改
              </button>
              <button onClick={clearSelected} disabled={!selectedCell}>
                清空此格
              </button>
              <button onClick={() => setDraft(toDraft(selectedCell))} disabled={!selectedCell || !cellDirty}>
                取消编辑
              </button>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
