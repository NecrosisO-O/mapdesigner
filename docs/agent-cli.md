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

## 使用建议

- 人工阅读时优先看 `display_coord`，例如 `R3C-2`
- 程序内部稳定定位可使用 `cell_id`
- 写入前优先使用 `--dry-run`
- 批量操作后优先再次调用 `inspect-cell` 或 `inspect-area`
- 若命令失败，优先读取 envelope 中的 `errors`

## 当前适合 agent 调用的命令

- `maps list`
- `maps inspect`
- `maps inspect-cell`
- `maps inspect-area`
- `maps neighbors`
- `maps apply`
- `maps export-png`
