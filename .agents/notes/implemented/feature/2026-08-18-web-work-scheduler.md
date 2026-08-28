# Agent Note: Workspace-persistent work scheduler

Status: implemented

English | [中文](2026-08-18-web-work-scheduler.zh.md)

## Problem

A personal scheduler needs a durable place in dsh Web without turning human planning state into model context or Session history. The supplied prototype represents independent work streams as ordered threads and distinguishes synchronous blocking, which stops later work in one thread, from asynchronous blocking, which frees that thread while retaining a return position.

## Decision

`@deepseek-ai/dsh-client-ui-work-scheduler` contributes an action to `sidebar.footer.action` and a modal layer to `shell.overlay`; one plugin store carries the open state and scheduler document across both entries. Opening a task's associated Session selects it through the client runtime and closes the complete layer so its conversation becomes visible. This uses declared UI extension points and leaves the conversation owner and agent loop unchanged.

The modal layer covers the application viewport and contains a desktop scheduler window that opens centered at `92vw` by `86vh`. The window supports bottom-right pointer resizing down to `760 x 560` where the viewport permits, plus a header toggle between windowed and application-fullscreen modes. Restore uses the pre-fullscreen geometry, while closing clears all presentation state. Viewports at or below 760 px fill the application viewport and hide inapplicable window controls. The help panel is positioned relative to the scheduler window. Geometry remains component-local and does not enter the scheduler document, browser storage, Host storage, or Session log.

Task creation uses progressive disclosure within the command area. The collapsed row separates secondary thread creation from the primary new-task action. Opening the task editor focuses a multiline description, exposes backlog and threads as a horizontally scrollable radio group, and provides a searchable Session picker limited to the active Workspace. Submit, cancel, and modal close discard the draft; `Escape` dismisses the Session picker, editor, and modal in that order. The expanded editor does not become the mobile page's scroll owner, so the board remains independently reachable.

Scheduler transitions are pure functions over a version 2 JSON document. Every task occupies exactly one process, backlog, blocked list, or archive. Moving a task to asynchronous blocking records its former process or backlog index, and waking it restores that position when the process still exists. Native card drops delegate same-process ordering and cross-process movement to the same `moveTask` transition. Import normalization removes duplicate and dangling placements before assigning unplaced tasks by status.

`@deepseek-ai/dsh-work-scheduler-store` owns one document per Workspace through the `work_scheduler` storage domain. The independent `@deepseek-ai/dsh-work-scheduler` bundle routes that domain to SQLite and mounts the store plus browser plugin after `@deepseek-ai/dsh-web-app`; the existing API proxy exposes `workScheduler.load` and `workScheduler.save`. The browser resolves the current Session's Workspace, then the recent or first Workspace, loads before enabling edits, and saves document changes after a 400 ms debounce. Load and save failures leave the panel read-only until its next durable reload. With no Workspace, the board remains in memory and does not call the Host.

An optional Session ID is the task association's only durable authority. The browser projects the current title from the active Workspace's Session registry and uses native Session navigation when the association resolves. A missing Session or one outside that Workspace remains visible as `会话不可用` and cannot navigate; the stored ID is preserved so a later registry change can make the association valid again.

`@deepseek-ai/dsh-tool-work-scheduler` contributes `sync_work_scheduler` to every current and future root Agent. The tool derives the calling Session from tool execution, requires the unique Workspace whose validated Session account contains it, and projects a complete ordered SOP stage snapshot under deterministic `sop:<sessionId>` process and task ids. Pending, active, and completed stages become ready, running, and archived tasks respectively. Every projected task carries the calling Session ID. Synchronization replaces only that Session's `sop:` namespace, preserves manual and other-Session work, retains timestamps on identical input, and permits a completed stage to return to active work.

The full scheduler document remains absent from model requests and the Session log. The model sees the synchronization schema, submits the SOP snapshot through an ordinary logged tool call, and receives only resolved identities and status counts. Export and import provide explicit JSON portability alongside Host persistence.

## Alternatives considered

**Embed the standalone HTML in an iframe.** This would duplicate dsh theme, interaction, and persistence behavior while bypassing client plugin disposal.

**Replace the conversation slot.** Scheduling is an independent human view, not a Session rendering mode.

**Keep browser localStorage as the authority.** Browser-profile state cannot provide one durable board per Workspace across browser clients. The Host storage domain provides that ownership without putting planning state in Session history.

**Implement storage inside the client package's Node half.** A separate Host package keeps browser presentation and durable storage independently composable and lets the Web bundle choose the storage backend through the existing storage domain.

**Reuse `todo_write` for SOP progress.** `todo_write` owns the current Session's replace-all implementation plan. SOP phases and implementation tasks have different granularity and update cadence; sharing one list would make either writer erase the other's state.

**Keep task creation as one inline row of native selects.** The row makes description, placement, association, and submission compete for width, while long Session titles are difficult to scan. Progressive disclosure keeps the board compact until task creation is intentional and gives placement and Session selection controls enough space to remain legible.

## Consequences

The shipped Web profile composes base, Web app, and the scheduler bundle. It exposes the scheduler from the sidebar, stores documents across Host restarts, and gives root Agents the SOP synchronization tool without adding a global tool. Pure transition tests pin blocking, waking, archiving, drag placement, import normalization, asynchronous return positions, Session-isolated SOP replacement, idempotence, and stage rollback. Browser component and shipped-composition tests pin window geometry, fullscreen restore, responsive fullscreen, task-editor reset and dismissal, searchable Session selection, mobile overflow ownership, Session navigation, SQLite persistence, and Agent-scoped registration. Concurrent editors use last-write-wins replacement, deleted Workspaces leave their scheduler documents behind, and the pre-release version 2 format has no migration path. Scheduler state can locate a Session but has no authority over Sessions, workflows, jobs, or subagents.
