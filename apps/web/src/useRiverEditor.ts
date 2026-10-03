import {
  buildHexLine,
  createDisplayCoord,
  parseDisplayCoord,
  DEFAULT_RIVER_WIDTH,
  type ActiveCell,
  type MapCommand,
  type MapRuntimeState,
  type RiverFeature,
  type RiverPoint
} from "@mapdesigner/map-core";
import { useEffect, useRef, useState } from "react";

import { useEditorTask } from "./useEditorTask.js";

export interface RiverDraft {
  name: string;
  pointsText: string;
  widthsText: string;
  color: string;
  opacity: string;
}

export type RiverDrawingStatus = "idle" | "drawing";

function coordKey(coord: { row: number; col: number }): string {
  return `${coord.row},${coord.col}`;
}

function parseCoordToken(value: string): { row: number; col: number } | null {
  return parseDisplayCoord(value.trim());
}

function parseWidthAnchors(
  value: string
): Map<string, { coord: { row: number; col: number }; width: number }> {
  const widths = new Map<string, { coord: { row: number; col: number }; width: number }>();
  if (!value.trim()) {
    return widths;
  }
  for (const token of value.split(",")) {
    const [coordRaw, widthRaw] = token.split(":");
    const coord = coordRaw ? parseCoordToken(coordRaw) : null;
    const width = widthRaw ? Number(widthRaw) : Number.NaN;
    if (!coord || !Number.isFinite(width)) {
      throw new Error("宽度锚点格式应为 R0C0:4, R2C1:8");
    }
    widths.set(coordKey(coord), { coord, width });
  }
  return widths;
}

function parseRiverPoints(pointsText: string, widthsText: string): RiverPoint[] {
  const widths = parseWidthAnchors(widthsText);
  const points = pointsText
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const coord = parseCoordToken(token);
      if (!coord) {
        throw new Error(`无效坐标：${token}`);
      }
      const width = widths.get(coordKey(coord))?.width;
      return {
        ...coord,
        ...(width === undefined ? {} : { width })
      };
    });
  if (points.length < 2) {
    throw new Error("河流至少需要两个路径点");
  }
  for (const anchor of widths.values()) {
    if (points.some((point) => point.row === anchor.coord.row && point.col === anchor.coord.col)) {
      continue;
    }
    let inserted = false;
    for (let index = 0; index < points.length - 1; index += 1) {
      const line = buildHexLine(points[index]!, points[index + 1]!);
      const lineIndex = line.findIndex(
        (coord) => coord.row === anchor.coord.row && coord.col === anchor.coord.col
      );
      if (lineIndex > 0 && lineIndex < line.length - 1) {
        points.splice(index + 1, 0, { ...anchor.coord, width: anchor.width });
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      throw new Error(
        `宽度锚点 ${createDisplayCoord(anchor.coord.row, anchor.coord.col)} 不在河流路径上`
      );
    }
  }
  return points;
}

function draftFromRiver(river: RiverFeature | null): RiverDraft {
  return {
    name: river?.name ?? "",
    pointsText:
      river?.points.map((point) => createDisplayCoord(point.row, point.col)).join(", ") ?? "",
    widthsText:
      river?.points
        .filter((point) => typeof point.width === "number")
        .map((point) => `${createDisplayCoord(point.row, point.col)}:${point.width}`)
        .join(", ") ?? "",
    color: river?.color ?? "#2F83B7",
    opacity: String(river?.opacity ?? 0.88)
  };
}

function parseRiverDraftPoints(draft: RiverDraft): RiverPoint[] {
  return parseRiverPoints(draft.pointsText, draft.widthsText);
}

function parseRiverDraftPreviewPoints(draft: RiverDraft): RiverPoint[] {
  try {
    return parseRiverDraftPoints(draft);
  } catch {
    return draft.pointsText
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map(parseCoordToken)
      .filter((coord): coord is RiverPoint => Boolean(coord));
  }
}

