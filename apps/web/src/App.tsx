import { usePanelLayout } from "./usePanelLayout.js";
import { PanelControls } from "./PanelControls.js";
import { HistoryPanel } from "./HistoryPanel.js";
import { MergeDialog } from "./MergeDialog.js";
import { Icon } from "./Icon.js";
import { useMaterialBrush } from "./useMaterialBrush.js";
import { MaterialLibrary } from "./MaterialLibrary.js";
import { ObjectBrowser } from "./ObjectBrowser.js";
import { LegendPanel, type LegendHighlight } from "./LegendPanel.js";
import type { GridCoordinate, MapCommand, RiverFeature, TagKey } from "@mapdesigner/map-core";
import { useEffect, useState } from "react";
import { Dialog, useDialogPrompt } from "./Dialog.js";
import { ToolRail } from "./ToolRail.js";
import { api } from "./api.js";
import { DetailPanel } from "./DetailPanel.js";
import { MapCanvas } from "./MapCanvas.js";
import { ExportDialog } from "./ExportDialog.js";
import { SidebarPanel } from "./SidebarPanel.js";
import { useAdvancedEditor } from "./useAdvancedEditor.js";
import { TopToolbar } from "./TopToolbar.js";
import type { InteractionMode } from "./TopToolbar.js";
import { useCellEditor } from "./useCellEditor.js";
import { useExportPanel } from "./useExportPanel.js";
import { useMapWorkspace } from "./useMapWorkspace.js";
import { RiverInspector } from "./RiverInspector.js";
import { useRiverEditor } from "./useRiverEditor.js";

