import type { MapRuntimeState } from "@mapdesigner/map-core";
import type { ChangeEvent, RefObject } from "react";
import type { MapListItem } from "./api.js";

interface TopToolbarProps {
  currentMap: MapRuntimeState | null;
  currentMapId: string;
  displayMaps: MapListItem[];
  mapDirty: boolean;
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
  onUndo: () => void;
  onRedo: () => void;
}

export function TopToolbar(props: TopToolbarProps) {
  const canUndo = !!props.currentMap && props.currentMap.history.past.length > 0;
  const canRedo = !!props.currentMap && props.currentMap.history.future.length > 0;

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
        <strong>MapDesigner</strong>
        <span className={props.mapDirty ? "save-state save-state-dirty" : "save-state"}>
          {props.mapDirty ? "未保存修改" : "已保存"}
        </span>
      </div>
      <div className="toolbar">
        <div className="toolbar-group toolbar-map-picker">
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
        </div>

        <div className="toolbar-group toolbar-primary-actions">
          <button onClick={props.onCreateMap}>新建地图</button>
          <button className="primary-button" onClick={props.onSaveMap} disabled={!props.mapDirty}>
            保存
          </button>
          <button onClick={props.onUndo} disabled={!canUndo}>
            撤销
          </button>
          <button onClick={props.onRedo} disabled={!canRedo}>
            重做
          </button>
        </div>

        <div className="toolbar-group toolbar-secondary-actions">
          <button onClick={props.onSaveAs} disabled={!props.currentMap}>
            另存为
          </button>
          {props.isRenaming ? (
            <div className="rename-editor">
              <input
                aria-label="地图名称"
                value={props.renameDraft}
                onChange={(event) => props.onRenameDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    props.onConfirmRename();
                  }
                  if (event.key === "Escape") {
                    props.onCancelRename();
                  }
                }}
                placeholder="输入地图名称"
              />
              <button
                onClick={props.onConfirmRename}
                disabled={!props.currentMap || !props.renameDraft.trim()}
                type="button"
              >
                确认重命名
              </button>
              <button onClick={props.onCancelRename} type="button">
                取消重命名
              </button>
            </div>
          ) : (
            <button onClick={props.onStartRenaming} disabled={!props.currentMap}>
              重命名
            </button>
          )}
          <button onClick={() => props.fileInputRef.current?.click()}>导入 JSON</button>
          <button onClick={props.onDuplicateMap} disabled={!props.currentMap}>
            复制地图
          </button>
          <button className="danger-button" onClick={props.onDeleteMap} disabled={!props.currentMap}>
            删除地图
          </button>
        </div>
      </div>
      <input
        ref={props.fileInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={handleFileChange}
      />
    </header>
  );
}
