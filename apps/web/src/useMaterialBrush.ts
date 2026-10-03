import {
  resolveMaterial,
  type ActiveCell,
  type BiomeKey,
  type MapCommand,
  type MapRuntimeState,
  type TerrainKey
} from "@mapdesigner/map-core";
import { useState } from "react";
export interface Material {
  terrain: TerrainKey;
  biome: BiomeKey | null;
}
export function materialForCell(
  cell: ActiveCell,
  material: Material,
  fields: { terrain: boolean; biome: boolean }
): ActiveCell {
  const terrain = fields.terrain ? material.terrain : cell.terrain;
  if (!terrain) return cell;
  return {
    ...cell,
    status: "designed",
    ...resolveMaterial(terrain, fields.biome ? material.biome : cell.biome)
  };
}
export function useMaterialBrush(
  applyCommands: (commands: MapCommand[]) => Promise<MapRuntimeState | null>,
  setMessage: (message: string) => void
) {
  const [material, setMaterial] = useState<Material>({ terrain: "plain", biome: "grassland" });
  const [fields, setFields] = useState({ terrain: true, biome: true });
  const [radius, setRadius] = useState(0);
  const [recent, setRecent] = useState<Material[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const remember = (value: Material) =>
    setRecent((items) =>
      [
        value,
        ...items.filter((item) => item.terrain !== value.terrain || item.biome !== value.biome)
      ].slice(0, 8)
    );
  function choose(value: Material) {
    setMaterial(value);
    remember(value);
    setNotice(null);
  }
  function chooseTerrain(terrain: TerrainKey) {
    const resolved = resolveMaterial(terrain, material.biome);
    choose(resolved);
    setNotice(resolved.notice);
  }
  function sample(cell: ActiveCell) {
    if (!cell.terrain) {
      setMessage("此格尚未设计，选择已设计格取样。");
      return false;
    }
    choose({ terrain: cell.terrain, biome: cell.biome });
    setMessage("已取样，可以直接绘制。");
    return true;
  }
  async function paint(cells: ActiveCell[]) {
    const groups = new Map<
      string,
      { changes: Extract<MapCommand, { action: "patch_cells" }>["changes"]; targets: ActiveCell[] }
    >();
    let adjusted = 0;
    for (const cell of cells) {
      const next = materialForCell(cell, material, fields);
      if (!next.terrain || (next.terrain === cell.terrain && next.biome === cell.biome)) continue;
      const changes = {
        ...(fields.terrain ? { terrain: next.terrain } : {}),
        ...(fields.biome || next.biome !== cell.biome ? { biome: next.biome } : {})
      };
      if (!fields.biome && cell.biome !== next.biome) adjusted++;
      const key = JSON.stringify(changes),
        group = groups.get(key) ?? { changes, targets: [] as ActiveCell[] };
      group.targets.push(cell);
      groups.set(key, group);
    }
    if (!groups.size) {
      setMessage("这次笔刷没有改变格子。");
      return;
    }
    const result = await applyCommands(
      [...groups.values()].map((group) => ({
        action: "patch_cells",
        source: "webui",
        targets: group.targets.map((c) => ({ row: c.row, col: c.col })),
        changes: group.changes
      }))
    );
    if (result) {
      remember(material);
      setMessage(
        "已绘制 " +
          [...groups.values()].reduce((n, g) => n + g.targets.length, 0) +
          " 格" +
          (adjusted ? "，并清除 " + adjusted + " 格不兼容的生态。" : "，可撤销本次笔刷。")
      );
    }
  }
  return {
    material,
    fields,
    radius,
    recent,
    notice,
    choose,
    chooseTerrain,
    chooseBiome: (biome: BiomeKey | null) => choose({ ...material, biome }),
    setFields,
    setRadius,
    sample,
    paint
  };
}
