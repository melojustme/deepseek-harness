# Work Scheduler Window Modes Design

English | [中文](design.zh.md)

- Module: `work-scheduler/window-modes`
- Requirements: [requirements.md](requirements.md)
- Created: 2026-08-28
- Status: confirmed

## 1. Design Overview

### 1.1 Background and Objective

The Work Scheduler uses a `shell.overlay` contribution for its application-covering modal backdrop and scheduler content. The selected design keeps the backdrop over the viewport while placing the scheduler content in a window whose size can change. Desktop users gain surrounding application context, pointer resizing, and an explicit application-fullscreen toggle. Creation uses one header menu, and a task can create and open a new Session with its description preserved as an unsent conversation draft. A running task can also summarize the linked Session's Todo projection without adding progress fields to the scheduler document.

### 1.2 Scope

| Scope | Included | Excluded |
|---|---|---|
| Presentation | Desktop window geometry, resize affordance, fullscreen/restore control, responsive override, contained help surface, and linked Todo progress on running task cards | Moving the window, browser fullscreen, alternate scheduler layouts |
| State | Transient geometry and requested display mode for one open instance | Persistence in the scheduler document, browser storage, or Host storage |
| Interactions | Close, layered `Escape`, mutually exclusive task and thread editors, existing-Session navigation, and new-Session creation followed by dialog close | Changes to task transitions, drag placement, import/export, or scheduler persistence |

### 1.3 Option Selection

| Option | Description | Trade-off | Decision |
|---|---|---|---|
| Compact fixed window | Uses a smaller fixed dialog and no free resize | Simple, but cannot adapt to different task densities | Prototype comparison only |
| Resizable window with fullscreen toggle | Opens windowed, supports bounded pointer resizing, and toggles to the application viewport | Adds transient geometry state and responsive rules | Selected |
| Always maximized | Retains the current viewport-filling presentation and adds only a restore affordance | Preserves density but does not address the requested default scale | Prototype comparison only |

The selected option makes the smallest behavioral change that satisfies both free resizing and one-action enlargement. It keeps the [browser plugin](../../../../packages/client/ui-work-scheduler/README.md) and the owning [work-scheduler decision](../../../../.agents/notes/implemented/feature/2026-08-18-web-work-scheduler.md) as the existing architecture owners. The [throwaway prototype](../../../../packages/client/ui-work-scheduler/prototype/window-modes.html?variant=resizable) exposes all three options through the `variant` query parameter and opens on the selected resizable option by default.

The creation design keeps task and thread actions under one header menu because neither action needs permanent horizontal space. The task Session picker retains existing association and no-association paths, then adds a fixed `新建并打开对话` action. Reusing the Client Session runtime and conversation composer avoids a scheduler-specific Session API or duplicate draft state.

## 2. Overall Architecture

### 2.1 Ownership

The feature remains within the browser plugin. The `shell.overlay` slot still owns mounting and disposal; the plugin-owned store continues to own durable-document loading state; the dialog component owns display mode and geometry because those values have no meaning outside one mounted view.

| Part | Responsibility | Dependency |
|---|---|---|
| Shell overlay contribution | Mount and remove the Work Scheduler modal layer with the plugin lifecycle | Existing slot registry |
| Modal backdrop | Cover the application, establish modal stacking, and center the default window without closing on backdrop clicks | Existing theme tokens |
| Scheduler window controller | Resolve effective mode, bound geometry, toggle fullscreen/restore, and reset presentation on close | Component-local state and viewport size |
| Scheduler content | Render the header, active creation editor, board, inspector, cards, linked Session Todo progress, and help surface | Existing scheduler store and Client registries |
| Session lifecycle callbacks | Create a Session in the active Workspace, seed its conversation draft, or select an associated Session before closing the complete dialog | Existing Client Session runtime and conversation service |

### 2.2 Layering

- The modal backdrop always fills the application viewport and owns the modal `dialog` semantics.
- The scheduler window is the bounded visual container inside that backdrop.
- Header presentation controls change window mode or close the modal; the separate creation menu opens one editor and mutates scheduler data only on a successful submit.
- The board and inspector keep their current scroll ownership so a smaller window changes available space rather than document structure.

No architecture diagram is required: the ownership table and four-layer list contain the complete relationship without introducing a separate visual artifact.

## 3. Core Interaction Design

### 3.1 Display Modes

