# 开发指南

本指南说明现行开发流程。目录和职责见[架构说明](./architecture.md)，环境调查与旧测试结果保存在[接手档案](./archive/takeover-notes.md)。

## 环境准备

使用根目录 [.nvmrc](../.nvmrc) 指定的 Node.js，以及 [package.json](../package.json) 中 `packageManager` 指定的 pnpm。原生依赖包括 `better-sqlite3`、`sharp` 和 `esbuild`；安装行为由锁文件与 [工作区配置](../pnpm-workspace.yaml) 管理。

在仓库根目录执行：

```sh
# 使用 nvm 时
nvm install
nvm use

pnpm install --frozen-lockfile
pnpm check
```

## 启动与构建

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 构建共享包，再并行启动 API 与 WebUI |
| `pnpm dev:server` | 单独启动后端源码监听 |
| `pnpm dev:web` | 单独启动 Vite |
| `pnpm build` | 按包依赖顺序构建共享包、后端与 WebUI |
| `pnpm start` | 运行已构建的后端，同时提供 API 与 WebUI |

开发 WebUI 位于 `http://127.0.0.1:5173`，API 位于 `http://127.0.0.1:3010/api`，健康检查为 `/api/health`。Vite 在 [配置文件](../apps/web/vite.config.ts) 中将 `/api` 代理到后端；修改后端 `PORT` 时同步调整代理目标。

单独启动前先执行 `pnpm build`。WebUI 通过 Vite 别名读取共享包源码，后端通过包入口读取构建产物。修改 `map-core` 或 `map-render` 后重新运行 `pnpm dev`，使后端加载更新后的共享模块。

发布态先运行 `pnpm build`，再执行 `pnpm start`，访问 `http://127.0.0.1:3010`。网络监听、访问令牌和 Docker 配置见[部署说明](./deployment.md#网络访问)。

## 数据隔离

默认使用仓库下的 `storage/`。开发时可以指定独立的 `MAPDESIGNER_ROOT`，程序在该目录下创建 `storage/`；该变量指向数据根目录，而非数据库文件或 `storage/` 本身。

例如，在类 Unix 环境中为一次本地验收建立临时根目录：

```sh
MAPDESIGNER_ROOT="$(mktemp -d)" pnpm dev
```

停止开发服务后数据仍保存在该临时目录中，可按需要归档或清理。CLI 直接读写本地数据库，手动调用 CLI 时也要设置相同的 `MAPDESIGNER_ROOT`。自动测试和数据基准脚本使用独立临时数据库。

仓库忽略数据库、上传暂存、备份和导出内容，仅跟踪 `storage/maps/.gitkeep` 与 `storage/exports/.gitkeep`。自定义数据目录应放在仓库之外。保留实际数据前先阅读[备份与恢复](./deployment.md#备份与恢复)。

## 验证改动

`pnpm check` 依次执行构建、类型检查和测试。构建先于测试，因为服务、CLI 和部分测试通过包入口使用共享包产物。

```sh
pnpm check
pnpm format:check
```

小范围修改可在构建后先验证受影响的包：

```sh
pnpm --filter @mapdesigner/map-core test
pnpm --filter @mapdesigner/map-render test
pnpm --filter @mapdesigner/server test
pnpm --filter @mapdesigner/web test
```

测试随源码放在各包的 `src/` 下。数据契约、事务、撤销和渲染几何的修改应验证实际行为及兼容性；布局和制图改动还需核对真实界面和固定样例。文档整理检查本地链接、资源路径与引用，依赖或共享契约变化执行完整检查。

`pnpm format:check` 当前覆盖应用的 TS/TSX/CSS 和共享包的 TS；维护脚本和 Markdown 不在其范围内。脚本可用 `node --check scripts/文件名.mjs` 检查语法，再运行与修改对应的验证。

[CI](../.github/workflows/ci.yml) 在推送、PR 和手动触发时执行完整检查、源码格式检查，以及生产镜像构建、令牌访问、中文字体、后台预览和 PNG 下载验证。发布时还需按[发布检查](./deployment.md#发布检查)核对最终提交与标签。

## 视觉与性能验证

启动开发服务后可访问 `/visual-qa.html`，比较浏览器、PNG、灰度与色觉模拟，并测量浏览器交互；`/responsive-qa.html` 在指定 CSS 视口中打开正式编辑器。这些是开发入口，生产构建以 `index.html` 为入口。

固定样例位于 [editor-v3](./design/editor-v3/README.md)。图集重生成会更新仓库内样例和图片，操作前阅读[脚本说明](../scripts/README.md)。性能脚本分别测量场景构建、真实数据库访问与大图完整流程；报告保留样本、机器、版本和测量口径。浏览器帧耗时与服务端时间分别记录。

历次结果和需要人工补充的验收见[研究与验收索引](./research/README.md)。

## 维护入口

- 后台导入、导出、合并和历史操作见[后台任务 API](./background-jobs.md)。
- 模块边界和后续拆分方向见[架构说明](./architecture.md)。
- 设计、河宽兼容和历史计划从[文档索引](./index.md)进入。新的实施记录和测量按日期保存，并更新相应索引。
