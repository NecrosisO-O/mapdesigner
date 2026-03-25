# 异世界地图设计软件实施计划

## 1. 文档定位

本文件用于记录项目从“设计完成”进入“准备开工”后的实施计划。

与 [DESIGN.md](/root/WorkSpace/MapDesigner/DESIGN.md) 的分工如下：

- `DESIGN.md`：负责产品设计、数据规则、UI 规则、CLI 规则、导出规则等“做什么”
- `IMPLEMENTATION_PLAN.md`：负责工程拆分、实施顺序、里程碑、交付物、验证方式等“怎么落地”

当前阶段仍然是计划阶段，不进入代码实现。

## 2. 当前共识与约束

开工前已确认的关键约束如下：

- 项目目录固定为 `/root/WorkSpace/MapDesigner`
- 首版同时提供 WebUI 与 CLI
- 地图采用平顶六角格，坐标系统为 `flat-top-even-q`
- 地图使用扩展坐标，显示坐标为 `R{row}C{col}`
- 单元格状态只有 `designed` 与 `undesigned`
- 地图文件仅持久化 `designed` 单元格
- 单元格内容以 `terrain + biome + tags + note` 表达
- `tags` 使用 V1 内置预设字典，不开放用户自定义
- AI agent 的主入口是 CLI，WebUI 只面向人类交互
- CLI 与 WebUI 共用统一业务规则，不允许各自维护一套地图逻辑
- V1 只处理地理底图，不进入国家、道路、聚落等人文图层

## 3. 推荐工程结构

建议实施时采用以下目录结构：

```text
/root/WorkSpace/MapDesigner
├── DESIGN.md
├── IMPLEMENTATION_PLAN.md
├── apps
│   ├── server
│   └── web
├── packages
│   ├── map-core
│   └── map-render
└── storage
    ├── exports
    └── maps
```

模块职责建议如下：

- `apps/web`
  负责页面布局、交互状态、地图管理界面、地图画布、详情面板、提示信息
- `apps/server`
  负责磁盘文件 I/O、本地 API、目录扫描、冲突检查、导入导出流程编排、PNG 生成编排
- `packages/map-core`
  负责地图领域模型、坐标换算、邻接计算、活动区域重算、校验、命令应用、撤销 / 重做核心逻辑、地图数据序列化 / 反序列化
- `packages/map-render`
  负责 SVG 六角格布局、terrain 底色、biome 纹理、tag 角标、离屏导出渲染
- `storage/maps`
  用于保存地图原生文件
- `storage/exports`
  用于保存导出的 PNG 等文件

## 4. 实施总原则

实施时建议遵守以下原则：

- 先打通最小闭环，再补完整功能
- 先做 `map-core`，再做 server / web / CLI 接入
- 先实现单格编辑闭环，再补批量操作
- 先做 JSON 导入导出，再做 PNG 导出
- 先保证规则正确，再优化性能与视觉表现
- 每一阶段都应有可验证产物，避免长时间堆积未验证代码

## 5. 里程碑总览

建议将首版实施拆成 8 个里程碑：

1. Milestone 0：工程骨架与基础约定
2. Milestone 1：`map-core` 核心规则层
3. Milestone 2：`map-render` 渲染层
4. Milestone 3：`apps/server` 本地服务层
5. Milestone 4：`apps/web` 基础编辑界面
6. Milestone 5：CLI `mapdesigner` 最小命令集
7. Milestone 6：PNG 导出、撤销重做与错误处理完善
8. Milestone 7：验收、自测样例与示例地图

以下章节按里程碑逐项说明。

## 6. Milestone 0：工程骨架与基础约定

### 6.1 目标

建立项目目录、包边界、命名规则和最小开发骨架，为后续编码留出稳定结构。

### 6.2 计划产物

- 初始化 `apps/web`
- 初始化 `apps/server`
- 初始化 `packages/map-core`
- 初始化 `packages/map-render`
- 创建 `storage/maps`
- 创建 `storage/exports`
- 建立统一的 TypeScript 基础配置与共享开发约定

### 6.3 关键决定

- 优先保证 monorepo 或多包结构稳定
- 在这一阶段不追求功能完成
- 所有包之间的依赖方向应先确定清楚

建议依赖方向：

- `apps/web` 依赖 `map-core`、`map-render`
- `apps/server` 依赖 `map-core`、`map-render`
- `map-render` 可依赖 `map-core` 的只读类型与渲染输入模型
- `map-core` 不依赖任何 app 层

### 6.4 完成判定

- 目录结构建立完成
- 各模块能独立被编译或加载
- 依赖方向没有循环引用
- 项目能够启动空白的 server 与 web 基础壳

## 7. Milestone 1：`map-core` 核心规则层

### 7.1 目标

实现首版最重要的业务核心，使地图规则不依赖 UI，也不依赖磁盘文件。

### 7.2 核心范围

- 地图数据类型定义
- 单元格类型定义
- `terrain / biome / tag` 字典常量
- 坐标与 `cell_id` 规则
- 六角格邻接计算
- 初始种子区生成
- 活动区域扩展与回收
- `designed / undesigned` 推导
- `terrain / biome` 组合校验
- `tags` 合法性校验
- 结构化命令执行器
- 撤销 / 重做核心数据结构
- 地图对象序列化 / 反序列化

