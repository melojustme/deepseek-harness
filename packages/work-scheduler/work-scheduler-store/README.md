# @deepseek-ai/dsh-work-scheduler-store

English | [中文](README.zh.md)

Per-Workspace durable store for the dsh Web work scheduler document. It reads and writes one versioned JSON document per Workspace through the [storage domain form](../../storage/storage-domain/README.md) (`ctx.storageDomain`). The composition's storage-domain routing selects the JSON file tree or SQLite medium; this package does not select a backend. The browser plugin ([`dsh-client-ui-work-scheduler`](../../client/ui-work-scheduler/README.md)) is a client of the durable copy.

## Service

The package registers `ctx.workSchedulerStore` with `load(workspaceId)` and `save(workspaceId, document)`. `load` resolves an empty document when the Workspace has no stored record. `save` replaces the document through the domain's single write chain: durability, memory, then `domain/changed`. The service opens the `work_scheduler` domain at version 2 with a `documents` table keyed by Workspace ID, closes it with its fiber, and revalidates every record against the document schema on reopen. A task may carry one optional Session ID; the browser projects its current title and availability instead of persisting either value.

The gateway's browser-safe `api/` layer ([`dsh-host-apiproxy`](../../host/apiproxy/README.md)) owns `WorkSchedulerDocument` and its Zod schema because the Host store and browser client share them. This package reuses that schema for durable records, so the wire and durable read paths accept the same JSON fields.

## Composition

The store requires the storage hub, a KV backend such as [`dsh-storage-sqlite`](../../storage/storage-sqlite/README.md), and [`dsh-storage-domain`](../../storage/storage-domain/README.md). The gateway serves `workScheduler.load` and `workScheduler.save` through this service. The installable [`dsh-work-scheduler`](../../bundle/work-scheduler/README.md) bundle mounts the store and browser plugin after the Web app and routes this domain to SQLite. See the [work scheduler decision](../../../.agents/notes/implemented/feature/2026-08-18-web-work-scheduler.md).

## Model Experience

### Workspace scheduler document

#### What the model sees

The model sees no document stored by `ctx.workSchedulerStore`. The package adds no prompt, tool schema, request field, Session event, or model-visible result.

#### Token effect

The package adds no tokens to model requests.

#### KV Cache effect

The package does not change model requests and therefore does not invalidate an otherwise reusable prefix.

## Known Limitations and Deferred Work

- Documents are keyed only by Workspace: concurrent editors use last-write-wins persistence with no merge or conflict detection.
- Deleting a Workspace registration leaves its scheduler document stored; Workspace lifecycle cleanup does not include this domain.
- The document uses `version: 2` with no migration path; a future format increments the domain version and rejects older media under the pre-release policy.