export function useRiverEditor(
  currentMap: MapRuntimeState | null,
  applyCommands: (commands: MapCommand[]) => Promise<MapRuntimeState | null>,
  setMessage: (message: string) => void
) {
  const [selectedRiverId, setSelectedRiverId] = useState<string>("");
  const rivers = currentMap?.document.features?.rivers ?? [];
  const [selectedRiver, setSelectedRiver] = useState<RiverFeature | null>(null);
  const [draft, setDraft] = useState<RiverDraft>(draftFromRiver(null));
  const [drawingStatus, setDrawingStatus] = useState<RiverDrawingStatus>("idle");
  const [drawingPoints, setDrawingPoints] = useState<RiverPoint[]>([]);

  const task = useEditorTask(currentMap?.document.meta.id);
  const pointsRef = useRef(drawingPoints);
  const latest = useRef({ draft, selectedRiverId });
  latest.current = { draft, selectedRiverId };
  const riverDirty = JSON.stringify(draft) !== JSON.stringify(draftFromRiver(selectedRiver));
  function ensureCanLeaveRiver(): boolean {
    return !task.pending && (!riverDirty || window.confirm("河流有未应用修改，是否放弃？"));
  }

  function startNewRiver(): void {
    setSelectedRiverId("");
    setSelectedRiver(null);
    setDraft(draftFromRiver(null));
    setDrawingStatus("idle");
    pointsRef.current = [];
    setDrawingPoints([]);
  }

  function selectRiver(id: string): void {
    const river = rivers.find((entry) => entry.id === id) ?? null;
    setSelectedRiverId(id);
    setSelectedRiver(river);
    setDraft(draftFromRiver(river));
    setDrawingStatus("idle");
    pointsRef.current = [];
    setDrawingPoints([]);
  }

  function syncDrawingDraft(points: RiverPoint[]): void {
    setDraft((current) => ({
      ...current,
      name: current.name.trim() ? current.name : `River ${rivers.length + 1}`,
      pointsText: points.map((point) => createDisplayCoord(point.row, point.col)).join(", "),
      widthsText:
        points.length > 0
          ? `${createDisplayCoord(points[0]!.row, points[0]!.col)}:${points[0]!.width ?? DEFAULT_RIVER_WIDTH}`
          : ""
    }));
  }

  function startRiverDrawing(): void {
    if (drawingStatus === "drawing") {
      return;
    }
    setSelectedRiverId("");
    setSelectedRiver(null);
    setDrawingStatus("drawing");
    pointsRef.current = [];
    setDrawingPoints([]);
    setDraft((current) => ({
      ...draftFromRiver(null),
      name: current.name.trim() ? current.name : `River ${rivers.length + 1}`,
      color: current.color || "#2F83B7",
      opacity: current.opacity || "0.88"
    }));
    setMessage("已进入河流绘制模式");
  }

  function appendRiverPoint(cell: ActiveCell): void {
    if (drawingStatus !== "drawing") {
      return;
    }
    const current = pointsRef.current;
    if (current.some((point) => point.row === cell.row && point.col === cell.col)) {
      setMessage(cell.display_coord + " 已在当前河流路径中");
      return;
    }
    const next: RiverPoint[] = [
      ...current,
      { row: cell.row, col: cell.col, ...(current.length ? {} : { width: DEFAULT_RIVER_WIDTH }) }
    ];
    pointsRef.current = next;
    setDrawingPoints(next);
    syncDrawingDraft(next);
    setMessage("已添加河流点 " + cell.display_coord);
  }

  async function applyRiverDraft(): Promise<boolean> {
    if (!currentMap) {
      return false;
    }
    if (!draft.name.trim()) {
      setMessage("河流名称不能为空");
      return false;
    }

    let points: RiverPoint[];
    try {
      points = parseRiverPoints(draft.pointsText, draft.widthsText);
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    }

    const opacity = Number(draft.opacity);
    if (!Number.isFinite(opacity)) {
      setMessage("河流透明度必须是数字");
      return false;
    }

    const nextId =
      selectedRiver?.id ??
      "river-" +
        [...crypto.getRandomValues(new Uint32Array(4))]
          .map((value) => value.toString(16).padStart(8, "0"))
          .join("");
    const submitted = draft;
    const result = await task.run(() =>
      applyCommands([
        selectedRiver
          ? {
              action: "update_river",
              source: "webui",
              river_id: selectedRiver.id,
              changes: {
                name: draft.name,
                points,
                color: draft.color || null,
                opacity
              }
            }
          : {
              action: "create_river",
              source: "webui",
              river: {
                id: nextId,
                name: draft.name,
                points,
                color: draft.color || null,
                opacity
              }
            }
      ])
    );
    if (!result) {
      return false;
    }
    if (latest.current.selectedRiverId !== selectedRiverId) return false;
    const nextRiver = result.document.features.rivers.find((river) => river.id === nextId) ?? null;
    setSelectedRiverId(nextRiver?.id ?? "");
    setSelectedRiver(nextRiver);
    if (latest.current.draft === submitted) setDraft(draftFromRiver(nextRiver));
    setDrawingStatus("idle");
    pointsRef.current = [];
    setDrawingPoints([]);
    setMessage("河流修改已保存到服务器");
    return true;
  }

  async function finishRiverDrawing(): Promise<boolean> {
    if (drawingPoints.length < 2) {
      setMessage("河流至少需要两个路径点");
      return false;
    }
    return applyRiverDraft();
  }

  function cancelRiverDrawing(): void {
    setDrawingStatus("idle");
    pointsRef.current = [];
    setDrawingPoints([]);
    setDraft(draftFromRiver(selectedRiver));
    setMessage("已取消河流绘制");
  }

  async function deleteSelectedRiver(): Promise<void> {
    if (!currentMap || !selectedRiver) {
      return;
    }
    const result = await task.run(() =>
      applyCommands([
        {
          action: "delete_river",
          source: "webui",
          river_id: selectedRiver.id
        }
      ])
    );
    if (!result) {
      return;
    }
    startNewRiver();
    setDrawingStatus("idle");
    setMessage("河流已删除并保存到服务器");
  }

  function acceptConfirmedFeatures(features: { rivers: RiverFeature[] }): void {
    if (!selectedRiverId) return;
    const river = features.rivers.find((item) => item.id === selectedRiverId);
    if (!river) {
      startNewRiver();
      return;
    }
    setSelectedRiver(river);
    if (!riverDirty) setDraft(draftFromRiver(river));
  }

  const riverPreview =
    drawingStatus === "drawing" && drawingPoints.length >= 1
      ? {
          id: "__river-preview",
          name: draft.name.trim() || "River Preview",
          points: parseRiverDraftPreviewPoints(draft),
          color: draft.color || "#2F83B7",
          opacity: Number(draft.opacity) || 0.88
        }
      : null;

  useEffect(() => {
    startNewRiver();
  }, [currentMap?.document.meta.id]);
  useEffect(() => {
    if (!selectedRiverId || riverDirty || task.pending) return;
    const river = rivers.find((entry) => entry.id === selectedRiverId);
    if (river && river !== selectedRiver) {
      setSelectedRiver(river);
      setDraft(draftFromRiver(river));
    }
  }, [rivers, selectedRiverId, riverDirty, task.pending]);

  return {
    pending: task.pending,
    ensureCanLeaveRiver,
    acceptConfirmedFeatures,
    selectedRiverId,
    selectedRiver,
    riverDraft: draft,
    riverDirty,
    riverDrawingStatus: drawingStatus,
    riverDrawingPoints: drawingPoints,
    riverPreview,
    setRiverDraft: setDraft,
    startNewRiver,
    selectRiver,
    startRiverDrawing,
    appendRiverPoint,
    finishRiverDrawing,
    cancelRiverDrawing,
    applyRiverDraft,
    deleteSelectedRiver
  };
}
