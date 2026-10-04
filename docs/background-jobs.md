# 后台任务 API

WebUI 使用后台任务执行大文件导入、导出、合并和合并历史操作。路由和状态定义见 [jobs.ts](../apps/server/src/jobs.ts)，执行入口为 [job-worker.ts](../apps/server/src/job-worker.ts)。CLI 常规命令见 [Agent CLI 指南](./agent-cli.md)。

## 请求与响应

配置访问令牌时，请求携带 `Authorization: Bearer <token>`，网络配置见[部署说明](./deployment.md#网络访问)。创建任务成功返回 HTTP `202`，响应使用统一信封：

```json
{
  "ok": true,
  "result": {
    "id": "任务 ID",
    "kind": "png",
    "state": "queued",
    "stage": "等待处理",
    "createdAt": 0
  },
  "warnings": [],
  "errors": []
}
```

`createdAt` 是创建时的 Unix 毫秒时间；上面是结构示例。任务可能已进入 `running`。使用 `GET /api/jobs/:id` 读取状态，完成后的任务结果位于 `result.result`。

| 方法与路径 | 输入 |
| --- | --- |
| `POST /api/jobs/import` | `Content-Type: application/octet-stream`，请求体直接发送 JSON 文件字节；可附 `?generateNewId=true` |
| `POST /api/jobs/export` | JSON：`{kind, mapId, options?, tileSize?}`；`kind` 为 `png`、`json`、`preview`、`tiles` 或 `tiles-preview` |
| `POST /api/jobs/merge` | JSON：`{mapId, input, preview?}`；`mapId` 为目标地图，合并参数见下方 |
| `POST /api/jobs/history` | JSON：`{mapId, direction: "undo" 或 "redo", expectedRevision}` |
| `GET /api/jobs/:id` | 查询任务，无请求体 |
| `DELETE /api/jobs/:id` | 申请取消，无请求体；返回当前任务状态 |

除原始文件上传外，创建任务使用 `Content-Type: application/json`。分块 `tileSize` 可选 `1024`、`2048`、`4096` 像素；绘图选项由 [ExportRenderOptions](../packages/map-core/src/types.ts) 定义。预览和下载的操作说明见[用户手册](./user-manual.md)。

## 合并预演与提交

合并 `input` 包含：

```json
{
  "sourceId": "来源地图 ID",
  "offsetRow": 0,
  "offsetCol": 0,
  "conflict": "keep-target",
  "expectedSourceRevision": 1,
  "expectedTargetRevision": 1
}
```

`conflict` 为 `keep-target` 或 `replace-target`。预演时可省略两个预期修订字段，实际合并必须提供它们。先以 `preview: true` 取得预演统计和带修订的 `input`，再把返回的 `input` 用于实际合并。来源或目标在两次操作之间发生变化时，修订校验会拒绝过期提交。合并完成后，后台历史接口可撤销或重做整次操作。

## 状态、取消与资源

任务状态为 `queued`、`running`、`cancelling`、`cancelled`、`done` 或 `failed`。失败说明在任务的 `error` 字段中。收到取消请求后继续查询，直到进入终态。事务开始最终提交时，取消接口会提示等待结果；失败或取消的导入不会发布半张地图。

每个服务进程最多接收三项运行/等待任务，上传中的文件也占用容量；同时运行一个工作线程，其 JavaScript 堆上限为 512 MiB。此上限不等于进程总内存。

| 任务 | 超时 |
| --- | --- |
| 导入、实际合并、历史操作、JSON 导出 | 15 分钟 |
| 分块图片包导出 | 1 小时 |
| 合并预演、图片预览、分块预演、普通 PNG | 2 分钟 |

已结束任务的状态从结束时起保留最多 15 分钟，受总计 20 项记录预算约束。状态存在服务进程内，重启后任务 ID 失效；已经提交的地图与历史仍保存在数据库中。

流式解析限制嵌套深度为 32，文件、单元格、河流、记录大小及导出预算见[资源边界](./deployment.md#资源边界)。直接字符串导入与旧同步接口的预算分别保留，调用时需选择对应入口。

文件导出使用独立文件名，结果的 `downloadUrl` 带五分钟有效的单文件凭证。开发模式通过 `apps/server/worker.mjs` 引导工作线程，生产模式使用编译后的 `job-worker.js`。测量方法和流程证据见[大地图验收](./research/large-map-capacity/README.md)。
