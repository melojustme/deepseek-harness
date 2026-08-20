# work-scheduler/ — 工作调度能力族

[English](README.md) | 中文

本能力族按 Workspace 持久化 dsh Web 的工作调度看板。

| Package | 角色 | ctx key |
|---|---|---|
| [`work-scheduler-store/`](work-scheduler-store/README.md) | 按 Workspace 持久化的调度文档存储 | `ctx.workSchedulerStore` |

浏览器界面位于 [`dsh-client-ui-work-scheduler`](../client/ui-work-scheduler/README.md)；本能力族拥有它读写的持久化文档服务。