### 7.3 建议先做的函数或模块

- `coords`
  负责 `row / col / cell_id / R{row}C{col}` 互转
- `neighbors`
  负责 even-q 邻接规则
- `activity-ring`
  负责活动区域扩展、回收与初始种子区生成
- `validators`
  负责 `terrain / biome / tag / meta.id / schema` 校验
- `commands`
  负责 `set_cell / set_cells / clear_cell / replace_terrain / replace_biome / annotate_cell`
- `history`
  负责撤销 / 重做记录结构
- `schema`
  负责地图文件读写前后的数据结构约束

### 7.4 建议实现顺序

1. 数据类型与字典
2. 坐标换算与邻接计算
3. 初始种子区与活动区域重算
4. 校验器
5. 单格命令
6. 批量命令
7. 撤销 / 重做
8. 序列化 / 反序列化

### 7.5 完成判定

- 不依赖 UI 即可在纯代码环境中创建地图
- 能正确应用结构化命令并返回变更结果
- 能从纯 `designed` 数据恢复运行时活动区域
- 能稳定判断 `warning / invalid`
- 能完成 JSON round-trip

## 8. Milestone 2：`map-render` 渲染层

### 8.1 目标

建立一套既可供 WebUI 使用、也可供导出使用的统一渲染逻辑。

### 8.2 核心范围

- 六角格几何布局计算
- SVG 渲染模型
- `terrain` 底色映射
- `biome` 纹理映射
- `designed / undesigned` 样式差异
- 主角标 tag 渲染
- 坐标与简写文字布局
- 缩放层级下的信息显示规则
- PNG 导出前的离屏渲染输入模型

### 8.3 建议产物

- `renderHexGrid(...)`
- `renderCell(...)`
- `renderTagBadge(...)`
- `buildExportScene(...)`
- terrain 颜色 token 表
- biome 纹理 token 表

### 8.4 实施注意点

- WebUI 渲染与 PNG 导出必须尽量复用同一套渲染规则
- 不要让浏览器画布逻辑和导出逻辑各走一套
- 先确保静态渲染正确，再做交互态和缩放层级优化

### 8.5 完成判定

- 能基于地图数据输出稳定 SVG 结果
- terrain / biome / tag 的视觉分层符合设计
- `clean / reference` 两种导出预设能生成不同渲染结果

## 9. Milestone 3：`apps/server` 本地服务层

### 9.1 目标

建立本地后端服务，使 WebUI、CLI 和磁盘存储之间有统一宿主层。

### 9.2 核心范围

- 地图文件列表读取
- 单张地图打开
- 保存 / 另存为 / 复制 / 删除
- 导入 JSON
- 导出 JSON
- PNG 导出流程
- `meta.id` 冲突检查
- `revision` 冲突检查
- 本地 API 路由

### 9.3 建议接口能力

- `GET /maps`
- `GET /maps/:id`
- `POST /maps`
- `PUT /maps/:id`
- `POST /maps/:id/duplicate`
- `DELETE /maps/:id`
- `POST /maps/import`
- `POST /maps/:id/export-json`
- `POST /maps/:id/export-png`

### 9.4 关键规则

- 所有地图读写都应走 `map-core` 的 schema 与校验规则
- server 只负责文件系统、目录扫描、冲突检查和流程编排
- `meta.id` 冲突必须显式返回错误或进入“生成新 ID 后导入”分支
- 不允许 server 绕过 `map-core` 直接修改地图业务数据

### 9.5 完成判定

- 能稳定读写 `storage/maps`
- 能检查文件名冲突与 `meta.id` 冲突
- 能返回结构化错误信息
- PNG 导出流程能通过 server 编排触发

## 10. Milestone 4：`apps/web` 基础编辑界面

### 10.1 目标

打通人类用户的最小可视化编辑闭环。

### 10.2 核心范围

- 顶栏文件操作
- 地图列表与地图切换
- 中央六角格画布
- 单元格选中
- 悬停信息
- 右侧详情面板
- `terrain / biome / tags / note` 编辑
- 单格保存与清空
- 脏状态提示
- 空状态与错误提示

### 10.3 建议先实现的交互闭环

1. 新建地图
2. 点击格子
3. 修改 `terrain`
4. 保存为 `designed`
5. 自动补出外围 `undesigned`
6. 切换地图并保持脏状态提示

### 10.4 细化建议

- `Tags` 使用预设 tag 多选控件
- `Status` 只读显示，不提供直接编辑
- 先采用“改表单后点击保存”的交互方式
- 空状态文案与错误提示先做清晰版，不急着做漂亮动画

### 10.5 完成判定

- 人类用户可以在 WebUI 中独立完成基础编辑
- 单元格状态变化与活动区域重算正确反映在画布上
- `terrain / biome / tags / note` 可视化与数据保持一致

## 11. Milestone 5：CLI `mapdesigner` 最小命令集

### 11.1 目标

