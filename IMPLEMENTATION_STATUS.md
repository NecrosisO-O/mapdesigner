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

- 已实现地图新建、打开、保存、导入 JSON、导出 JSON、导出 PNG
- 已实现单元格选中、编辑、清空、取消编辑
- 已实现 `terrain / biome / tags / note` 编辑
- 已实现脏状态基础提示
- 已实现撤销 / 重做按钮
- 已实现地图平移与缩放

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
