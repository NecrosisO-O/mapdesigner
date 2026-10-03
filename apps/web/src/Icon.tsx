const paths = {
  map: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15M15 6v15",
  chevron: "M7 10l5 5 5-5",
  close: "M6 6l12 12M18 6L6 18",
  undo: "M8 4L3 9l5 5M3 9h10a7 7 0 0 1 7 7v3",
  redo: "M16 4l5 5-5 5M21 9H11a7 7 0 0 0-7 7v3",
  theme: "M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z",
  focus: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  history: "M3 5v5h5M3 10a9 9 0 1 1 1 7M12 7v5l4 2",
  pin: "M8 3h8l-1 7 4 4H5l4-4ZM12 14v7",
  layers: "M3 8l9-5 9 5-9 5ZM3 12l9 5 9-5M3 16l9 5 9-5",
  library: "M4 4h6v16H4ZM14 4l5-1 4 16-5 1Z",
  inspector: "M3 5h18M3 12h18M3 19h18M8 3v4M16 10v4M9 17v4",
  help: "M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  sample: "M14 3l7 7M12 5l7 7-10 10H4v-5ZM4 18l3 3",
  search: "M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  arrow: "M4 12h16M14 6l6 6-6 6"
};
export function Icon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
