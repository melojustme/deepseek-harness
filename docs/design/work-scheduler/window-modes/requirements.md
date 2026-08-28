# Work Scheduler Window Modes Requirements

English | [中文](requirements.zh.md)

## Original Requirement

> 工作调度这个弹窗可以适当的缩放，可以有个放大全屏按钮。

The Work Scheduler dialog should open at an appropriate window size, support resizing, and provide a control that enlarges it to the application viewport.

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

### Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | Header controls, forms, lanes, task cards, the inspector, and visible text must not overlap at supported viewport and window sizes. |
| NFR-02 | The maximize control has an accessible name that changes between `全屏` and `还原`; keyboard focus remains on the toggle while its mode changes. |
| NFR-03 | Resizing and mode changes affect presentation only and must not mutate or save the scheduler document. |
| NFR-04 | The design continues to use existing theme tokens and icon primitives and adds no independent visual language. |

### Constraints

- Fullscreen means filling the dsh application viewport; the feature does not call the browser Fullscreen API or hide browser chrome.
- The change remains inside the existing `shell.overlay` contribution and Client-owned view state; it adds no Host API, storage field, Session event, or model-visible input.
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

## Confirmed Solution Details

The selected design combines free resizing with a two-state windowed/fullscreen control. Window geometry is transient presentation state for one open instance. Desktop windowed mode is the default; responsive small-screen mode is effectively fullscreen. The prototype compares compact, resizable, and maximized presentations, with the resizable presentation as the implementation candidate.
