# MapDesigner 中文说明

MapDesigner 是一个本地优先的六角格地图设计工具，适合异世界设定、世界观构建、跑团参考地图和与 AI 协作的结构化地图编辑。

它把可视化 WebUI 和结构化 CLI 放在同一套规则之上，让你既可以一边看地图一边修改，也可以在与 AI 讨论设定的过程中，直接通过命令对地图做稳定、可重复的调整。

## 功能概览

- 在浏览器中编辑六角格地图
- 为每个单元格叠加 `terrain` 与 `biome`
- 将地图保存为结构化 JSON，并在之后重新打开
- 导出 PNG 作为参考图
- 通过 CLI 进行查询、批量修改与导出
- 让 WebUI、CLI 与导出结果共享同一套地图规则

## 快速开始

### 源码运行

```bash
pnpm install
pnpm build
pnpm start
```

然后访问 `http://localhost:3010`。

### Docker 运行

```bash
docker build -t mapdesigner:0.1.0 .
docker run --rm -p 3010:3010 -e MAPDESIGNER_ROOT=/data -v "$(pwd)/mapdesigner-data:/data" mapdesigner:0.1.0
```

然后访问 `http://localhost:3010`。

## 文档导航

- [英文 README](./README.md)
- [用户说明书](./docs/user-manual.md)
- [部署说明](./docs/deployment.md)
- [Docker 部署说明](./docs/docker.md)
- [Agent CLI 指南](./docs/agent-cli.md)
- [产品总览](./PRODUCT_OVERVIEW_0.1.0.md)
- [版本变更记录](./CHANGELOG.md)

## 当前版本

当前公开版本为 `v0.1.0`。这一版已经可以完成基础地图创建、单元格编辑、JSON 保存与导入、PNG 导出，以及面向 AI agent 的结构化 CLI 操作。

## 许可证

本项目采用 [GNU General Public License v3.0](./LICENSE)。
