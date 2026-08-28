# Work Scheduler Window Modes Requirements

English | [中文](requirements.zh.md)

## Original Requirement

> 工作调度这个弹窗可以适当的缩放，可以有个放大全屏按钮。

The Work Scheduler dialog should open at an appropriate window size, support resizing, and provide a control that enlarges it to the application viewport.

> 新增任务，会话有可能是新增。

Task creation must also allow the association to be a newly created conversation, not only an existing Session.

> 部分工作进度我希望你参考 dashi-taskboard 这个项目实现。

Running task cards should project useful work progress from their associated Session, following the segmented Todo presentation established by dashi-taskboard.

## Requirements Breakdown

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | On desktop viewports, opening Work Scheduler presents a centered window rather than immediately covering the complete application viewport. |
| FR-02 | The window opens at approximately `92vw` by `86vh`, is bounded by the viewport, and supports pointer resizing down to a layout-safe minimum size. |
| FR-03 | A header control toggles between windowed and application-fullscreen modes. Restoring from fullscreen returns to the geometry held before maximization. |
| FR-04 | The existing close button and `Escape` close the complete Work Scheduler dialog. Opening an associated Session also closes the complete dialog after selecting that Session. |
| FR-05 | Closing and reopening Work Scheduler resets it to the default windowed geometry; neither size nor fullscreen state is persisted. |
| FR-06 | Small viewports use the existing responsive content layout in an application-fullscreen dialog and do not expose an inapplicable resize or maximize affordance. |
| FR-07 | The help surface remains contained by the Work Scheduler window in both windowed and fullscreen modes. |
| FR-08 | One `新建` menu in the header exposes `新建任务` and `新建线程`; their editors are mutually exclusive and no creation form remains permanently visible. |
| FR-09 | The task Session picker keeps `新建并打开对话` and `不关联对话` visible before existing Sessions from the active Workspace, while search filters only those existing Sessions. |
| FR-10 | Submitting with `新建并打开对话` creates a Session in the active Workspace, seeds its unsent composer with the task description, adds the associated task, closes Work Scheduler, and opens the new Session. |
| FR-11 | If new-Session creation fails, no task is added; the task draft, selected placement, and editor remain available with a retryable error. |
| FR-12 | A running task associated with an available Session and a non-empty Todo projection shows segmented Todo progress, the completed and total counts, and the current `in_progress` item. Other task states and missing or empty projections show no progress block. |

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | Header controls, forms, lanes, task cards, the inspector, and visible text must not overlap at supported viewport and window sizes. |
| NFR-02 | The maximize control has an accessible name that changes between `全屏` and `还原`; keyboard focus remains on the toggle while its mode changes. |
| NFR-03 | Resizing and mode changes affect presentation only and must not mutate or save the scheduler document. |
| NFR-04 | The design continues to use existing theme tokens and icon primitives and adds no independent visual language. |
| NFR-05 | Opening either creation editor focuses its first input; `Escape` dismisses the Session picker, creation menu, active editor, and complete dialog in that order. |
| NFR-06 | Cancelling, switching editors, changing Workspace, or closing the dialog while Session creation is pending invalidates that submission; a late result must not add a task or reopen a conversation. |
| NFR-07 | Todo progress exposes progressbar semantics and stable completed and total values; each projection renders one equal-width segment per Todo without changing scheduler state. |

### Constraints

- Fullscreen means filling the dsh application viewport; the feature does not call the browser Fullscreen API or hide browser chrome.
- The change remains inside the existing `shell.overlay` contribution and Client Session and conversation services; it adds no Host API, scheduler storage field, Session event, or model-visible input.
- The new-Session action requires an active Workspace. The task is not added until Session creation and draft seeding have succeeded, and the seeded draft is not sent automatically.
- Progress is a read-only projection of `SessionSummary.projectionValues.todos`; the scheduler does not append `todo/write` events or persist Todo data in its document.
- Clicking the backdrop does not close the dialog, preventing accidental loss of the user's current visual context.
- Moving the window by dragging its header and persisting geometry across opens or browser reloads are outside this scope.

### Acceptance Criteria

| ID | Acceptance criterion |
|---|---|
| AC-01 | At a `1564x996` viewport, Work Scheduler opens with visible space around the window and retains a usable four-lane board with horizontal board scrolling where necessary. |
| AC-02 | Dragging the resize affordance changes the window dimensions without allowing the controls or inspector to collapse below their supported minimum layout. |
| AC-03 | Activating `全屏` fills the application viewport; activating `还原` restores the prior window geometry. |
| AC-04 | Closing after a resize or fullscreen transition and reopening returns to the default windowed geometry. |
| AC-05 | Clicking an available Session association selects that Session and removes the Work Scheduler dialog without requiring a separate close action. |
| AC-06 | On a narrow viewport, Work Scheduler fills the application viewport and the maximize control and resize affordance are absent. |
| AC-07 | Component tests cover mode transitions and close behavior; a real Web test covers the user-visible navigation and dialog result. |
| AC-08 | The header creation menu opens the requested task or thread editor, switching editors discards the previous editor draft, and closing an editor restores the compact scheduler layout. |
| AC-09 | Selecting `新建并打开对话` and submitting a task reveals a new conversation with the task description in its unsent composer, while the scheduler task stores that Session's ID. |
| AC-10 | A Session-creation rejection leaves the task editor visible with its draft intact, displays `无法新建对话，请重试。`, and adds no task. |
| AC-11 | Cancelling a pending new-Session submit closes the editor immediately; resolving the original request afterward neither adds a task nor changes the visible Session. |
| AC-12 | A running task linked to a Session with one completed, one active, and one pending Todo shows `1/3` and the active Todo text; a ready task linked to the same Session has no progressbar. |

## Confirmed Solution Details

The selected design combines free resizing with a two-state windowed/fullscreen control. Window geometry is transient presentation state for one open instance. Desktop windowed mode is the default; responsive small-screen mode is effectively fullscreen. The prototype compares compact, resizable, and maximized presentations, with the resizable presentation as the implementation candidate.

Creation is consolidated into a header menu with one active editor. New-task association offers an explicit new-conversation action alongside no association and existing Sessions. The new-conversation path reuses the active Workspace's Session runtime and conversation composer, preserving the task text as an unsent draft before navigation.

Task progress reuses the linked Session's existing Todo projection. It appears only on running tasks with non-empty Todo data, so one Session shared by several scheduler tasks does not duplicate active progress across inactive cards.