| Requested mode | Effective desktop mode | Effective small-screen mode | Header control |
|---|---|---|---|
| Windowed | Bounded resizable window | Application fullscreen | `全屏` on desktop; hidden on small screens |
| Fullscreen | Application fullscreen | Application fullscreen | `还原` on desktop; hidden on small screens |

Small-screen behavior takes precedence over requested mode. When a viewport crosses back into the desktop range during the same open instance, the previously requested desktop mode becomes effective again.

### 3.2 Geometry

| Context | Initial size | Bounds | Resize behavior |
|---|---|---|---|
| Desktop windowed | Approximately `92vw` by `86vh`, centered with visible backdrop on every side | Never exceeds the application viewport; minimum size preserves a usable command bar, board, and inspector | Bottom-right pointer resize; the top-left corner remains fixed during the gesture |
| Desktop fullscreen | Fills the application viewport | Exact viewport bounds | Disabled |
| Small screen | Fills the application viewport | Exact viewport bounds | Disabled |

Before entering fullscreen, the controller records the current windowed geometry. Restoring uses that geometry. Closing clears it, so the next open uses the default centered dimensions.

### 3.3 State Transitions

| Event | Precondition | Presentation result | Scheduler-document effect |
|---|---|---|---|
| Open scheduler | Dialog is closed | Open in default windowed geometry on desktop or effective fullscreen on a small screen | Existing load behavior only |
| Resize | Effective mode is desktop windowed | Clamp width and height to the supported range | None |
| Activate `全屏` | Effective mode is desktop windowed | Record window geometry and fill the application viewport | None |
| Activate `还原` | Requested mode is fullscreen on desktop | Restore recorded window geometry | None |
| Open a creation editor | Editing is enabled | Close the creation menu, show only the selected editor, reset its fields, and focus its first input | None |
| Submit a task without a new Session | Task description is non-empty | Close the active editor | Add the task with no Session or the selected existing Session ID |
| Submit a task with `新建并打开对话` | An active Workspace exists | After Session creation and draft seeding, remove the complete modal and open the new Session | Add the task with the new Session ID |
| Activate close | Dialog is open | Remove the complete modal and clear presentation and editor state | Existing save behavior remains unchanged |
| Press `Escape` | Dialog is open | Close the Session picker, creation menu, active editor, or complete modal, choosing the first open layer in that order | None |
| Open an associated Session | Association resolves in the current Workspace | Select the Session, then remove the complete modal | None |
| Enter a small viewport | Dialog is open | Apply effective fullscreen and hide inapplicable window controls | None |

### 3.4 Header Controls

The header action order is create, help, export, import, fullscreen/restore, and close. The create action is a text-and-icon menu trigger because it contains two named commands; selecting a command closes the menu and opens the matching editor below the header. The mode toggle uses the existing fullscreen icon, stays mounted while its label and pressed state change, and retains keyboard focus across the transition. The close control remains the final header action and continues to close the complete dialog.

The toggle exposes `aria-label` and `title` as `全屏` in windowed mode and `还原` in fullscreen mode. The dialog retains its `工作调度` accessible name. A small viewport omits the toggle rather than presenting an action with no visible result.

### 3.5 Resize Behavior

Pointer resizing begins only from the dedicated bottom-right affordance. The controller captures the starting pointer and window dimensions, applies bounded dimensions during movement, and releases document-level listeners at gesture completion or component disposal. The gesture does not move the window, alter board data, or trigger persistence.

Fullscreen is the non-drag alternative for users who need the maximum workspace. The selected scope does not add keyboard increments for arbitrary window sizes.

### 3.6 Backdrop and Help Surface

The backdrop visually separates the modal from the underlying conversation while keeping that context recognizable. It does not close the dialog when clicked. The help surface changes from viewport-fixed positioning to positioning relative to the scheduler window, preventing it from escaping windowed geometry.

### 3.7 Creation Editors

The scheduler has no permanent command row. The `新建` menu opens either a compact thread editor or the task editor, and selecting the other action replaces the current editor after clearing its draft. The thread editor contains its name input and submit action on one row. The task editor retains multiline task text, a horizontally scrollable placement control, and the Session picker. Submit and cancel clear the active editor; a rejected new-Session request is the exception and keeps the task draft for retry.

### 3.8 New Session Association

