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
- `DESIGN.md`: 当前设计案
- `IMPLEMENTATION_PLAN.md`: 开工计划
- `IMPLEMENTATION_STATUS.md`: 当前实现核查与落地状态

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
4. 编辑 `terrain / biome / tags / note`
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
pnpm exec tsx apps/server/src/cli.ts maps export-json --map-id demo-map
pnpm exec tsx apps/server/src/cli.ts maps export-png --map-id demo-map --preset reference
```

结构化命令应用示例：

```bash
echo '{
  "action": "set_cell",
  "source": "cli",
  "target": { "row": 0, "col": 0 },
  "changes": { "terrain": "plain", "biome": "grassland" }
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin
```

CLI 当前支持：

- `maps list`
- `maps create`
- `maps inspect`
- `maps apply`
- `maps import`
- `maps export-json`
- `maps export-png`
- `maps duplicate`
- `maps delete`

CLI 输出固定为 JSON envelope，便于脚本和 AI agent 调用。

## 当前已实现范围

- WebUI 六角地图渲染
- 单元格坐标与内部编号
- terrain 与 biome 叠加展示
- 结构化命令驱动的地图修改
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
