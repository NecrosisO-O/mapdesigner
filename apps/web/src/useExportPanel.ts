import type { ExportRenderOptions, MapRuntimeState } from "@mapdesigner/map-core";
import { useState } from "react";
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
  scale: 2
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

  async function handleExportPng(currentMap: MapRuntimeState | null): Promise<void> {
    if (!currentMap) {
      return;
    }
    const response = await api.exportPng(currentMap.document.meta.id, pngOptions);
    if (!response.ok || !response.result) {
      setMessage(formatStatusMessage(response.errors[0]?.message, "导出失败"));
      return;
    }
    triggerDownload(
      response.result.downloadUrl ?? `/api/exports/${encodeURIComponent(response.result.fileName)}`,
      response.result.fileName
    );
    setMessage(`PNG 已导出并开始下载：${response.result.fileName}`);
  }

  return {
    exportPanelOpen,
    pngOptions,
    setExportPanelOpen,
    setPngOptions,
    handleExportPng
  };
}
