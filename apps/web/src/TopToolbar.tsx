import type { MapRuntimeState } from "@mapdesigner/map-core";
import { useEffect, useRef, type ChangeEvent, type RefObject } from "react";
import type { MapHistory, MapListItem } from "./api.js";
import { Icon } from "./Icon.js";

export type InteractionMode =
  "select" | "pan" | "brush" | "format-brush" | "sample" | "river-draw" | "batch-select";

interface TopToolbarProps {
  currentMap: MapRuntimeState | null;
  mapHistory: MapHistory | null;
  currentMapId: string;
  displayMaps: MapListItem[];
  mapDirty: boolean;
  pending?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onHistory: () => void;
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
  onMergeMap?: () => void;
  onDeleteMap: () => void;
  interactionMode: InteractionMode;
  onInteractionModeChange: (mode: InteractionMode) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopToolbar(props: TopToolbarProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  function closeMenu(restoreFocus = false): void {
    if (!menu.current) return;
    menu.current.open = false;
    if (restoreFocus) menu.current.querySelector("summary")?.focus();
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
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
          <Icon name="map" size={24} />
        </span>
        <strong>MapDesigner</strong>
      </div>
      <details
        ref={menu}
        className="document-menu"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            closeMenu(true);
          }
        }}
      >
        <summary>
          地图 <Icon name="chevron" size={14} />
        </summary>
        <div
          className="document-menu-content"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) closeMenu(true);
          }}
        >
          <label>
            选择地图
            <select
              aria-label="选择地图"
              value={props.currentMapId}
              onChange={(event) => {
                props.onSelectMap(event.target.value);
                closeMenu(true);
              }}
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
          <button onClick={props.onSaveMap} disabled={!props.mapDirty || props.pending}>
            应用待保存修改
          </button>
          <button onClick={props.onSaveAs} disabled={!props.currentMap}>
            另存为
          </button>
          <button onClick={props.onDuplicateMap} disabled={!props.currentMap}>
            复制地图
          </button>
          <button onClick={props.onMergeMap} disabled={!props.currentMap || props.pending}>
            合并其他地图
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
          <button
            className="name-button"
            onClick={props.onStartRenaming}
            title={props.currentMap?.document.meta.name ?? "未打开地图"}
          >
            {props.currentMap?.document.meta.name ?? "未打开地图"}
          </button>
        )}
        <span
          title={props.error ?? undefined}
          className={props.mapDirty || props.error ? "save-state save-state-dirty" : "save-state"}
        >
          {props.pending
            ? "正在提交…"
            : props.error
              ? "提交失败"
              : props.mapDirty
                ? "草稿未应用"
                : props.currentMap
                  ? "已保存"
                  : "选择或新建地图"}
        </span>
      </div>
      <div className="document-actions">
        {props.error && props.onRetry && (
          <button className="retry-button" onClick={props.onRetry} disabled={props.pending}>
            重试
          </button>
        )}
        {props.mapDirty && (
          <button className="apply-drafts" onClick={props.onSaveMap} disabled={props.pending}>
            应用草稿
          </button>
        )}
        <button
          className="icon-button"
          aria-label="撤销"
          onClick={props.onUndo}
          disabled={!canUndo || props.pending}
          title="撤销 · ⌘/Ctrl Z"
        >
          <Icon name="undo" />
        </button>
        <button
          onClick={props.onRedo}
          className="icon-button"
          aria-label="重做"
          disabled={!canRedo || props.pending}
          title="重做 · ⌘/Ctrl Shift Z"
        >
          <Icon name="redo" />
        </button>
        <span className="toolbar-divider" />
        <button
          className="icon-button"
          aria-label="编辑历史"
          onClick={props.onHistory}
          title="编辑历史"
        >
          <Icon name="history" />
        </button>
        <button onClick={props.onToggleTheme} aria-label="切换深浅主题" title="切换深浅主题">
          <Icon name="theme" />
        </button>
        <button onClick={props.onToggleFocus} aria-label="专注画布" title="专注画布">
          <Icon name="focus" />
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
