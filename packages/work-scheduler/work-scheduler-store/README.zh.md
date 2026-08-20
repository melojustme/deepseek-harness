# @deepseek-ai/dsh-work-scheduler-store

[English](README.md) | 中文

dsh Web 工作调度文档的按 Workspace 持久化存储。它通过[存储领域形态](../../storage/storage-domain/README.md)（`ctx.storageDomain`）为每个 Workspace 读写一份带版本的 JSON 文档。组合中的 storage-domain 路由选择 JSON 文件树或 SQLite 介质，本包不选择后端。浏览器插件（[`dsh-client-ui-work-scheduler`](../../client/ui-work-scheduler/README.md)）是持久化副本的客户端。

## 服务

本包注册 `ctx.workSchedulerStore`，提供 `load(workspaceId)` 与 `save(workspaceId, document)`。Workspace 没有存储记录时，`load` 返回空文档。`save` 通过领域单写链替换文档：先持久化，再更新内存，最后发送 `domain/changed`。服务打开版本 2 的 `work_scheduler` 领域，其中 `documents` 表以 Workspace ID 为键；服务随自身 fiber 关闭，并在重新打开时按文档 schema 校验每条记录。任务可以携带一个可选 Session ID；浏览器会投影其当前标题与可用状态，而不持久化这两个值。

网关中可供浏览器使用的 `api/` 层（[`dsh-host-apiproxy`](../../host/apiproxy/README.md)）拥有 `WorkSchedulerDocument` 及其 Zod schema，因为 Host 存储和浏览器客户端共享这些定义。本包对持久化记录复用该 schema，因此线上和持久化读取路径接受相同的 JSON 字段。

## 组合

存储服务需要 storage 枢纽、一个 KV 后端（如 [`dsh-storage-sqlite`](../../storage/storage-sqlite/README.md)）和 [`dsh-storage-domain`](../../storage/storage-domain/README.md)。网关通过该服务提供 `workScheduler.load` 与 `workScheduler.save`。可安装的 [`dsh-work-scheduler`](../../bundle/work-scheduler/README.md) bundle 在 Web app 之后挂载存储与浏览器插件，并把本领域路由到 SQLite。见[工作调度决策](../../../.agents/notes/implemented/feature/2026-08-18-web-work-scheduler.md)。

## 模型体验

### Workspace 调度文档

#### 模型看到什么

模型看不到 `ctx.workSchedulerStore` 存储的文档。本包不增加提示词、工具 schema、请求字段、Session 事件或模型可见结果。

#### Token 影响

本包不会向模型请求添加 token。

#### KV Cache 影响

本包不改变模型请求，因此不会使原本可复用的前缀失效。

## 已知限制与延期工作

- 文档只按 Workspace 为键：并发编辑采用后写胜出，不进行合并或冲突检测。
- 删除 Workspace 注册后，其调度文档仍然保留；Workspace 生命周期清理不包含本领域。
- 文档采用 `version: 2` 且没有迁移路径；未来格式会提升领域版本，并按预发布策略拒绝旧介质。
