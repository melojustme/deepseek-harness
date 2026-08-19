# Agent Note: Browser-local work scheduler

Status: implemented

English | [中文](2026-08-18-web-work-scheduler.zh.md)

## Problem

A personal scheduler needs a durable place in dsh Web without turning human planning state into model context or Session history. The supplied prototype represents independent work streams as ordered threads and distinguishes synchronous blocking, which stops later work in one thread, from asynchronous blocking, which frees that thread while retaining a return position.

## Decision

`@deepseek-ai/dsh-client-ui-work-scheduler` is a browser-only plugin. It contributes an action to `sidebar.footer.action` and a full-frame panel to `shell.overlay`; one plugin store carries the open state and scheduler document across both entries. This uses declared UI extension points and leaves the conversation owner and agent loop unchanged.

Scheduler transitions are pure functions over a versioned JSON document. Every task occupies exactly one process, backlog, blocked list, or archive. Moving a task to asynchronous blocking records its former process or backlog index, and waking it restores that position when the process still exists. Import normalization removes duplicate and dangling placements before assigning unplaced tasks by status.

The browser persists the document in localStorage. Scheduler state is intentionally absent from the Session log because it never reaches a model request and does not describe agent execution. Export and import provide explicit portability without adding a Host API or storage service.

## Alternatives

Embedding the standalone HTML in an iframe was rejected because it would duplicate dsh theme, interaction, and persistence behavior while bypassing client plugin disposal. Replacing the conversation slot was rejected because scheduling is an independent human view, not a Session rendering mode. Host persistence was deferred because there is no current cross-device or Workspace-scoped consumer.

## Consequences

The shipped Web profile exposes the scheduler from the sidebar and supports light, dark, desktop, and narrow layouts through dsh design tokens. Domain tests pin blocking, waking, archiving, and import normalization. The state remains local to a browser profile and has no authority over Sessions, workflows, jobs, or subagents.
