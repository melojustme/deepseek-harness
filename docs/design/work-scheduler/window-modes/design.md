# Work Scheduler Window Modes Design

English | [中文](design.zh.md)

- Module: `work-scheduler/window-modes`
- Requirements: [requirements.md](requirements.md)
- Created: 2026-08-28
- Status: confirmed

## 1. Design Overview

### 1.1 Background and Objective

The Work Scheduler currently uses a `shell.overlay` contribution that fills the application viewport. The selected design retains that extension point and scheduler content while separating the viewport-covering modal backdrop from a window whose size can change. Desktop users gain surrounding application context, pointer resizing, and an explicit application-fullscreen toggle without changing scheduler data or Session selection.

### 1.2 Scope

| Scope | Included | Excluded |
|---|---|---|
| Presentation | Desktop window geometry, resize affordance, fullscreen/restore control, responsive override, contained help surface | Moving the window, browser fullscreen, alternate scheduler layouts |
| State | Transient geometry and requested display mode for one open instance | Persistence in the scheduler document, browser storage, or Host storage |
| Existing interactions | Close, `Escape`, Session navigation followed by dialog close | Changes to task transitions, drag placement, import/export, or persistence |

### 1.3 Option Selection

| Option | Description | Trade-off | Decision |
|---|---|---|---|
| Compact fixed window | Uses a smaller fixed dialog and no free resize | Simple, but cannot adapt to different task densities | Prototype comparison only |
| Resizable window with fullscreen toggle | Opens windowed, supports bounded pointer resizing, and toggles to the application viewport | Adds transient geometry state and responsive rules | Selected |
| Always maximized | Retains the current viewport-filling presentation and adds only a restore affordance | Preserves density but does not address the requested default scale | Prototype comparison only |

The selected option makes the smallest behavioral change that satisfies both free resizing and one-action enlargement. It keeps the [browser plugin](../../../../packages/client/ui-work-scheduler/README.md) and the owning [work-scheduler decision](../../../../.agents/notes/implemented/feature/2026-08-18-web-work-scheduler.md) as the existing architecture owners. The [throwaway prototype](../../../../packages/client/ui-work-scheduler/prototype/window-modes.html?variant=resizable) exposes all three options through the `variant` query parameter and opens on the selected resizable option by default.

## 2. Overall Architecture

### 2.1 Ownership

The feature remains within the browser plugin. The `shell.overlay` slot still owns mounting and disposal; the plugin-owned store continues to own durable-document loading state; the dialog component owns display mode and geometry because those values have no meaning outside one mounted view.

| Part | Responsibility | Dependency |
|---|---|---|
| Shell overlay contribution | Mount and remove the Work Scheduler modal layer with the plugin lifecycle | Existing slot registry |
| Modal backdrop | Cover the application, establish modal stacking, and center the default window without closing on backdrop clicks | Existing theme tokens |
| Scheduler window controller | Resolve effective mode, bound geometry, toggle fullscreen/restore, and reset presentation on close | Component-local state and viewport size |
| Scheduler content | Render the existing header, command bar, board, inspector, cards, and help surface | Existing scheduler store and Client registries |
| Session navigation callback | Select the associated Session before closing the complete dialog | Existing Client Session registry |

### 2.2 Layering

- The modal backdrop always fills the application viewport and owns the modal `dialog` semantics.
- The scheduler window is the bounded visual container inside that backdrop.
- Header controls change window presentation or close the modal; they do not mutate scheduler data.
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
| Activate close or press `Escape` | Dialog is open | Remove the complete modal and clear presentation state | Existing save behavior remains unchanged |
| Open an associated Session | Association resolves in the current Workspace | Select the Session, then remove the complete modal | None |
| Enter a small viewport | Dialog is open | Apply effective fullscreen and hide inapplicable window controls | None |

### 3.4 Header Controls

The header action order is help, export, import, fullscreen/restore, and close. The mode toggle uses the existing fullscreen icon, stays mounted while its label and pressed state change, and retains keyboard focus across the transition. The close control remains the final header action and continues to close the complete dialog.

The toggle exposes `aria-label` and `title` as `全屏` in windowed mode and `还原` in fullscreen mode. The dialog retains its `工作调度` accessible name. A small viewport omits the toggle rather than presenting an action with no visible result.

### 3.5 Resize Behavior

Pointer resizing begins only from the dedicated bottom-right affordance. The controller captures the starting pointer and window dimensions, applies bounded dimensions during movement, and releases document-level listeners at gesture completion or component disposal. The gesture does not move the window, alter board data, or trigger persistence.

Fullscreen is the non-drag alternative for users who need the maximum workspace. The selected scope does not add keyboard increments for arbitrary window sizes.

### 3.6 Backdrop and Help Surface

The backdrop visually separates the modal from the underlying conversation while keeping that context recognizable. It does not close the dialog when clicked. The help surface changes from viewport-fixed positioning to positioning relative to the scheduler window, preventing it from escaping windowed geometry.

