import type { MapRuntimeState } from "@mapdesigner/map-core";
import type { ChangeEvent, RefObject } from "react";
import type { MapHistory, MapListItem } from "./api.js";

export type InteractionMode = "select" | "pan" | "brush" | "river-draw" | "batch-select";

interface TopToolbarProps {
  currentMap: MapRuntimeState | null;
  mapHistory: MapHistory | null;
  currentMapId: string;
  displayMaps: MapListItem[];
  mapDirty: boolean;
  pending?: boolean;
  onExport?: () => void;
  onToggleTheme?: () => void;
  onToggleFocus?: () => void;
  onToggleContent?: () => void;
  onToggleInspector?: () => void;
  onAccessToken?: () => void;
  isRenaming: boolean;
  renameDraft: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onCreateMap: () => void;
  onSelectMap: (mapId: string) => void;
  onSaveMap: () => void;
  onSaveAs: () => void;
  onStartRenaming: () => void;
  onRenameDraftChange: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onImportFile: (file: File) => void;
  onDuplicateMap: () => void;
  onDeleteMap: () => void;
  interactionMode: InteractionMode;
  onInteractionModeChange: (mode: InteractionMode) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopToolbar(props: TopToolbarProps) {
  const canUndo = !!props.currentMap && (props.mapHistory?.status.canUndo ?? false);
  const canRedo = !!props.currentMap && (props.mapHistory?.status.canRedo ?? false);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    props.onImportFile(file);
    event.currentTarget.value = "";
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ⬡
        </span>
        <strong>MapDesigner</strong>
      </div>
      <details className="document-menu">
        <summary>
          地图 <span aria-hidden="true">⌄</span>
        </summary>
        <div className="document-menu-content">
          <label>
            选择地图
            <select
              aria-label="选择地图"
              value={props.currentMapId}
              onChange={(event) => props.onSelectMap(event.target.value)}
            >
              <option value="">选择地图</option>
              {props.displayMaps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={props.onCreateMap}>新建地图</button>
          <button onClick={() => props.fileInputRef.current?.click()}>导入 JSON</button>
          <button onClick={props.onStartRenaming} disabled={!props.currentMap}>
            重命名
          </button>
          <button onClick={props.onSaveAs} disabled={!props.currentMap}>
            另存为
          </button>
          <button onClick={props.onDuplicateMap} disabled={!props.currentMap}>
            复制地图
          </button>
          <button
            className="danger-button"
            onClick={props.onDeleteMap}
            disabled={!props.currentMap}
          >
            删除地图
          </button>
          <button onClick={props.onAccessToken}>连接设置</button>
        </div>
      </details>
      <div className="document-title">
        {props.isRenaming ? (
          <form
            className="rename-editor"
            onSubmit={(event) => {
              event.preventDefault();
              props.onConfirmRename();
            }}
          >
            <input
              aria-label="地图名称"
              autoFocus
              value={props.renameDraft}
              onChange={(event) => props.onRenameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") props.onCancelRename();
              }}
            />
            <button type="submit" disabled={!props.renameDraft.trim()}>
              确认重命名
            </button>
            <button type="button" onClick={props.onCancelRename}>
              取消重命名
            </button>
          </form>
        ) : (
          <button className="name-button" onClick={props.onStartRenaming} title="重命名地图">
            {props.currentMap?.document.meta.name ?? "未打开地图"}
          </button>
        )}
        <span className={props.mapDirty ? "save-state save-state-dirty" : "save-state"}>
          {props.pending ? "正在提交…" : props.mapDirty ? "未保存修改" : "已保存"}
        </span>
      </div>
      <div className="document-actions">
        {props.mapDirty && (
          <button onClick={props.onSaveMap} disabled={props.pending}>
            保存
          </button>
        )}
        <button onClick={props.onUndo} disabled={!canUndo || props.pending} title="撤销 · ⌘/Ctrl Z">
          撤销
        </button>
        <button
          onClick={props.onRedo}
          disabled={!canRedo || props.pending}
          title="重做 · ⌘/Ctrl Shift Z"
        >
          重做
        </button>
        <span className="toolbar-divider" />
        <button onClick={props.onToggleTheme} aria-label="切换深浅主题" title="切换深浅主题">
          ◐
        </button>
        <button onClick={props.onToggleFocus} aria-label="专注画布" title="专注画布">
          ⛶
        </button>
        <button className="primary-button" onClick={props.onExport} disabled={!props.currentMap}>
          导出
        </button>
      </div>
      <input
        ref={props.fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleFileChange}
      />
    </header>
  );
}
