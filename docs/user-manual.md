# MapDesigner 0.1.0 用户说明书

本文档面向 `MapDesigner 0.1.0` 的实际使用者，说明如何安装、启动、编辑地图、保存导入导出，以及如何使用 CLI 进行基础操作。

如果你想了解项目定位、功能总览与发布口径，可参考：

- [PRODUCT_OVERVIEW_0.1.0.md](/root/WorkSpace/MapDesigner/PRODUCT_OVERVIEW_0.1.0.md)

如果你想了解面向 AI agent 的 CLI 工作流，可参考：

- [agent-cli.md](/root/WorkSpace/MapDesigner/docs/agent-cli.md)

如果你想了解用户自部署与发布态启动方式，可参考：

- [deployment.md](/root/WorkSpace/MapDesigner/docs/deployment.md)

## 1. 适用对象

`MapDesigner` 适合以下使用场景：

- 异世界地理底图设计
- 小说、跑团、游戏设定中的地图参考制作
- 希望同时使用 WebUI 和结构化命令编辑地图的用户
- 需要本地保存地图文件、并导出参考图片的创作者

当前版本更偏向：

- 地形与生态层面的世界设计
- 规则驱动的参考地图制作

当前不以在线协作、复杂人文图层或美术成图为主要目标。

## 2. 环境要求

使用前请确认本地环境满足：

- Node.js `20 LTS`
- `pnpm`

## 3. 安装依赖

进入项目根目录后执行：

```bash
pnpm install
```

## 4. 启动项目

`MapDesigner` 当前有两种常见启动方式：

- 开发模式
- 发布态模式

如果你只是日常使用本项目，推荐优先参考“发布态模式”。

### 4.1 开发模式启动

开发模式适合：

- 本地开发
- 调试界面
- 修改代码后即时查看效果

在项目根目录执行以下两个命令。

启动服务端：

```bash
pnpm dev:server
```

再启动 WebUI：

```bash
pnpm dev:web
```

默认情况下：

- `http://localhost:3010`
- `http://localhost:5173`

其中：

- `3010` 为服务端
- `5173` 为 Vite 开发页面

### 4.2 发布态模式启动

发布态模式适合：

- 用户本地长期使用
- 自部署运行
- 按正式发布流程访问 WebUI

在项目根目录执行：

```bash
pnpm build
pnpm start
```

默认情况下，发布态访问地址为：

- `http://localhost:3010`

此时：

- `server` 会提供 API
- `server` 也会直接托管前端构建产物
- 用户只需要访问一个地址即可使用 WebUI

### 4.3 建议的启动顺序

推荐先启动服务端，再启动 WebUI：

1. `pnpm dev:server`
2. `pnpm dev:web`

如果你使用发布态模式，则只需要：

1. `pnpm build`
2. `pnpm start`

## 5. 数据目录说明

当前版本采用本地文件持久化。

### 5.1 地图文件目录

地图主文件默认存放在：

- `storage/maps`

地图主文件格式为 `JSON`。

### 5.2 导出文件目录

导出文件默认存放在：

- `storage/exports`

导出内容可能包括：

- 地图 JSON
- PNG 图片

### 5.3 运行数据说明

项目运行过程中，测试地图和临时导出文件也会写入这些目录。若你使用 Git 管理仓库，通常不建议把本地运行数据直接提交到版本库。

## 6. 界面概览

当前 WebUI 采用三栏布局：

- 顶栏：地图管理与全局操作
- 左栏：状态、显示信息、图片导出等辅助功能
- 中栏：六角格地图画布
- 右栏：当前单元格属性编辑区

## 7. 地图基础概念

在开始编辑前，建议先理解下面几条规则。

### 7.1 六角格布局

- 地图以六角形单元格显示
- 当前布局固定为 `flat-top-even-q`

### 7.2 坐标显示

每个单元格都有坐标，显示格式为：

- `R{row}C{col}`

例如：

- `R0C0`
- `R1C-1`
- `R-2C3`

其中：

- `R` 后表示行
- `C` 后表示列
- 坐标允许负数

