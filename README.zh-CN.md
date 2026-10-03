# MapDesigner 中文说明

MapDesigner 是一个本地优先的六角格地图设计工具，适合异世界设定、世界观构建、跑团参考地图和与 AI 协作的结构化地图编辑。

它把可视化 WebUI 和结构化 CLI 放在同一套规则之上，让你既可以一边看地图一边修改，也可以在与 AI 讨论设定的过程中，直接通过命令对地图做稳定、可重复的调整。

## 功能概览

- 在浏览器中编辑六角格地图
- 为每个单元格叠加 `terrain` 与 `biome`
- 在 WebUI 或 CLI 中以覆盖层方式绘制跨单元格河流，并支持宽度锚点与水域端点提示
- 以本地 SQLite 存储地图，并保留结构化 JSON 导入/导出用于归档和交换
- 使用可搜索的材料样本、取样、笔刷及直接河流节点/宽度编辑
- 以共享地貌符号、生态纹理、全图图例和连续水面表达地图
- 真实预览并导出带标题、图例、透明背景和格距说明的 PNG
- 通过 CLI 进行查询、批量修改与导出
- 针对大地图使用摘要与范围查询，避免默认读取所有单元格
- 让 WebUI、CLI 与导出结果共享同一套地图规则

## 快速开始

![正式编辑器界面](./docs/research/2026-10-03/visual-redesign/workspace-final.png)

桌面、窄屏截图与操作验证见[浏览器验收记录](./docs/research/2026-10-03/visual-redesign/README.md)。

### 源码运行

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

然后访问 `http://localhost:3010`。

### Docker 运行

```bash
docker build -t mapdesigner:0.3.0-rc.1 .
docker run --rm -p 127.0.0.1:3010:3010 -e MAPDESIGNER_TOKEN=replace-with-a-long-random-token -v mapdesigner-data:/data mapdesigner:0.3.0-rc.1
```

然后访问 `http://localhost:3010`。

已有安装请先阅读[升级步骤](./docs/deployment.md#升级到-v030-rc1)，再使用原有数据启动新版本。

## 文档导航

- [英文 README](./README.md)
- [用户说明书](./docs/user-manual.md)
- [部署说明](./docs/deployment.md)
- [Docker 部署说明](./docs/docker.md)
- [Agent CLI 指南](./docs/agent-cli.md)
- [产品总览](./PRODUCT_OVERVIEW_0.1.0.md)
- [版本变更记录](./CHANGELOG.md)

## 当前版本

`v0.3.0-rc.1` 完成了工作区重设计、可视化材料绘制、河流节点与宽度直接编辑，以及画布和导出共享的制图表现。地图与操作历史由 SQLite 保存，导入和导出支持后台任务，并保留旧地图与历史规则的兼容处理。自 `v0.2.0` 以来的完整变化见[版本记录](./CHANGELOG.md)，验证依据见[验收记录](./docs/research/2026-10-03/visual-redesign/README.md)。

## 开发说明

Node.js 版本见 `.nvmrc`，pnpm 版本见 `package.json`。
执行 `pnpm install --frozen-lockfile` 后，可以用 `pnpm check` 完成构建、类型检查与测试，
用 `pnpm dev` 同时启动后端和 WebUI。
环境基线、开发流程与接手记录见[开发说明](./docs/development.md)。

本项目在开发过程中使用了 AI 辅助。

## 许可证

本项目采用 [GNU General Public License v3.0](./LICENSE)。

重构实施与验证记录见 [实施计划](./docs/IMPLEMENTATION_PLAN.md) 和 [性能记录](./docs/research/2026-10-03/README.md)。Docker 启动后需在“连接设置”输入令牌。
