# 开发说明与接手基线

记录日期：2026-10-02。基线提交：`be10266`（2026-06-16，`Improve river rendering`）。
包版本为 `0.2.0`；主分支还包含该版本发布后的 SQLite、范围查询和河流相关改动。

后续[代码与架构审查](./research/2026-10-02/README.md)已复现数据一致性与输入输出问题，
并将事务、操作历史和编辑会话列为重构的首要工作。

## 本机环境

| 项目 | 已确认状态 |
| --- | --- |
| 工作目录 | `/Users/manatsu/Workspace/MapDesigner` |
| GitHub CLI | `/opt/homebrew/bin/gh`，`2.94.0` |
| GitHub 账号 | `NecrosisO-O`，登录有效，对仓库有 ADMIN 权限 |
| 远程仓库 | `https://github.com/NecrosisO-O/mapdesigner.git` |
| 默认分支 | `main` |
| 本地准备分支 | `codex/development-setup` |
| Node.js | `24.16.0`，已写入根目录 `.nvmrc` |
| pnpm | 项目固定使用 `10.23.0`；本机全局启动器为 `11.8.0`，会按 `packageManager` 切换 |
| 原生依赖 | `better-sqlite3`、`sharp`、`esbuild` 安装成功 |
| Docker | 已有 CLI；daemon 未运行，容器构建尚未验证 |

Codex 的命令沙箱限制网络和系统凭据访问。本次 `gh auth status` 在沙箱内出现登录失败，
获准联网重试后确认登录正常。pnpm 启动器的版本签名校验也需要网络；
网络受限时应先确认连接和授权，保留包管理器的校验。

## 开始开发

```bash
# 使用 nvm 时，在仓库根目录读取 .nvmrc
nvm install
nvm use

pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

`pnpm dev` 先按依赖顺序构建两个共享包，再同时启动后端和前端：

- WebUI：`http://localhost:5173`
- API：`http://localhost:3010/api`
- 健康检查：`http://localhost:3010/api/health`

前端将 `/api` 请求代理到 `3010`。后端端口可通过 `PORT` 修改；更换端口时，
还需同步修改 `apps/web/vite.config.ts` 中的代理目标。

也可以分别运行 `pnpm dev:server` 和 `pnpm dev:web`。单独启动前先执行 `pnpm build`。
前端使用共享包源码别名，后端使用共享包构建产物；修改 `map-core` 或 `map-render` 后，
重新运行 `pnpm dev`，保证后端加载更新后的共享模块。

发布态使用 `pnpm build` 后执行 `pnpm start`，由后端在 `3010` 同时提供 API 与 WebUI。

## 验证入口

`pnpm check` 依次执行构建、类型检查和现有测试。构建放在最前面，
因为服务端、CLI 和部分测试通过包入口加载共享包的 `dist` 产物。

