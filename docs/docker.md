# MapDesigner 0.1.0 Docker 部署说明

本文档面向希望使用 Docker 自行部署 `MapDesigner 0.1.0` 的用户，说明推荐的容器运行方式、数据挂载方式，以及启动后的访问方式。

## 1. 当前支持的 Docker 形态

`MapDesigner 0.1.0` 当前提供的是最小可用的单容器部署方案：

- 一个容器同时运行后端服务与 WebUI
- 容器内由 `server` 直接托管前端构建产物
- 地图数据与导出文件通过 volume 持久化

这意味着容器启动后，你只需要通过浏览器访问映射端口，就可以直接打开 WebUI。

## 2. 前置要求

请先准备：

- Docker

不需要额外安装 Node.js 或 `pnpm` 到宿主机。

## 3. 构建镜像

在项目根目录执行：

```bash
docker build -t mapdesigner:0.1.0 .
```

如果构建成功，你会得到一个可直接运行的本地镜像：

- `mapdesigner:0.1.0`

## 4. 启动容器

推荐使用一个本地目录来持久化数据，例如：

```bash
mkdir -p ./mapdesigner-data
docker run --rm \
  -p 3010:3010 \
  -e MAPDESIGNER_ROOT=/data \
  -v "$(pwd)/mapdesigner-data:/data" \
  --name mapdesigner \
  mapdesigner:0.1.0
```

启动后，在浏览器打开：

- `http://localhost:3010`

即可访问 WebUI。

## 5. 容器内的数据目录

推荐将容器内数据根目录统一挂载到：

- `/data`

当 `MAPDESIGNER_ROOT=/data` 时，项目会将数据写到：

- `/data/storage/maps`
- `/data/storage/exports`

这两部分分别用于：

- 保存地图主文件
- 保存导出的图片文件

如果删除容器，只要 volume 仍然保留，数据就不会丢失。

## 6. 端口说明

容器默认监听：

- `3010`

如果你想映射到宿主机的其他端口，可以调整 `-p` 参数，例如：

```bash
docker run --rm \
  -p 4010:3010 \
  -e MAPDESIGNER_ROOT=/data \
  -v "$(pwd)/mapdesigner-data:/data" \
  mapdesigner:0.1.0
```

此时浏览器访问：

- `http://localhost:4010`

## 7. 如何确认是否启动成功

你可以通过以下方式确认服务可用：

1. 浏览器访问 `http://localhost:3010`
2. 调用健康接口：

```bash
curl http://localhost:3010/api/health
```

如果服务正常，应返回包含 `status: "ok"` 的 JSON。

## 8. Docker 模式下的使用方式

在 Docker 部署下，使用体验与本地发布态基本一致：

- WebUI 仍然通过浏览器访问
- API 仍然由同一个服务地址提供
- 地图保存与图片导出仍然写入 `storage` 目录

因此对普通用户来说，主要差别只是：

- 运行方式从 `pnpm build && pnpm start` 变成 `docker build` 与 `docker run`

## 9. 常见问题

### 9.1 浏览器打不开页面

请优先检查：

- 容器是否已经启动
- 宿主机端口是否映射正确
- 浏览器访问的端口是否与 `docker run -p` 一致

### 9.2 地图没有持久化

请确认：

- 已使用 `-v` 挂载宿主机目录
- `MAPDESIGNER_ROOT` 指向 `/data`

### 9.3 导出的图片保存在哪里

如果你按推荐方式挂载数据目录，导出文件会保存在宿主机的：

- `./mapdesigner-data/storage/exports`

### 9.4 如何备份数据

直接备份你挂载到容器的宿主机目录即可，例如：

- `./mapdesigner-data`

## 10. 推荐的 Docker 使用流程

推荐的最小流程如下：

1. 构建镜像：`docker build -t mapdesigner:0.1.0 .`
2. 准备宿主机数据目录
3. 启动容器并映射端口与 volume
4. 浏览器打开 `http://localhost:3010`
5. 创建地图并确认宿主机挂载目录下出现 `storage/maps`

## 11. 与源码部署的关系

如果你更希望直接以源码方式运行项目，可参考：

- [部署说明](/root/WorkSpace/MapDesigner/docs/deployment.md)

如果你只是想直接使用当前版本，Docker 部署通常会更省事。
