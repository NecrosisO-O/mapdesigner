import type { InteractionMode } from "./TopToolbar.js";
const tools: Array<{ id: InteractionMode; label: string; key: string; path: string }> = [
  { id: "select", label: "选择", key: "V", path: "M5 3l13 9-6 1-3 6z" },
  {
    id: "pan",
    label: "平移",
    key: "H",
    path: "M8 11V5a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7c0 4-3 6-7 6-3 0-5-2-7-5l-2-3c-1-2 1-3 2-2l2 2"
  },
  {
    id: "brush",
    label: "笔刷",
    key: "B",
    path: "M9 13L18 3l3 3-10 9M10 15c-6-2-2 6-7 5 5 3 10 0 7-5z"
  },
  { id: "river-draw", label: "河流", key: "R", path: "M6 3c16 4-10 9 8 18M10 3c16 4-10 9 8 18" },
  {
    id: "batch-select",
    label: "批量",
    key: "M",
    path: "M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M8 8h8v8H8z"
  }
];
export function ToolRail(props: {
  mode: InteractionMode;
  disabled: boolean;
  onChange: (mode: InteractionMode) => void;
  onHelp: () => void;
}) {
  return (
    <nav className="tool-rail" aria-label="编辑工具">
      {tools.map((tool) => (
        <button
          key={tool.id}
          title={tool.label + " · " + tool.key}
          aria-label={tool.label}
          aria-keyshortcuts={tool.key}
          aria-pressed={props.mode === tool.id}
          disabled={props.disabled}
          onClick={() => props.onChange(tool.id)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d={tool.path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{tool.label}</span>
        </button>
      ))}
      <button
        className="tool-help"
        onClick={props.onHelp}
        aria-label="快捷键帮助"
        title="快捷键 · ?"
      >
        ?
      </button>
    </nav>
  );
}
