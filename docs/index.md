# MapDesigner 文档索引

本文档用于作为 `MapDesigner` 当前文档的统一入口，帮助用户根据自己的使用场景快速找到对应说明。

## 面向普通用户

如果你想直接开始使用 `MapDesigner`，建议优先阅读：

- [用户说明书](/root/WorkSpace/MapDesigner/docs/user-manual.md)

这份文档适合：

- 想了解如何启动项目
- 想了解 WebUI 怎么使用
- 想了解如何保存、导入、导出地图
- 想快速上手当前版本功能的用户

## 面向自部署用户

如果你希望自己部署 `MapDesigner 0.1.0`，建议阅读：

- [部署说明](/root/WorkSpace/MapDesigner/docs/deployment.md)
- [Docker 部署说明](/root/WorkSpace/MapDesigner/docs/docker.md)

这份文档适合：

- 想以发布态方式运行项目
- 想使用 Docker 直接启动 WebUI
- 想了解 `pnpm build` 与 `pnpm start` 的使用方式
- 想了解数据目录、端口和 `MAPDESIGNER_ROOT` 的用户

## 面向 AI agent 与脚本调用

如果你希望通过 CLI 或 AI agent 调用本项目，建议阅读：

- [Agent CLI Guide](/root/WorkSpace/MapDesigner/docs/agent-cli.md)

这份文档适合：

- 想使用结构化命令修改地图
- 想使用查询命令、`dry-run` 与导出能力
- 想把 `MapDesigner` 接入自动化流程的用户

## 面向发布整理与产品说明

如果你正在整理版本发布资料或产品说明，可参考：

- [0.1.0 产品功能与特点总览](/root/WorkSpace/MapDesigner/PRODUCT_OVERVIEW_0.1.0.md)
- [0.1.0 自部署方案草案](/root/WorkSpace/MapDesigner/DEPLOYMENT_PLAN_0.1.0.md)

这两份文档适合：

- 整理发布口径
- 编写 README 与 Release Notes
- 规划当前版本的部署支持边界

## 当前推荐阅读顺序

对于大多数用户，建议按以下顺序阅读：

1. [用户说明书](/root/WorkSpace/MapDesigner/docs/user-manual.md)
2. 若使用源码部署，阅读 [部署说明](/root/WorkSpace/MapDesigner/docs/deployment.md)
3. 若使用 Docker 部署，阅读 [Docker 部署说明](/root/WorkSpace/MapDesigner/docs/docker.md)
4. 如果需要自动化调用，再看 [Agent CLI Guide](/root/WorkSpace/MapDesigner/docs/agent-cli.md)
