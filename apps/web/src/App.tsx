import type { MapCommand, TagKey } from "@mapdesigner/map-core";
import { useEffect, useState } from "react";
import { Dialog, useDialogPrompt } from "./Dialog.js";
import { ToolRail } from "./ToolRail.js";
import { api } from "./api.js";
import { DetailPanel } from "./DetailPanel.js";
import { MapCanvas } from "./MapCanvas.js";
import { SidebarPanel } from "./SidebarPanel.js";
import { useAdvancedEditor } from "./useAdvancedEditor.js";
import { TopToolbar } from "./TopToolbar.js";
import type { InteractionMode } from "./TopToolbar.js";
import { useCellEditor } from "./useCellEditor.js";
import { useExportPanel } from "./useExportPanel.js";
import { useMapWorkspace } from "./useMapWorkspace.js";
import { useRiverEditor } from "./useRiverEditor.js";

export default function App() {
  const [message, setMessage] = useState<string>("准备就绪");
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showShorthand, setShowShorthand] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showUndesigned, setShowUndesigned] = useState(true);
  const [tagFilter, setTagFilter] = useState<TagKey[]>([]);
  const [lastOpaqueExportBackground, setLastOpaqueExportBackground] = useState("#F4F0E6");
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("select");
  const prompt = useDialogPrompt();
  const [contentOpen, setContentOpen] = useState(() => window.innerWidth > 1180), [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 760);
  const [inspectorTab, setInspectorTab] = useState<"cell" | "batch" | "river" | "history">("cell");
  const [focusMode, setFocusMode] = useState(false), [dark, setDark] = useState(false), [helpOpen, setHelpOpen] = useState(false);
  const workspace = useMapWorkspace(setMessage);
  const activeMap = workspace.visibleMap ?? workspace.currentMap;
  const editor = useCellEditor(activeMap, workspace.applyCommands, setMessage, {
    enabled: interactionMode === "brush", setEnabled: enabled => setInteractionMode(enabled ? "brush" : "select"),
    confirmDiscard: async () => !!await prompt.ask({ title: "放弃单元格草稿？", message: "当前单元格还有未应用修改。", confirm: "放弃修改" })
  });
  const advancedEditor = useAdvancedEditor(activeMap, workspace.applyCommands, setMessage, confirmReplacement);
  const riverEditor = useRiverEditor(activeMap, workspace.applyCommands, setMessage);
  const exportPanel = useExportPanel(setMessage);

  function updateEditorDraftFromMap(nextMap: NonNullable<typeof workspace.currentMap>): void {
    if (!editor.selectedCell) {
      return;
    }
    editor.syncDraftFromCell(
      nextMap.activeCells.find((cell) => cell.id === editor.selectedCell?.id) ?? null
    );
  }

  const hasDrafts = workspace.mapDirty || editor.cellDirty || riverEditor.riverDirty || advancedEditor.batchDirty;
  async function ensureCanLeave(): Promise<boolean> {
    if (workspace.pendingCount || editor.pending || riverEditor.pending || advancedEditor.pending || workspace.loading) {
      setMessage("请等待当前操作完成"); return false;
    }
    if (!hasDrafts) return true;
    const decision = await prompt.ask({ title: "有未应用的修改", message: "继续会放弃当前名称、单元格、批量和河流草稿。取消可以返回编辑。", confirm: "放弃并继续" });
    if (!decision) return false;
    editor.syncDraftFromCell(editor.selectedCell);
    riverEditor.selectRiver(riverEditor.selectedRiverId);
    for (const field of ["terrain", "biome", "tags", "note"] as const) advancedEditor.setBatchFieldMode(field, "keep");
    if (workspace.mapDirty) workspace.renameCurrentMap(workspace.mapSummary!.meta.name);
    return true;
  }
  async function changeTool(mode: InteractionMode): Promise<void> {
    if (mode === interactionMode || !await ensureCanLeave()) return;
    if (mode === "brush" && !editor.canUseFormatBrush) { setMessage("请先选择一个已设计单元格作为笔刷来源"); return; }
    if (riverEditor.riverDrawingStatus === "drawing") riverEditor.cancelRiverDrawing();
    setInteractionMode(mode);
    setInspectorTab(mode === "river-draw" ? "river" : mode === "batch-select" ? "batch" : "cell");
    if (mode === "river-draw") riverEditor.startRiverDrawing();
  }
  async function moveHistory(direction: "undo" | "redo"): Promise<void> {
    if (!await ensureCanLeave()) return;
    const result = await (direction === "undo" ? workspace.undoCurrentMap() : workspace.redoCurrentMap());
    if (result) updateEditorDraftFromMap(result);
  }
  async function confirmReplacement(commands: MapCommand[]): Promise<boolean> {
    if (!workspace.currentMapId) return false;
    const response = await api.applyCommands(workspace.currentMapId, commands, { dryRun: true, includeMap: false, expectedRevision: workspace.mapSummary?.meta.revision });
    if (!response.ok || !response.result) { setMessage(response.errors[0]?.message ?? "预览失败"); return false; }
    return !!await prompt.ask({ title: "确认全图替换", message: "将修改全图 " + response.result.stats.changed_count + " 格。" + response.warnings.map(item => item.message).join("；"), confirm: "执行替换" });
  }
  async function configureAccess(): Promise<void> {
    const token = await prompt.ask({ title: "连接设置", message: "输入服务器配置的访问令牌。本窗口关闭后自动清除。", initial: "", secret: true, confirm: "连接" });
    if (!token) return;
    sessionStorage.setItem("mapdesigner-access-token", token); await workspace.refreshMaps();
  }
  useEffect(() => { setInteractionMode("select"); setInspectorTab("cell"); }, [workspace.currentMapId]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (prompt.open || helpOpen || exportPanel.exportPanelOpen || (event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
      const command = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
      if (command && key === "z") { event.preventDefault(); void moveHistory(event.shiftKey ? "redo" : "undo"); }
      else if (command && key === "s") { event.preventDefault(); void workspace.saveMap(); }
      else if (command && key === "enter") { event.preventDefault(); void editor.applyDraft(); }
      else if (!command && !event.altKey) {
        const tools: Record<string, InteractionMode> = { v: "select", h: "pan", b: "brush", r: "river-draw", m: "batch-select" };
        if (tools[key]) { event.preventDefault(); void changeTool(tools[key]!); }
        if (key === "?") setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (hasDrafts || workspace.pendingCount) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts, workspace.pendingCount]);

  async function handleCreateMap(): Promise<void> {
    if (!await ensureCanLeave()) return;
    const name = await prompt.ask({ title: "新建地图", initial: "", confirm: "创建" });
    if (!name) return;
    const result = await workspace.createMap(name);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleSelectMap(mapId: string): Promise<void> {
    const nextId = mapId.trim();
    if (!nextId) {
      return;
    }
    if (!await ensureCanLeave()) {
      return;
    }
    const result = await workspace.openMap(nextId);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (!await ensureCanLeave()) return;
    const name = await prompt.ask({ title: "另存为", initial: (workspace.currentMap?.document.meta.name ?? "地图") + " Copy" });
    if (!name) return;
    const result = await workspace.saveMapAs(name);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleImportFile(file: File): Promise<void> {
    if (!await ensureCanLeave()) return;
    const result = await workspace.importFile(file);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleDuplicateMap(): Promise<void> {
    if (!await ensureCanLeave()) return;
    const result = await workspace.duplicateMap();
    if (result) {
      editor.disableFormatBrush();
    }
  }

  async function handleDeleteMap(): Promise<void> {
    if (!await ensureCanLeave()) return;
    if (!await prompt.ask({ title: "删除地图", message: "确定删除「" + workspace.currentMap?.document.meta.name + "」及其全部历史？此操作无法撤销。", danger: true, confirm: "确认删除" })) return;
    const deleted = await workspace.deleteCurrentMap(true);
    if (deleted) {
      editor.resetEditor();
    }
  }

  return (
    <div className={"app-shell" + (dark ? " theme-dark" : "") + (focusMode ? " focus-mode" : "")} data-content-open={contentOpen} data-inspector-open={inspectorOpen}>
      <TopToolbar
        currentMap={workspace.currentMap}
        mapHistory={workspace.mapHistory}
        currentMapId={workspace.currentMapId}
        displayMaps={workspace.displayMaps}
        mapDirty={hasDrafts}
        isRenaming={workspace.isRenaming}
        renameDraft={workspace.renameDraft}
        fileInputRef={workspace.fileInputRef}
        onCreateMap={() => void handleCreateMap()}
        onSelectMap={(mapId) => void handleSelectMap(mapId)}
        onSaveMap={() => void (workspace.mapDirty ? workspace.saveMap() : editor.cellDirty ? editor.applyDraft() : riverEditor.riverDirty ? riverEditor.applyRiverDraft() : advancedEditor.applyBatchEdit())}
        onSaveAs={() => void handleSaveAs()}
        onStartRenaming={workspace.startRenaming}
        onRenameDraftChange={workspace.setRenameDraft}
        onConfirmRename={() => workspace.renameCurrentMap(workspace.renameDraft)}
        onCancelRename={workspace.cancelRenaming}
        onImportFile={(file) => void handleImportFile(file)}
        onDuplicateMap={() => void handleDuplicateMap()}
        onDeleteMap={() => void handleDeleteMap()}
        interactionMode={interactionMode}
        onInteractionModeChange={mode => void changeTool(mode)}
        onUndo={() => void moveHistory("undo")} onRedo={() => void moveHistory("redo")}
        pending={workspace.pendingCount > 0}
        onExport={() => exportPanel.setExportPanelOpen(true)}
        onToggleTheme={() => setDark(value => !value)} onToggleFocus={() => setFocusMode(value => !value)}
        onAccessToken={() => void configureAccess()}

      />

      {(workspace.importProgress || exportPanel.isExportingPng) && <div className="task-progress" role="status">
        {workspace.importProgress || exportPanel.progress || "准备导出"}
        <button onClick={workspace.importProgress ? workspace.cancelImport : exportPanel.cancelExport}>取消任务</button>
      </div>}
      <div className="panel-toggles"><button onClick={() => { setContentOpen(value => !value); setFocusMode(false); }} aria-expanded={contentOpen}>内容与图层</button><button onClick={() => { setInspectorOpen(value => !value); setFocusMode(false); }} aria-expanded={inspectorOpen}>属性</button></div>
      <main className="layout" inert={prompt.open || helpOpen}>
        <ToolRail mode={interactionMode} disabled={!activeMap || workspace.pendingCount > 0} onChange={mode => void changeTool(mode)} onHelp={() => setHelpOpen(true)} />
        <SidebarPanel
          onClose={() => setContentOpen(false)}
          onSelectRiver={id => { riverEditor.selectRiver(id); setInspectorTab("river"); setInspectorOpen(true); }}
          onExportJson={() => void exportPanel.handleExportJson(workspace.currentMap)}
          loading={workspace.loading}
          message={message}
          currentMap={workspace.currentMap}
          mapSummary={workspace.mapSummary}
          mapDirty={workspace.mapDirty}
          showCoordinates={showCoordinates}
          showShorthand={showShorthand}
          showGrid={showGrid}
          showUndesigned={showUndesigned}
          onShowCoordinatesChange={setShowCoordinates}
          onShowShorthandChange={setShowShorthand}
          onShowGridChange={setShowGrid}
          onShowUndesignedChange={setShowUndesigned}
          exportPanelOpen={exportPanel.exportPanelOpen}
          isExportingPng={exportPanel.isExportingPng}
          pngOptions={exportPanel.pngOptions}
          pngRangeMode={exportPanel.pngRangeMode}
          lastOpaqueBackground={lastOpaqueExportBackground}
          tagFilter={tagFilter}
          onToggleExportPanel={() => exportPanel.setExportPanelOpen((current) => !current)}
          onExportPng={() => void exportPanel.handleExportPng(workspace.currentMap, workspace.visibleRange)}
          onPngRangeModeChange={exportPanel.setPngRangeMode}
          onPresetChange={(preset) =>
            exportPanel.setPngOptions((current) => ({
              ...current,
              preset,
              includeCoordinates: preset === "reference" ? true : current.includeCoordinates,
              includeShorthand: preset === "reference" ? true : current.includeShorthand
            }))
          }
          onScaleChange={(scale) =>
            exportPanel.setPngOptions((current) => ({
              ...current,
              scale
            }))
          }
          onPaddingChange={(padding) =>
            exportPanel.setPngOptions((current) => ({
              ...current,
              padding
            }))
          }
          onBackgroundChange={(background) => {
            if (background !== "transparent") {
              setLastOpaqueExportBackground(background);
            }
            exportPanel.setPngOptions((current) => ({
              ...current,
              background
            }));
          }}
          onIncludeGridChange={(includeGrid) =>
            exportPanel.setPngOptions((current) => ({
              ...current,
              includeGrid
            }))
          }
          onIncludeUndesignedChange={(includeUndesigned) =>
            exportPanel.setPngOptions((current) => ({
              ...current,
              includeUndesigned
            }))
          }
          onIncludeCoordinatesChange={(includeCoordinates) =>
            exportPanel.setPngOptions((current) => ({
              ...current,
              includeCoordinates
            }))
          }
          onIncludeShorthandChange={(includeShorthand) =>
            exportPanel.setPngOptions((current) => ({
              ...current,
              includeShorthand
            }))
          }
          onTagFilterChange={(tag, checked) =>
            setTagFilter((current) =>
              checked ? (current.includes(tag) ? current : [...current, tag]) : current.filter((entry) => entry !== tag)
            )
          }
          onClearTagFilter={() => setTagFilter([])}
        />

        <section className="canvas-panel">
          {activeMap ? (
            <MapCanvas
              map={activeMap}
              mapSummary={workspace.mapSummary}
              selectedCell={editor.selectedCell}
              selectedCellId={editor.selectedCellId}
              onSelectCell={cell => { void editor.handleCanvasCellSelect(cell); setInspectorTab("cell"); }}
              onBrushStroke={cells => void editor.applyFormatBrushStroke(cells)}
              interactionMode={interactionMode}
              batchSelectedCellIds={advancedEditor.batchSelectedCellIds}
              onBatchCellToggle={advancedEditor.toggleBatchCell}
              riverPreview={riverEditor.riverPreview}
              riverDrawingPointCount={riverEditor.riverDrawingPoints.length}
              onRiverPointAdd={riverEditor.appendRiverPoint}
              onFinishRiverDrawing={() => {
                void riverEditor.finishRiverDrawing().then((finished) => {
                  if (finished) {
                    setInteractionMode("select");
                  }
                });
              }}
              onCancelRiverDrawing={() => {
                riverEditor.cancelRiverDrawing();
                setInteractionMode("select");
              }}
              onVisibleRangeChange={(range) => void workspace.requestVisibleRange(range)}
              showCoordinates={showCoordinates}
              showShorthand={showShorthand}
              showGrid={showGrid}
              showUndesigned={showUndesigned}
              tagFilter={tagFilter}
            />
          ) : (
            <div className="empty-state">
              <h2>还没有打开地图</h2>
              <p>从顶部新建地图，或导入已有 JSON 文件开始。</p>
            </div>
          )}
        </section>

        <DetailPanel
          activeTab={inspectorTab} onTabChange={setInspectorTab} onClose={() => setInspectorOpen(false)}
          pending={workspace.pendingCount > 0}
          currentMap={activeMap}
          mapHistory={workspace.mapHistory}
          selectedCell={editor.selectedCell}
          draft={editor.draft}
          terrainCategory={editor.terrainCategory}
          filteredTerrainCategories={editor.filteredTerrainCategories}
          terrainOptions={editor.terrainOptions}
          biomeOptions={editor.biomeOptions}
          formatBrushEnabled={editor.formatBrushEnabled}
          formatBrushScope={editor.formatBrushScope}
          rivers={activeMap?.document.features?.rivers ?? []}
          selectedRiverId={riverEditor.selectedRiverId}
          riverDraft={riverEditor.riverDraft}
          riverDirty={riverEditor.riverDirty}
          riverDrawingStatus={riverEditor.riverDrawingStatus}
          riverDrawingPointCount={riverEditor.riverDrawingPoints.length}
          batchModeActive={interactionMode === "batch-select"}
          batchSelectedCount={advancedEditor.batchSelectedCells.length}
          batchTagMode={advancedEditor.batchTagMode} onBatchTagModeChange={advancedEditor.setBatchTagMode}
          batchDraft={advancedEditor.batchDraft}
          batchModes={advancedEditor.batchModes}
          onBatchFieldModeChange={advancedEditor.setBatchFieldMode}
          replaceTerrainDraft={advancedEditor.replaceTerrainDraft}
          replaceBiomeDraft={advancedEditor.replaceBiomeDraft}
          batchFilteredTerrainCategories={advancedEditor.batchFilteredTerrainCategories}
          batchTerrainOptions={advancedEditor.batchTerrainOptions}
          batchBiomeOptions={advancedEditor.batchBiomeOptions}
          replaceTerrainOptions={advancedEditor.replaceTerrainOptions}
          noneBiomeValue={advancedEditor.noneBiomeValue}
          canUseFormatBrush={editor.canUseFormatBrush}
          cellDirty={editor.cellDirty}
          onApplyDraft={() => void editor.applyDraft()}
          onRevertDraft={() => editor.syncDraftFromCell(editor.selectedCell)}
          onClearSelected={() => void editor.clearSelected()}
          onToggleFormatBrush={() => void changeTool(interactionMode === "brush" ? "select" : "brush")}
          onFormatBrushScopeChange={editor.setFormatBrushScopeField}
          onTerrainCategoryChange={editor.handleTerrainCategoryChange}
          onTerrainChange={editor.handleTerrainChange}
          onBiomeChange={editor.handleBiomeChange}
          onTagChange={(tagKey, checked) =>
            editor.setDraft((current) => ({
              ...current,
              tags: checked
                ? [...current.tags, tagKey]
                : current.tags.filter((tag) => tag !== tagKey)
            }))
          }
          onNoteChange={(value) =>
            editor.setDraft((current) => ({
              ...current,
              note: value
            }))
          }
          onSelectRiver={(id) => {
            riverEditor.selectRiver(id);
            setInteractionMode("select");
          }}
          onStartNewRiver={() => {
            riverEditor.startNewRiver();
            setInteractionMode("select");
          }}
          onRiverDraftChange={(patch) =>
            riverEditor.setRiverDraft((current) => ({
              ...current,
              ...patch
            }))
          }
          onApplyRiverDraft={() => {
            void riverEditor.applyRiverDraft().then((applied) => {
              if (applied) {
                setInteractionMode("select");
              }
            });
          }}
          onDeleteSelectedRiver={() => {
            void riverEditor.deleteSelectedRiver().then(() => {
              setInteractionMode("select");
            });
          }}
          onStartRiverDrawing={() => void changeTool("river-draw")}
          onFinishRiverDrawing={() => {
            void riverEditor.finishRiverDrawing().then((finished) => {
              if (finished) {
                setInteractionMode("select");
              }
            });
          }}
          onCancelRiverDrawing={() => {
            riverEditor.cancelRiverDrawing();
            setInteractionMode("select");
          }}
          onToggleBatchMode={() => void changeTool(interactionMode === "batch-select" ? "select" : "batch-select")}
          onClearBatchSelection={advancedEditor.clearBatchSelection}
          onApplyBatchEdit={() => {
            void advancedEditor.applyBatchEdit().then((result) => {
              if (result) {
                updateEditorDraftFromMap(result);
              }
            });
          }}
          onBatchTerrainCategoryChange={advancedEditor.setBatchTerrainCategory}
          onBatchTerrainChange={advancedEditor.setBatchTerrain}
          onBatchBiomeChange={advancedEditor.setBatchBiome}
          onBatchTagChange={advancedEditor.setBatchTag}
          onBatchNoteChange={(value) =>
            advancedEditor.setBatchDraft((current) => ({
              ...current,
              note: value
            }))
          }
          onReplaceTerrainMatchChange={(value) =>
            advancedEditor.setReplaceTerrainDraft((current) => ({
              ...current,
              matchTerrain: value
            }))
          }
          onReplacementTerrainCategoryChange={advancedEditor.setReplacementTerrainCategory}
          onReplacementTerrainChange={advancedEditor.setReplacementTerrain}
          onApplyTerrainReplacement={() => {
            void advancedEditor.applyTerrainReplacement().then((result) => {
              if (result) {
                updateEditorDraftFromMap(result);
              }
            });
          }}
          onReplaceBiomeMatchChange={(value) =>
            advancedEditor.setReplaceBiomeDraft((current) => ({
              ...current,
              matchBiome: value
            }))
          }
          onReplacementBiomeChange={(value) =>
            advancedEditor.setReplaceBiomeDraft((current) => ({
              ...current,
              replacementBiome: value
            }))
          }
          onApplyBiomeReplacement={() => {
            void advancedEditor.applyBiomeReplacement().then((result) => {
              if (result) {
                updateEditorDraftFromMap(result);
              }
            });
          }}
          getFormatBrushLabel={editor.getFormatBrushLabel}
        />
      </main>
      <footer className="statusbar" aria-label="当前状态"><span className="status-indicator" /><span role="status">{workspace.loading ? "加载中…" : message}</span><span className="status-count">{workspace.mapSummary?.designed_cell_count.toLocaleString() ?? 0} 格 · 修订 {workspace.mapSummary?.meta.revision ?? "—"}</span></footer>
      {prompt.dialog}
      {helpOpen && <Dialog title="快捷键" onClose={() => setHelpOpen(false)}><dl className="shortcut-list"><dt>V / H / B / R / M</dt><dd>选择 / 平移 / 笔刷 / 河流 / 多选</dd><dt>空格 + 拖动</dt><dd>临时平移</dd><dt>方向键 / Enter</dt><dd>移动焦点 / 对当前格操作</dd><dt>⌘ / Ctrl + Z</dt><dd>撤销；按住 Shift 重做</dd><dt>⌘ / Ctrl + Enter</dt><dd>应用单元格</dd><dt>F / + / −</dt><dd>适合画布 / 放大 / 缩小</dd><dt>Escape</dt><dd>取消手势或关闭对话框</dd></dl></Dialog>}
    </div>
  );
}
