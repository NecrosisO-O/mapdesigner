import { useEffect, useState } from "react";
import type { CellRange, MapFeaturePage, RiverFeature } from "@mapdesigner/map-core";
import { api } from "./api.js";
export function ObjectBrowser(props: {
  mapId: string;
  revision: number;
  range: CellRange | null;
  selectedId: string;
  onSelect: (river: RiverFeature) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"full" | "visible">("full");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<MapFeaturePage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const rangeKey = scope === "visible" ? JSON.stringify(props.range) : "";
  useEffect(() => {
    setOffset(0);
    setResult(null);
  }, [props.mapId, search, scope, rangeKey]);
  useEffect(() => {
    let cancelled = false;
    if (!props.mapId) return;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void api
        .searchMapFeatures(props.mapId, search, offset, scope === "visible" ? props.range : null)
        .then((response) => {
          if (cancelled) return;
          if (response.ok && response.result) setResult(response.result);
          else setError(response.errors[0]?.message ?? "无法加载对象");
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [props.mapId, props.revision, search, scope, rangeKey, offset, retry]);
  return (
    <div className="object-browser">
      <div className="section-heading">
        <h3>河流</h3>
        <button onClick={props.onCreate}>绘制河流</button>
      </div>
      <label>
        <span className="sr-only">搜索河流</span>
        <input
          aria-label="搜索河流"
          type="search"
          placeholder="按河流名称查找"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        查找范围
        <select value={scope} onChange={(e) => setScope(e.target.value as "full" | "visible")}>
          <option value="full">全图</option>
          <option value="visible">当前区域</option>
        </select>
      </label>
      {loading && <p role="status">正在查找…</p>}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setRetry((v) => v + 1)}>重新加载</button>
        </div>
      ) : (
        <>
          <p className="result-count">{result?.page.total ?? 0} 条河流 · 点击定位并编辑</p>
          <div className="river-list">
            {result?.rivers.map((river) => (
              <button
                key={river.id}
                aria-pressed={river.id === props.selectedId}
                onClick={() => props.onSelect(river)}
              >
                <span className="river-swatch" style={{ background: river.color ?? "#2F83B7" }} />
                <span>
                  {river.name}
                  <small>{river.points.length} 个节点</small>
                </span>
              </button>
            ))}
          </div>
          {!loading && !result?.rivers.length && (
            <p>没有匹配的河流。可以调整搜索范围或绘制一条河流。</p>
          )}
          <div className="pagination">
            <button
              disabled={loading || offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 50))}
            >
              上一页
            </button>
            <span>
              {Math.floor(offset / 50) + 1} /{" "}
              {Math.max(1, Math.ceil((result?.page.total ?? 0) / 50))}
            </span>
            <button
              disabled={loading || !result?.page.has_more}
              onClick={() => setOffset((value) => value + 50)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  );
}
