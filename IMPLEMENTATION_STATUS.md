# MapDesigner 当前实现状态

本文档用于记录当前代码实现相对于 [DESIGN.md](/root/WorkSpace/MapDesigner/DESIGN.md) 与 [IMPLEMENTATION_PLAN.md](/root/WorkSpace/MapDesigner/IMPLEMENTATION_PLAN.md) 的落地情况。

## 1. 当前总体判断

- 如果按“首版最小可用闭环”衡量，当前项目已经达到可运行、可编辑、可保存、可导出的状态
- 如果按设计案中全部细化规则衡量，当前仍有一批产品化细节尚未补齐
- 当前阶段最适合的推进方式是：
  - 先补测试并修稳已实现能力
  - 再补齐高优先未实现功能

## 2. 已实现能力

### 2.1 工程与分层

- 已建立 `pnpm workspace` monorepo
- 已建立 `apps/web`、`apps/server`、`packages/map-core`、`packages/map-render`
- 已建立 `storage/maps` 与 `storage/exports`

### 2.2 地图核心规则

- 已实现地图文档类型、运行时类型、命令类型、校验问题类型
- 已实现 `flat-top-even-q` 坐标与稳定单元格编号
- 已实现 `R{row}C{col}` 显示坐标与 `cell@row,col` 内部编号
- 已实现 7 格初始种子区
- 已实现“已设计区域 + 外围一圈 undesigned” 的活动区域推导
- 已实现空地图回退到初始种子区
- 已实现 terrain / biome / tag 字典
- 已实现基础 terrain / biome 组合校验
- 已实现运行时撤销 / 重做
- 已实现 JSON 序列化 / 反序列化与文档校验

### 2.3 指令与 CLI

- 已实现结构化命令：
  - `set_cell`
  - `set_cells`
  - `clear_cell`
  - `replace_terrain`
  - `replace_biome`
  - `annotate_cell`
- 已实现 CLI：
  - `maps list`
  - `maps create`
  - `maps inspect`
  - `maps apply`
  - `maps import`
  - `maps export-json`
  - `maps export-png`
  - `maps duplicate`
  - `maps delete`

### 2.4 渲染与导出

- 已实现 SVG 六角格布局
- 已实现 terrain 底色、biome 纹理、主 tag 角标
- 已实现坐标与简写显示逻辑
- 已实现 PNG 导出
- 已实现 `clean` / `reference` 两种导出预设基础能力

### 2.5 WebUI

- 已实现地图新建、打开、保存、导入 JSON、导出 PNG
- 已实现单元格选中、编辑、清空、取消编辑
- 已实现 `terrain / biome / tags / note` 编辑
- 已实现脏状态基础提示
- 已实现撤销 / 重做按钮
- 已实现地图平移与缩放
- WebUI 已移除“导出 JSON”按钮，JSON 导出能力当前仅保留在 server / CLI

## 3. 已实现但仍较粗糙的部分

- WebUI 目前更偏工程版，尚未达到设计案中的完整产品化体验
- 错误提示、冲突提示、空状态提示已具备基础版本，但仍可继续细化
- WebUI 的地图管理入口已经更完整，但仍缺少更系统的批量操作能力
- 当前历史仅覆盖会话内编辑历史，不包含跨会话持久化时间线
- 图片导出选项已经支持首版调节，但还没有导出模板管理能力

## 4. 本轮已补齐的高优先功能

- 已补上 WebUI 的“另存为”
- 已补上 WebUI 的地图重命名入口
- 已补上更完整的地图列表信息展示
- 已补上 WebUI 的 PNG 导出选项面板
- 已补上地图悬停详情信息
- 已补上右侧历史摘要区

## 5. 当前测试现状