提供稳定的 AI agent 主调用入口，并与 WebUI 共用业务规则。

### 11.2 首批命令

- `mapdesigner maps list`
- `mapdesigner maps create`
- `mapdesigner maps inspect`
- `mapdesigner maps apply`
- `mapdesigner maps import`
- `mapdesigner maps export-json`
- `mapdesigner maps export-png`
- `mapdesigner maps duplicate`
- `mapdesigner maps delete`

### 11.3 关键约束

- CLI 必须使用统一 JSON envelope
- 所有命令尽量返回结构化 JSON
- `--map-id` 以 `meta.id` 为唯一定位键
- `maps apply` 必须支持从 `--stdin` 与 `--file` 接收结构化命令
- CLI 不通过自动化点击 WebUI 来完成操作

### 11.4 建议实现顺序

1. `maps list`
2. `maps inspect`
3. `maps create`
4. `maps apply`
5. `maps import`
6. `maps export-json`
7. `maps export-png`
8. `maps duplicate`
9. `maps delete`

### 11.5 完成判定

- AI agent 能只依赖 CLI 完成地图修改与导出
- CLI 返回结果稳定，适合自动解析
- CLI 与 WebUI 对同一地图的行为规则一致

## 12. Milestone 6：PNG 导出、撤销重做与错误处理完善

### 12.1 目标

将首版从“能用”提升到“可持续使用”。

### 12.2 核心范围

- `clean / reference` 两种 PNG 预设
- 导出范围与 `undesigned` 组合规则
- 撤销 / 重做交互接入
- 成功提示、警告提示、冲突提示
- 导入失败与保存失败的明确错误显示
- 导出失败提示

### 12.3 建议完成顺序

1. PNG 导出规则完全接通
2. 撤销 / 重做按钮与快捷键接入
3. 成功 / 警告 / 错误提示统一
4. 空状态与异常状态补齐

### 12.4 完成判定

- WebUI 中能稳定执行撤销 / 重做
- PNG 导出与设计文档规则一致
- 常见错误都能被明确识别和提示

## 13. Milestone 7：验收、自测样例与示例地图

### 13.1 目标

让首版不仅“实现完”，而且“可验证、可演示、可回归”。

### 13.2 核心范围

- 示例地图文件
- 导入校验异常样例
- CLI 命令示例
- PNG 导出示例
- 关键规则回归验证

### 13.3 建议准备的样例

- 空地图样例
- 单区域小地图样例
- 多块不连通区域样例
- 含内部 `undesigned` 空白格样例
- `warning` 级组合样例
- `invalid` 级输入样例
- 主角标 tag 展示样例

### 13.4 完成判定

- 能通过样例快速回归核心功能
- 新成员只看样例也能理解地图文件结构和 CLI 用法
- 导出结果可用于演示与验收

## 14. 推荐首轮开工顺序

如果进入实际编码，我建议采用以下“最小闭环优先”顺序：

1. 建立工程骨架与包边界
2. 完成 `map-core` 的坐标、活动区域、校验和单格命令
3. 用最简 SVG 先把六角格画出来
4. 打通 server 的地图读写接口
5. 打通 WebUI 的单格选中和右侧编辑面板
6. 打通“新建地图 -> 编辑单格 -> 保存 -> 重新打开”闭环
7. 再补 CLI `maps inspect / maps apply`
8. 最后补 PNG 导出、撤销 / 重做、地图管理与细节优化

这样做的好处是：

- 核心规则会尽早被真实流程验证
- 可以尽快形成第一个可演示版本
- 后续再补批量命令和导出时风险更低

## 15. 每阶段建议验证方式

建议每个阶段至少做一轮针对性验证：

- Milestone 0：模块能否独立启动 / 构建
- Milestone 1：纯逻辑样例验证与核心规则测试
- Milestone 2：静态渲染结果对照检查
- Milestone 3：文件读写、冲突、导入导出流程验证
- Milestone 4：人工点选与编辑闭环验证
- Milestone 5：CLI 输入输出回归验证
- Milestone 6：导出、撤销 / 重做、错误处理回归验证
- Milestone 7：整体验收清单核对

## 16. 风险与应对

当前实施风险主要有以下几类：

- 业务规则被分散到多个层
  应对：优先完成 `map-core`，严禁 app 层复制规则
- WebUI 渲染与 PNG 导出表现不一致
  应对：统一通过 `map-render` 输出渲染结果
- `meta.id` / `revision` 冲突处理被绕过
  应对：所有读写统一走 server 和 `map-core`
- 过早追求视觉精细，拖慢主闭环
  应对：先做正确，再做精细
- 过早铺开 CLI 全命令，导致主闭环变慢
  应对：先完成 `inspect` 与 `apply`，其他命令后补

## 17. 当前结论

当前项目已经具备进入编码实施前准备阶段的条件。

推荐策略是：

- 先按本计划执行工程骨架与核心规则层
- 先追求最小闭环，而不是一次性完成全部细节
- 每完成一个里程碑就做验证，不累积大批未校验工作

在不改变既有设计结论的前提下，本计划可以直接作为后续开工的执行底稿。