## 4. Data Model

### 4.1 Transient View State

| Value | Meaning | Lifetime |
|---|---|---|
| Requested display mode | The user's desktop choice between windowed and fullscreen | One open dialog instance |
| Window geometry | Current bounded width and height plus the anchored top-left position used for restore | One open dialog instance |
| Small-screen match | Whether responsive fullscreen overrides the requested mode | Derived from the current viewport |

### 4.2 Durable Data

The version 2 scheduler document does not change. Window size and display mode are presentation preferences, so they do not enter the Workspace document, Host storage, Session log, import/export JSON, model context, or localization resources.

## 5. Interfaces

### 5.1 Existing Interfaces

| Interface | Treatment |
|---|---|
| `shell.overlay` contribution | Retained as the mount point for the modal backdrop and scheduler window |
| Work Scheduler store actions | Existing open, close, help, document, and persistence actions remain unchanged |
| Session navigation callback | Retained; successful invocation is followed by closing the complete dialog |
| Host `workScheduler.load` and `workScheduler.save` | Unchanged |

### 5.2 New Public Interfaces

None. Display mode, geometry, resize handling, and responsive matching remain private presentation behavior. No configuration key, RPC method, event, or exported service is introduced.

## 6. Failure Behavior

| Condition | Required behavior |
|---|---|
| Viewport becomes smaller than the current geometry | Effective geometry is clamped within the viewport; small-screen rules take precedence where applicable |
| Pointer resize ends outside the browser window | Listener cleanup ends the gesture without leaving a global pointer handler installed |
| Component disposes during resize | Cleanup releases gesture listeners; no geometry is persisted |
| Associated Session is unavailable | Existing `会话不可用` behavior remains; the dialog does not navigate or close |
| Scheduler load or save fails | Existing read-only error behavior remains independent of display mode |

The presentation changes add no user-facing error code. Unsupported geometry is prevented by bounds instead of reported after the fact.

## 7. Operation Logging

Fullscreen and resize gestures are local presentation actions and do not receive Host operation logs. Existing load and save diagnostics remain unchanged. The implementation must not add console output for normal resizing or mode changes.

## 8. Audit Logging

No audit event is added. Display geometry does not change scheduler data, authority, configuration, or another user's state.

## 9. User Permissions

The feature introduces no permission distinction. Anyone who can open Work Scheduler can resize, maximize, restore, or close their local dialog. Existing Session association rules remain authoritative for navigation availability.

## 10. Internationalization

The control labels follow the existing Chinese Work Scheduler presentation: `全屏` and `还原`. Accessible names, tooltips, tests, and documentation use the same terms. The package does not use the Client locale service, and this change does not create a separate localization mechanism.

## 11. Test Strategy

| Tier | Evidence |
|---|---|
| Component behavior | Default windowed mode, fullscreen/restore labels and state, geometry reset after close, existing close and Session-navigation behavior |
| Responsive behavior | Small-screen fullscreen override, hidden resize/maximize affordances, and restoration of the requested desktop mode after widening |
| Real Web composition | Opening from the sidebar, visible desktop backdrop, associated-Session navigation, and automatic removal of the complete dialog |
| Visual inspection | Default desktop, manually resized desktop, fullscreen desktop, and narrow mobile screenshots with overlap and clipping checks |

The focused component suite remains the fastest behavior signal. The existing real Web scenario continues to prove that the shipped composition reveals the associated conversation after the dialog closes.

## 12. Delivery and Rollback

The change ships only in the Client package and regenerated Web assets. It requires no data migration, Host restart requirement, or compatibility handling. Deployment uses the ordinary Web build. Rolling back the Client bundle restores the viewport-filling presentation without transforming scheduler documents.

## 13. Security and Accessibility Review

| Concern | Decision |
|---|---|
| Untrusted geometry | Pointer-derived dimensions are clamped to viewport and minimum-layout bounds and are never parsed from durable input |
| Global gesture listeners | Installed only for an active resize and removed on completion and disposal |
| Accidental close | Backdrop clicks do not close; explicit close, `Escape`, and successful Session navigation retain their defined behavior |
| Keyboard access | Fullscreen/restore and close are ordinary focusable buttons; mode labels update on the same toggle element |
| Text and control overlap | Stable header controls, bounded window dimensions, existing scroll owners, and responsive layout preserve separation |

No filesystem, process, credential, network, or new authorization boundary is involved.

## Confirmation Record

| Section | Confirmed by | Date | Status |
|---|---|---|---|
| Requirements and scope | User | 2026-08-28 | Confirmed |
| Window modes and geometry | User | 2026-08-28 | Confirmed |
| Transient state and interface boundaries | User | 2026-08-28 | Confirmed |
| Compliance, testing, delivery, and security treatment | User | 2026-08-28 | Confirmed |

## Change Record

| Date | Version | Change |
|---|---|---|
| 2026-08-28 | 1.0 | Initial confirmed design for resizable and application-fullscreen Work Scheduler presentation |
