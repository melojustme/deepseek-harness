# @deepseek-ai/dsh-client-ui-work-scheduler

English | [中文](README.zh.md)

The browser plugin for a thread-oriented personal work scheduler in dsh Web. It registers a footer action in the sidebar and a modal window through the existing slot system. Each thread advances tasks in order: a synchronous block stops later work in that thread, while an asynchronous block moves the task to a separate waiting list and preserves its return position.

## Window presentation

On desktop, the scheduler opens centered at `92vw` by `86vh`. Its bottom-right affordance resizes the window down to `760 x 560` when the viewport permits, and the header toggle switches between windowed and application-fullscreen modes. Restoring returns to the geometry captured before fullscreen; closing discards the geometry and the next open uses the default size. Viewports at or below 760 px fill the application viewport and hide the fullscreen and resize controls. The help panel remains inside the scheduler window. These modes do not use the browser Fullscreen API or persist presentation state.

## Persistence and portability

Opening the panel resolves the current Session's Workspace, then the recent or first Workspace, and loads its versioned JSON document through `workScheduler.load`. Document changes are saved to the Host after a 400 ms debounce. Editing remains disabled until the initial load completes, so a stale browser document cannot overwrite the Workspace copy. A load or save failure enters a read-only error state until the panel is reopened and reloads the durable copy. The Web bundle persists documents through [`dsh-work-scheduler-store`](../../work-scheduler/work-scheduler-store/README.md) on SQLite.

When no Workspace exists, the panel starts empty and remains in memory without calling the Host. Scheduler documents are not Session data and never enter model context.

Import normalizes task status, placement, and asynchronous wake origins, removes unknown or duplicate references, and assigns otherwise unplaced tasks to the appropriate backlog, blocked, or archive list. Export downloads the normalized document as JSON.

## Session association and task movement

A single `新建` menu in the header opens either the task editor or the compact thread editor, so creation controls do not occupy a permanent command row and only one editor is visible at a time. Opening an editor focuses its first input. The task editor presents the backlog and current threads as a horizontally scrollable radio group. `Escape` closes the Session picker, creation menu, active editor, and scheduler window in that order. On small viewports, the board retains its own scrolling area while the task editor is open.

The Session picker always exposes `新建并打开对话` and `不关联对话` before the searchable Sessions from the active Workspace; search filters only the existing Sessions. Choosing the new-Session action creates a Session in the active Workspace, copies the task description into its unsent conversation draft, stores the new Session ID on the task, closes Work Scheduler, and opens that Session. It does not send the draft. If Session creation fails, the task editor and draft remain, no task is added, and the editor reports a retryable error.

A new task may otherwise store the ID of one existing Session in its Workspace. The card resolves the current display title from the Session registry and opens that Session through native dsh navigation, closing the scheduler overlay so the conversation is visible. The document does not copy the title. If the Session is absent or belongs to another Workspace, the card keeps the association visible as `会话不可用` and performs no navigation.

A running task with an available associated Session also projects that Session's non-empty Todo list as segmented progress. The card shows completed items over the total and the current `in_progress` item. Ready, blocked, and completed tasks do not show this progress even when they share the same Session, and an absent or empty Todo projection leaves no placeholder. The scheduler only reads `SessionSummary.projectionValues.todos`; it does not write Todo events or copy Todo data into its document.

Editable task cards use native browser dragging. Dropping on a card reorders relative to that card; dropping on a lane appends to that thread. Both same-thread and cross-thread moves use the scheduler's placement transition, so status and durable ordering update together.

## Composition

The sidebar trigger and modal contribution share one plugin-owned store. The panel reads the Session and Workspace registries from the client runtime, uses the conversation service only to seed a newly created Session's local draft, and calls the connection plugin for durable scheduler load and save. Removing the client entry retracts both slot contributions. The installable [`dsh-work-scheduler`](../../bundle/work-scheduler/README.md) bundle mounts this plugin and its Host store after the Web surface owners.

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
- A task association can create and open a Session or navigate to an existing one; it does not send the seeded draft or start, stop, or monitor Sessions, workflows, jobs, or subagents.
- Import replaces the current document after normalization; the plugin does not merge two scheduler documents.