### 7.3 单元格状态

当前版本中，单元格主要有两种状态：

- `designed`
- `undesigned`

含义如下：

- `designed`：已经正式设计完成，会保存到地图文件中
- `undesigned`：当前活动区域中的空白格，仅用于继续扩展和编辑，不会写入地图文件

### 7.4 地图扩展规则

地图不会一次性生成无限大的空白区域。当前规则是：

- 文件只保存 `designed` 单元格
- 运行时自动显示这些单元格外围一圈 `undesigned` 单元格
- 当你把外围空白格正式设计后，地图会继续向外扩一圈

这样做的目的是：

- 保证地图可持续扩展
- 避免文件里保存大量无意义空白格

## 8. 新建和打开地图

### 8.1 新建地图

在顶栏中使用新建地图功能，可创建一张新的空地图。

新地图创建后：

- 文件会写入 `storage/maps`
- 地图初始会显示一个 7 格种子区
- 这些初始格大多是 `undesigned`，用于开始编辑

### 8.2 打开已有地图

你可以从界面中打开已存在的地图文件，继续编辑之前保存的内容。

打开后：

- 已设计的格子会恢复
- 活动区域会根据当前 `designed` 单元格自动重新计算

## 9. 单元格编辑

### 9.1 选中单元格

在中间地图画布上点击某个六角格，即可选中它。

选中后，可在右侧编辑区查看和修改该格属性。

### 9.2 可编辑的内容

当前支持编辑以下属性：

- `Terrain 分类`
- `Terrain`
- `Biome`
- `Tags`
- `Note`

### 9.3 Terrain 分类与 Terrain

地形选择分为两级：

- 先选 `Terrain 分类`
- 再选具体 `Terrain`

这样可以减少长列表查找，提高操作速度。

### 9.4 Biome 联动

`Biome` 会根据当前地形进行联动筛选。

表现为：

- 先选地形时，生态候选会缩小
- 先选生态时，地形分类和地形列表也会缩小

这项功能的目的不是完全禁止特殊组合，而是缩小选择范围，让编辑更舒适。

### 9.5 Tags 与 Note

除了地形与生态，你还可以为单元格添加：

- `Tags`：附加标记
- `Note`：备注说明

这些内容适合记录：

- 地貌特征
- 特殊说明
- 创作备注

### 9.6 保存修改

在右侧编辑区修改内容后，需要执行保存操作，才会正式写入地图文件。

如果切换格子、切换地图或关闭页面时存在未保存修改，界面会进行提示。

### 9.7 清空单元格

你可以将一个已经设计过的格子清空。

清空后：

- 该格会回到 `undesigned`
- 若它只属于外围冗余空白区域，地图边界可能会自动回收

## 10. 地图视图操作

### 10.1 缩放

地图画布支持滚轮缩放。

当前版本已优化为：

- 可以缩得比较小
- 缩放尽量以鼠标位置为中心

### 10.2 平移

地图画布支持拖拽平移，便于查看更大范围的地图。

## 11. 格式刷

当前 WebUI 已提供基础格式刷功能。

使用方式是：

- 点击格式刷按钮进入格式刷模式
- 再次点击可退出格式刷模式

格式刷适合快速复制某些单元格的属性组合，提高重复编辑效率。

## 12. 地图管理功能

当前 WebUI 已支持以下地图管理操作：

- 保存
- 另存为
- 重命名
- 复制
- 删除

### 12.1 保存

将当前地图内容写回原地图文件。

### 12.2 另存为

将当前地图保存为一张新的地图文件，保留原地图不变。

### 12.3 重命名

修改当前地图的名称。

### 12.4 复制

基于当前地图快速创建一个副本。

### 12.5 删除

删除当前地图文件。使用前请确认该地图是否仍需要保留。

## 13. 导入与导出

### 13.1 导入 JSON

你可以导入符合当前格式的地图 JSON 文件。

适合：

- 恢复已有地图
- 在不同环境间转移地图
- 通过外部脚本生成后再导入

### 13.2 导出 PNG

当前 WebUI 支持将渲染后的地图导出为 PNG 图片。

