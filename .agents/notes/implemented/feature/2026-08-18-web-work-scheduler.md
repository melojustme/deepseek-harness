# Agent Note: Workspace-persistent work scheduler

Status: implemented

English | [中文](2026-08-18-web-work-scheduler.zh.md)

## Problem

A personal scheduler needs a durable place in dsh Web without turning human planning state into model context or Session history. The supplied prototype represents independent work streams as ordered threads and distinguishes synchronous blocking, which stops later work in one thread, from asynchronous blocking, which frees that thread while retaining a return position.

## Decision

`@deepseek-ai/dsh-client-ui-work-scheduler` contributes an action to `sidebar.footer.action` and a modal layer to `shell.overlay`; one plugin store carries the open state and scheduler document across both entries. Opening a task's associated Session selects it through the client runtime and closes the complete layer so its conversation becomes visible. Task creation can also create a Session through that runtime and seed its unsent conversation draft through the conversation service before opening it. This uses declared UI extension points and leaves the conversation owner and agent loop unchanged.

The modal layer covers the application viewport and contains a desktop scheduler window that opens centered at `92vw` by `86vh`. The window supports bottom-right pointer resizing down to `760 x 560` where the viewport permits, plus a header toggle between windowed and application-fullscreen modes. Restore uses the pre-fullscreen geometry, while closing clears all presentation state. Viewports at or below 760 px fill the application viewport and hide inapplicable window controls. The help panel is positioned relative to the scheduler window. Geometry remains component-local and does not enter the scheduler document, browser storage, Host storage, or Session log.

Creation uses progressive disclosure below the header. One `新建` menu exposes task and thread commands, no creation row remains permanently visible, and only the selected editor is mounted. Opening either editor focuses its first input; the task editor exposes a multiline description, backlog and threads as a horizontally scrollable radio group, and a Session picker limited to the active Workspace. The picker keeps new-Session and no-association actions above searchable existing Sessions. Submit, cancel, and modal close discard the active draft; `Escape` dismisses the Session picker, creation menu, editor, and modal in that order. A rejected new-Session request instead preserves the task editor and draft, adds no task, and reports a retryable error. Cancelling, switching editors or Workspace, or closing while creation is pending invalidates its completion so a late result cannot add a task or navigate. The expanded task editor does not become the mobile page's scroll owner, so the board remains independently reachable.

Scheduler transitions are pure functions over a version 2 JSON document. Every task occupies exactly one process, backlog, blocked list, or archive. Moving a task to asynchronous blocking records its former process or backlog index, and waking it restores that position when the process still exists. Native card drops delegate same-process ordering and cross-process movement to the same `moveTask` transition. Import normalization removes duplicate and dangling placements before assigning unplaced tasks by status.

`@deepseek-ai/dsh-work-scheduler-store` owns one document per Workspace through the `work_scheduler` storage domain. The independent `@deepseek-ai/dsh-work-scheduler` bundle routes that domain to SQLite and mounts the store plus browser plugin after `@deepseek-ai/dsh-web-app`; the existing API proxy exposes `workScheduler.load` and `workScheduler.save`. The browser resolves the current Session's Workspace, then the recent or first Workspace, loads before enabling edits, and saves document changes after a 400 ms debounce. Load and save failures leave the panel read-only until its next durable reload. With no Workspace, the board remains in memory and does not call the Host.

An optional Session ID is the task association's only durable authority. The browser projects the current title from the active Workspace's Session registry and uses native Session navigation when the association resolves. For a new association, it creates the Session in that Workspace, resolves its Client scope, writes the task description to the unsent conversation composer, then adds the task, closes the scheduler, and opens the Session. The scheduler does not send the draft or copy it into its document. A missing Session or one outside that Workspace remains visible as `会话不可用` and cannot navigate; the stored ID is preserved so a later registry change can make the association valid again.

A running task also reads the associated Session's non-empty `projectionValues.todos` and renders segmented completed progress, the completed and total counts, and the current active item. Other task states omit this projection even when they share the Session, preventing one implementation list from appearing as several active scheduler tasks. The Todo list remains Session-owned; the scheduler neither writes it nor copies it into the Workspace document.

`@deepseek-ai/dsh-tool-work-scheduler` contributes `sync_work_scheduler` to every current and future root Agent. The tool derives the calling Session from tool execution, requires the unique Workspace whose validated Session account contains it, and projects a complete ordered SOP stage snapshot under deterministic `sop:<sessionId>` process and task ids. Pending, active, and completed stages become ready, running, and archived tasks respectively. Every projected task carries the calling Session ID. Synchronization replaces only that Session's `sop:` namespace, preserves manual and other-Session work, retains timestamps on identical input, and permits a completed stage to return to active work.

The full scheduler document remains absent from model requests and the Session log. The model sees the synchronization schema, submits the SOP snapshot through an ordinary logged tool call, and receives only resolved identities and status counts. Export and import provide explicit JSON portability alongside Host persistence.

## Alternatives considered

**Embed the standalone HTML in an iframe.** This would duplicate dsh theme, interaction, and persistence behavior while bypassing client plugin disposal.

**Replace the conversation slot.** Scheduling is an independent human view, not a Session rendering mode.

**Keep browser localStorage as the authority.** Browser-profile state cannot provide one durable board per Workspace across browser clients. The Host storage domain provides that ownership without putting planning state in Session history.

**Implement storage inside the client package's Node half.** A separate Host package keeps browser presentation and durable storage independently composable and lets the Web bundle choose the storage backend through the existing storage domain.

**Reuse `todo_write` as the source of SOP stage progress.** `todo_write` owns the current Session's replace-all implementation plan. SOP phases and implementation tasks have different granularity and update cadence; sharing one list would make either writer erase the other's state. Reading that independent list on an associated running card does not make it the authority for scheduler stages.

**Keep creation as one inline row of native inputs and selects.** The row makes thread naming, task description, placement, association, and submission compete for width, while long Session titles are difficult to scan. A single header menu and mutually exclusive editors keep the board compact until creation is intentional and give placement and Session selection controls enough space to remain legible.

## Consequences

The shipped Web profile composes base, Web app, and the scheduler bundle. It exposes the scheduler from the sidebar, stores documents across Host restarts, and gives root Agents the SOP synchronization tool without adding a global tool. Pure transition tests pin blocking, waking, archiving, drag placement, import normalization, asynchronous return positions, Session-isolated SOP replacement, idempotence, and stage rollback. Browser component and shipped-composition tests pin window geometry, fullscreen restore, responsive fullscreen, creation-menu and mutually exclusive editor behavior, fixed and searchable Session choices, new-Session draft seeding and failure preservation, running-only Todo progress through the real Session projection, mobile overflow ownership, Session navigation, SQLite persistence, and Agent-scoped registration. Concurrent editors use last-write-wins replacement, deleted Workspaces leave their scheduler documents behind, and the pre-release version 2 format has no migration path. Scheduler state can locate or request creation of a Session but has no authority to write Todo state, send a draft, or start, stop, or monitor Sessions, workflows, jobs, or subagents.
