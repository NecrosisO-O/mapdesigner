/// <reference types="vite/client" />
import { useMemo, useRef, useState } from "react";
import {
  createEmptyDocument,
  createRuntimeState,
  type ExportRenderOptions,
  type MapDocument,
  type MapRuntimeState,
  type MapSummary
} from "@mapdesigner/map-core";
import { buildExportScene, renderSvgString } from "@mapdesigner/map-render";
import cases from "../../../docs/design/editor-v3/fixtures/cartography-gallery.json";
import { MapCanvas } from "./MapCanvas.js";
import "./editor.css";
const fixtures = cases as unknown as Array<{
  id: string;
  title: string;
  check: string;
  document: MapDocument;
  options: ExportRenderOptions;
}>;
const pngs = import.meta.glob("../../../docs/research/2026-10-03/visual-redesign/gallery/*.png", {
  eager: true,
  query: "?url",
  import: "default"
});
const frame = () => new Promise<number>(requestAnimationFrame);
const p95 = (a: number[]) => [...a].sort((a, b) => a - b)[Math.ceil(a.length * 0.95) - 1];
function performanceMap(count: number): { map: MapRuntimeState; summary: MapSummary } {
  const doc = createEmptyDocument({ id: "qa-" + count, name: "性能验收 " + count });
  const width = Math.ceil(Math.sqrt(count));
  for (let row = 0; row < 30; row++)
    for (let col = 0; col < 40; col++)
      doc.cells.push({
        row,
        col,
        terrain: (row + col) % 9 === 0 ? "mountain" : "plain",
        biome: (row + col) % 9 === 0 ? "conifer_forest" : "grassland",
        tags: [],
        note: ""
      });
  doc.features.rivers = [
    {
      id: "long",
      name: "长河",
      width_mode: "distance",
      points: [
        { row: -10000, col: 10, width: 2 },
        { row: 0, col: 12, width: 6 },
        { row: 10000, col: 10, width: 20 }
      ]
    }
  ];
  const map: MapRuntimeState = {
    document: doc,
    activeCells: doc.cells.map((c) => ({
      ...c,
      id: "cell@" + c.row + "," + c.col,
      display_coord: "R" + c.row + "C" + c.col,
      status: "designed"
    })),
    history: { past: [], future: [], limit: 100 }
  };
  return {
    map,
    summary: {
      meta: doc.meta,
      grid: doc.grid,
      designed_cell_count: count,
      feature_counts: { rivers: 1 },
      bounds: { min_row: 0, max_row: width - 1, min_col: 0, max_col: width - 1 }
    }
  };
}
export function VisualQa() {
  const [id, setId] = useState("junctions"),
    [filter, setFilter] = useState("none"),
    [comparison, setComparison] = useState(false),
    [running, setRunning] = useState(false),
    [report, setReport] = useState("");
  const [perf, setPerf] = useState<ReturnType<typeof performanceMap> | null>(null);
  const bench = useRef<HTMLDivElement>(null);
  const fixture = fixtures.find((f) => f.id === id)!;
  const svg = useMemo(() => {
    let map = createRuntimeState(fixture.document);
    const range = fixture.options.range;
    if (range)
      map = {
        ...map,
        activeCells: map.activeCells.filter(
          (c) =>
            c.row >= range.minRow &&
            c.row <= range.maxRow &&
            c.col >= range.minCol &&
            c.col <= range.maxCol
        )
      };
    return renderSvgString(buildExportScene({ map, options: fixture.options }));
  }, [fixture]);
  const png = Object.entries(pngs).find(([key]) => key.endsWith("/" + id + ".png"))?.[1] as
    string | undefined;
  async function run() {
    setRunning(true);
    setReport("");
    const results = [];
    for (const count of [10000, 100000, 500000]) {
      setPerf(performanceMap(count));
      await frame();
      await frame();
      await frame();
      bench.current!.scrollIntoView({ block: "start" });
      await frame();
      const canvas = bench.current!.querySelector<HTMLElement>('[aria-label="地图编辑区域"]')!;
      const rect = canvas.getBoundingClientRect(),
        frames: number[] = [],
        interactions: number[] = [];
      for (let i = 0; i < 50; i++) {
        const previous = await frame(),
          start = performance.now();
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: i % 2 ? 25 : -25,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          })
        );
        const rendered = await frame();
        await frame();
        if (i >= 10) {
          frames.push(rendered - previous);
          interactions.push(performance.now() - start);
        }
      }
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize;
      results.push({
        sourceCells: count,
        renderedCells: 1200,
        samples: 40,
        frameP95Ms: p95(frames),
        interactionP95Ms: p95(interactions),
        heapMB: memory ? memory / 1048576 : null,
        domElements: bench.current!.querySelectorAll("*").length
      });
      setReport(
        JSON.stringify(
          {
            method:
              "Actual MapCanvas at 1200 loaded cells, synthetic wheel events, rAF frame gaps and event-to-next-paint proxy; source count is summary metadata, HTTP/data loading is measured separately.",
            results
          },
          null,
          2
        )
      );
    }
    setRunning(false);
  }
  return (
    <main className="visual-qa">
      <style>
        {
          ".visual-qa{height:100dvh;overflow:auto;padding:24px;background:#F2F2EA}.qa-controls{display:flex;gap:16px;flex-wrap:wrap;align-items:end}.qa-controls label{min-width:200px}.qa-pictures{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}.qa-pictures img{display:block;max-width:100%;max-height:680px;margin:auto}.qa-pictures figure{margin:0;background:white;padding:12px;border-radius:10px}.qa-bench{height:700px;width:1100px;max-width:100%;position:relative}.qa-bench .map-canvas{height:100%;width:100%}.visual-qa pre{white-space:pre-wrap;background:white;padding:16px;user-select:text}.visual-qa h1{font-size:24px;margin:0}.qa-pictures figcaption{font-size:14px;margin-bottom:8px}"
        }
      </style>
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <filter id="deutan" colorInterpolationFilters="linearRGB">
            <feColorMatrix
              type="matrix"
              values="0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0"
            />
          </filter>
          <filter id="protan" colorInterpolationFilters="linearRGB">
            <feColorMatrix
              type="matrix"
              values="0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>
      <h1>MapDesigner · 固定视觉验收</h1>
      <div className="qa-controls">
        <label>
          视觉样例
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {fixtures.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          辨识度对照
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="none">正常颜色</option>
            <option value="grayscale(1)">灰度</option>
            <option value="url(#deutan)">绿色觉缺失模拟</option>
            <option value="url(#protan)">红色觉缺失模拟</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={comparison}
            onChange={(e) => setComparison(e.target.checked)}
          />
          对照导出的 PNG
        </label>
        <button disabled={running} onClick={() => void run()}>
          {running ? "正在测量…" : "运行浏览器性能验收"}
        </button>
      </div>
      <p>{fixture.check}</p>
      <div className="qa-pictures" style={{ filter }}>
        <figure>
          <figcaption>浏览器 · 共享 SVG 绘图</figcaption>
          <img
            alt={fixture.title + " 浏览器绘图"}
            src={"data:image/svg+xml," + encodeURIComponent(svg)}
          />
        </figure>
        {comparison && (
          <figure>
            <figcaption>输出 · 同一配置 PNG</figcaption>
            <img alt={fixture.title + " PNG 输出"} src={png} />
          </figure>
        )}
      </div>
      {perf && (
        <div className="qa-bench" ref={bench}>
          <MapCanvas
            key={perf.map.document.meta.id}
            map={perf.map}
            mapSummary={perf.summary}
            focusRequest={{ coord: { row: 15, col: 20 }, token: perf.summary.designed_cell_count }}
            selectedCell={null}
            selectedCellId={null}
            onSelectCell={() => {}}
            interactionMode="select"
            showCoordinates={false}
            showShorthand={false}
            showGrid
            showUndesigned={false}
          />
        </div>
      )}
      <pre aria-label="性能测量结果">{report || "尚未运行性能测量"}</pre>
      <p>
        色觉对照采用
        Machado、Oliveira、Fernandes（2009）的二色视觉矩阵；用于设计检查，不代替实际使用者辨识测试。
      </p>
    </main>
  );
}
