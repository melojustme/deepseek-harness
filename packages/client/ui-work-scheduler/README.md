# @deepseek-ai/dsh-client-ui-work-scheduler

English | [中文](README.zh.md)

The browser plugin for a thread-oriented personal work scheduler in dsh Web. It registers a footer action in the sidebar and a full-frame overlay through the existing slot system. Each thread advances tasks in order: a synchronous block stops later work in that thread, while an asynchronous block moves the task to a separate waiting list and preserves its return position.

## Persistence and portability

Opening the panel resolves the current Session's Workspace, then the recent or first Workspace, and loads its versioned JSON document through `workScheduler.load`. Document changes are saved to the Host after a 400 ms debounce. Editing remains disabled until the initial load completes, so a stale browser document cannot overwrite the Workspace copy. A load or save failure enters a read-only error state until the panel is reopened and reloads the durable copy. The Web bundle persists documents through [`dsh-work-scheduler-store`](../../work-scheduler/work-scheduler-store/README.md) on SQLite.

When no Workspace exists, the panel starts empty and remains in memory without calling the Host. Scheduler documents are not Session data and never enter model context.

Import normalizes task status, placement, and asynchronous wake origins, removes unknown or duplicate references, and assigns otherwise unplaced tasks to the appropriate backlog, blocked, or archive list. Export downloads the normalized document as JSON.

## Session association and task movement

A new task may store the ID of one Session in its Workspace. The card resolves the current display title from the Session registry and opens that Session through native dsh navigation. The document does not copy the title. If the Session is absent or belongs to another Workspace, the card keeps the association visible as `会话不可用` and performs no navigation.

Editable task cards use native browser dragging. Dropping on a card reorders relative to that card; dropping on a lane appends to that thread. Both same-thread and cross-thread moves use the scheduler's placement transition, so status and durable ordering update together.

## Composition

The sidebar trigger and frame overlay share one plugin-owned store. The panel reads the Session and Workspace registries from the client runtime and calls the connection plugin for durable load and save. Removing the client entry retracts both slot contributions. The installable [`dsh-work-scheduler`](../../bundle/work-scheduler/README.md) bundle mounts this plugin and its Host store after the Web surface owners.

## Model Experience

### Workspace scheduler state

#### What the model sees

The model sees no scheduler document loaded through `workScheduler.load`. The plugin adds no prompt content, tool schema, request field, Session event, or model-visible result.

#### Token effect

The plugin adds no tokens to model requests.

#### KV Cache effect

The plugin does not change model requests and therefore does not invalidate an otherwise reusable prefix.

## Known Limitations and Deferred Work

- Concurrent editors for one Workspace use last-write-wins persistence with no merge or conflict detection.
- A board without a Workspace is in-memory only.
- A task association only navigates to an existing Session; it does not start, stop, or monitor Sessions, workflows, jobs, or subagents.
- Import replaces the current document after normalization; the plugin does not merge two scheduler documents.
