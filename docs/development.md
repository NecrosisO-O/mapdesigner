# 开发指南

模块职责见[架构说明](./architecture.md)，接口与使用说明从[文档入口](./index.md)查找。

## 工具链与启动

使用 [.nvmrc](../.nvmrc) 指定的 Node.js，以及 [package.json](../package.json) 中 `packageManager` 指定的 pnpm。在仓库根目录执行：

```sh
# 使用 nvm 时
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 先构建共享包，再并行启动 API（`127.0.0.1:3010`）和 Vite（`127.0.0.1:5173`）。单独启动可用 `pnpm dev:server` / `pnpm dev:web`，此前先执行 `pnpm build`。发布态使用 `pnpm build` 后运行 `pnpm start`。

WebUI 通过 Vite 别名读取共享包源码，后端读取构建产物；修改共享包后重新运行 `pnpm dev`。修改后端 `PORT` 时，同步调整 [Vite 代理](../apps/web/vite.config.ts)。原生依赖安装由锁文件和[工作区配置](../pnpm-workspace.yaml)管理。

## 开发数据

默认运行数据位于仓库的 `storage/`。`MAPDESIGNER_ROOT` 指向数据根目录，程序在其下创建 `storage/`。建议用仓库外目录隔离验收数据，例如在类 Unix 环境中：

```sh
mapdesigner_dev_root="$(mktemp -d)"
MAPDESIGNER_ROOT="$mapdesigner_dev_root" pnpm dev
```

CLI 直接访问数据库，调用时设置相同的 `MAPDESIGNER_ROOT`。服务停止后开发数据仍保留；自动测试和数据基准脚本另建临时数据库，并负责清理。实际地图的保护与恢复见[备份说明](./deployment.md#备份与恢复)。

## 验证改动

```sh
pnpm check
pnpm format:check
```

`pnpm check` 依次构建、检查类型并运行测试；部分测试依赖共享包的构建产物。小范围修改可在构建后执行 `pnpm --filter @mapdesigner/web test` 等对应包测试。格式检查覆盖应用 TS/TSX/CSS 和共享包 TS；脚本语法可用 `node --check scripts/文件名.mjs` 检查。

测试随源码放置。事务、命令、撤销、兼容和绘图几何改动验证实际行为；视觉改动核对界面与固定样例；文档改动检查引用。[CI](../.github/workflows/ci.yml) 执行完整检查、格式检查、生产容器构建、访问控制和后台图片输出验证。

开发入口 `/visual-qa.html` 比较浏览器、PNG、灰度和色觉模拟，并测量交互；`/responsive-qa.html` 用指定 CSS 视口打开编辑器。固定数据与 PNG 对照位于 [design](./design/README.md)，结论与待补项目见[验收记录](./research/README.md)。

## 维护脚本

从仓库根目录运行。除连接现有实例的 HTTP 验证脚本外，先执行 `pnpm build`。方括号为可选参数。

| 命令 | 用途与数据影响 |
| --- | --- |
| `pnpm backup [新目录]` | 在线备份当前数据库、旧 JSON 与清单；默认位于 `storage/backups/<时间戳>`，目标目录需尚不存在 |
| `node scripts/benchmark-large-maps.mjs [格数] [报告] [--flows]` | 默认 110000 格；测导入、查询和编辑，`--flows` 增加合并、历史、JSON 往返与区域分块；使用临时数据库 |
| `node scripts/benchmark-visual.mjs [报告]` | 测量 1200 个可见格子的场景构建与 SVG 序列化，为 Node CPU 时间 |
| `node scripts/benchmark-visual-data.mjs [报告]` | 在临时 SQLite 中测量 1 万、10 万、50 万格的访问与输出 |
| `node scripts/build-visual-gallery.mjs` | 校验并更新 `docs/design/fixtures/cartography-gallery.json` 与 `docs/design/gallery/*.png`；审查样例和图片差异后提交 |
| `node scripts/smoke-production.mjs 生产包绝对路径` | 在端口 3199 启动生产包验证界面、数据库及工作线程，结束后关闭并清理临时数据；包需包含服务端生产依赖及 `apps/web/dist/`，布局见 [Dockerfile](../Dockerfile) |
| `node scripts/verify-http.mjs [服务地址]` | 默认连接 `http://127.0.0.1:3010`，使用 `MAPDESIGNER_TOKEN`，会创建验收地图和导出文件，适用于隔离实例 |

三个性能脚本默认将报告写入系统临时目录，文件名分别为 `mapdesigner-capacity-<格数>.json`、`mapdesigner-visual-performance.json` 和 `mapdesigner-visual-data.json`。也可指定已存在的输出目录；同名报告会被覆盖。完整流程示例：

```sh
mkdir -p artifacts
node scripts/benchmark-large-maps.mjs 1000000 artifacts/capacity.json --flows
```

`artifacts/` 已忽略。保留验收报告时，仅选取需要支撑结论的数据，附样本、版本、运行环境与统计口径；数据库耗时、Node 绘图耗时和浏览器帧耗时分别记录。

## 公开内容

提交前检查暂存差异及附件。环境变量文件、私钥、数据库、HTTP 抓包、个人路径、账号权限和原始错误日志保存在仓库之外或已忽略的目录；示例使用占位值和合成地图。截图检查可见文字及作者、定位等元数据。

文档保留现行指南、兼容契约和必要的验收结论，已完成计划与重复过程截图按需要删除。发现真实凭据进入历史时，先撤销或轮换，再评估历史清理；删除当前文件不会清除旧提交或旧发行包。
