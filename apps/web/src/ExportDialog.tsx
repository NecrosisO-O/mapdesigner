import { useEffect, useMemo, useState } from "react";
import type {
  CellRange,
  ExportPreview,
  TileExportPreview,
  ExportRenderOptions,
  MapRuntimeState,
  MapSummary
} from "@mapdesigner/map-core";
import { Dialog } from "./Dialog.js";
import { api } from "./api.js";
import type { useExportPanel } from "./useExportPanel.js";

export function ExportDialog({
  control: c,
  map,
  summary,
  visibleRange,
  viewOptions
}: {
  control: ReturnType<typeof useExportPanel>;
  map: MapRuntimeState;
  summary: MapSummary | null;
  visibleRange: CellRange | null;
  viewOptions: Partial<ExportRenderOptions>;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [preview, setPreview] = useState<ExportPreview | TileExportPreview | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const options = useMemo(
    () => ({
      ...c.pngOptions,
      title: c.pngOptions.title ?? map.document.meta.name,
      range: c.pngRangeMode === "visible" ? visibleRange : null
    }),
    [c.pngOptions, c.pngRangeMode, visibleRange, map.document.meta.name]
  );
  const patch = (value: Partial<ExportRenderOptions>) =>
    c.setPngOptions((current) => ({ ...current, ...value }));
  const rangeSize = options.range
    ? (options.range.maxRow - options.range.minRow + 1) *
      (options.range.maxCol - options.range.minCol + 1)
    : 0;
  const budgetError =
    c.pngMode === "tiles"
      ? ""
      : c.pngRangeMode === "full" && (summary?.designed_cell_count ?? 0) > 10000
        ? "单张全图 PNG 最多 10,000 格。请选择分块图片包，或缩小导出区域。"
        : rangeSize > 25000
          ? "当前区域超过 25,000 格。请先放大地图以缩小导出范围。"
          : "";
  const key = JSON.stringify([
    map.document.meta.id,
    map.document.meta.revision,
    options,
    retry,
    c.pngMode,
    c.tileSize
  ]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setPreview(null);
    setError("");
    setLoading(!budgetError);
    if (budgetError) return;
    const timeout = window.setTimeout(() => {
      void (
        c.pngMode === "tiles"
          ? api.previewTiles(map.document.meta.id, options, c.tileSize, {
              signal: controller.signal
            })
          : api.previewPng(map.document.meta.id, options, { signal: controller.signal })
      ).then((result) => {
        if (!active) return;
        setLoading(false);
        if (result.ok && result.result) setPreview(result.result);
        else setError(result.errors[0]?.message ?? "预览失败，请重试。");
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [key, budgetError]);
  const toggles: Array<[keyof ExportRenderOptions, string]> = [
    ["includeTerrain", "地貌"],
    ["includeBiomes", "生态纹理"],
    ["includeRivers", "河流"],
    ["includeTags", "地点标记"],
    ["includeGrid", "导出网格线"],
    ["includeCoordinates", "导出坐标"],
    ["includeShorthand", "导出简写"],
    ["includeUndesigned", "导出待设计格"]
  ];
  return (
    <Dialog title="导出地图" wide onClose={() => c.setExportPanelOpen(false)}>
      <div className="export-layout" id="export-panel-content">
        <div className="export-options">
          <fieldset disabled={c.isExportingPng}>
            <label>
              导出方式
              <select
                value={c.pngMode}
                onChange={(e) => c.setPngMode(e.target.value as "single" | "tiles")}
              >
                <option value="single">单张 PNG</option>
                <option value="tiles">分块图片包</option>
              </select>
            </label>
            {c.pngMode === "tiles" && (
              <>
                <label>
                  每块最大尺寸
                  <select
                    value={c.tileSize}
                    onChange={(e) => c.setTileSize(Number(e.target.value))}
                  >
                    {[1024, 2048, 4096].map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString()} × {n.toLocaleString()} 像素
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-help">
                  分块图片可按位置无缝拼接。标题、说明与图例放在图片包的索引页。
                </p>
              </>
            )}
            <label>
              导出范围
              <select
                value={c.pngRangeMode}
                onChange={(e) => c.setPngRangeMode(e.target.value as "visible" | "full")}
              >
                <option value="visible">当前可见区域</option>
                <option value="full">全图</option>
              </select>
            </label>
            <p className="field-help">
              {options.range
                ? "行 " +
                  options.range.minRow +
                  " 至 " +
                  options.range.maxRow +
                  "，列 " +
                  options.range.minCol +
                  " 至 " +
                  options.range.maxCol
                : "包含整张地图的已设计内容"}
            </p>
            <label>
              预设
              <select
                value={options.preset}
                onChange={(e) =>
                  patch({
                    preset: e.target.value as "clean" | "reference",
                    includeCoordinates: e.target.value === "reference",
                    includeShorthand: e.target.value === "reference"
                  })
                }
              >
                <option value="clean">纯净地图</option>
                <option value="reference">参考地图（坐标与简写）</option>
              </select>
            </label>
            <div className="compact-field-grid">
              <label>
                缩放倍率
                <select
                  value={options.scale}
                  onChange={(e) => patch({ scale: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4].map((v) => (
                    <option key={v} value={v}>
                      {v}×
                    </option>
                  ))}
                </select>
              </label>
              <label>
                边距
                <select
                  value={options.padding}
                  onChange={(e) => patch({ padding: Number(e.target.value) })}
                >
                  {[16, 32, 48, 64].map((v) => (
                    <option key={v} value={v}>
                      {v} px
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <details className="editor-disclosure" open>
              <summary>成图排版</summary>
              <label>
                地图标题
                <input
                  maxLength={120}
                  value={options.title}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
              <label>
                成图说明
                <textarea
                  maxLength={500}
                  rows={2}
                  value={options.caption ?? ""}
                  onChange={(e) => patch({ caption: e.target.value })}
                />
              </label>
              {(
                [
                  ["includeLegend", "附带本图图例"],
                  ["northArrow", "图面北向标"],
                  ["gridScale", "显示格距说明"]
                ] as const
              ).map(([field, label]) => (
                <label className="checkbox-row" key={field}>
                  <input
                    type="checkbox"
                    checked={Boolean(options[field])}
                    onChange={(e) => patch({ [field]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <p className="field-help">格距表示相邻格心距离。此图未定义真实距离单位。</p>
            </details>
            <details className="editor-disclosure">
              <summary>图层与背景</summary>
              <button onClick={() => patch(viewOptions)}>采用当前画布显示选项</button>
              {toggles.map(([field, label]) => (
                <label className="checkbox-row" key={field}>
                  <input
                    type="checkbox"
                    checked={Boolean(options[field])}
                    onChange={(e) =>
                      patch({
                        [field]: e.target.checked,
                        ...(field === "includeCoordinates" || field === "includeShorthand"
                          ? { preset: "clean" as const }
                          : {})
                      })
                    }
                  />
                  {label}
                </label>
              ))}
              <label>
                背景色
                <input
                  type="color"
                  value={options.background === "transparent" ? "#F4F0E6" : options.background}
                  disabled={options.background === "transparent"}
                  onChange={(e) => patch({ background: e.target.value })}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={options.background === "transparent"}
                  onChange={(e) =>
                    patch({ background: e.target.checked ? "transparent" : "#F4F0E6" })
                  }
                />
                透明背景
              </label>
              <p className="field-help">透明背景保留标题和图例的浅色底，以保证文字可读。</p>
            </details>
          </fieldset>
        </div>
        <figure className="export-preview">
          <div
            className={"export-preview-image" + (zoomed ? " export-preview-zoomed" : "")}
            aria-busy={loading}
          >
            {preview ? (
              <img
                src={preview.image}
                alt={"tileCount" in preview ? "分块的实际成图样例" : "实际范围的成图预览"}
              />
            ) : (
              <div className="empty-state">
                <strong>
                  {budgetError || error || (loading ? "正在生成成图预览…" : "暂无预览")}
                </strong>
                {error && <button onClick={() => setRetry((v) => v + 1)}>重新生成预览</button>}
              </div>
            )}
          </div>
          <figcaption>
            {preview && (
              <button
                className="preview-zoom"
                aria-pressed={zoomed}
                onClick={() => setZoomed((v) => !v)}
              >
                {zoomed ? "适合窗口" : "放大预览"}
              </button>
            )}
            {preview ? (
              <>
                <strong>
                  {preview.width.toLocaleString()} × {preview.height.toLocaleString()} 像素
                </strong>
                <span>
                  {"tileCount" in preview
                    ? `${preview.columns} 列 × ${preview.rows} 行，共 ${preview.tileCount.toLocaleString()} 张 · 样例为第 ${preview.sampleRow + 1} 行第 ${preview.sampleCol + 1} 列`
                    : `${preview.cellCount.toLocaleString()} 个已设计格`}{" "}
                  · 修订 {preview.revision} · 预览缩放显示
                </span>
              </>
            ) : (
              <span>预览采用与下载图片相同的水面、图例和排版规则。</span>
            )}
          </figcaption>
          <p className="field-help">
            {c.pngMode === "tiles"
              ? "图片包包含 PNG、位置清单和可打开的索引页；最多 2048 张、2 GiB。上方图片展示一块实际分块，尺寸表示整套图片拼接后的范围。"
              : "单张图片上限：单边 32,768 px、总计 4,000 万像素；全图 10,000 格、区域 25,000 格。"}
          </p>
        </figure>
      </div>
      <div className="export-footer">
        <div role="status">
          {c.isExportingPng ? c.progress || "准备导出" : c.resultMessage}
          {c.download && (
            <a href={c.download.url} download={c.download.fileName}>
              再次下载 · {c.download.fileName}
            </a>
          )}
        </div>
        <div className="action-row">
          {c.isExportingPng && <button onClick={c.cancelExport}>取消任务</button>}
          <button disabled={c.isExportingPng} onClick={() => void c.handleExportJson(map)}>
            导出 JSON
          </button>
          <button
            className="primary-button"
            disabled={c.isExportingPng || loading || !preview || Boolean(budgetError || error)}
            onClick={() =>
              void c.handleExportPng(map, visibleRange, {
                ...options,
                expectedRevision: preview?.revision
              })
            }
          >
            {c.isExportingPng ? "导出中..." : c.pngMode === "tiles" ? "导出图片包" : "导出图片"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
