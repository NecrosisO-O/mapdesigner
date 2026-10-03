import {
  getRiverPointWidths,
  isOpenWaterTerrain,
  type ActiveCell,
  type RiverFeature
} from "@mapdesigner/map-core";

export interface RiverAdvice {
  id: string;
  pointIndex: number;
  message: string;
}
/** Editing hints use only the loaded neighborhood; no elevation or discharge is inferred. */
export function riverAdvice(
  river: RiverFeature,
  rivers: RiverFeature[],
  cells: ActiveCell[]
): RiverAdvice[] {
  const advice: RiverAdvice[] = [],
    widths = getRiverPointWidths(river.points, river.width_mode ?? "distance");
  river.points.forEach((p, i) => {
    const add = (kind: string, message: string) =>
      advice.push({ id: river.id + ":" + i + ":" + kind, pointIndex: i, message });
    const last = i === river.points.length - 1,
      kind = i === 0 ? river.start_kind : last ? river.end_kind : null;
    const cell = cells.find((c) => c.row === p.row && c.col === p.col);
    if (kind === "water" && cell && !isOpenWaterTerrain(cell.terrain))
      add("water", "端点标为入海或入湖，但所在格不是开放水面。可调整地形、端点位置或端部类型。");
    if (i > 0 && Math.max(widths[i]!, widths[i - 1]!) / Math.min(widths[i]!, widths[i - 1]!) > 4)
      add("width", "这段河宽变化超过四倍，请确认是有意的扩展或收窄。");
    if (p.junction_id) {
      const members = rivers.flatMap((r) =>
        r.points.flatMap((v, index) =>
          v.junction_id === p.junction_id ? [{ river: r, index }] : []
        )
      );
      if (members.length < 2)
        add("connection", "当前区域只找到一个连接成员，请检查相邻河流是否已移除或断开。");
      else {
        const flows = members.flatMap(({ river: r, index }) =>
          r.flow_direction === "unspecified" ||
          !r.flow_direction ||
          (index > 0 && index < r.points.length - 1)
            ? []
            : [(index === 0) === (r.flow_direction === "forward") ? "out" : "in"]
        );
        if (flows.length === members.length && new Set(flows).size === 1)
          add(
            "flow",
            flows[0] === "in"
              ? "相连河流都朝向此节点。若这里不是内流终点，请检查是否缺少下游河段。"
              : "相连河流都离开此节点。若这里不是源头或分流起点，请检查流向。"
          );
      }
    }
  });
  return advice;
}
