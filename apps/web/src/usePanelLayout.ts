import { useEffect, useRef, useState, type CSSProperties } from "react";

const read = () => {
  try {
    return JSON.parse(localStorage.getItem("mapdesigner-panels-v3") ?? "{}");
  } catch {
    return {};
  }
};
export function usePanelLayout() {
  const [preferences, setPreferences] = useState(() => {
    const stored = read();
    return {
      width: Math.max(280, Math.min(420, Number(stored.width) || 320)),
      pinned: stored.pinned === true
    };
  });
  const [drawer, setDrawer] = useState<"half" | "full">("half");
  const drag = useRef<{ start: number; width: number; side: "left" | "right" } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("mapdesigner-panels-v3", JSON.stringify(preferences));
    } catch {}
  }, [preferences]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () =>
      document.documentElement.style.setProperty(
        "--visible-height",
        (viewport?.height ?? window.innerHeight) + "px"
      );
    update();
    viewport?.addEventListener("resize", update);
    return () => viewport?.removeEventListener("resize", update);
  }, []);
  return {
    ...preferences,
    drawer,
    setDrawer,
    togglePin: () => setPreferences((current) => ({ ...current, pinned: !current.pinned })),
    style: { "--panel-width": preferences.width + "px" } as CSSProperties,
    resizeProps: (side: "left" | "right") => ({
      role: "separator" as const,
      tabIndex: 0,
      "aria-label": "调整面板宽度",
      "aria-orientation": "vertical" as const,
      "aria-valuenow": preferences.width,
      "aria-valuemin": 280,
      "aria-valuemax": 420,
      onKeyDown: (event: React.KeyboardEvent) => {
        if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
          event.preventDefault();
          setPreferences((current) => ({
            ...current,
            width:
              event.key === "Home"
                ? 320
                : Math.max(
                    280,
                    Math.min(
                      420,
                      current.width +
                        (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1) * 16
                    )
                  )
          }));
        }
      },
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        drag.current = { start: event.clientX, width: preferences.width, side };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent) => {
        const start = drag.current;
        if (start)
          setPreferences((current) => ({
            ...current,
            width: Math.max(
              280,
              Math.min(
                420,
                start.width + (event.clientX - start.start) * (start.side === "left" ? 1 : -1)
              )
            )
          }));
      },
      onPointerUp: () => {
        drag.current = null;
      },
      onPointerCancel: () => {
        drag.current = null;
      }
    })
  };
}
