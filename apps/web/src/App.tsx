import { redo, undo, type TagKey } from "@mapdesigner/map-core";
import { useState } from "react";
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
  const workspace = useMapWorkspace(setMessage);
  const editor = useCellEditor(workspace.currentMap, workspace.setCurrentMap, setMessage);
  const advancedEditor = useAdvancedEditor(workspace.currentMap, workspace.setCurrentMap, setMessage);
  const riverEditor = useRiverEditor(workspace.currentMap, workspace.setCurrentMap, setMessage);
  const exportPanel = useExportPanel(setMessage);

  function updateEditorDraftFromMap(nextMap: NonNullable<typeof workspace.currentMap>): void {
    if (!editor.selectedCell) {
      return;
    }
    editor.syncDraftFromCell(
      nextMap.activeCells.find((cell) => cell.id === editor.selectedCell?.id) ?? null
    );
  }

  async function handleCreateMap(): Promise<void> {
    const result = await workspace.createMap();
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleSelectMap(mapId: string): Promise<void> {
    const nextId = mapId.trim();
    if (!nextId) {
      return;
    }
    if (!workspace.ensureCanLeaveMap() || !editor.ensureCanLeaveSelection()) {
      return;
    }
    const result = await workspace.openMap(nextId);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (
      editor.cellDirty &&
      !window.confirm("当前单元格表单还有未应用修改，另存为不会包含这些修改。是否继续？")
    ) {
      return;
    }
    const result = await workspace.saveMapAs();
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleImportFile(file: File): Promise<void> {
    const result = await workspace.importFile(file);
    if (result) {
      editor.resetEditor();
    }
  }

  async function handleDuplicateMap(): Promise<void> {
    const result = await workspace.duplicateMap();
    if (result) {
      editor.disableFormatBrush();
    }
  }

  async function handleDeleteMap(): Promise<void> {
    const deleted = await workspace.deleteCurrentMap();
    if (deleted) {
      editor.resetEditor();
    }
  }

  return (
    <div className="app-shell">
      <TopToolbar
        currentMap={workspace.currentMap}
        currentMapId={workspace.currentMapId}
        displayMaps={workspace.displayMaps}
        mapDirty={workspace.mapDirty}
        isRenaming={workspace.isRenaming}
        renameDraft={workspace.renameDraft}
        fileInputRef={workspace.fileInputRef}
        onCreateMap={() => void handleCreateMap()}
        onSelectMap={(mapId) => void handleSelectMap(mapId)}
        onSaveMap={() => void workspace.saveMap()}
        onSaveAs={() => void handleSaveAs()}
        onStartRenaming={workspace.startRenaming}
        onRenameDraftChange={workspace.setRenameDraft}
        onConfirmRename={() => workspace.renameCurrentMap(workspace.renameDraft)}
        onCancelRename={workspace.cancelRenaming}
        onImportFile={(file) => void handleImportFile(file)}
        onDuplicateMap={() => void handleDuplicateMap()}
        onDeleteMap={() => void handleDeleteMap()}
        interactionMode={interactionMode}
        onInteractionModeChange={(mode) => {
          if (mode === interactionMode) {
            return;
          }
          setInteractionMode(mode);
          if (mode === "river-draw") {
            editor.disableFormatBrush();
            riverEditor.startRiverDrawing();
          } else if (riverEditor.riverDrawingStatus === "drawing") {
            riverEditor.cancelRiverDrawing();
          }
          if (mode === "batch-select") {
            editor.disableFormatBrush();
          }
        }}
        onUndo={() => {
          if (!workspace.currentMap) {
            return;
          }
          workspace.setCurrentMap(undo(workspace.currentMap));
          setMessage("已撤销");
        }}
        onRedo={() => {
          if (!workspace.currentMap) {
            return;
          }
          workspace.setCurrentMap(redo(workspace.currentMap));
          setMessage("已重做");
        }}
      />

      <main className="layout">
        <SidebarPanel
          loading={workspace.loading}
          message={message}
          currentMap={workspace.currentMap}
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
          lastOpaqueBackground={lastOpaqueExportBackground}
          tagFilter={tagFilter}
          onToggleExportPanel={() => exportPanel.setExportPanelOpen((current) => !current)}
          onExportPng={() => void exportPanel.handleExportPng(workspace.currentMap)}
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
          {workspace.currentMap ? (
            <MapCanvas
              map={workspace.currentMap}
              selectedCell={editor.selectedCell}
              selectedCellId={editor.selectedCellId}
              onSelectCell={editor.handleCanvasCellSelect}
              interactionMode={interactionMode}
              batchSelectedCellIds={advancedEditor.batchSelectedCellIds}
              onBatchCellToggle={advancedEditor.toggleBatchCell}
              riverPreview={riverEditor.riverPreview}
              riverDrawingPointCount={riverEditor.riverDrawingPoints.length}
              onRiverPointAdd={riverEditor.appendRiverPoint}
              onFinishRiverDrawing={() => {
                if (riverEditor.finishRiverDrawing()) {
                  setInteractionMode("select");
                }
              }}
              onCancelRiverDrawing={() => {
                riverEditor.cancelRiverDrawing();
                setInteractionMode("select");
              }}
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
          currentMap={workspace.currentMap}
          selectedCell={editor.selectedCell}
          draft={editor.draft}
          terrainCategory={editor.terrainCategory}
          filteredTerrainCategories={editor.filteredTerrainCategories}
          terrainOptions={editor.terrainOptions}
          biomeOptions={editor.biomeOptions}
          formatBrushEnabled={editor.formatBrushEnabled}
          formatBrushScope={editor.formatBrushScope}
          rivers={workspace.currentMap?.document.features?.rivers ?? []}
          selectedRiverId={riverEditor.selectedRiverId}
          riverDraft={riverEditor.riverDraft}
          riverDirty={riverEditor.riverDirty}
          riverDrawingStatus={riverEditor.riverDrawingStatus}
          riverDrawingPointCount={riverEditor.riverDrawingPoints.length}
          batchModeActive={interactionMode === "batch-select"}
          batchSelectedCount={advancedEditor.batchSelectedCells.length}
          batchDraft={advancedEditor.batchDraft}
          replaceTerrainDraft={advancedEditor.replaceTerrainDraft}
          replaceBiomeDraft={advancedEditor.replaceBiomeDraft}
          batchFilteredTerrainCategories={advancedEditor.batchFilteredTerrainCategories}
          batchTerrainOptions={advancedEditor.batchTerrainOptions}
          batchBiomeOptions={advancedEditor.batchBiomeOptions}
          replaceTerrainOptions={advancedEditor.replaceTerrainOptions}
          noneBiomeValue={advancedEditor.noneBiomeValue}
          canUseFormatBrush={editor.canUseFormatBrush}
          cellDirty={editor.cellDirty}
          onApplyDraft={editor.applyDraft}
          onRevertDraft={() => editor.syncDraftFromCell(editor.selectedCell)}
          onClearSelected={editor.clearSelected}
          onToggleFormatBrush={editor.toggleFormatBrush}
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
            if (riverEditor.applyRiverDraft()) {
              setInteractionMode("select");
            }
          }}
          onDeleteSelectedRiver={() => {
            riverEditor.deleteSelectedRiver();
            setInteractionMode("select");
          }}
          onStartRiverDrawing={() => {
            setInteractionMode("river-draw");
            editor.disableFormatBrush();
            riverEditor.startRiverDrawing();
          }}
          onFinishRiverDrawing={() => {
            if (riverEditor.finishRiverDrawing()) {
              setInteractionMode("select");
            }
          }}
          onCancelRiverDrawing={() => {
            riverEditor.cancelRiverDrawing();
            setInteractionMode("select");
          }}
          onToggleBatchMode={() => {
            if (interactionMode === "batch-select") {
              setInteractionMode("select");
              return;
            }
            editor.disableFormatBrush();
            if (riverEditor.riverDrawingStatus === "drawing") {
              riverEditor.cancelRiverDrawing();
            }
            setInteractionMode("batch-select");
          }}
          onClearBatchSelection={advancedEditor.clearBatchSelection}
          onApplyBatchEdit={() => {
            const result = advancedEditor.applyBatchEdit();
            if (result) {
              updateEditorDraftFromMap(result);
            }
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
            const result = advancedEditor.applyTerrainReplacement();
            if (result) {
              updateEditorDraftFromMap(result);
            }
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
            const result = advancedEditor.applyBiomeReplacement();
            if (result) {
              updateEditorDraftFromMap(result);
            }
          }}
          getFormatBrushLabel={editor.getFormatBrushLabel}
        />
      </main>
    </div>
  );
}