按改动范围可单独运行：

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @mapdesigner/map-core test
pnpm --filter @mapdesigner/map-render test
pnpm --filter @mapdesigner/server test
pnpm --filter @mapdesigner/web test
```

本次基线验证结果：

| 检查 | 结果 |
| --- | --- |
| 按锁文件安装 | 通过，`pnpm-lock.yaml` 无改动 |
| 四个工作区包构建 | 通过 |
| TypeScript 类型检查 | 通过 |
| 地图规则测试 | 20 项通过 |
| 渲染测试 | 7 项通过 |
| 后端、API、CLI、配置测试 | 59 项通过 |
| 前端测试 | 42 项通过 |
| 测试合计 | 9 个测试文件，128 项通过 |
| 一键开发启动 | 前端与后端启动成功 |
| 浏览器 | WebUI 加载成功，显示“准备就绪” |
| HTTP 健康检查 | `ok: true`、`status: ok`、端口 `3010` |
| 依赖审计 | 53 条告警，详见下文 |

现有测试包含 SQLite 持久化、修订冲突、范围查询、撤销/重做、河流命令、
JSON 导入导出与 PNG 导出。百万格地图的耗时、内存和长时间编辑表现尚未压测。

新增的 `.github/workflows/ci.yml` 在 push、pull request 或手动触发时，
使用 `.nvmrc` 和 `packageManager` 安装工具链，并执行 `pnpm check`。
远端验证以相应提交的 GitHub Actions 运行结果为准；本机基线结果见上表。

## 代码结构

| 位置 | 当前职责 |
| --- | --- |
| `packages/map-core` | 六角格坐标、地形/生态字典、命令、校验、序列化、运行时历史 |
| `packages/map-render` | SVG 布局、样式、场景与河流渲染；前端和 PNG 导出共用 |
| `apps/server/src/api.ts` | Fastify 路由、请求解析、静态页面与导出下载 |
| `apps/server/src/service.ts` | 地图操作、范围查询、命令执行、导出和撤销/重做服务 |
| `apps/server/src/repository.ts` | SQLite 查询、增量写入、旧 JSON 迁移、持久操作历史 |
| `apps/server/src/cli.ts` | 面向用户脚本与 AI agent 的结构化 JSON 接口 |
| `apps/web/src/useMapWorkspace.ts` | 地图会话、范围加载、缓存、保存与持久编辑历史 |
| `apps/web/src/MapCanvas.tsx` | SVG 画布、缩放平移、视口裁剪、单元格与河流交互 |

基线中的 `service.ts` 约 1,961 行，`repository.ts` 约 1,406 行，
`MapCanvas.tsx` 约 840 行，`useMapWorkspace.ts` 约 740 行。
它们是后续职责拆分和性能分析的主要入口。

## 数据与文档状态

当前实际数据位置：

- `storage/mapdesigner.db`：SQLite 地图、单元格、河流和持久操作历史。
- `storage/mapdesigner.db-wal`、`storage/mapdesigner.db-shm`：数据库运行时的辅助文件。
- `storage/maps`：旧 JSON 地图的兼容与迁移入口。
- `storage/exports`：导出的 JSON 和 PNG。

`MAPDESIGNER_ROOT` 会覆盖数据根目录。测试通过临时目录隔离数据。
手动迁移或备份时，先停止服务，再复制整个 `storage` 目录。

`docs/deployment.md`、`docs/docker.md` 和用户手册的部分段落仍按旧 JSON 存储描述，
`PRODUCT_OVERVIEW_0.1.0.md` 是历史版本说明。旧部署文档和 Dockerfile 仍使用 Node.js 20，
需要在容器验证时与本次已验证的 Node.js 24 开发基线统一。

`docs/NEXT_WORK_PLAN.md` 已标记为历史计划。当前服务端已有 SQLite 操作日志、
持久撤销/重做和范围读取；核心包中也保留了运行时快照历史。
后续历史系统设计需要先梳理两条路径的实际使用范围。

## 依赖审计

2026-10-02 对原锁文件执行 `pnpm audit --json`，报告：

| 等级 | 报告数量 |
| --- | ---: |
| Critical | 1 |
| High | 33 |
| Moderate | 17 |
| Low | 2 |

这些是包管理器报告的告警数量，具体可达性和触发条件需要逐项核实。
主要涉及 Fastify、`@fastify/static`、Sharp 及其间接依赖，
以及 Vite、Vitest、PostCSS 等开发依赖。

Critical 项为 Vitest UI 服务相关告警（`GHSA-5xrq-8626-4rwp`）；
当前测试脚本执行 `vitest run`。后续升级仍需覆盖所有工作区中的 Vitest 版本。

优先按运行依赖与开发工具分别验证升级，每批更新后执行 `pnpm check`，
并复查 PNG 导出、数据库读写与旧地图导入。

## 已有反馈与后续工作

- [Issue #2](https://github.com/NecrosisO-O/mapdesigner/issues/2)：反馈地图删除、
  PNG 导出不稳定、JSON 请求大小限制和大地图卡顿；用户提到 11 万、500 万、2,300 万格地图。
- [PR #3：v0.1.1](https://github.com/NecrosisO-O/mapdesigner/pull/3)：仍开放，
  2026-10-02 查询为 `CONFLICTING`，涉及 22 个文件；包含深色模式、透明导出、
  导出进度、标签筛选、地图合并和方格模式等改动。
  其中部分能力已经出现在当前主分支，需要按功能核对现状与差异。

本次重启已获准进行大幅重构。建议按以下顺序推进：

1. 优先修复审查中复现的事务隔离、并发写入、撤销与元数据草稿问题。
2. 统一命令规则、输入校验和前端会话模型；同步处理依赖告警与服务访问边界。
3. 修复大地图导入和区域导出，再根据范围查询、河流几何和浏览器测量推进性能改造。
4. 逐项评估 PR #3 的修复与功能，配合数据契约完善迁移、运行时与部署说明。

每阶段以已有行为验证、数据兼容和明确的性能指标作为验收依据。
