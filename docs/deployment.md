# MapDesigner 0.1.0 部署说明

本文档面向希望自行部署 `MapDesigner 0.1.0` 的用户，说明发布态部署的推荐方式、运行命令、数据目录和常见注意事项。

## 1. 支持范围

`MapDesigner 0.1.0` 当前推荐的正式部署方式是：

- 本地单机部署
- 基于源码部署
- Node.js + pnpm 环境运行

当前版本更适合：

- 个人创作使用
- 本地资料整理
- 本地 AI agent 工作流集成

当前不以以下方向作为正式支持目标：

- Docker
- 云托管部署
- 多用户协作部署
- 桌面安装包分发

## 2. 环境要求

请先安装：

- Node.js `20 LTS`
- `pnpm`

## 3. 获取项目

将项目源码下载或克隆到本地后，进入项目根目录。

## 4. 安装依赖

在项目根目录执行：

```bash
pnpm install
```

## 5. 构建项目

发布态运行前，请先构建：

```bash
pnpm build
```

这一步会构建：

- `map-core`
- `map-render`
- `server`
- `web`

其中前端构建产物会生成在：

- `apps/web/dist`

## 6. 启动发布态服务

构建完成后，在项目根目录执行：

```bash
pnpm start
```

默认情况下，服务会监听：

- `http://localhost:3010`

此时：

- API 由 `server` 提供
- WebUI 也由 `server` 直接托管

你只需要打开一个地址即可访问整个系统。

## 7. 开发模式与发布态模式的区别

### 7.1 开发模式

开发模式命令为：

```bash
pnpm dev:server
pnpm dev:web
```

适合：

- 本地开发
- 调试界面
- 修改代码

### 7.2 发布态模式

发布态模式命令为：

```bash
pnpm build
pnpm start
```

适合：

- 自部署
- 实际使用
- 发布后运行

如果你是普通用户，推荐优先使用发布态模式。

## 8. 数据目录

当前版本使用本地文件保存数据。

### 8.1 地图主文件

默认目录：

- `storage/maps`

### 8.2 导出文件

默认目录：

- `storage/exports`

### 8.3 备份建议

如果你要备份地图数据，建议至少备份：

- 整个 `storage` 目录

这样可以同时保留：

- 地图主文件
- 已导出的图片或 JSON

## 9. 自定义数据根目录

如果你不希望数据保存在仓库默认位置，可以使用环境变量：

- `MAPDESIGNER_ROOT`

它会覆盖默认数据根目录。

例如：

```bash
MAPDESIGNER_ROOT=/data/mapdesigner pnpm start
```

此时地图与导出目录会变为：

- `/data/mapdesigner/storage/maps`
- `/data/mapdesigner/storage/exports`

适合：

- 自定义存储位置
- 测试隔离
- 多套运行环境分离

## 10. 端口说明

默认端口为：

- `3010`

如果需要更换端口，可通过环境变量 `PORT` 覆盖。

例如：

```bash
PORT=4010 pnpm start
```

## 11. 启动后如何确认是否成功

启动成功后，你可以：

1. 在浏览器中打开：
   - `http://localhost:3010`
2. 检查健康接口：

```bash
curl http://localhost:3010/api/health
```

如果正常，接口会返回包含 `status: "ok"` 的 JSON。

## 12. 发布态访问说明

在发布态模式下：

- 前端页面由 `server` 直接提供
- `/api/*` 路由继续用于数据操作
- 前端页面和 API 共用同一个服务地址

这意味着用户不需要单独再启动一个 Vite 页面服务。

## 13. 常见问题

### 13.1 页面打不开

请优先检查：

- 是否已经执行 `pnpm build`
- 是否已经执行 `pnpm start`
- `3010` 端口是否已被占用

### 13.2 启动成功但没有前端页面

请确认：

- `apps/web/dist` 是否存在
- 是否在构建后再执行了 `pnpm start`

### 13.3 地图保存在哪里

默认保存在：

- `storage/maps`

### 13.4 导出的图片在哪里

默认保存在：

- `storage/exports`

### 13.5 如何迁移到另一台机器

建议同时迁移：

- 项目源码
- `storage` 目录

如果使用了自定义 `MAPDESIGNER_ROOT`，请一并迁移对应的数据目录。

## 14. 建议的用户部署流程

推荐的最小部署流程如下：

1. 安装 Node.js `20 LTS`
2. 安装 `pnpm`
3. 获取项目源码
4. 执行 `pnpm install`
5. 执行 `pnpm build`
6. 执行 `pnpm start`
7. 打开 `http://localhost:3010`
8. 创建地图并确认 `storage/maps` 中出现文件

## 15. 面向 AI agent 的补充说明

如果你还希望通过 CLI 或 AI agent 调用本项目，可参考：

- [agent-cli.md](/root/WorkSpace/MapDesigner/docs/agent-cli.md)

CLI 与 WebUI 共享同一套地图规则，因此可以对同一张地图交叉使用。
