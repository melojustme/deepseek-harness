# work-scheduler/ — work scheduler family

English | [中文](README.zh.md)

This family persists the dsh Web work scheduler board per Workspace.

| Package | Role | ctx key |
|---|---|---|
| [`work-scheduler-store/`](work-scheduler-store/README.md) | Per-workspace durable scheduler document store | `ctx.workSchedulerStore` |

The browser surface lives in [`dsh-client-ui-work-scheduler`](../client/ui-work-scheduler/README.md); this family owns the durable document service it reads and writes.
