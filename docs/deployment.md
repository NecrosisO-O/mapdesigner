# 部署与数据维护

v0.3.0-rc.1 采用 SQLite 保存地图和操作历史。Node 版本由根目录 .nvmrc 固定，包管理器版本由 package.json 固定。

## 升级到 v0.3.0-rc.1

1. 停止旧服务和直接访问地图的 CLI，备份原数据根目录下的整个 storage 目录；Docker 部署则备份原 /data 卷。v0.2.0 使用 JSON 存储，停服复制即可保留原始地图。
2. 下载 v0.3.0-rc.1 源码，使用 Node.js 24.16.0 和 pnpm 10.23.0，执行 pnpm install --frozen-lockfile 和 pnpm build。
3. 保持原 MAPDESIGNER_ROOT 配置；使用默认路径时，将备份之外的原 storage 目录放到新源码根目录。旧 storage/maps 下的 JSON 会自动导入 SQLite 并保留原文件，已有 SQLite 地图与历史继续使用原数据库。
4. Docker 或对外监听时设置 MAPDESIGNER_TOKEN，在“地图 → 连接设置”中输入该令牌。旧 Docker 数据卷需由 UID/GID 1000 写入，步骤见 [Docker 升级说明](./docker.md#升级已有数据卷)。
5. 启动服务。后续地图和操作历史写入 storage/mapdesigner.db，可使用下方备份命令保存。

需要回退时，停止新服务，使用升级前备份和原版本启动。

## 源码运行

    pnpm install --frozen-lockfile
    pnpm check
    pnpm start

浏览器打开 http://127.0.0.1:3010 。默认只监听回环地址。
开发环境使用 pnpm dev，前端位于 http://127.0.0.1:5173 ，API 位于 3010。

## 网络访问

对外监听需要明确配置 HOST 和 MAPDESIGNER_TOKEN。例如：

    HOST=0.0.0.0 MAPDESIGNER_TOKEN='替换为随机长令牌' pnpm start

用户在地图菜单的“连接设置”输入令牌；令牌只存于当前浏览器窗口会话。
CLI 直接使用本地数据库，不经过 HTTP 认证。HTTP 客户端发送 Authorization: Bearer 加令牌。
健康检查与静态界面允许匿名读取，地图 API 需要认证。下载使用五分钟有效的单文件凭证。
服务验证来源和 Host；反向代理应保留 Host，使用 HTTPS，并将公开来源加入 MAPDESIGNER_ALLOWED_ORIGINS（逗号分隔）。
MAPDESIGNER_ROOT 控制数据根目录，PORT 默认 3010。

## 持久化目录

- storage/mapdesigner.db：地图、河流、修订号与撤销重做历史。
- 同目录的 -wal / -shm：SQLite 运行时文件，服务运行期间不要手工删除。
- storage/maps：旧版 JSON 的兼容入口；按需导入后保留原始文件。
- storage/exports：导出产物，JSON 与 PNG 均使用唯一名称。
- storage/uploads：正在处理的临时上传，任务结束后清理。

不要把 storage 提交到 Git。部署账号必须拥有数据目录的写权限。

## 备份与恢复

构建后执行：

    pnpm backup /absolute/path/to/new-backup-directory

该命令使用 SQLite 在线备份 API，包含操作历史，同时复制旧 JSON 文件并写入清单。
目标目录必须尚不存在。未指定目标时，保存到 storage/backups 下的新时间戳目录。
PNG/JSON 导出文件不属于数据库备份；需要长期保留时另行归档。

恢复步骤：

1. 停止服务与直接访问数据库的 CLI。
2. 将当前整个 storage 目录移到另一个位置保留，以便回退。
3. 创建新的 storage 目录，将备份中的 mapdesigner.db 与 maps 目录复制进去。
4. 设置写权限后启动服务，核对地图名称、格数、河流与撤销重做。

不要只把一个运行中数据库的主文件复制走；使用备份命令，或停止服务后复制整个存储目录。
自动测试已覆盖旧 JSON 保留、备份恢复后修订和历史一致，以及恢复后的撤销重做。

## 资源边界

当前源码的浏览器文件导入与 CLI `maps import --summary` 使用流式导入：文件最多 2 GiB、2500 万格、2 万条河流，河流总路径最多 50 万格，单条记录最多 8 MiB。分块导出、地图合并和这一导入能力属于 RC1 之后的未发布改进。
最多三项运行/等待任务，一个独立工作线程，JavaScript 堆上限 512 MiB（不等于进程总内存）。导入、合并、合并历史和 JSON 导出限时 15 分钟，分块导出一小时，预览和普通 PNG 两分钟。
任务状态仅在进程内保存；重启后需重新查询地图列表确认已经完成的导入。
取消在事务提交前生效，已经开始最终提交时会提示等待完成。

单张 PNG 单边最多 32768 像素、总计 4000 万像素；全图导出最多 10000 个已设计格，范围导出最多 25000 格。分块图片包最多 2048 张、总计 320 亿像素、2 GiB ZIP。超过预算时缩小范围或倍率，并分区导出。JSON 导出不受 PNG 尺寸限制。旧同步导入 HTTP 接口仍有 1 MiB 请求体上限；直接字符串导入和不带 `--summary` 的 CLI 仍保留 64 MiB / 50 万格限制。

流式导入同时使用输入文件、暂存数据库和目标数据库；事务日志也占用磁盘。合并和撤销历史保存实际变更，历史较多时需要更多空间。2300 万格合成样本的输入约 1.77 GiB，最终数据库约 3.96 GiB，这不包含导入期间的峰值磁盘开销。测量环境与证据见[容量记录](./research/large-map-capacity/README.md)。

远景使用覆盖完整范围的聚合图块；放大到局部后恢复精确编辑。概览是示意，不用于逐格修改。

## 发布检查

每次推送运行构建、类型检查、单元/服务/CLI 回归，以及 Docker 镜像构建、非 root 运行和 HTTP 访问检查。
本机生产包冒烟测试覆盖静态界面、SQLite、后台工作线程与 PNG 下载。
RC1 已由维护者完成实际操作验收；发布时确认最终提交的自动检查结果，并将版本标签指向该提交。
