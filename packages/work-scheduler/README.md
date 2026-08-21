# work-scheduler/ — work scheduler family

English | [中文](README.zh.md)

This family persists the dsh Web work scheduler board per Workspace.

| Package | Role | ctx key |
|---|---|---|
| [`work-scheduler-store/`](work-scheduler-store/README.md) | Per-workspace durable scheduler document store | `ctx.workSchedulerStore` |
| [`tool-work-scheduler/`](tool-work-scheduler/README.md) | Agent-scoped development-SOP synchronization | `sync_work_scheduler` |

The browser surface lives in [`dsh-client-ui-work-scheduler`](../client/ui-work-scheduler/README.md); this family owns the durable document service it reads and writes plus the model tool that projects a Session's SOP stages into that document.
