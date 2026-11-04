# Agent Note: Planning-first Work Scheduler board

Status: implemented

English | [中文](2026-11-04-work-scheduler-planning-first-board.zh.md)

## Problem

The overlay mapped personal tasks onto Host execution/review columns. `resolveBoardDrop` rejected destination approved or review unless the latest attempt was already in review, and dragging cannot mint evidence. Users saw 「先完成执行并检查本轮证据，才能通过审查。」 when checking off work that had never run, so a personal board required a worktree before a card could leave 待办.

The [Workspace-persistent scheduler](2026-08-18-web-work-scheduler.md) still owns durability, SOP isolation, and the absence of the board from model context. The [native execution proposal](../../proposed/feature/2026-09-08-work-scheduler-agent-delivery.md) still owns Host attempts and versioned review. Neither authorized execution evidence as a precondition for personal planning.

## Decision

The overlay defaults to a planning board: 待办, user-named thread columns, 已暂停, and 已完成. Cards without attempts move with `moveTask` and `archiveTask` and never create Host attempts. 看板选项 exposes an optional execution board (待办 / 进行中 / 待审查 / 已通过) for SOP review. On that board, unattempted cards may still archive without evidence; attempted cards keep evidence-bound review. The screenshot copy appears only when an attempted card is dropped on 已通过 without review evidence. 待审查 remains Host-owned: dragging an unattempted card there is rejected with copy that points to 已通过 or 已完成.

新建任务 and each column 添加 open an inline composer that keeps the board visible. Acceptance criteria are optional. Unattempted cards expose 编辑 (in-place on the board) and 删除 (confirm, then `removeTask`); Host attempts are unchanged because save still forbids rewriting them. Attempted cards are not draggable on the planning board and omit those actions. Details still confirm native execution through 执行任务.

清空看板 is a visible header action. After RiskConfirmation it saves `createSchedulerState(document.revision)` through the existing `workScheduler.save` path. The Host store treats a version-compatible empty document as a full replacement of that Workspace record, including Host-owned attempts. Other Workspaces are untouched. The panel does not delete SQLite rows by hand.

The plugin store holds open, view, selected, and workspaceId. Documents stay in `WorkSchedulerRuntime`. The board remains absent from model requests and the Session log.

## Alternatives considered

**Keep the status board as the default and allow mark-done without an attempt.** This also unblocks personal tasks, and the execution board still implements that path. Landing on execution columns first is what produced the screenshot, so the ordinary path is the planning board and SOP review stays an explicit advanced mode.

**Delete the SQLite domain row to reset.** The Host load/save path is the only supported reset; deleting storage by hand is forbidden.

**Put the board into model context so an agent can check off tasks.** Rejected by the existing scheduler decision: planning state stays out of Session history.

## Consequences

Personal planning no longer requires worktree evidence. SOP review remains available on the optional execution board and in task details. Component tests pin the default 规划看板, unattempted archive without the evidence banner, attempted running-to-approved still showing that copy, card edit/delete, column add, and 清空看板 replacing one Workspace document. The keyless Web SOP scenario creates a personal task on the visible planning board, archives it without attempts, and still reaches details execution confirmation. `WorkScheduler.tsx` remains on the GUI coverage exemption until a browser-grade harness covers overlay, keyboard, and Workspace-fence branches; `board-drop.ts`, `scheduler.ts`, and the store stay per-file gated.
