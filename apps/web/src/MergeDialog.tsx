import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MergeMapInput,
  MergeMapPreview,
  MapOverview,
  MapSummary
} from "@mapdesigner/map-core";
import { centerForCoord } from "@mapdesigner/map-render";
import { api, type MapListItem } from "./api.js";
import { Dialog } from "./Dialog.js";

function PlacementPreview({ preview: p }: { preview: MergeMapPreview }) {
  const shape = (overview: MapOverview, dr = 0, dc = 0) =>
    overview.tiles.map((tile) => {
      const r = tile.row + dr,
        c = tile.col + dc,
        n = overview.bucket_size;
      return [
        { row: r - 0.5, col: c - 0.5 },
        { row: r + n - 0.5, col: c - 0.5 },
        { row: r + n - 0.5, col: c + n - 0.5 },
        { row: r - 0.5, col: c + n - 0.5 }
      ].map((coord) => centerForCoord(coord, 1));
    });
  const target = shape(p.targetOverview),
    source = shape(p.sourceOverview, p.input.offsetRow, p.input.offsetCol);
  const corners = (o: MapOverview, dr = 0, dc = 0) =>
    [o.range.minRow, o.range.maxRow].flatMap((row) =>
      [o.range.minCol, o.range.maxCol].map((col) =>
        centerForCoord({ row: row + dr, col: col + dc }, 1)
      )
    );
  const all = [...target, ...source]
    .flat()
    .concat(
      corners(p.targetOverview),
      corners(p.sourceOverview, p.input.offsetRow, p.input.offsetCol)
    );
  let minX = 0,
    minY = 0,
    maxX = 1,
    maxY = 1;
  if (all.length) {
    minX = Math.min(...all.map((c) => c.x));
    minY = Math.min(...all.map((c) => c.y));
    maxX = Math.max(...all.map((c) => c.x));
    maxY = Math.max(...all.map((c) => c.y));
  }
  const padding = Math.max(maxX - minX, maxY - minY) * 0.06 + 1;
  const radius = Math.max(0.4, Math.max(maxX - minX, maxY - minY) / 180);
  const stripe = Math.max(1, padding / 2);
  const rivers = (o: MapOverview, dr = 0, dc = 0) =>
    o.rivers?.flatMap((r) =>
      r.paths.map((points) =>
        points
          .filter(
            (_, i) =>
              i === points.length - 1 || i % Math.max(1, Math.ceil(points.length / 2000)) === 0
          )
          .map((point) => {
            const q = centerForCoord({ row: point.row + dr, col: point.col + dc }, 1);
            return `${q.x},${q.y}`;
          })
          .join(" ")
      )
    ) ?? [];
  return (
    <svg
      className="merge-map-preview"
      role="img"
      aria-label="来源地图放置位置与重叠格概览"
      viewBox={`${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`}
    >
      <defs>
        <pattern
          id="merge-source-pattern"
          patternUnits="userSpaceOnUse"
          width={stripe}
          height={stripe}
        >
          <rect width={stripe} height={stripe} fill="var(--warning-soft)" />
          <path
            d={`M 0 ${stripe} L ${stripe} 0`}
            stroke="var(--warning)"
            strokeWidth={stripe / 5}
          />
        </pattern>
      </defs>
      {target.map((points, i) => (
        <polygon
          key={"t" + i}
          className="merge-target"
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      ))}
      {source.map((points, i) => (
        <polygon
          key={"s" + i}
          className="merge-source"
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      ))}
      {rivers(p.targetOverview).map((points, i) => (
        <polyline
          key={"tr" + i}
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={radius}
        />
      ))}
      {rivers(p.sourceOverview, p.input.offsetRow, p.input.offsetCol).map((points, i) => (
        <polyline
          key={"sr" + i}
          points={points}
          fill="none"
          stroke="var(--warning)"
          strokeDasharray={`${radius * 4} ${radius * 2}`}
          strokeWidth={radius}
        />
      ))}
      {p.conflicts.map((c) => {
        const point = centerForCoord(c, 1);
        return (
          <circle
            key={c.row + "," + c.col}
            className="merge-conflict"
            cx={point.x}
            cy={point.y}
            r={radius}
          />
        );
      })}
    </svg>
  );
}

