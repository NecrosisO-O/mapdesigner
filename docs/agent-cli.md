# Agent CLI Guide

`MapDesigner` 的 CLI 已支持面向 AI agent 的结构化工作流，推荐固定采用下面这条顺序：

1. `summary`
2. `cells` / `inspect-cell` / `inspect-area`
3. `apply --dry-run --summary`
4. `apply --summary`
5. `summary` / `cells` / `inspect-area`
6. `export-png`

所有 CLI 输出都保持 JSON envelope：

```json
{
  "ok": true,
  "result": {},
  "warnings": [],
  "errors": []
}
```

## 推荐工作流

### 1. 查看地图摘要

优先用 `summary` 了解地图元数据、边界和已设计单元格数量。这个命令不会返回完整单元格数组，适合作为大地图和 agent 工作流的入口。

```bash
pnpm exec tsx apps/server/src/cli.ts maps summary --map-id demo-map
```

### 2. 查看局部单元格范围

需要扫描一块矩形窗口时使用 `cells`。默认只返回范围内已设计单元格；如果希望同时看到已设计格周边的可扩展空白格，加上 `--include-undesigned`。

```bash
pnpm exec tsx apps/server/src/cli.ts maps cells \
  --map-id demo-map \
  --min-row -10 \
  --max-row 10 \
  --min-col -10 \
  --max-col 10 \
  --include-undesigned
```

### 3. 查看整张地图

`inspect` 会返回完整 runtime，适合小地图、调试和兼容旧脚本。大地图或自动化流程应优先使用 `summary`、`cells`、`inspect-cell`、`inspect-area`。

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect --map-id demo-map
```

### 4. 查看单格

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect-cell --map-id demo-map --row 0 --col 0
```

返回结果会包含：

- `cell`
- `neighbors`
- `rivers`

### 5. 查看一片区域

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect-area --map-id demo-map --row 0 --col 0 --radius 2
```

返回结果会包含：

- `center`
- `radius`
- `cells`

### 6. 查看某格六邻格

```bash
pnpm exec tsx apps/server/src/cli.ts maps neighbors --map-id demo-map --row 0 --col 0
```

返回结果会包含：

- `center`
- `neighbors`

### 7. 先 dry-run 再正式 apply

推荐先预演：

```bash
echo '{
  "commands": [
    {
      "action": "set_cell",
      "source": "cli",
      "target": { "row": 0, "col": 0 },
      "changes": { "terrain": "plain", "biome": "grassland" }
    }
  ]
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin --dry-run --summary
```

`--dry-run` 不会写回磁盘。加上 `--summary` 会返回紧凑摘要，适合大批量修改：

- `map_id`
- `revision`
- `designed_cell_count`
- `dry_run`
- `warning_count`
- `changed_count`
- `created_count`
- `updated_count`
- `cleared_count`
- `terrain_summary`
- `biome_summary`

不加 `--summary` 时会返回完整执行结果，包含 `map`、`command_results` 和 `changes`。`command_results` 按命令顺序给出逐条执行摘要；`changes` 给出聚合后的变更明细。每条变更都包含：

- `coord`
- `cell_id`
- `display_coord`
- `before`
- `after`

确认无误后再正式执行：

```bash
echo '{
  "commands": [
    {
      "action": "set_cell",
      "source": "cli",
      "target": { "row": 0, "col": 0 },
      "changes": { "terrain": "plain", "biome": "grassland" }
    }
  ]
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin --summary
```

### 8. 导出参考图

```bash
pnpm exec tsx apps/server/src/cli.ts maps export-png \
  --map-id demo-map \
  --preset reference \
  --scale 2 \
  --padding 32 \
  --background "#F4F0E6" \
  --min-row -10 \
  --max-row 10 \
  --min-col -10 \
  --max-col 10 \
  --include-grid \
  --include-coordinates \
  --include-shorthand
```

`maps export-png` 支持的参数：

- `--preset clean|reference`
- `--scale 1..4`
- `--padding 0..256`
- `--background #RRGGBB|transparent`
- `--include-grid`
- `--include-coordinates`
- `--include-shorthand`
- `--include-undesigned`
- `--min-row --max-row --min-col --max-col`：可选，导出指定区域；大地图推荐始终使用区域导出

### 9. 高级编辑命令

批量设置多个单元格可使用 `set_cells`：

