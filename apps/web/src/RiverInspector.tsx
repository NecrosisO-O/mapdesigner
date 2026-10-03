import { riverAdvice } from "./river-advice.js";
import { useState } from "react";
import {
  buildHexLine,
  createDisplayCoord,
  getHexDistance,
  type ActiveCell,
  type RiverFeature,
  type RiverPoint,
  type RiverPointReference
} from "@mapdesigner/map-core";
import { riverGeometry } from "@mapdesigner/map-render";
import type { useRiverEditor } from "./useRiverEditor.js";

export type RiverEditor = ReturnType<typeof useRiverEditor>;
export interface RiverInspectorProps {
  editor: RiverEditor;
  rivers: RiverFeature[];
  cells: ActiveCell[];
  disabled: boolean;
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onApply: () => void;
  onDelete: () => void;
  onBranch: () => void;
  onLocate: (point: RiverPoint) => void;
}
export function RiverInspector({
  editor: e,
  rivers,
  cells,
  disabled,
  onStart,
  onFinish,
  onCancel,
  onApply,
  onDelete,
  onBranch,
  onLocate
}: RiverInspectorProps) {
  const [target, setTarget] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const advice = riverAdvice(e.draftRiver, rivers, cells).filter((a) => !dismissed.includes(a.id));
  const draft = e.riverDraft,
    points = e.riverPoints,
    node = points[e.selectedNode],
    drawing = e.riverDrawingStatus === "drawing";
  const patch = (value: Partial<typeof draft>) =>
    e.setRiverDraft((current) => ({ ...current, ...value }));
  const updateNode = (value: Partial<RiverPoint>) =>
    e.editPoints(points.map((p, i) => (i === e.selectedNode ? { ...p, ...value } : p)));
  const geometry = riverGeometry(e.draftRiver),
    widths = geometry.filter((p) => p.controlIndex !== undefined);
  const effectiveWidth = widths.find((p) => p.controlIndex === e.selectedNode)?.width ?? 4;
  const candidates = node
    ? rivers
        .filter((r) => r.id !== e.selectedRiverId)
        .flatMap((r) =>
          r.points.flatMap((p, i) =>
            getHexDistance(p, node) <= 2
              ? [
                  {
                    value: JSON.stringify({ river_id: r.id, point_index: i }),
                    label: r.name + " · 节点 " + (i + 1) + " · " + createDisplayCoord(p.row, p.col)
                  }
                ]
              : []
          )
        )
        .slice(0, 60)
    : [];
  function insertNode() {
    if (!node) return;
    const next = points[e.selectedNode + 1];
    const line = next ? buildHexLine(node, next) : [];
    const p =
      line.length > 2 ? line[Math.floor(line.length / 2)]! : { row: node.row + 1, col: node.col };
    if (points.some((v) => v.row === p.row && v.col === p.col)) return;
    e.editPoints([...points.slice(0, e.selectedNode + 1), p, ...points.slice(e.selectedNode + 1)]);
    e.setSelectedNode(e.selectedNode + 1);
  }
  function preset(kind: "equal" | "widen" | "narrow") {
    if (kind === "narrow") {
      updateNode({ width: Math.max(0.5, Math.round(effectiveWidth * 5) / 10) });
      return;
    }
    e.editPoints(
      points.map((p, i) => ({
        ...p,
        width:
          kind === "equal"
            ? Math.round(effectiveWidth * 10) / 10
            : i === 0
              ? 2
              : i === points.length - 1
                ? 12
                : undefined
      }))
    );
  }
  return (
    <section className="panel cell-editor-panel river-editor-panel">
      <div className="cell-editor-heading">
        <div>
          <h2>节点与河宽</h2>
          <p>
            {e.selectedRiver?.name || "新河流"} · {drawing ? "路径点：" : "节点 "}
            {points.length}
          </p>
        </div>
        {e.riverDirty && <span className="status-chip status-chip-dirty">未应用</span>}
      </div>
      <div className="cell-editor-fields">
        <fieldset disabled={disabled || e.pending} className="river-fields">
          <label>
            河流名称
            <input value={draft.name} onChange={(ev) => patch({ name: ev.target.value })} />
          </label>
          {node && (
            <>
              <div className="river-primary-grid">
                <label>
                  当前节点
                  <select
                    value={e.selectedNode}
                    onChange={(ev) => {
                      e.setSelectedNode(Number(ev.target.value));
                      setTarget("");
                    }}
                  >
                    {points.map((p, i) => (
                      <option key={i} value={i}>
                        {i + 1} · {createDisplayCoord(p.row, p.col)}
                        {p.junction_id ? " · 已连接" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  节点宽度
                  <input
                    type="number"
                    min=".5"
                    max="64"
                    step=".5"
                    value={node.width ?? ""}
                    placeholder={"自动 · " + effectiveWidth.toFixed(1)}
                    onChange={(ev) =>
                      updateNode({
                        width: ev.target.value === "" ? undefined : Number(ev.target.value)
                      })
                    }
                  />
                </label>
              </div>
              <p className="field-help">
                {node.width === undefined
                  ? "自动插值节点，填写数值即可设置宽度锚点。"
                  : "显式宽度锚点，清空数值可恢复沿程插值。"}
              </p>
              <div className="action-row">
                <button onClick={() => preset("equal")}>等宽</button>
                <button onClick={() => preset("widen")}>渐宽</button>
                <button onClick={() => preset("narrow")}>局部收窄</button>
              </div>
              <details className="editor-disclosure">
                <summary>节点位置与路径</summary>
                <div className="compact-field-grid">
                  <label>
                    节点行
                    <input
                      type="number"
                      step="1"
                      value={node.row}
                      onChange={(ev) => {
                        if (ev.target.value && Number.isSafeInteger(Number(ev.target.value)))
                          updateNode({ row: Number(ev.target.value) });
                      }}
                    />
                  </label>
                  <label>
                    节点列
                    <input
                      type="number"
                      step="1"
                      value={node.col}
                      onChange={(ev) => {
                        if (ev.target.value && Number.isSafeInteger(Number(ev.target.value)))
                          updateNode({ col: Number(ev.target.value) });
                      }}
                    />
                  </label>
                </div>
                <div className="action-row">
                  <button onClick={() => onLocate(node)}>定位节点</button>
                  <button disabled={drawing} onClick={insertNode}>
                    插入节点
                  </button>
                  <button
                    disabled={drawing || points.length <= 2 || Boolean(node.junction_id)}
                    onClick={() => e.editPoints(points.filter((_, i) => i !== e.selectedNode))}
                  >
                    移除节点
                  </button>
                </div>
              </details>
              <p className="field-help">
                画布中拖动圆点改位置，拖动两侧方块改宽度；每次拖动可一步撤销。按 Esc 取消。
              </p>
            </>
          )}
          {points.length > 0 ? (
            <div className="river-width-preview">
              <svg viewBox="0 0 260 50" role="img" aria-label="沿程宽度预览">
                <path
                  d={
                    geometry
                      .map(
                        (p, i) =>
                          (i ? "L " : "M ") +
                          (8 + (p.distance / Math.max(1, geometry.at(-1)!.distance)) * 244) +
                          " " +
                          (25 - p.width * 0.3)
                      )
                      .join(" ") +
                    " " +
                    [...geometry]
                      .reverse()
                      .map(
                        (p) =>
                          "L " +
                          (8 + (p.distance / Math.max(1, geometry.at(-1)!.distance)) * 244) +
                          " " +
                          (25 + p.width * 0.3)
                      )
                      .join(" ") +
                    " Z"
                  }
                  fill="currentColor"
                />
              </svg>
              <p>宽度按地图单位表示 · 不代表流量</p>
            </div>
          ) : (
            <div className="empty-state">
              <p>在地图上依次点击，画出第一条河流。</p>
              <button className="primary-button" onClick={onStart}>
                开始绘制
              </button>
            </div>
          )}
          <details className="editor-disclosure">
            <summary>流向与端点</summary>
            <label>
              流向
              <select
                value={draft.flowDirection}
                onChange={(ev) =>
                  patch({ flowDirection: ev.target.value as typeof draft.flowDirection })
                }
              >
                <option value="unspecified">未指定</option>
                <option value="forward">从首节点到末节点</option>
                <option value="reverse">从末节点到首节点</option>
              </select>
            </label>
            <button
              disabled={draft.flowDirection === "unspecified"}
              onClick={() =>
                patch({ flowDirection: draft.flowDirection === "forward" ? "reverse" : "forward" })
              }
            >
              反转流向
            </button>
            <p className="field-help">反转流向保留所有节点的位置和宽度。</p>
            {(["startKind", "endKind"] as const).map((key, i) => (
              <label key={key}>
                {i ? "末节点端部" : "首节点端部"}
                <select value={draft[key]} onChange={(ev) => patch({ [key]: ev.target.value })}>
                  <option value="auto">按所在水面衔接</option>
                  <option value="spring">源头 · 收束</option>
                  <option value="water">入海或入湖</option>
                  <option value="open">开放端部</option>
                </select>
              </label>
            ))}
          </details>
          <details className="editor-disclosure">
            <summary>节点连接与分支{node?.junction_id ? " · 已连接" : ""}</summary>
            <p className="field-help">相交不自动汇流。连接节点共享位置，解除连接后保留各自河道。</p>
            {drawing ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={e.snapConnections}
                  onChange={(ev) => e.setSnapConnections(ev.target.checked)}
                />
                点击已有节点时连接
              </label>
            ) : (
              <>
                <label>
                  附近可连接节点
                  <select value={target} onChange={(ev) => setTarget(ev.target.value)}>
                    <option value="">选择两格内的目标节点</option>
                    {candidates.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="action-row">
                  <button
                    disabled={!target || e.riverDirty || !e.selectedRiverId}
                    onClick={() => void e.editConnection(JSON.parse(target) as RiverPointReference)}
                  >
                    连接到目标
                  </button>
                  <button
                    disabled={!node?.junction_id || e.riverDirty}
                    onClick={() => void e.editConnection(null)}
                  >
                    解除连接
                  </button>
                </div>
                <button disabled={!node || e.riverDirty || !e.selectedRiverId} onClick={onBranch}>
                  从此节点创建分支
                </button>
                {e.riverDirty && (
                  <p className="field-notice">应用当前修改后可编辑连接或创建分支。</p>
                )}
              </>
            )}
          </details>
          {e.selectedRiverId && (
            <details className="editor-disclosure">
              <summary>水系编辑建议 · {advice.length}</summary>
              <p className="field-help">
                根据当前区域的节点、流向和宽度提供建议。允许有意的分汊、局部收窄及内流终点；没有高程和流量数据，未进行物理水文校验。
              </p>
              {advice.length ? (
                advice.map((a) => (
                  <div className="river-advice" key={a.id}>
                    <p>{a.message}</p>
                    <div className="action-row">
                      <button
                        onClick={() => {
                          e.setSelectedNode(a.pointIndex);
                          onLocate(points[a.pointIndex]!);
                        }}
                      >
                        定位节点 {a.pointIndex + 1}
                      </button>
                      <button onClick={() => setDismissed((list) => [...list, a.id])}>
                        忽略本次提示
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p>当前区域没有需要提示的项目。</p>
              )}
            </details>
          )}
          <details className="editor-disclosure">
            <summary>颜色与路径文本</summary>
            <div className="compact-field-grid">
              <label>
                颜色
                <input
                  type="color"
                  value={draft.color}
                  onChange={(ev) => patch({ color: ev.target.value })}
                />
              </label>
              <label>
                透明度
                <input
                  type="number"
                  min=".1"
                  max="1"
                  step=".05"
                  value={draft.opacity}
                  onChange={(ev) => patch({ opacity: ev.target.value })}
                />
              </label>
            </div>
            <label>
              路径坐标
              <textarea
                rows={3}
                value={draft.pointsText}
                onChange={(ev) => patch({ pointsText: ev.target.value })}
              />
            </label>
            <label>
              宽度锚点
              <textarea
                rows={2}
                value={draft.widthsText}
                onChange={(ev) => patch({ widthsText: ev.target.value })}
              />
            </label>
            <p className="field-help">
              路径格式 R0C0, R1C0；宽度格式 R0C0:4。连接节点请使用上方数值或画布编辑。
            </p>
          </details>
        </fieldset>
      </div>
      <div className="panel-header">
        <div className="action-row">
          <button
            className="primary-button"
            disabled={disabled || e.pending || points.length < 2 || (!drawing && !e.riverDirty)}
            onClick={drawing ? onFinish : onApply}
          >
            {drawing ? "结束绘制" : "应用修改"}
          </button>
          <button
            disabled={e.pending || (!drawing && !e.riverDirty)}
            onClick={drawing ? onCancel : e.revertDraft}
          >
            {drawing ? "取消" : "还原"}
          </button>
          {!drawing && (
            <details className="cell-more-actions">
              <summary>更多</summary>
              <div>
                <button onClick={onStart}>绘制新河流</button>
                <button
                  className="danger-button"
                  disabled={!e.selectedRiverId || e.pending}
                  onClick={onDelete}
                >
                  删除河流
                </button>
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
