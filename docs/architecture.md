# 架构与仓库结构

MapDesigner 使用 pnpm 工作区管理两个应用和两个共享包。WebUI、CLI 与后台任务通过共享地图规则处理六角格数据，持久化和历史操作由服务端管理。

## 目录

```text
apps/
  web/            React 编辑器与开发验收页面
  server/         Fastify API、CLI、SQLite 与后台任务
packages/
  map-core/       类型、坐标、材料字典、命令与校验
  map-render/     共享场景、SVG、图例与水系几何
scripts/          备份、性能测量和生产验证工具
docs/
  design/         视觉与兼容约定、固定地图和 PNG 对照
  research/       验收结论、容量与性能测量
  images/         项目介绍使用的界面截图
storage/          本地运行数据，仅提交目录占位文件
.github/          CI 工作流
```

根目录保留项目介绍、许可证、版本记录与构建配置。测试随源码放置；各包的 `dist/`、依赖目录和运行数据由工具生成。

## 依赖与职责

`map-render` 依赖 `map-core`；WebUI 与服务端都依赖这两个包。共享包保持独立于 React、HTTP 和 SQLite。

| 模块 | 职责与阅读入口 |
| --- | --- |
| 地图规则 | [types.ts](../packages/map-core/src/types.ts)、[commands.ts](../packages/map-core/src/commands.ts)、[validation.ts](../packages/map-core/src/validation.ts) 定义文档、命令及合法性；河网和宽度在 `river-network.ts`、`rivers.ts` 中处理 |
| 绘图 | [scene.ts](../packages/map-render/src/scene.ts) 构建共享场景，`symbols.ts` / `presentation.ts` 提供符号与材料表达，`river-geometry.ts` / `water.ts` 处理河流及水面，`export-layout.ts` 负责成图排版 |
| 编辑会话 | [useMapWorkspace.ts](../apps/web/src/useMapWorkspace.ts) 管理加载、缓存和提交；[editor-session.ts](../apps/web/src/editor-session.ts) 定义局部地图表示与缓存。单格、材料、河流和高级编辑各有专用 hook |
| 界面与画布 | [App.tsx](../apps/web/src/App.tsx) 组合工作区，[MapCanvas.tsx](../apps/web/src/MapCanvas.tsx) 管理视口与交互，[RiverEditingLayer.tsx](../apps/web/src/RiverEditingLayer.tsx) 处理河流直接编辑；对话框、工具栏和属性面板按任务拆分 |
| 服务入口 | [api.ts](../apps/server/src/api.ts) 解析 HTTP 请求，[cli.ts](../apps/server/src/cli.ts) 提供结构化命令；[service.ts](../apps/server/src/service.ts) 组织地图操作 |
| 命令与存储 | [command-executor.ts](../apps/server/src/command-executor.ts) 统一执行与修订检查，[repository.ts](../apps/server/src/repository.ts) 封装数据库查询、写入与历史，[db.ts](../apps/server/src/db.ts) 管理连接和表结构 |
| 大地图与任务 | [jobs.ts](../apps/server/src/jobs.ts) 管理队列和取消，`job-worker.ts` 执行任务；`stream-import.ts`、`tiled-export.ts`、`merge.ts`、`overview.ts` 分别处理导入、分块、合并和远景 |

## 编辑与历史

WebUI 保存已确认的地图修订、当前范围和独立的表单草稿。视口缓存只负责显示数据；切换面板、范围重载或缓存淘汰不应清除选区和未提交输入。提交使用地图身份与预期修订校验，成功后再更新会话。

普通命令在服务端同步事务中执行：读取相关实体、应用核心规则、写入变化、推进修订并记录历史。预演计算影响而不写入业务数据。合并使用 `merge.ts` 的专门流程，将单元格与河流变更逐条保存到 `operation_cells` / `operation_features`，支持重启后的撤销和重做。

核心包的 [history.ts](../packages/map-core/src/history.ts) 仍提供内存快照历史，供运行时地图规则使用。正式编辑器的持久撤销/重做以服务端数据库为准；JSON 地图归档包含地图内容，数据库备份另行保留操作历史。

## 大地图与输出

浏览器读取摘要、局部精细范围和远景聚合。数据库按 32 格基础图块保存地形及材料计数，相关写入通过事务内触发器同步更新。概览用于导航，放大后再恢复精确编辑。

上传文件暂存于 `storage/uploads/`，工作线程逐条解析到暂存 SQLite，校验后通过事务发布。导出在数据库读事务内固定修订，构建共享场景并输出 PNG、JSON 或分块图片包。任务请求格式见[后台任务 API](./background-jobs.md)，资源预算见[部署说明](./deployment.md#资源边界)。

工作区主题和地图样式分别保存。画布、材料样本、图例和导出共用绘图规则；旧地图样式及河宽语义按[视觉与兼容约定](./design/README.md)恢复。

## 后续维护边界

四包结构与现有依赖方向适合当前项目规模。后续功能若继续扩大，可优先沿职责拆分以下模块，并用既有行为回归约束改动：

- `repository.ts`：按地图查询、实体写入、历史存取拆分，事务与修订边界保持统一。
- `MapCanvas.tsx`：将视口手势、命中与选择、场景呈现分别组织。
- `App.tsx`：进一步抽出文档管理和后台任务的流程组合。

官方数据与渲染模型仅支持六角格。需要方格网时，可 Fork 后扩展坐标、命令、存储和渲染契约。