export function MergeDialog({
  target,
  maps,
  onClose,
  onComplete
}: {
  target: MapSummary;
  maps: MapListItem[];
  onClose: () => void;
  onComplete: (summary: MapSummary) => Promise<void>;
}) {
  const sources = maps.filter((m) => m.id !== target.meta.id);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? ""),
    [row, setRow] = useState("0"),
    [col, setCol] = useState("0");
  const [conflict, setConflict] = useState<MergeMapInput["conflict"]>("keep-target");
  const [preview, setPreview] = useState<MergeMapPreview | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null),
    closeAfterCancel = useRef(false);
  const input = useMemo(
    () => ({ sourceId, offsetRow: Number(row), offsetCol: Number(col), conflict }),
    [sourceId, row, col, conflict]
  );
  const valid =
    sourceId &&
    row.trim() &&
    col.trim() &&
    [input.offsetRow, input.offsetCol].every(
      (n) => Number.isSafeInteger(n) && Math.abs(n) <= 1_000_000_000
    );
  useEffect(() => {
    if (busy) return;
    setPreview(null);
    setError("");
    setLoading(Boolean(valid));
    if (!valid) return;
    let active = true;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      void api.previewMerge(target.meta.id, input, { signal: abort.signal }).then((response) => {
        if (!active) return;
        setLoading(false);
        if (response.ok && response.result) setPreview(response.result);
        else setError(response.errors[0]?.message ?? "预览失败，请重试");
      });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [input, target.meta.id, target.meta.revision, retry, valid]);
  useEffect(() => () => controller.current?.abort(), []);
  function close() {
    if (controller.current) {
      closeAfterCancel.current = true;
      controller.current.abort();
      setProgress("正在取消，请稍候");
    } else onClose();
  }
  async function submit() {
    if (!preview || busy) return;
    controller.current = new AbortController();
    setBusy(true);
    setError("");
    try {
      const response = await api.mergeMap(target.meta.id, preview.input, {
        signal: controller.current.signal,
        onProgress: setProgress
      });
      if (response.ok && response.result) {
        await onComplete(response.result.summary);
        onClose();
      } else {
        setError(response.errors[0]?.message ?? "合并失败，请重新预览");
        setPreview(null);
      }
    } finally {
      controller.current = null;
      setBusy(false);
      if (closeAfterCancel.current) onClose();
    }
  }
  return (
    <Dialog title="合并其他地图" wide onClose={close}>
      <p>将另一张地图放入「{target.meta.name}」。合并后可整体撤销，也可继续连接两张地图的河流。</p>
      {!sources.length ? (
        <div className="empty-state">先导入或创建另一张地图，再打开合并工具。</div>
      ) : (
        <div className="export-layout merge-layout">
          <div className="export-options">
            <fieldset disabled={busy}>
              <label>
                来源地图
                <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  {sources.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.designedCellCount.toLocaleString()} 格
                    </option>
                  ))}
                </select>
              </label>
              <div className="compact-field-grid">
                <label>
                  行偏移
                  <input
                    type="number"
                    step="1"
                    value={row}
                    onChange={(e) => setRow(e.target.value)}
                  />
                </label>
                <label>
                  列偏移
                  <input
                    type="number"
                    step="1"
                    value={col}
                    onChange={(e) => setCol(e.target.value)}
                  />
                </label>
              </div>
              <button
                disabled={!preview}
                onClick={() => {
                  if (preview) {
                    const t = preview.target.render_bounds ?? preview.target.bounds,
                      s = preview.source.render_bounds ?? preview.source.bounds;
                    const dc = (t.max_col ?? 0) - (s.min_col ?? 0) + 3;
                    setCol(String(dc));
                    setRow(String(Math.round((t.min_row ?? 0) - (s.min_row ?? 0) - dc / 2)));
                  }
                }}
              >
                并排放在右侧
              </button>
              <p className="field-help">
                按六边形坐标整体平移。正行值向图面上方，正列值向右上方；输入负数反向移动。
              </p>
              <label>
                重叠格处理
                <select
                  value={conflict}
                  onChange={(e) => setConflict(e.target.value as MergeMapInput["conflict"])}
                >
                  <option value="keep-target">保留当前地图的格子</option>
                  <option value="replace-target">使用来源地图覆盖</option>
                </select>
              </label>
              <p className="field-help">
                河流会一并复制，保留来源中的交汇关系。合并后的显示采用当前地图样式。
              </p>
              {!valid && <p role="alert">请选择来源，并输入整数偏移量。</p>}
            </fieldset>
          </div>
          <figure className="merge-preview" aria-busy={loading || busy}>
            {preview ? (
              <>
                <PlacementPreview preview={preview} />
                <figcaption className="merge-key">
                  <span>实底：当前地图</span>
                  <span>斜纹：来源地图</span>
                  <span>圆点：重叠格</span>
                </figcaption>
                <dl className="merge-counts">
                  <div>
                    <dt>新增格子</dt>
                    <dd>{preview.added.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>{conflict === "replace-target" ? "覆盖格子" : "保留重叠格"}</dt>
                    <dd>{preview.overlapping.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>复制河流</dt>
                    <dd>{preview.rivers.toLocaleString()}</dd>
                  </div>
                </dl>
                <p className="field-help">
                  放置概览显示分布与重叠位置，最多标出 500 个重叠格。来源修订{" "}
                  {preview.source.meta.revision} · 当前地图修订 {preview.target.meta.revision}。
                </p>
              </>
            ) : (
              <div className="empty-state">
                {loading ? "正在计算放置位置…" : "调整来源与偏移，查看合并预览。"}
              </div>
            )}
          </figure>
        </div>
      )}
      <div className="export-footer">
        <div role="status">
          {busy ? progress : error}
          {error && !busy && <button onClick={() => setRetry((v) => v + 1)}>重新预览</button>}
        </div>
        <div className="action-row">
          <button onClick={close}>{busy ? "取消合并" : "取消"}</button>
          <button
            className="primary-button"
            disabled={
              !preview || loading || busy || preview.added + preview.replaced + preview.rivers === 0
            }
            onClick={() => void submit()}
          >
            {busy ? "正在合并…" : "确认合并"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