The Session picker groups fixed actions before an `已有对话` divider. `新建并打开对话` remains visible whenever the picker is open and is disabled without an active Workspace; `不关联对话` remains available; search applies only to existing Sessions in the active Workspace. Existing Session selection stays optional and defaults to no association.

For the new-Session path, submit first asks the Session runtime to create a Session in the active Workspace, resolves that Session's Client scope, and writes the task description to its conversation composer draft. Only after those operations succeed does the scheduler add the task with the new Session ID, close the scheduler, and open the Session. The draft is not sent, so the user can revise it in the conversation before submission.

### 3.9 Linked Todo Progress

For each running task with a resolvable associated Session, the card reads `SessionSummary.projectionValues.todos`. A non-empty list produces one equal-width segment per Todo, completed and total counts, and the first `in_progress` item's content. Completed segments use the success color, the active segment uses the existing business accent, and pending segments retain the subdued success track. The segment group exposes `progressbar` semantics with the completed count as its current value.

The progress block is absent when the task is not running or the projection is missing, null, or empty. This task-state condition prevents a ready or blocked task that shares the Session from repeating the active work display. Todo updates replace the rendered projection in place and do not mutate the scheduler task or its placement.

## 4. Data Model

### 4.1 Transient View State

| Value | Meaning | Lifetime |
|---|---|---|
| Requested display mode | The user's desktop choice between windowed and fullscreen | One open dialog instance |
| Window geometry | Current bounded width and height plus the anchored top-left position used for restore | One open dialog instance |
| Small-screen match | Whether responsive fullscreen overrides the requested mode | Derived from the current viewport |
| Active creation editor | Whether the thread editor, task editor, or neither is visible | One open dialog instance |
| Task Session choice and submit state | New Session, no association, or an existing Session plus the pending error state | One task-editor instance |

### 4.2 Durable Data

The version 2 scheduler document does not change. An added task uses the existing optional Session ID field whether the Session already existed or was created by this flow. Window size, display mode, editor drafts, submit errors, and projected Todo data do not enter the Workspace document, Host storage, import/export JSON, model context, or localization resources. Todo data remains owned by the associated Session log, while a new Session and its unsent composer draft remain owned by the existing Client Session and conversation services.

## 5. Interfaces

### 5.1 Existing Interfaces

| Interface | Treatment |
|---|---|
| `shell.overlay` contribution | Retained as the mount point for the modal backdrop and scheduler window |
| Work Scheduler store actions | Existing open, close, help, document, and persistence actions remain unchanged |
| Client `SessionRuntime` | Existing `create`, `scope`, and `open` operations create or navigate to the selected Session |
| `SessionSummary.projectionValues.todos` | Existing Session projection supplies read-only Todo items for a running associated task card |
| Conversation input service | Existing scoped `setDraft` operation seeds the new Session without sending a message |
| Host `workScheduler.load` and `workScheduler.save` | Unchanged |

### 5.2 New Public Interfaces

None. Display mode, geometry, resize handling, responsive matching, and the injected Session-creation callback remain private Client behavior. No configuration key, RPC method, event, or exported service is introduced.

## 6. Failure Behavior

| Condition | Required behavior |
|---|---|
| Viewport becomes smaller than the current geometry | Effective geometry is clamped within the viewport; small-screen rules take precedence where applicable |
| Pointer resize ends outside the browser window | Listener cleanup ends the gesture without leaving a global pointer handler installed |
| Component disposes during resize | Cleanup releases gesture listeners; no geometry is persisted |
| Associated Session is unavailable | Existing `会话不可用` behavior remains; the dialog does not navigate or close |
| Associated Session has no non-empty Todo projection | Omit the progress block without showing placeholder content |
| No active Workspace exists | The new-Session option is disabled; ordinary unassociated task creation remains available |
| Session creation or draft seeding fails | Keep the task editor, description, placement, and Session choice; add no task, perform no navigation, and show `无法新建对话，请重试。` |
| User cancels, switches editor or Workspace, or closes while Session creation is pending | Invalidate the submission; ignore its late completion without adding a task or opening a Session |
| Scheduler load or save fails | Existing read-only error behavior remains independent of display mode |

Unsupported geometry is prevented by bounds instead of reported after the fact. New-Session failure uses one local, retryable message because no stable protocol error is introduced or exposed by the scheduler.

## 7. Operation Logging