- 已有 `map-core` 核心单元测试
- 已通过：
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm test`
- 已做过 CLI 烟雾测试：
  - 创建地图
  - 应用结构化命令
  - 导出 PNG
- 现已补上：
  - `apps/server` 的 service / API 集成测试
  - `apps/web` 的关键交互测试
- 当前验证覆盖已包括：
  - 核心规则
  - server 新建 / 获取 / 另存为 / 导出
  - WebUI 打开 / 选中 / 新建 / 另存为

## 6. 下一步执行顺序

1. 继续补强 WebUI 交互测试，覆盖重命名、PNG 选项与悬停信息
2. 评估是否为 CLI 增补更多地图管理命令能力
3. 继续对照设计案梳理剩余产品化细节
4. 再次审视 README 与使用说明，补齐操作文档

## 7. 最新验收记录

### 7.1 WebUI 验收结论

- 已完成手工验收的核心项：
  - 地图打开与状态显示
  - 缩放与平移
  - 单元格选中与右侧编辑
  - 已设计格编辑与保存
  - 外围 `undesigned` 设为 `designed` 后自动扩边
  - 清空单元格后的状态回退与边界回收
  - 地图保存、另存为、重命名
  - 图片导出
  - 脏状态切图确认
  - 顶部地图切换
- 本轮产品决策：
  - WebUI 顶部移除“导出 JSON”入口
  - JSON 导出保留给 server / CLI 使用

### 7.2 CLI 验收结论

- 已通过的 CLI 验收项：
  - `maps list`
  - `maps inspect`
  - `maps apply` 的 `set_cell`
  - `maps apply` 的 `clear_cell`
  - `maps export-png`
- 已确认 CLI 与 WebUI 共用同一套地图规则：
  - CLI 把外围 `undesigned` 设为 `designed` 后，WebUI 能正确看到目标格转为已设计状态
  - CLI 设格后，WebUI 能正确看到活动区域继续向外扩一圈
  - CLI 清空后，WebUI 能正确看到目标格回退为 `undesigned`
  - CLI 清空后，WebUI 能正确看到纯外围新增活动区被回收
- 本轮 CLI 验收使用的地图：
  - `manual-acceptance-map-copy-b72429`
- 本轮 CLI 验收中实际验证过的目标格：
  - `R1C2`

### 7.3 Phase A 已修正项

- `maps apply --stdin` / `--file` 已对齐为支持设计案中的正式输入格式：
  - `{ "commands": [...] }`
- 同时保留兼容输入：
  - 单条 `MapCommand`
  - `MapCommand[]`
- server 默认存储目录已回归仓库根目录：
  - `storage/maps`
  - `storage/exports`
- `MAPDESIGNER_ROOT` 覆盖能力保留不变，用于测试与隔离环境

### 7.4 Phase B 已修正项

- WebUI 的 PNG 导出已从“仅服务端落盘”升级为“服务端落盘 + 浏览器直接下载”
- server 新增导出文件下载路由，供 WebUI 在导出成功后直接获取 PNG
- `POST /api/maps/:id/export-png` 现已返回：
  - `fileName`
  - `path`
  - `downloadUrl`
- CLI 导出行为保持不变，仍以文件落盘为主

### 7.5 Phase C 已修正项

- WebUI 的 terrain 选择已从单层扁平下拉升级为“两级选择”：
  - `Terrain 分类`
  - `Terrain`
- terrain 一级分类基于 `map-core` 字典统一导出，当前分为：
  - 水域
  - 海岸
  - 平原与低地
  - 高地与山地
  - 切割地貌
  - 干旱地貌
  - 寒冷地貌
  - 火山地貌
- 地图持久化格式、CLI terrain key、已有地图文件结构均保持不变
- 打开已有地图时，WebUI 会根据当前 terrain 自动回填对应分类

### 7.6 Phase D 已修正项

- WebUI 已升级为 `Terrain 分类 / Terrain / Biome` 双向联动筛选
- 当前联动行为为：
  - 先选 `Terrain` 时，`Biome` 下拉缩小为该地形的可选生态
  - 先选 `Biome` 时，`Terrain 分类` 与 `Terrain` 缩小为仍可选项
  - 若修改一侧后另一侧不再兼容，界面会自动清空不兼容值
- 本轮目标是缩小菜单范围、提升编辑舒适度，不新增 warning 流程，也不把这套关系提升为严格硬校验
- 主规则表已集中在 `map-core`，供 WebUI 复用：
  - `ALLOWED_BIOMES_BY_TERRAIN`

### 7.7 Phase E 验收收口结论

- 已完成无需用户参与的第一阶段验收：
  - `map-core` 测试通过：15 项
  - `web` 测试通过：16 项
  - `server` 测试通过：12 项
  - 三侧 `typecheck` 全部通过
  - 全量 `build` 通过
- 已完成 CLI 与文件行为验收：
  - `maps create` 正常
  - `maps apply --stdin` 使用 `{ "commands": [...] }` 正常
  - `maps inspect` 可顺序读取更新后的 revision 与 cell 内容
  - `maps export-png` 正常
  - 默认目录已核实为仓库根：
    - `/root/WorkSpace/MapDesigner/storage/maps`
    - `/root/WorkSpace/MapDesigner/storage/exports`
  - 下载路由已核实可返回真实 PNG：
    - `GET /api/exports/:fileName`
- 已完成需要用户参与的第二阶段手工验收：
  - 页面正常打开
  - 选中已有格子后，`Terrain 分类 / Terrain / Biome` 回填正常
  - 先选 `Terrain` 时，`Biome` 缩小正常
  - 先选 `Biome` 时，`Terrain 分类` 与 `Terrain` 反向缩小正常
  - 由于 UI 已前置约束，不兼容组合在正常操作路径中通常无法先被选出；该行为已被确认是合理且符合预期的
  - 右侧编辑保存正常
  - 顶部保存正常
  - 重新打开后数据恢复正常
  - PNG 导出可直接触发浏览器下载
- 当前可确认：
  - Phase A 已验收通过
  - Phase B 已验收通过
  - Phase C 已验收通过
  - Phase D 已验收通过
- 当前阶段状态：
  - 本轮“下一阶段计划”中的核心功能与验收目标已完成
  - 尚未执行的主要收口动作只剩提交 / 推送与后续是否继续扩展新功能的决策