export default function App() {
  const [message, setMessage] = useState<string>("准备就绪");
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [showShorthand, setShowShorthand] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showUndesigned, setShowUndesigned] = useState(true);
  const [tagFilter, setTagFilter] = useState<TagKey[]>([]);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("select");
  const prompt = useDialogPrompt();
  const [contentOpen, setContentOpen] = useState(() => window.innerWidth > 760),
    [inspectorOpen, setInspectorOpen] = useState(false);
  const panelLayout = usePanelLayout();
  const [contentTab, setContentTab] = useState<"materials" | "objects" | "legend" | "display">(
    "materials"
  );
  const [layers, setLayers] = useState({ terrain: true, biomes: true, rivers: true, tags: true });
  const [highlight, setHighlight] = useState<LegendHighlight | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ coord: GridCoordinate; token: number } | null>(
    null
  );
  const [inspectorTab, setInspectorTab] = useState<"cell" | "batch" | "river">("cell");
  const [focusMode, setFocusMode] = useState(false),
    [dark, setDark] = useState(false),
    [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const workspace = useMapWorkspace(setMessage);
  const activeMap = workspace.visibleMap ?? workspace.currentMap;
  const materialBrush = useMaterialBrush(workspace.applyCommands, setMessage);
  const editor = useCellEditor(activeMap, workspace.applyCommands, setMessage, {
    enabled: interactionMode === "format-brush",
    setEnabled: (enabled) => setInteractionMode(enabled ? "format-brush" : "select"),
    confirmDiscard: async () =>
      !!(await prompt.ask({
        title: "放弃单元格草稿？",
        message: "当前单元格还有未应用修改。",
        confirm: "放弃修改"
      }))
  });
  const advancedEditor = useAdvancedEditor(
    activeMap,
    workspace.applyCommands,
    setMessage,
    confirmReplacement
  );
  const riverEditor = useRiverEditor(activeMap, workspace.applyCommands, setMessage);
  const exportPanel = useExportPanel(setMessage);

  function revealInspector(): void {
    setInspectorOpen(true);
    setFocusMode(false);
    if (!panelLayout.pinned || window.innerWidth <= 1180) setContentOpen(false);
  }

  useEffect(() => {
    let previousWidth = window.innerWidth;
    const resize = () => {
      const width = window.innerWidth;
      if (width <= 1180 && previousWidth > 1180) setContentOpen(false);
      if (width <= 760 && previousWidth > 760) setInspectorOpen(false);
      previousWidth = width;
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function updateEditorDraftFromMap(nextMap: NonNullable<typeof workspace.currentMap>): void {
    if (!editor.selectedCell) {
      return;
    }
    editor.syncDraftFromCell(
      nextMap.activeCells.find((cell) => cell.id === editor.selectedCell?.id) ?? editor.selectedCell
    );
  }

  const hasDrafts =
    workspace.mapDirty || editor.cellDirty || riverEditor.riverDirty || advancedEditor.batchDirty;
  async function ensureCanLeave(): Promise<boolean> {
    if (
      workspace.pendingCount ||
      editor.pending ||
      riverEditor.pending ||
      advancedEditor.pending ||
      workspace.loading
    ) {
      setMessage("请等待当前操作完成");
      return false;
    }
    if (!hasDrafts) return true;
    const decision = await prompt.ask({
      title: "有未应用的修改",
      message: "继续会放弃当前名称、单元格、批量和河流草稿。取消可以返回编辑。",
      confirm: "放弃并继续"
    });
    if (!decision) return false;
    editor.syncDraftFromCell(editor.selectedCell);
    riverEditor.selectRiver(riverEditor.selectedRiverId);
    for (const field of ["terrain", "biome", "tags", "note"] as const)
      advancedEditor.setBatchFieldMode(field, "keep");
    if (workspace.mapDirty) workspace.renameCurrentMap(workspace.mapSummary!.meta.name);
    return true;
  }
  async function changeTool(mode: InteractionMode): Promise<void> {
    if (mode === interactionMode) return;
    if (workspace.pendingCount || editor.pending || riverEditor.pending || advancedEditor.pending) {
      setMessage("请等待当前操作完成");
      return;
    }
    if (mode === "format-brush" && editor.cellDirty) {
      setMessage("先应用当前格子的修改，再复制其格式。");
      return;
    }
    if (mode === "format-brush" && !editor.canUseFormatBrush) {
      setMessage("请先选中已设计格作为格式刷来源");
      return;
    }
    if (
      mode === "river-draw" &&
      riverEditor.riverDirty &&
      riverEditor.riverDrawingStatus !== "drawing"
    ) {
      if (
        !(await prompt.ask({
          title: "开始新的河流？",
          message: "当前河流属性还有未应用修改。",
          confirm: "放弃并绘制"
        }))
      )
        return;
    }
    setInteractionMode(mode);
    setFocusMode(false);
    if (mode === "brush") {
      setContentTab("materials");
      setContentOpen(true);
      if (!panelLayout.pinned || window.innerWidth <= 1180) setInspectorOpen(false);
    }
    if (mode === "batch-select" || mode === "format-brush") {
      setInspectorTab(mode === "batch-select" ? "batch" : "cell");
      revealInspector();
    }
    if (mode === "river-draw") {
      setLayers((current) => ({ ...current, rivers: true }));
      setInspectorTab("river");
      riverEditor.startRiverDrawing();
      if (window.innerWidth > 760) revealInspector();
      else {
        setContentOpen(false);
        setInspectorOpen(false);
      }
    }
  }
  async function selectKnownRiver(river: RiverFeature, locate = true): Promise<void> {
    if (
      river.id !== riverEditor.selectedRiverId &&
      riverEditor.riverDirty &&
      !(await prompt.ask({
        title: "切换河流？",
        message: "当前河流还有未应用修改。",
        confirm: "放弃并切换"
      }))
    )
      return;
    if (river.id !== riverEditor.selectedRiverId) riverEditor.selectRiver(river.id, river);
    setInteractionMode("select");
    setInspectorTab("river");
    revealInspector();
    const point = river.points[Math.floor(river.points.length / 2)];
    if (point && locate) setFocusRequest({ coord: point, token: Date.now() });
  }
  function panelHeader(title: string, onClose: () => void, closeLabel: string) {
    return (
      <PanelControls
        title={title}
        pinned={panelLayout.pinned}
        drawer={panelLayout.drawer}
        onPin={panelLayout.togglePin}
        onDrawer={() => panelLayout.setDrawer(panelLayout.drawer === "half" ? "full" : "half")}
        onClose={onClose}
        closeLabel={closeLabel}
      />
    );
  }
  async function moveHistory(direction: "undo" | "redo"): Promise<void> {
    if (!(await ensureCanLeave())) return;
    const result = await (direction === "undo"
      ? workspace.undoCurrentMap()
      : workspace.redoCurrentMap());
    if (result) {
      updateEditorDraftFromMap(result);
      if (result.confirmedFeatures) riverEditor.acceptConfirmedFeatures(result.confirmedFeatures);
    }
  }
  async function confirmReplacement(commands: MapCommand[]): Promise<boolean> {
    if (!workspace.currentMapId) return false;
    const response = await api.applyCommands(workspace.currentMapId, commands, {
      dryRun: true,
      includeMap: false,
      expectedRevision: workspace.mapSummary?.meta.revision
    });
    if (!response.ok || !response.result) {
      setMessage(response.errors[0]?.message ?? "预览失败");
      return false;
    }
    return !!(await prompt.ask({
      title: "确认全图替换",
      message:
        "将修改全图 " +
        response.result.stats.changed_count +
        " 格。" +
        response.warnings.map((item) => item.message).join("；"),
      confirm: "执行替换"
    }));
  }
  async function configureAccess(): Promise<void> {
    const token = await prompt.ask({
      title: "连接设置",
      message: "输入服务器配置的访问令牌。本窗口关闭后自动清除。",
      initial: "",
      secret: true,
      confirm: "连接"
    });
    if (!token) return;
    sessionStorage.setItem("mapdesigner-access-token", token);
    await workspace.refreshMaps();
  }
  useEffect(() => {
    setInteractionMode("select");
    setInspectorTab("cell");
  }, [workspace.currentMapId]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        historyOpen ||
        mergeOpen ||
        prompt.open ||
        helpOpen ||
        exportPanel.exportPanelOpen ||
        (event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      const command = event.metaKey || event.ctrlKey,
        key = event.key.toLowerCase();
      if (command && key === "z") {
        event.preventDefault();
        void moveHistory(event.shiftKey ? "redo" : "undo");
      } else if (command && key === "s") {
        event.preventDefault();
        void workspace.saveMap();
      } else if (command && key === "enter") {
        event.preventDefault();
        void editor.applyDraft();
      } else if (!command && !event.altKey) {
        const tools: Record<string, InteractionMode> = {
          v: "select",
          h: "pan",
          b: "brush",
          i: "sample",
          r: "river-draw",
          m: "batch-select"
        };
        if (tools[key]) {
          event.preventDefault();
          void changeTool(tools[key]!);
        }
        if (key === "?") setHelpOpen(true);
        if (key === "escape" && window.innerWidth < 760) {
          setContentOpen(false);
          setInspectorOpen(false);
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (hasDrafts || workspace.pendingCount) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts, workspace.pendingCount]);

  async function handleCreateMap(): Promise<void> {
    if (!(await ensureCanLeave())) return;
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
    if (!(await ensureCanLeave())) {
      return;
    }
    const result = await workspace.openMap(nextId);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (!(await ensureCanLeave())) return;
    const name = await prompt.ask({
      title: "另存为",
      initial: (workspace.currentMap?.document.meta.name ?? "地图") + " Copy"
    });
    if (!name) return;
    const result = await workspace.saveMapAs(name);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleImportFile(file: File): Promise<void> {
    if (!(await ensureCanLeave())) return;
    const result = await workspace.importFile(file);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleDuplicateMap(): Promise<void> {
    if (!(await ensureCanLeave())) return;
    const result = await workspace.duplicateMap();
    if (result) {
      editor.disableFormatBrush();
    }
  }

  async function handleDeleteMap(): Promise<void> {
    if (!(await ensureCanLeave())) return;
    if (
      !(await prompt.ask({
        title: "删除地图",
        message:
          "确定删除「" +
          workspace.currentMap?.document.meta.name +
          "」及其全部历史？此操作无法撤销。",
        danger: true,
        confirm: "确认删除"
      }))
    )
      return;
    const deleted = await workspace.deleteCurrentMap(true);
    if (deleted) {
      editor.resetEditor();
    }
  }

  return (
    <div
      className={"app-shell" + (dark ? " theme-dark" : "") + (focusMode ? " focus-mode" : "")}
      style={panelLayout.style}
      data-drawer={panelLayout.drawer}
      data-content-open={contentOpen}
      data-inspector-open={inspectorOpen}
    >
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
        onSaveMap={() =>
          void (workspace.mapDirty
            ? workspace.saveMap()
            : editor.cellDirty
              ? editor.applyDraft()
              : riverEditor.riverDirty
                ? riverEditor.applyRiverDraft()
                : advancedEditor.applyBatchEdit())
        }
        onSaveAs={() => void handleSaveAs()}
        onStartRenaming={workspace.startRenaming}
        onRenameDraftChange={workspace.setRenameDraft}
        onConfirmRename={() => workspace.renameCurrentMap(workspace.renameDraft)}
        onCancelRename={workspace.cancelRenaming}
        onImportFile={(file) => void handleImportFile(file)}
        onDuplicateMap={() => void handleDuplicateMap()}
        onMergeMap={() =>
          void (async () => {
            if (await ensureCanLeave()) setMergeOpen(true);
          })()
        }
        onDeleteMap={() => void handleDeleteMap()}
        interactionMode={interactionMode}
        onInteractionModeChange={(mode) => void changeTool(mode)}
        onUndo={() => void moveHistory("undo")}
        onRedo={() => void moveHistory("redo")}
        error={workspace.writeError}
        onRetry={
          workspace.canRetryCommands
            ? () =>
                void (editor.cellDirty
                  ? editor.applyDraft()
                  : riverEditor.riverDirty
                    ? riverEditor.applyRiverDraft()
                    : advancedEditor.batchDirty
                      ? advancedEditor.applyBatchEdit()
                      : workspace.retryLastCommands())
            : workspace.mapDirty
              ? () => void workspace.saveMap()
              : undefined
        }
        pending={workspace.pendingCount > 0}
        onExport={() => exportPanel.setExportPanelOpen(true)}
        onToggleTheme={() => setDark((value) => !value)}
        onToggleFocus={() => setFocusMode((value) => !value)}
        onAccessToken={() => void configureAccess()}
        onHistory={() => setHistoryOpen(true)}
      />

      {(workspace.importProgress ||
        (exportPanel.isExportingPng && !exportPanel.exportPanelOpen)) && (
        <div className="task-progress" role="status">
          {workspace.importProgress || exportPanel.progress || "准备导出"}
          <button
            onClick={workspace.importProgress ? workspace.cancelImport : exportPanel.cancelExport}
          >
            取消任务
          </button>
        </div>
      )}
      <div className="panel-toggles">
        <button
          onClick={() => {
            setContentOpen((value) => !value);
            if (!contentOpen && (!panelLayout.pinned || window.innerWidth <= 1180))
              setInspectorOpen(false);
            setFocusMode(false);
          }}
          aria-expanded={contentOpen}
        >
          <Icon name="library" size={17} /> 材料与对象
        </button>
        <button
          onClick={() => {
            setInspectorOpen((value) => !value);
            if (!inspectorOpen && (!panelLayout.pinned || window.innerWidth <= 1180))
              setContentOpen(false);
            setFocusMode(false);
          }}
          aria-expanded={inspectorOpen}
        >
          <Icon name="inspector" size={17} /> 属性
        </button>
        <div className="tool-context">
          <strong>
            {
              {
                select:
                  inspectorTab === "river" && riverEditor.selectedRiver
                    ? "河流 · " + riverEditor.selectedRiver.name
                    : editor.selectedCell
                      ? editor.selectedCell.display_coord
                      : "选择对象",
                pan: "平移地图",
                brush: "材料笔刷",
                "format-brush": "格式刷",
                sample: "取样材料",
                "river-draw": "绘制河流",
                "batch-select": "多选格子"
              }[interactionMode]
            }
          </strong>
          {interactionMode === "brush" ? (
            <>
              <label>
                范围
                <select
                  aria-label="笔刷范围"
                  value={materialBrush.radius}
                  onChange={(e) => materialBrush.setRadius(Number(e.target.value))}
                >
                  <option value="0">单格</option>
                  <option value="1">7 格</option>
                  <option value="2">19 格</option>
                </select>
              </label>
              {(["terrain", "biome"] as const).map((key) => (
                <label className="checkbox-row" key={key}>
                  <input
                    type="checkbox"
                    checked={materialBrush.fields[key]}
                    onChange={(e) => {
                      if (
                        e.target.checked ||
                        materialBrush.fields[key === "terrain" ? "biome" : "terrain"]
                      )
                        materialBrush.setFields((current) => ({
                          ...current,
                          [key]: e.target.checked
                        }));
                    }}
                  />
                  {key === "terrain" ? "地形" : "生态"}
                </label>
              ))}
            </>
          ) : (
            <span>
              {
                {
                  select:
                    inspectorTab === "river" && riverEditor.selectedRiver
                      ? "选择节点调整路径与宽度"
                      : editor.selectedCell
                        ? "在属性面板修改地形与生态"
                        : "点击格子或河流查看属性",
                  pan: "拖动地图 · 滚轮缩放",
                  brush: "",
                  "format-brush": "拖动复制选中字段",
                  sample: "点击已设计格取样",
                  "river-draw": "点击添加节点 · Enter 完成 · Esc 取消",
                  "batch-select": "点击格子增减选择"
                }[interactionMode]
              }
            </span>
          )}
        </div>
      </div>
      <main
        className="layout"
        inert={prompt.open || helpOpen || historyOpen || mergeOpen || exportPanel.exportPanelOpen}
      >
        <ToolRail
          mode={interactionMode}
          disabled={!activeMap || workspace.pendingCount > 0}
          onChange={(mode) => void changeTool(mode)}
          onHelp={() => setHelpOpen(true)}
        />
        <SidebarPanel
          tab={contentTab}
          onTabChange={setContentTab}
          panelHeader={panelHeader("材料与对象", () => setContentOpen(false), "关闭内容栏")}
          resizeHandle={
            <div className="panel-resize-edge right" {...panelLayout.resizeProps("left")} />
          }
          materialLibrary={
            <MaterialLibrary
              brush={materialBrush}
              style={activeMap?.document.meta.map_style ?? "classic-v1"}
              onPaint={() => void changeTool("brush")}
            />
          }
          objectBrowser={
            <ObjectBrowser
              mapId={workspace.currentMapId}
              revision={workspace.mapSummary?.meta.revision ?? 0}
              range={workspace.visibleRange}
              selectedId={riverEditor.selectedRiverId}
              onSelect={(river) => void selectKnownRiver(river)}
              onCreate={() => void changeTool("river-draw")}
            />
          }
          legend={<LegendPanel map={activeMap} highlight={highlight} onHighlight={setHighlight} />}
          layers={layers}
          onLayerChange={(key, visible) => setLayers((current) => ({ ...current, [key]: visible }))}
          currentMap={workspace.currentMap}
          showCoordinates={showCoordinates}
          showShorthand={showShorthand}
          showGrid={showGrid}
          showUndesigned={showUndesigned}
          onMapStyleChange={(style) => {
            void workspace.applyCommands([{ action: "set_map_style", style, source: "webui" }]);
          }}
          onShowCoordinatesChange={setShowCoordinates}
          onShowShorthandChange={setShowShorthand}
          onShowGridChange={setShowGrid}
          onShowUndesignedChange={setShowUndesigned}
          tagFilter={tagFilter}
          onTagFilterChange={(tag, checked) =>
            setTagFilter((current) =>
              checked
                ? current.includes(tag)
                  ? current
                  : [...current, tag]
                : current.filter((entry) => entry !== tag)
            )
          }
          onClearTagFilter={() => setTagFilter([])}
        />

        <section className="canvas-panel">
          {activeMap ? (
            <MapCanvas
              key={activeMap.document.meta.id}
              map={activeMap}
              overview={workspace.overview}
              mapSummary={workspace.mapSummary}
              selectedCell={editor.selectedCell}
              selectedCellId={editor.selectedCellId}
              onSelectCell={(cell) => {
                if (interactionMode === "sample") {
                  if (materialBrush.sample(cell)) {
                    setInteractionMode("brush");
                    setContentTab("materials");
                    setContentOpen(true);
                    if (!panelLayout.pinned) setInspectorOpen(false);
                  }
                  return;
                }
                void editor.handleCanvasCellSelect(cell).then((selected) => {
                  if (selected) {
                    setInspectorTab("cell");
                    revealInspector();
                  }
                });
              }}
              onBrushStroke={(cells) =>
                void (interactionMode === "format-brush"
                  ? editor.applyFormatBrushStroke(cells)
                  : materialBrush.paint(cells))
              }
              brushRadius={interactionMode === "brush" ? materialBrush.radius : 0}
              brushMaterial={interactionMode === "brush" ? materialBrush.material : undefined}
              brushFields={materialBrush.fields}
              focusRequest={focusRequest}
              legendHighlight={highlight}
              showTerrain={layers.terrain}
              showBiomes={layers.biomes}
              showRivers={layers.rivers}
              showTags={layers.tags}
              interactionMode={interactionMode}
              batchSelectedCellIds={advancedEditor.batchSelectedCellIds}
              onBatchCellToggle={advancedEditor.toggleBatchCell}
              riverPreview={riverEditor.riverPreview}
              selectedRiver={
                inspectorTab === "river" &&
                interactionMode === "select" &&
                riverEditor.selectedRiverId
                  ? riverEditor.draftRiver
                  : null
              }
              selectedRiverNode={riverEditor.selectedNode}
              riverEditingDisabled={
                riverEditor.riverDirty ||
                Boolean(workspace.pendingCount || workspace.loading || riverEditor.pending)
              }
              onSelectRiver={(river) => void selectKnownRiver(river, false)}
              onSelectRiverNode={riverEditor.setSelectedNode}
              onCommitRiverPoints={(points) => void riverEditor.commitPoints(points)}
              snapRiverConnections={riverEditor.snapConnections}
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
              onVisibleRangeChange={(range) =>
                void workspace.requestVisibleRange(range, activeMap.document.meta.id)
              }
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
          activeTab={inspectorTab}
          panelHeader={panelHeader(
            inspectorTab === "river"
              ? "河流属性"
              : inspectorTab === "batch"
                ? "批量属性"
                : "格子属性",
            () => setInspectorOpen(false),
            "关闭属性"
          )}
          resizeHandle={
            <div className="panel-resize-edge left" {...panelLayout.resizeProps("right")} />
          }
          materialNotice={editor.materialNotice}
          onClose={() => setInspectorOpen(false)}
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
          riverPanel={
            <RiverInspector
              editor={riverEditor}
              cells={activeMap?.activeCells ?? []}
              rivers={activeMap?.document.features.rivers ?? []}
              disabled={
                !activeMap ||
                Boolean(workspace.pendingCount || workspace.loading || riverEditor.pending)
              }
              onStart={() => void changeTool("river-draw")}
              onFinish={() =>
                void riverEditor.finishRiverDrawing().then((done) => {
                  if (done) setInteractionMode("select");
                })
              }
              onCancel={() => {
                riverEditor.cancelRiverDrawing();
                setInteractionMode("select");
              }}
              onApply={() =>
                void riverEditor.applyRiverDraft().then((done) => {
                  if (done) setInteractionMode("select");
                })
              }
              onDelete={() =>
                void prompt
                  .ask({
                    title: "删除河流？",
                    message: "将移除所选河流，可通过撤销恢复。",
                    confirm: "删除河流"
                  })
                  .then((yes) => {
                    if (yes) void riverEditor.deleteSelectedRiver();
                  })
              }
              onBranch={() => {
                if (riverEditor.startBranch()) {
                  setInteractionMode("river-draw");
                  if (window.innerWidth <= 760) setInspectorOpen(false);
                }
              }}
              onLocate={(coord) => setFocusRequest({ coord, token: Date.now() })}
            />
          }
          batchModeActive={interactionMode === "batch-select"}
          batchSelectedCount={advancedEditor.batchSelectedCells.length}
          batchMixedFields={advancedEditor.mixedFields}
          batchPlannedCount={advancedEditor.plannedCount}
          batchTagMode={advancedEditor.batchTagMode}
          onBatchTagModeChange={advancedEditor.setBatchTagMode}
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
          onToggleFormatBrush={() =>
            void changeTool(interactionMode === "format-brush" ? "select" : "format-brush")
          }
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
          onToggleBatchMode={() =>
            void changeTool(interactionMode === "batch-select" ? "select" : "batch-select")
          }
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
      <footer className="statusbar" aria-label="当前状态">
        <span className="status-indicator" />
        <span role="status">{workspace.loading ? "加载中…" : message}</span>
        <span className="status-count">
          {workspace.mapSummary?.designed_cell_count.toLocaleString() ?? 0} 格 · 修订{" "}
          {workspace.mapSummary?.meta.revision ?? "—"}
        </span>
      </footer>
      {exportPanel.exportPanelOpen && workspace.currentMap && (
        <ExportDialog
          control={exportPanel}
          map={workspace.currentMap}
          summary={workspace.mapSummary}
          visibleRange={workspace.visibleRange}
          viewOptions={{
            includeTerrain: layers.terrain,
            includeBiomes: layers.biomes,
            includeRivers: layers.rivers,
            includeTags: layers.tags,
            includeGrid: showGrid,
            includeCoordinates: showCoordinates,
            includeShorthand: showShorthand,
            includeUndesigned: showUndesigned
          }}
        />
      )}
      {prompt.dialog}
      {mergeOpen && workspace.mapSummary && (
        <MergeDialog
          target={workspace.mapSummary}
          maps={workspace.displayMaps}
          onClose={() => setMergeOpen(false)}
          onComplete={async (summary) => {
            const result = await workspace.refreshMergedMap(summary);
            if (result) {
              updateEditorDraftFromMap(result);
              setMessage("地图已合并，可在编辑历史中整体撤销");
            }
          }}
        />
      )}
      {historyOpen && (
        <Dialog title="编辑历史" onClose={() => setHistoryOpen(false)}>
          <HistoryPanel history={workspace.mapHistory} />
        </Dialog>
      )}
      {helpOpen && (
        <Dialog title="快捷键" onClose={() => setHelpOpen(false)}>
          <p>
            选择材料后用笔刷拖动绘制；一次拖动对应一次撤销。使用取样工具复制地图上的地形和生态。窄屏可用“展开”查看完整属性，用关闭按钮返回地图。
          </p>
          <dl className="shortcut-list">
            <dt>V / H / B / I / R / M</dt>
            <dd>选择 / 平移 / 材料笔刷 / 取样 / 河流 / 多选</dd>
            <dt>空格 + 拖动</dt>
            <dd>临时平移</dd>
            <dt>方向键 / Enter</dt>
            <dd>移动焦点 / 对当前格操作</dd>
            <dt>⌘ / Ctrl + Z</dt>
            <dd>撤销；按住 Shift 重做</dd>
            <dt>⌘ / Ctrl + Enter</dt>
            <dd>应用单元格</dd>
            <dt>F / + / −</dt>
            <dd>适合画布 / 放大 / 缩小</dd>
            <dt>Escape</dt>
            <dd>取消手势或关闭对话框</dd>
          </dl>
        </Dialog>
      )}
    </div>
  );
}
