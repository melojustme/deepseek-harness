# `@deepseek-ai/dsh-tool-work-scheduler`

English | [中文](README.zh.md)

Agent-scoped `sync_work_scheduler` tool for projecting a development SOP into the work scheduler. Install it through [`@deepseek-ai/dsh-work-scheduler`](../../bundle/work-scheduler/README.md), or load it after `agents`, `tools`, `workspaceRegistry`, and `workSchedulerStore`. The plugin mounts the tool for every current and future root Agent and removes each registration with its owning Agent scope or plugin fiber.

The caller submits the complete ordered workflow stage list with stable keys, display names, and `pending`, `in_progress`, or `completed` states. The tool derives the current Session from tool execution, finds the unique Workspace whose validated Session account contains it, loads that Workspace's scheduler document, and replaces only task ids under `sop:<sessionId>:`. Manual tasks and other Sessions' SOP projections remain unchanged. Pending stages become ready tasks, the one active stage becomes running, and completed stages enter the archive. Every projected task stores the current Session ID, so the browser can open that Session through native navigation.

Stage keys use lowercase letters, digits, and internal hyphens; names and the workflow name must be non-empty, keys must be unique, and at most one stage may be active. Invalid input, a Session without a Workspace, or an inconsistent multiple-Workspace membership fails without saving. Repeating the same snapshot preserves task timestamps. Reopening a completed stage moves it out of the archive and back into its process.

The store uses whole-document last-write-wins replacement. A browser edit concurrent with a model synchronization can overwrite the other writer; the package does not add compare-and-set or locking.

## Model Experience

### Tool schema

#### What the model sees

Each root Agent receives the generated [`sync_work_scheduler` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-work-scheduler), which requires the workflow name and complete ordered stage snapshot.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin or Agent lifecycle changes may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains the complete submitted stage snapshot in its arguments. Success returns the resolved Workspace ID, Session ID, deterministic process ID, and counts by SOP state; it never returns the scheduler document. Validation, Workspace resolution, and store failures use the ordinary tool-error path.

#### Token effect

Call growth scales with the number and names of workflow stages; the compact result has fixed fields and remains small.

#### KV Cache effect

Append-only; tool arguments and results follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Concurrent whole-document writes are last-write-wins** — a browser edit and a model synchronization that overlap can overwrite each other because the store provides neither compare-and-set nor locking.