```bash
echo '{
  "commands": [
    {
      "action": "set_cells",
      "source": "cli",
      "targets": [
        { "row": 0, "col": 0 },
        { "row": 0, "col": 1 },
        { "row": 1, "col": 0 }
      ],
      "changes": {
        "terrain": "plain",
        "biome": "grassland",
        "tags": ["peak"],
        "note": "批量设置示例"
      }
    }
  ]
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin --dry-run --summary
```

全图替换地形可使用 `replace_terrain`：

```json
{
  "action": "replace_terrain",
  "source": "cli",
  "match": { "terrain": "plain" },
  "changes": { "terrain": "hill" }
}
```

全图替换生态可使用 `replace_biome`：

```json
{
  "action": "replace_biome",
  "source": "cli",
  "match": { "biome": "grassland" },
  "changes": { "biome": "shrubland" }
}
```

批量标注若需要保留各格原有地形，可提交多条 `annotate_cell` 命令，而不是用 `set_cells` 覆盖整格：

```json
{
  "commands": [
    {
      "action": "annotate_cell",
      "source": "cli",
      "target": { "row": 2, "col": 1 },
      "changes": { "tags": ["cave_entrance"], "note": "洞穴入口" }
    }
  ]
}
```

### 10. 管理河流覆盖层

河流覆盖层是叠加在单元格地貌之上的线性要素，适合小河、支流、溪流和穿过其他地形的河道。

查看河流：

```bash
pnpm exec tsx apps/server/src/cli.ts maps rivers list --map-id demo-map
```

创建河流：

```bash
pnpm exec tsx apps/server/src/cli.ts maps rivers create \
  --map-id demo-map \
  --id main-river \
  --name "Main River" \
  --points R0C0,R0C2,R2C3 \
  --widths R0C0:2,R0C1:4,R2C3:8
```

查看单条河流：

```bash
pnpm exec tsx apps/server/src/cli.ts maps rivers inspect --map-id demo-map --river-id main-river
```

删除河流：

```bash
pnpm exec tsx apps/server/src/cli.ts maps rivers delete --map-id demo-map --river-id main-river
```

`--points` 使用 `R<row>C<col>` 列表。第一个点可视为源头或入图点，最后一个点可视为终点或出图点；如果端点落在湖泊、海洋、河口、潮滩等水域单元格上，渲染会用水域端点标记提示衔接。`--widths` 是可选宽度锚点；相邻锚点之间会按路径渐变。宽度锚点可以落在两个显式控制点之间的自动补齐路径上，CLI 会把它插入为路径锚点，方便 agent 精细控制河宽。

## 输入格式

`maps apply` 正式输入格式为：

```json
{
  "commands": [
    {
      "action": "set_cell",
      "source": "cli",
      "target": { "row": 0, "col": 0 },
      "changes": {
        "terrain": "plain",
        "biome": "grassland"
      }
    }
  ]
}
```

当前也兼容：

- 单条 `MapCommand`
- `MapCommand[]`

河流也可以通过 `maps apply` 直接写入结构化命令：

```json
{
  "commands": [
    {
      "action": "create_river",
      "source": "cli",
      "river": {
        "id": "main-river",
        "name": "Main River",
        "points": [
          { "row": 0, "col": 0, "width": 2 },
          { "row": 0, "col": 2 },
          { "row": 2, "col": 3, "width": 8 }
        ]
      }
    }
  ]
}
```

## 使用建议

- 人工阅读时优先看 `display_coord`，例如 `R3C-2`
- 程序内部稳定定位可使用 `cell_id`
- 写入前优先使用 `--dry-run`
- 大地图优先用 `summary` 和 `cells`，不要把 `inspect` 当作默认入口
- 批量操作后优先再次调用 `summary`、`cells`、`inspect-cell` 或 `inspect-area`
- `inspect-area --radius` 最大为 `50`
- 若命令失败，优先读取 envelope 中的 `errors`

## 当前适合 agent 调用的命令

- `maps list`
- `maps summary`
- `maps cells`
- `maps inspect`
- `maps inspect-cell`
- `maps inspect-area`
- `maps neighbors`
- `maps apply`
- `maps rivers list`
- `maps rivers inspect`
- `maps rivers create`
- `maps rivers update`
- `maps rivers delete`
- `maps export-png`
