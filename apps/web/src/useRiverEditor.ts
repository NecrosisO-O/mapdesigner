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
import { useEffect, useState } from "react";

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

function parseWidthAnchors(value: string): Map<string, { coord: { row: number; col: number }; width: number }> {
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
      const lineIndex = line.findIndex((coord) => coord.row === anchor.coord.row && coord.col === anchor.coord.col);
      if (lineIndex > 0 && lineIndex < line.length - 1) {
        points.splice(index + 1, 0, { ...anchor.coord, width: anchor.width });
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      throw new Error(`宽度锚点 ${createDisplayCoord(anchor.coord.row, anchor.coord.col)} 不在河流路径上`);
    }
  }
  return points;
}

function draftFromRiver(river: RiverFeature | null): RiverDraft {
  return {
    name: river?.name ?? "",
    pointsText: river?.points.map((point) => createDisplayCoord(point.row, point.col)).join(", ") ?? "",
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
  const selectedRiver = rivers.find((river) => river.id === selectedRiverId) ?? null;
  const [draft, setDraft] = useState<RiverDraft>(draftFromRiver(null));
  const [drawingStatus, setDrawingStatus] = useState<RiverDrawingStatus>("idle");
  const [drawingPoints, setDrawingPoints] = useState<RiverPoint[]>([]);

  const riverDirty =
    selectedRiver !== null &&
    (draft.name !== selectedRiver.name ||
      draft.pointsText !== selectedRiver.points.map((point) => createDisplayCoord(point.row, point.col)).join(", ") ||
      draft.widthsText !== draftFromRiver(selectedRiver).widthsText ||
      draft.color !== (selectedRiver.color ?? "#2F83B7") ||
      draft.opacity !== String(selectedRiver.opacity ?? 0.88));

  function startNewRiver(): void {
    setSelectedRiverId("");
    setDraft(draftFromRiver(null));
    setDrawingStatus("idle");
    setDrawingPoints([]);
  }

  function selectRiver(id: string): void {
    const river = rivers.find((entry) => entry.id === id) ?? null;
    setSelectedRiverId(id);
    setDraft(draftFromRiver(river));
    setDrawingStatus("idle");
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
    setDrawingStatus("drawing");
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
    setDrawingPoints((current) => {
      if (current.some((point) => point.row === cell.row && point.col === cell.col)) {
        setMessage(`${cell.display_coord} 已在当前河流路径中`);
        return current;
      }
      const nextPoint: RiverPoint = {
        row: cell.row,
        col: cell.col,
        ...(current.length === 0 ? { width: DEFAULT_RIVER_WIDTH } : {})
      };
      const next = [...current, nextPoint];
      syncDrawingDraft(next);
      setMessage(`已添加河流点 ${cell.display_coord}`);
      return next;
    });
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

    const existingIds = new Set(rivers.map((river) => river.id));
    const result = await applyCommands([
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
              name: draft.name,
              points,
              color: draft.color || null,
              opacity
            }
          }
    ]);
    if (!result) {
      return false;
    }
    const nextRiver = selectedRiver
      ? result.document.features.rivers.find((river) => river.id === selectedRiver.id) ?? null
      : result.document.features.rivers.find((river) => !existingIds.has(river.id)) ?? null;
    setSelectedRiverId(nextRiver?.id ?? "");
    setDraft(draftFromRiver(nextRiver));
    setDrawingStatus("idle");
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
    setDrawingPoints([]);
    setDraft(draftFromRiver(selectedRiver));
    setMessage("已取消河流绘制");
  }

  async function deleteSelectedRiver(): Promise<void> {
    if (!currentMap || !selectedRiver) {
      return;
    }
    const result = await applyCommands([{
      action: "delete_river",
      source: "webui",
      river_id: selectedRiver.id
    }]);
    if (!result) {
      return;
    }
    startNewRiver();
    setDrawingStatus("idle");
    setMessage("河流已删除并保存到服务器");
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
    if (!currentMap) {
      startNewRiver();
      return;
    }
    if (selectedRiverId && !selectedRiver) {
      startNewRiver();
    }
  }, [currentMap, selectedRiver, selectedRiverId]);

  return {
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
