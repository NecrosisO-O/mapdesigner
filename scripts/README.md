# 维护与验收脚本

从仓库根目录运行。除连接已有实例的 `verify-http.mjs` 外，这些脚本依赖工作区或生产包的构建产物；先执行 `pnpm build`。日常启动和包测试见[开发指南](../docs/development.md)。

## 入口与数据影响

方括号中的参数为可选项。报告文件的父目录需已存在；再次使用同一路径会覆盖原报告。

| 入口 | 用途、输出与数据影响 |
| --- | --- |
| `pnpm backup [新备份目录]` | 对当前 `MAPDESIGNER_ROOT` 的数据库执行在线备份，复制旧 `maps/` 并生成清单。默认写入 `storage/backups/<时间戳>/`，目标目录必须尚不存在 |
| `node scripts/benchmark-large-maps.mjs [格数] [报告路径] [--flows]` | 默认 110000 格；测量导入、范围查询、概览、编辑和撤销。`--flows` 增加合并、历史、JSON 往返与区域分块验证，使用独立临时数据库并在结束时清理 |
| `node scripts/benchmark-visual.mjs [报告路径]` | 测量 1200 个可见格子的场景构建与 SVG 序列化，覆盖长河道；生成 1 万/10 万/50 万格样本后截取可见范围，结果是 Node CPU 时间 |
| `node scripts/benchmark-visual-data.mjs [报告路径]` | 在临时 SQLite 中写入 1 万/10 万/50 万格，经本地 API 注入测量范围、概览、图例、预览和输出；结束后清理测试数据 |
| `node scripts/build-visual-gallery.mjs` | 更新固定制图样例以及对应 SVG/PNG；具体写入位置见下方 |
| `node scripts/smoke-production.mjs 生产包绝对路径` | 在端口 3199 启动已部署的生产包，使用临时数据验证 WebUI、SQLite、工作线程和 PNG 下载；结束后关闭进程并清理数据 |
| `node scripts/verify-http.mjs [服务地址]` | 默认连接 `http://127.0.0.1:3010`，读取 `MAPDESIGNER_TOKEN`。在该实例中创建“容器导出验收”地图、写入格子并生成 PNG 与预览，保留创建的地图及导出文件，适用于隔离验收实例 |

备份与恢复方法见[部署说明](../docs/deployment.md#备份与恢复)。`smoke-production.mjs` 的输入应包含服务端生产依赖、`dist/apps/server/src/index.js` 和 `apps/web/dist/`；包布局可参考 [Dockerfile](../Dockerfile)。

## 性能报告

未指定报告路径时，三个基准脚本使用 `os.tmpdir()` 返回的系统临时目录，文件名分别为：

- `mapdesigner-capacity-<格数>.json`
- `mapdesigner-visual-performance.json`
- `mapdesigner-visual-data.json`

需要传入 `--flows` 时同时指定格数与报告路径，例如：

```sh
node scripts/benchmark-large-maps.mjs 1000000 /tmp/mapdesigner-capacity.json --flows
node scripts/benchmark-visual.mjs /tmp/mapdesigner-visual.json
node scripts/benchmark-visual-data.mjs /tmp/mapdesigner-data.json
```

示例路径适用于类 Unix 系统，可替换为本机可写路径。大样本会占用磁盘和内存，容量选择与报告解释见[实测口径](../docs/research/large-map-capacity/README.md)。浏览器交互通过开发验收页面单独测量，结果不能与 Node 场景构建时间混用。

## 固定视觉图集

`build-visual-gallery.mjs` 当前写入以下跟踪文件：

- [制图样例 JSON](../docs/design/editor-v3/fixtures/cartography-gallery.json)
- [视觉图集目录](../docs/research/2026-10-03/visual-redesign/gallery/)中的 SVG 和 PNG

该脚本用于有意更新固定样例；运行后审查数据和图片差异，并补充本次验证记录。需要保存新版本验收证据时，把输出另存到新的日期目录，保留对应代码提交。普通构建和测试不会运行此生成脚本。

历次结果从[研究与验收索引](../docs/research/README.md)进入。`docs/research/` 中的早期探针随当时基线保留，复现时按同目录说明选择对应版本。
