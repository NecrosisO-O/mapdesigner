# Agent CLI Guide

`MapDesigner` 的 CLI 已支持面向 AI agent 的结构化工作流，推荐固定采用下面这条顺序：

1. `inspect`
2. `dry-run`
3. `apply`
4. `inspect`
5. `export-png`

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

### 1. 查看整张地图

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect --map-id demo-map
```

### 2. 查看单格

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect-cell --map-id demo-map --row 0 --col 0
```

返回结果会包含：

- `cell`
- `neighbors`
- `rivers`

### 3. 查看一片区域

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect-area --map-id demo-map --row 0 --col 0 --radius 2
```

返回结果会包含：

- `center`
- `radius`
- `cells`

### 4. 查看某格六邻格

```bash
pnpm exec tsx apps/server/src/cli.ts maps neighbors --map-id demo-map --row 0 --col 0
```

返回结果会包含：

- `center`
- `neighbors`

### 5. 先 dry-run 再正式 apply

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
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin --dry-run
```

`--dry-run` 不会写回磁盘，但会返回完整执行结果：

- `dryRun`
- `map`
- `warnings`
- `command_results`
- `changes`

`command_results` 按命令顺序给出逐条执行摘要。`changes` 给出聚合后的变更明细。每条变更都包含：

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
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin
```

### 6. 导出参考图

```bash
pnpm exec tsx apps/server/src/cli.ts maps export-png \
  --map-id demo-map \
  --preset reference \
  --scale 2 \
  --padding 32 \
  --background "#F4F0E6" \
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

### 7. 高级编辑命令

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
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin --dry-run
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

### 8. 管理河流覆盖层

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
- 批量操作后优先再次调用 `inspect-cell` 或 `inspect-area`
- `inspect-area --radius` 最大为 `50`
- 若命令失败，优先读取 envelope 中的 `errors`

## 当前适合 agent 调用的命令

- `maps list`
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
