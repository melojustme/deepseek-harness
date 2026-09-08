# Agent Note: Native task execution and review in Work Scheduler

Status: proposed

English | [中文](2026-09-08-work-scheduler-agent-delivery.zh.md)

## Problem

The existing scheduler associates planning tasks with Sessions but does not own execution attempts or human acceptance. A running label, idle Session, or complete Todo list cannot establish which task produced a file change or whether a human reviewed that version.

## Proposal

Extend the scheduler with Host-owned attempts, dedicated native Sessions, isolated Git worktrees, and version-bound reviews. The [requirements](../../../../docs/design/work-scheduler/agent-delivery/requirements.md) own product acceptance; the [design](../../../../docs/design/work-scheduler/agent-delivery/design.md) owns data, commands, recovery, and composition. The [prototype](../../../../packages/client/ui-work-scheduler/prototype/agent-delivery.html) demonstrates simulated interactions only.

The [existing scheduler decision](../../implemented/feature/2026-08-18-web-work-scheduler.md) remains active: its planning semantics, SOP ownership, and window composition still apply. This proposal adds execution ownership to that foundation.

The [interaction design](../../../../docs/design/work-scheduler/agent-delivery/interaction.md) separates the full-width board, editor, and task details. Collapsed advanced controls keep execution and review decisions visible. Prototype drag operations are simulated; the product must dispatch commands and preserve Host-owned evidence instead of assigning status labels. A permanent narrow inspector was considered, but long acceptance criteria and diffs need the task page width.

## Alternatives considered

**Embed AutoMaker's application.** This preserves a ready-made UI but introduces a separate provider, session, and storage system instead of extending the user's Harness panel.

**Run tasks inside browser components.** This is smaller initially but makes panel teardown and disconnection affect orchestration, while multiple clients can submit duplicate work. A Host owner provides durable admission and recovery.

**Reuse any associated Session and diff the original Workspace.** Existing associations can represent several SOP tasks, and shared filesystem changes cannot be assigned reliably to one execution. Dedicated attempts and worktrees make evidence reviewable at the cost of explicit Git and artifact-retention requirements.

## Acceptance criteria

The design package provides linked bilingual requirements and architecture plus an interactive simulated board, execution progress, review, approval, rework, and failure states. Implementation acceptance is defined in the requirements and needs real composition, logged input, race coverage, and native execution evidence before this note can move to implemented.

## Risks

Host-owned attempts require conditional updates instead of whole-document last-write-wins, including the existing SOP writer. Version 3 rejects older records. Worktrees consume disk and require retention policy; non-Git execution and automatic branch integration are excluded. Approval of evidence must remain distinct from provider success claims and from merging changes.
