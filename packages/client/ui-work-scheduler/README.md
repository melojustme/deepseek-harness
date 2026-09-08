# @deepseek-ai/dsh-client-ui-work-scheduler

English | [中文](README.zh.md)

The native Work Scheduler panel contributes a sidebar action and modal overlay through the Client slot system. It offers a status board, ordered thread view, task details, execution history, and human review. [The local execution provider](../../work-scheduler/work-scheduler-execution-local/README.md) owns execution independently of panel visibility.

## Planning and execution

Select a Workspace, create a thread or task, and supply a description plus one acceptance condition per line. Unattempted tasks can be edited, associated with an existing Session, moved using thread dragging or up/down controls, and synchronously or asynchronously blocked. Creating a draft Session seeds unsent text; executing a task creates a separate native execution Session. The board distinguishes manual planning completion from human approval.

Execution uses the selected Git revision, defaulting to HEAD, and excludes uncommitted original-workspace changes. Cancel waits for native release. Todo progress and pending user interactions come from Session projections; native Session navigation exposes complete logs and approval/question controls. The selected board remains available after opening an isolated execution Session.

Review displays the fixed log digest, file diff, summary, tool results, and retained artifact directory. Changed files require refreshed evidence. Failed tools require an acceptance reason; rework requires feedback and creates another isolated attempt from the previous snapshot. Approval records a human decision without merging or pushing. Review retains its thread position until approval or explicit asynchronous yielding; restoring the position preserves the waiting task's return location.

Status-board cards support drag/drop and Alt plus arrow keys. Unattempted tasks reorder within their owning queue without crossing attempted tasks; cross-thread placement uses the thread view. Moving into execution asks for confirmation, moving an active task back asks to stop, and moving review work opens approval or rework details. The Host alone creates review evidence and approves it through explicit commands. A revision change during dragging or before confirmation rejects the gesture; disconnected boards reject edits.

## Data and connection state

`WorkSchedulerRuntime` in the React-free object layer owns the selected document, revision, conditional writes, and periodic refresh. The validated `refreshIntervalMs` configuration controls refresh cadence. Slot stores hold only presentation state. Closing the panel does not stop Host execution or refresh ownership; unloading the plugin disposes the runtime and both slot contributions.

Edits remain disabled while loading, saving, or disconnected. Failed saves retain editor fields, and uncertain execution submissions retain their command identity for retry. Workspace generation fences reject late responses. Import validates version 3 and rejects malformed references, duplicate placement, older formats, or attempts that differ from the Host's records; it does not repair or discard execution evidence. Export downloads the complete versioned document.

The board, task editor, and task details occupy separate views of the same window. Returning from details preserves filters and focuses the selected card. Board import/export, Git revisions, thread management, and task arrangement are expandable secondary controls. See the [interaction design](../../../docs/design/work-scheduler/agent-delivery/interaction.md) for the staged workflow and drag semantics.

## Window and accessibility

The centered desktop window supports resizing and application fullscreen. Small viewports use the full viewport and replace the board with selected-task details. Escape closes the innermost editor or details before closing the window. Details return focus to their task card, Tab remains within the dialog, and execution state has textual labels alongside progress semantics.

## Model Experience

### Logged task input

#### What the model sees

The panel itself adds no model input. Explicit execution delegates the task description, acceptance conditions, and rework feedback to the provider's logged native Session input. See [the provider's Model Experience](../../work-scheduler/work-scheduler-execution-local/README.md#model-experience).

#### Token effect

No direct input; the execution provider owns task input and the selected preset owns the request.

#### KV Cache effect

No direct effect; the execution provider and selected preset own model requests.

## Known Limitations and Deferred Work

- Native execution requires a registered Git repository with a commit. Artifacts remain local until the user performs separate integration or cleanup.
- A Workspace is required for planning and execution. Import replaces planning data conditionally and cannot transplant another Workspace's execution history.
- Full logs and pending interactions open in the native Session view; the panel projects summaries and bounded evidence.
