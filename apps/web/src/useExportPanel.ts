import type { CellRange, ExportRenderOptions, MapRuntimeState } from "@mapdesigner/map-core";
import { useRef, useState } from "react";
import { api } from "./api.js";
import { formatStatusMessage } from "./useMapWorkspace.js";

const DEFAULT_PNG_OPTIONS: ExportRenderOptions = {
  preset: "clean",
  includeCoordinates: false,
  includeShorthand: false,
  includeGrid: false,
  includeUndesigned: false,
  background: "#F4F0E6",
  padding: 32,
  scale: 2,
  range: null,
  includeLegend: true,
  includeTerrain: true,
  includeTerrainSymbols: true,
  includeBiomes: true,
  includeRivers: true,
  includeTags: true
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
  const [pngRangeMode, setPngRangeMode] = useState<"visible" | "full">("full");
  const [pngMode, setPngMode] = useState<"single" | "tiles">("single");
  const [tileSize, setTileSize] = useState(4096);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [download, setDownload] = useState<{ fileName: string; url: string } | null>(null);
  const [progress, setProgress] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  function reportResult(message: string): void {
    setMessage(message);
    setResultMessage(message);
  }

  async function handleExportPng(
    currentMap: MapRuntimeState | null,
    visibleRange?: CellRange | null,
    overrides: Partial<ExportRenderOptions> = {}
  ): Promise<void> {
    if (!currentMap || controller.current) {
      return;
    }
    const exportOptions: ExportRenderOptions = {
      ...pngOptions,
      ...overrides,
      range: pngRangeMode === "visible" ? (visibleRange ?? null) : null
    };
    controller.current = new AbortController();
    setResultMessage("");
    setIsExportingPng(true);
    setMessage("正在导出 PNG...");
    try {
      const control = {
        signal: controller.current.signal,
        onProgress: setProgress
      };
      const response =
        pngMode === "tiles"
          ? await api.exportTiles(currentMap.document.meta.id, exportOptions, tileSize, control)
          : await api.exportPng(currentMap.document.meta.id, exportOptions, control);
      if (!response.ok || !response.result) {
        reportResult(
          controller.current?.signal.aborted
            ? "导出已取消"
            : formatStatusMessage(response.errors[0]?.message, "导出失败")
        );
        return;
      }
      setDownload({
        fileName: response.result.fileName,
        url:
          response.result.downloadUrl ??
          "/api/exports/" + encodeURIComponent(response.result.fileName)
      });
      triggerDownload(
        response.result.downloadUrl ??
          `/api/exports/${encodeURIComponent(response.result.fileName)}`,
        response.result.fileName
      );
      reportResult(
        pngMode === "tiles"
          ? "图片包已导出，解压后打开 index.html 查看分块与图例"
          : "PNG 已导出并开始下载"
      );
    } finally {
      setIsExportingPng(false);
      controller.current = null;
      setProgress("");
    }
  }

  async function handleExportJson(currentMap: MapRuntimeState | null): Promise<void> {
    if (!currentMap || controller.current) return;
    controller.current = new AbortController();
    setResultMessage("");
    setIsExportingPng(true);
    try {
      const response = await api.exportJson(currentMap.document.meta.id, {
        signal: controller.current.signal,
        onProgress: setProgress
      });
      if (!response.ok || !response.result) {
        reportResult(
          controller.current?.signal.aborted
            ? "导出已取消"
            : (response.errors[0]?.message ?? "导出失败")
        );
        return;
      }
      triggerDownload(response.result.downloadUrl, response.result.fileName);
      setDownload({ fileName: response.result.fileName, url: response.result.downloadUrl });
      reportResult("JSON 已导出并开始下载");
    } finally {
      controller.current = null;
      setIsExportingPng(false);
      setProgress("");
    }
  }

  return {
    pngMode,
    setPngMode,
    tileSize,
    setTileSize,
    download,
    progress,
    resultMessage,
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
