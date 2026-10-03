import type { CellRange, ExportRenderOptions, MapRuntimeState } from "@mapdesigner/map-core";
import { useRef, useState } from "react";
import { api } from "./api.js";
import { formatStatusMessage } from "./useMapWorkspace.js";

const DEFAULT_PNG_OPTIONS: ExportRenderOptions = {
  preset: "clean",
  includeCoordinates: false,
  includeShorthand: false,
  includeGrid: true,
  includeUndesigned: false,
  background: "#F4F0E6",
  padding: 32,
  scale: 2,
  range: null
};

function triggerDownload(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function useExportPanel(setMessage: (message: string) => void) {
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const [pngOptions, setPngOptions] = useState<ExportRenderOptions>(DEFAULT_PNG_OPTIONS);
  const [pngRangeMode, setPngRangeMode] = useState<"visible" | "full">("visible");
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);

  async function handleExportPng(
    currentMap: MapRuntimeState | null,
    visibleRange?: CellRange | null
  ): Promise<void> {
    if (!currentMap || controller.current) {
      return;
    }
    const exportOptions: ExportRenderOptions = {
      ...pngOptions,
      range: pngRangeMode === "visible" ? (visibleRange ?? null) : null
    };
    controller.current = new AbortController();
    setIsExportingPng(true);
    setMessage("正在导出 PNG...");
    try {
      const response = await api.exportPng(currentMap.document.meta.id, exportOptions, {
        signal: controller.current.signal,
        onProgress: setProgress
      });
      if (!response.ok || !response.result) {
        setMessage(formatStatusMessage(response.errors[0]?.message, "导出失败"));
        return;
      }
      triggerDownload(
        response.result.downloadUrl ??
          `/api/exports/${encodeURIComponent(response.result.fileName)}`,
        response.result.fileName
      );
      setMessage(`PNG 已导出并开始下载：${response.result.fileName}`);
    } finally {
      setIsExportingPng(false);
      controller.current = null;
      setProgress("");
    }
  }

  async function handleExportJson(currentMap: MapRuntimeState | null): Promise<void> {
    if (!currentMap || controller.current) return;
    controller.current = new AbortController();
    setIsExportingPng(true);
    try {
      const response = await api.exportJson(currentMap.document.meta.id, {
        signal: controller.current.signal,
        onProgress: setProgress
      });
      if (!response.ok || !response.result) {
        setMessage(response.errors[0]?.message ?? "导出失败");
        return;
      }
      triggerDownload(response.result.downloadUrl, response.result.fileName);
      setMessage("JSON 已导出并开始下载");
    } finally {
      controller.current = null;
      setIsExportingPng(false);
      setProgress("");
    }
  }

  return {
    progress,
    cancelExport: () => controller.current?.abort(),
    handleExportJson,
    exportPanelOpen,
    isExportingPng,
    pngOptions,
    pngRangeMode,
    setExportPanelOpen,
    setPngOptions,
    setPngRangeMode,
    handleExportPng
  };
}