Fullscreen and resize gestures are local presentation actions and do not receive Host operation logs. Session creation uses the existing Client runtime path and its diagnostics; the scheduler adds no parallel operation log. Existing load and save diagnostics remain unchanged. The implementation must not add console output for normal resizing or mode changes.

## 8. Audit Logging

No audit event is added. Display geometry does not change scheduler data, authority, configuration, or another user's state. New-Session creation uses the same audit treatment as creating a Session from the conversation surface.

## 9. User Permissions

The feature introduces no permission distinction. Anyone who can open Work Scheduler can resize, maximize, restore, close their local dialog, and use the existing Client Session creation path. Existing Workspace membership and Session association rules remain authoritative for creation and navigation availability.

## 10. Internationalization

The control labels follow the existing Chinese Work Scheduler presentation, including `新建`, `新建任务`, `新建线程`, `新建并打开对话`, `不关联对话`, `已有对话`, `工作进度`, `全屏`, and `还原`. Accessible names, tooltips, errors, tests, and documentation use the same terms. The package does not use the Client locale service, and this change does not create a separate localization mechanism.

## 11. Test Strategy

| Tier | Evidence |
|---|---|
| Component behavior | Default windowed mode, fullscreen/restore labels and state, geometry reset after close, creation-menu and editor focus/reset behavior, fixed Session choices, new-Session success and failure, existing Session navigation, and running-only Todo progress |
| Responsive behavior | Small-screen fullscreen override, hidden resize/maximize affordances, and restoration of the requested desktop mode after widening |
| Real Web composition | Opening from the sidebar, visible desktop backdrop, a real `todo/write` projection on the running task, new Session creation with a seeded unsent draft, associated-Session navigation, and automatic removal of the complete dialog |
| Visual inspection | Default desktop with segmented task progress, creation menu, task and thread editors, Session picker, manually resized desktop, fullscreen desktop, and narrow mobile screenshots with overlap and clipping checks |

The focused component suite remains the fastest behavior signal. The real Web scenario proves that the shipped composition projects Session Todo state, can create a Session, seeds its visible unsent composer, and reveals that conversation after the dialog closes.

## 12. Delivery and Rollback

The change ships in the Client package, its declared conversation UI dependency, and regenerated Web assets. It requires no data migration, Host restart requirement, or compatibility handling. Deployment uses the ordinary Web build. Rolling back the Client bundle restores the former creation and viewport-filling presentation without transforming scheduler documents; Sessions already created by the newer UI remain ordinary Sessions.

## 13. Security and Accessibility Review

| Concern | Decision |
|---|---|
| Untrusted geometry | Pointer-derived dimensions are clamped to viewport and minimum-layout bounds and are never parsed from durable input |
| Global gesture listeners | Installed only for an active resize and removed on completion and disposal |
| Task text handling | The typed conversation draft setter receives plain task text; the scheduler does not interpret it as markup or send it to a model |
| Asynchronous creation | Submit fields are disabled while creation is pending; cancellation invalidates the callback, and the task is added only after Session creation and draft seeding succeed |
| Accidental close | Backdrop clicks do not close; explicit close, layered `Escape`, and successful existing- or new-Session navigation retain their defined behavior |
| Keyboard access | Create, fullscreen/restore, and close are ordinary focusable buttons; editor focus and layered `Escape` follow the documented order |
| Text and control overlap | Stable header controls, bounded window dimensions, existing scroll owners, and responsive layout preserve separation |

No new filesystem, process, credential, wire, or authorization mechanism is introduced.

## Confirmation Record

| Section | Confirmed by | Date | Status |
|---|---|---|---|
| Requirements and scope | User | 2026-08-28 | Confirmed |
| Window modes and geometry | User | 2026-08-28 | Confirmed |
| Creation menu and new-Session association | User | 2026-08-28 | Confirmed |
| Linked Session Todo progress | User | 2026-08-28 | Confirmed |
| Transient state and interface boundaries | User | 2026-08-28 | Confirmed |
| Compliance, testing, delivery, and security treatment | User | 2026-08-28 | Confirmed |

## Change Record

| Date | Version | Change |
|---|---|---|
| 2026-08-28 | 1.0 | Initial confirmed design for resizable and application-fullscreen Work Scheduler presentation |
| 2026-08-28 | 1.1 | Consolidated creation actions and added task creation with a new Session and unsent conversation draft |
| 2026-08-28 | 1.2 | Added running-task progress from the linked Session's Todo projection |
