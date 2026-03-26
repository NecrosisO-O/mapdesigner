# MapDesigner

MapDesigner 是一个本地优先的六角格地图设计工具，面向异世界与世界观设定场景。

V1 当前交付形态为：

- 本地 `WebUI`
- 本地 `Fastify` 服务
- 可供 AI agent 调用的结构化 `CLI`

## 目录结构

- `apps/web`: React + Vite 编辑界面
- `apps/server`: Fastify API、本地文件读写、PNG 导出、CLI 入口
- `packages/map-core`: 坐标、命令、校验、活动区域、序列化、历史
- `packages/map-render`: SVG 场景构建、程序化地形/生态视觉、导出渲染
- `storage/maps`: 地图 JSON 主文件目录
- `storage/exports`: 导出的 JSON / PNG 文件目录

## 环境要求

- Node.js `20 LTS`
- `pnpm`

## 安装与启动

在仓库根目录执行：

```bash
pnpm install
pnpm dev:server
pnpm dev:web
```

默认情况下：

- Server 运行在 `http://localhost:3010`
- WebUI 由 Vite 提供本地开发地址

## 常用脚本

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 数据与文件

仓库约定：

- 正式默认数据目录是仓库根的 `storage/maps` 与 `storage/exports`
- `apps/server/storage/` 是早期开发期遗留的本地运行目录，不作为正式持久化位置
- 本地运行生成的测试地图、临时导出文件默认不建议提交到 Git
- 如果后续需要保留示例地图，建议显式挑选少量文件纳入版本控制，而不是直接提交整个运行数据目录

### 地图主文件

- 持久化格式固定为 `JSON`
- 存放目录：`storage/maps`
- 顶层结构：
  - `schema_version`
  - `meta`
  - `grid`
  - `cells`

### 导出文件

- 导出目录：`storage/exports`
- 支持导出：
  - `JSON`
  - `PNG`
- WebUI 导出 PNG 时会在服务端落盘，同时直接触发浏览器下载
- CLI / server 仍然保留文件落盘能力，便于自动化流程与离线留档

### 运行时规则

- 六角格布局固定为 `flat-top-even-q`
- 原点固定为 `row: 0, col: 0`
- 界面显示坐标格式为 `R{row}C{col}`
- 内部稳定编号为 `cell@{row},{col}`
- 文件只保存 `designed` 单元格
- 运行时活动区域为：
  - 所有 `designed` 单元格
  - 它们外围一圈 `undesigned` 单元格
- 当地图还没有任何已设计单元格时，回退到 7 格种子区

## WebUI 操作流

当前 WebUI 已支持以下基础闭环：

1. 新建地图
2. 打开地图
3. 在中央六角地图上选中单元格
4. 通过 `terrain 分类 -> terrain` 两级选择编辑地形，并使用与 terrain 双向联动的 `biome` 选择
5. 保存到地图文件
6. 另存为新地图
7. 重命名当前地图
8. 导入 / 导出 JSON
9. 按参数导出 PNG
10. 撤销 / 重做当前会话内修改

界面分区说明：

- 顶栏：地图管理、保存、导入导出、复制删除、撤销重做
- 左栏：地图列表、显示控制、PNG 导出选项、状态、悬停信息
- 中栏：SVG 六角地图画布，支持滚轮缩放与拖拽平移
- 右栏：当前单元格属性编辑、操作区、会话历史摘要

## CLI 用法

CLI 入口名为 `mapdesigner`，由 `apps/server` 提供。

开发环境下可直接从仓库根目录执行：

```bash
pnpm exec tsx apps/server/src/cli.ts maps list
```

常用命令示例：

```bash
pnpm exec tsx apps/server/src/cli.ts maps create --name "Demo Map"
pnpm exec tsx apps/server/src/cli.ts maps inspect --map-id demo-map
pnpm exec tsx apps/server/src/cli.ts maps inspect-cell --map-id demo-map --row 0 --col 0
pnpm exec tsx apps/server/src/cli.ts maps inspect-area --map-id demo-map --row 0 --col 0 --radius 2
pnpm exec tsx apps/server/src/cli.ts maps neighbors --map-id demo-map --row 0 --col 0
pnpm exec tsx apps/server/src/cli.ts maps export-json --map-id demo-map
pnpm exec tsx apps/server/src/cli.ts maps export-png --map-id demo-map --preset reference
```

结构化命令应用示例：

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

先预演再落盘：

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

兼容性说明：

- `maps apply` 正式输入格式为 `{ "commands": [...] }`
- 当前也兼容单条 `MapCommand` 与 `MapCommand[]`，便于已有脚本平滑过渡
- 推荐 AI agent 固定采用：
  - `inspect`
  - `dry-run`
  - `apply`
  - `inspect`

CLI 当前支持：

- `maps list`
- `maps create`
- `maps inspect`
- `maps inspect-cell`
- `maps inspect-area`
- `maps neighbors`
- `maps apply`
- `maps import`
- `maps export-json`
- `maps export-png`
- `maps duplicate`
- `maps delete`

CLI 输出固定为 JSON envelope，便于脚本和 AI agent 调用。

AI agent CLI 工作流文档见：

- [`docs/agent-cli.md`](./docs/agent-cli.md)

## 当前已实现范围

- WebUI 六角地图渲染
- 单元格坐标与内部编号
- terrain 与 biome 叠加展示
- terrain 一级分类 + 具体地形两级选择
- terrain / biome 双向联动筛选，缩小可选菜单范围
- 结构化命令驱动的地图修改
- 面向 AI agent 的 CLI 查询 / dry-run / diff 回显
- 本地 JSON 保存、导入、导出
- PNG 导出
- 会话内撤销 / 重做
- CLI 与 WebUI 复用同一套核心规则

## 当前暂未实现范围

以下内容当前不在 V1 已实现范围内：

- 自然语言命令解析
- 账号系统、云同步、多人协作
- CSV 作为主持久化格式
- 奇幻专用地形扩展
- 人文地理图层
- 跨会话持久化历史

## 验证现状

当前仓库已通过：

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

手工验收建议在本地开发环境中同时打开 WebUI 与 CLI，对同一张地图进行交叉验证。
