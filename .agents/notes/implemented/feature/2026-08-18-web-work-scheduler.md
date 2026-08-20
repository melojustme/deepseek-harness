# Agent Note: Workspace-persistent work scheduler

Status: implemented

English | [中文](2026-08-18-web-work-scheduler.zh.md)

## Problem

A personal scheduler needs a durable place in dsh Web without turning human planning state into model context or Session history. The supplied prototype represents independent work streams as ordered threads and distinguishes synchronous blocking, which stops later work in one thread, from asynchronous blocking, which frees that thread while retaining a return position.

## Decision

`@deepseek-ai/dsh-client-ui-work-scheduler` contributes an action to `sidebar.footer.action` and a full-frame panel to `shell.overlay`; one plugin store carries the open state and scheduler document across both entries. This uses declared UI extension points and leaves the conversation owner and agent loop unchanged.

Scheduler transitions are pure functions over a version 2 JSON document. Every task occupies exactly one process, backlog, blocked list, or archive. Moving a task to asynchronous blocking records its former process or backlog index, and waking it restores that position when the process still exists. Native card drops delegate same-process ordering and cross-process movement to the same `moveTask` transition. Import normalization removes duplicate and dangling placements before assigning unplaced tasks by status.

`@deepseek-ai/dsh-work-scheduler-store` owns one document per Workspace through the `work_scheduler` storage domain. The independent `@deepseek-ai/dsh-work-scheduler` bundle routes that domain to SQLite and mounts the store plus browser plugin after `@deepseek-ai/dsh-web-app`; the existing API proxy exposes `workScheduler.load` and `workScheduler.save`. The browser resolves the current Session's Workspace, then the recent or first Workspace, loads before enabling edits, and saves document changes after a 400 ms debounce. Load and save failures leave the panel read-only until its next durable reload. With no Workspace, the board remains in memory and does not call the Host.

An optional Session ID is the task association's only durable authority. The browser projects the current title from the active Workspace's Session registry and uses native Session navigation when the association resolves. A missing Session or one outside that Workspace remains visible as `会话不可用` and cannot navigate; the stored ID is preserved so a later registry change can make the association valid again.

Scheduler state is intentionally absent from the Session log because it never reaches a model request and does not describe agent execution. Export and import provide explicit JSON portability alongside Host persistence.

## Alternatives considered

**Embed the standalone HTML in an iframe.** This would duplicate dsh theme, interaction, and persistence behavior while bypassing client plugin disposal.

**Replace the conversation slot.** Scheduling is an independent human view, not a Session rendering mode.

**Keep browser localStorage as the authority.** Browser-profile state cannot provide one durable board per Workspace across browser clients. The Host storage domain provides that ownership without putting planning state in Session history.

**Implement storage inside the client package's Node half.** A separate Host package keeps browser presentation and durable storage independently composable and lets the Web bundle choose the storage backend through the existing storage domain.

## Consequences

The shipped Web profile composes base, Web app, and the scheduler bundle. It exposes the scheduler from the sidebar, stores documents across Host restarts, and supports light, dark, desktop, and narrow layouts through dsh design tokens. Pure transition tests pin blocking, waking, archiving, drag placement, import normalization, and asynchronous return positions; a Loader composition test pins SQLite persistence across separate boots. Concurrent editors use last-write-wins replacement, deleted Workspaces leave their scheduler documents behind, and the pre-release version 2 format has no migration path. Scheduler state can locate a Session but has no authority over Sessions, workflows, jobs, or subagents.
