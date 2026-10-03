import { Icon } from "./Icon.js";
export function PanelControls(props: {
  title: string;
  pinned: boolean;
  drawer: "half" | "full";
  onPin: () => void;
  onDrawer: () => void;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className="panel-heading">
      <h2>{props.title}</h2>
      <div className="panel-heading-actions">
        <button
          className="panel-pin icon-button"
          aria-label="固定双侧面板"
          aria-pressed={props.pinned}
          onClick={props.onPin}
          title="固定双侧面板"
        >
          <Icon name="pin" size={17} />
        </button>
        <button
          className="drawer-expand"
          onClick={props.onDrawer}
          aria-label={props.drawer === "half" ? "展开面板" : "半屏面板"}
        >
          {props.drawer === "half" ? "展开" : "半屏"}
        </button>
        <button
          className="icon-button"
          aria-label={props.closeLabel}
          title="收起面板"
          onClick={props.onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