导出时：

- 服务端会将图片保存到 `storage/exports`
- 浏览器会直接触发下载

适合：

- 存档
- 创作参考
- 分享当前地图状态

### 13.3 导出预设

当前 PNG 导出支持基础预设，例如：

- `clean`
- `reference`

不同预设适合不同的参考用途。

## 14. JSON 文件说明

当前地图的主持久化格式为 `JSON`。

顶层结构包括：

- `schema_version`
- `meta`
- `grid`
- `cells`

其中：

- `cells` 只保存 `designed` 单元格
- `undesigned` 单元格不写入文件，只在运行时生成

## 15. CLI 基础用法

如果你希望通过命令行而不是 WebUI 进行操作，可以使用 CLI。

### 15.1 CLI 入口

开发环境中可在项目根目录执行：

```bash
pnpm exec tsx apps/server/src/cli.ts maps list
```

### 15.2 常用命令

创建地图：

```bash
pnpm exec tsx apps/server/src/cli.ts maps create --name "Demo Map"
```

查看地图：

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect --map-id demo-map
```

查看单格：

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect-cell --map-id demo-map --row 0 --col 0
```

查看一片区域：

```bash
pnpm exec tsx apps/server/src/cli.ts maps inspect-area --map-id demo-map --row 0 --col 0 --radius 2
```

查看六邻格：

```bash
pnpm exec tsx apps/server/src/cli.ts maps neighbors --map-id demo-map --row 0 --col 0
```

导出 PNG：

```bash
pnpm exec tsx apps/server/src/cli.ts maps export-png --map-id demo-map --preset reference
```

### 15.3 结构化修改

CLI 支持通过结构化 JSON 命令修改地图。

例如：

```bash
echo '{
  "commands": [
    {
      "action": "set_cell",
      "source": "cli",
      "target": { "row": 0, "col": 0 },
      "changes": { "terrain": "plain", "biome": "grassland" }
    }
  ]
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin
```

### 15.4 先 dry-run 再 apply

推荐先预演，再正式写盘：

```bash
echo '{
  "commands": [
    {
      "action": "set_cell",
      "source": "cli",
      "target": { "row": 0, "col": 0 },
      "changes": { "terrain": "plain", "biome": "grassland" }
    }
  ]
}' | pnpm exec tsx apps/server/src/cli.ts maps apply --map-id demo-map --stdin --dry-run
```

`--dry-run` 会返回完整执行结果，但不会写回地图文件。

## 16. AI agent 使用建议

如果你计划让 AI agent 调用本项目，推荐使用固定顺序：

1. `inspect`
2. `inspect-cell` 或 `inspect-area`
3. `dry-run`
4. `apply`
5. `inspect`
6. `export-png`

更完整的 agent 使用说明请参考：

- [agent-cli.md](/root/WorkSpace/MapDesigner/docs/agent-cli.md)

## 17. 常见问题

### 17.1 为什么有些空白格不会保存到文件里

因为当前版本只保存 `designed` 单元格。外围空白格属于运行时活动区域，用于继续扩图，不会直接写入地图文件。

### 17.2 为什么清空一个格子后地图边缘会缩回去

因为系统会自动回收纯外围冗余空白区域。这是当前设计的一部分，用于避免活动区域无限膨胀。

### 17.3 为什么 WebUI 中看不到导出 JSON 按钮

当前版本中，WebUI 主要提供 PNG 导出。JSON 导出能力保留在 server / CLI 侧。

### 17.4 当前版本支持自然语言下命令吗

不支持。当前版本只支持结构化命令，不解析自然语言输入。

## 18. 当前版本边界

`0.1.0` 目前尚未包含以下方向：

- 自然语言命令解析
- 云同步
- 多人协作
- CSV 作为主持久化格式
- 人文图层
- 奇幻专用地形扩展
- 跨会话历史时间线

因此，建议把 `0.1.0` 理解为：

- 一个已经可用的初始版
- 一个适合本地创作与 AI agent 协同流程的基础地图工具

而不是一个已经覆盖全部高级需求的终版系统。
