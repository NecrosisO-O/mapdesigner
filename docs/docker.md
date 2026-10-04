# Docker 部署

镜像构建阶段使用与 .nvmrc 对齐的 Node 24，最终镜像只包含服务器生产依赖、编译产物和 WebUI。
运行账号为 node（UID 1000），默认监听 0.0.0.0:3010，必须配置 MAPDESIGNER_TOKEN。

## 构建与启动

    docker build -t mapdesigner:0.3.0-rc.2 .
    export MAPDESIGNER_TOKEN='替换为随机长令牌'
    docker volume create mapdesigner-data
    docker run --rm --name mapdesigner \
      -p 127.0.0.1:3010:3010 \
      -e MAPDESIGNER_TOKEN \
      -v mapdesigner-data:/data \
      mapdesigner:0.3.0-rc.2

打开 http://127.0.0.1:3010 ，在“地图 → 连接设置”输入令牌。
使用命名卷时 Docker 会保留数据目录权限。若改用宿主机目录挂载，提前让 UID 1000 可写。
如需局域网访问，可将端口映射绑定到指定网卡地址，并根据部署说明配置公开来源与 HTTPS。

## 升级已有数据卷

先停止旧容器并备份整个 /data 卷，再从 v0.3.0-rc.2 源码构建镜像。复用 RC1 的数据卷和访问令牌，SQLite 地图、修订与撤销重做历史会继续保留；新增表在启动时初始化。

镜像以 UID/GID 1000 运行。更早版本由 root 创建的文件需调整所有者；已经正常运行 RC1 的卷可直接复用。以下命令使用本地新镜像更新示例命名卷的权限：

    docker run --rm --user 0 --entrypoint chown \
      -v mapdesigner-data:/data mapdesigner:0.3.0-rc.2 -R 1000:1000 /data

将 mapdesigner-data 替换为实际卷名；宿主机目录挂载同样需要让 UID/GID 1000 可写。随后按上面的启动命令复用原卷并配置访问令牌。

## 数据与健康检查

/data/storage/mapdesigner.db 保存地图和历史，/data/storage/maps 用于旧 JSON 兼容，/data/storage/exports 保存导出产物。
升级镜像时保留整个 /data 卷。镜像带有 /api/health 健康检查，可用 docker inspect 查看状态。

查看日志：

    docker logs mapdesigner

备份可停止容器后归档整个命名卷，或使用 SQLite 在线备份 API。
恢复前保留原卷，建立新卷再验证。详细步骤见 deployment.md。

本仓库 CI 会实际构建镜像并验证非 root 用户、静态界面、健康接口、未认证拒绝和认证后的地图创建、后台渲染和 PNG 下载。
