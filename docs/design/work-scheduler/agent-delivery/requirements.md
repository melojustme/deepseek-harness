# Work Scheduler: task execution and review requirements

English | [中文](requirements.zh.md)

Status: proposed, not implemented. This is a product requirements reference; the [technical design](design.md) defines implementation responsibilities, and the [interactive prototype](../../../../packages/client/ui-work-scheduler/prototype/agent-delivery.html) demonstrates the flow with simulated data.

## Goal and baseline

Bring AutoMaker's core board → execution → live progress → review → approval or rework flow into the existing scheduler plugin. Users describe tasks, assign work, inspect artifacts, and decide whether to accept results inside one Workspace.

The baseline is the [scheduler plugin](../../../../packages/client/ui-work-scheduler/README.md) at commit `b14d2218f9`: ordered threads, synchronous and asynchronous blocking, Session associations, Todo progress, Workspace persistence, and window modes. [AutoMaker](https://github.com/AutoMaker-Org/automaker/tree/5888d2e) supplies product prior art for board interactions; execution uses native Harness capabilities.

## Scope

| Included in this design | Excluded from this design |
|---|---|
| Task creation, thread grouping, status board, filtering, ordering, blocking | Embedding the complete AutoMaker React/Electron application |
| Explicit execution, queuing, stopping, retrying, limits | Unattended admission of every backlog task |
| Dedicated execution Sessions, live status, Todos, log navigation | Copying AutoMaker provider login or model catalogs |
| Summaries, check evidence, execution-owned file diffs, human approval and rework | GitHub Issue/PR synchronization, commits, pushes, or automatic merging |
| Reconnection, Host restart recovery, conflict notices | Standalone terminals, cross-project scheduling, general workflow editors |

Git Workspaces create an isolated worktree per execution so diffs have reliable ownership. Non-Git Workspaces can manage backlog items, but execution explains that they are unsupported. Review approval accepts the result and retains its worktree without merging changes into the user's current branch. This limitation must be visible before execution and after approval.

## User flow

1. Create a task with a description, acceptance conditions, and thread. Creation saves backlog only and sends no model request. Existing Session associations remain context-navigation links.
2. Select Execute task. The Host validates the task, Workspace, model configuration, thread predecessors, and capacity. Accepted work shows queued or running and exposes this execution's Session.
3. Inspect the current step, actual Todo counts, tool activity, and pending user actions. Closing the panel leaves execution running; only Stop execution requests cancellation.
4. Execution enters review or failure. Users inspect the execution summary, observed checks, and a fixed version of the file diff.
5. Approve review to archive the accepted result, or enter non-empty feedback and request rework to create another execution attempt. Earlier attempts remain inspectable.

## States and actions

| State | Meaning | Available actions |
|---|---|---|
| Backlog | Not submitted, or manually unblocked | Edit, reorder, execute, block |
| Queued | Accepted by the Host, awaiting thread and capacity | Inspect queue reason, cancel queue |
| Running | This execution is active | Inspect logs, handle native approvals, stop |
| Waiting for user | Blocked on approval, plan review, or a question | Open the native interaction, stop |
| In review | Execution ended normally and evidence is fixed | Inspect, approve, request rework |
| Failed / stopped | Failure, cancellation, or unrecoverable restart | Inspect reason, retry; no direct approval |
| Approved | A human accepted a particular attempt and diff version | Inspect the review record, copy into a new task |

The board uses Backlog, Running, In review, and Approved columns. Queued and waiting work appear under Running; failures, stopped work, and manual blocks appear under Backlog with a reason. Thread view orders the same tasks without copying them. Dragging changes backlog placement or order only; it cannot manufacture execution, approval, or cancellation. Synchronous blocks and pending review retain the thread; asynchronous blocks retain a return position and allow later submitted work to advance.

## Execution and review rules

- Execution uses the Workspace's native model configuration. Missing usable configuration produces an actionable error rather than silently selecting another provider. Native execution composition owns approval and sandbox policy.
- A task has at most one nonterminal attempt. Double clicks and network retries return the same submission result without another Session or another model charge.
- Host configuration controls capacity. One thread runs one task at a time; later submitted tasks wait for predecessor approval or an explicit asynchronous yield. Different threads may use remaining capacity in isolated worktrees.
- An idle Session, completed Todos, or an acknowledged stop request alone cannot prove success. Only normal completion of the owned attempt plus finalized evidence admits review.
- Review summaries name observed checks and their exit results. Unexecuted checks show Not run. Failed checks remain visible, and approving them requires an acceptance reason. Model success claims do not substitute for check evidence.
- Diffs cover modified, deleted, and added files against the execution baseline. Binary files and display limits have explicit notices. Changes during review invalidate approval of the old version and require refreshed evidence.
- Rework feedback enters the new attempt's model input and Session log. A fresh dedicated Session starts from the previous attempt's artifacts with the task, acceptance conditions, and feedback. Prior conversations remain inspectable references rather than silently replayed messages from other tasks.

## Acceptance criteria

| ID | Observable result |
|---|---|
| AC-01 | Creating a task makes no model call; description, acceptance conditions, thread, and position survive reload. |
| AC-02 | Submission creates one attempt and dedicated Session; double clicks and timeout retries do not duplicate execution. |
| AC-03 | Missing models, non-Git Workspaces, and worktree creation failures never display a false running state. |
| AC-04 | The Host enforces thread order, cross-thread capacity, and synchronous/asynchronous blocking. |
| AC-05 | Execution survives panel closure; reopening restores real progress, and disconnects show connection state rather than a failure conclusion. |
| AC-06 | Native Sessions supply live Todos, tool activity, approvals, and questions; absent Todos produce no estimated percentage. |
| AC-07 | Stopping targets the current attempt and waits for execution resources to finish; late events from old attempts are ineffective. |
| AC-08 | Only normal completion admits review; failures, cancellations, and uncertain recovery cannot be approved. |
| AC-09 | Review exposes the execution summary, check evidence, diffs including new files, and full logs. |
| AC-10 | The approved attempt, diff version, timestamp, and required acceptance reason persist; approval does not commit, push, or merge. |
| AC-11 | Non-empty feedback becomes logged model input for a new attempt; prior results and review records remain available. |
| AC-12 | Concurrent writes reject stale versions and request reload; SOP synchronization cannot overwrite execution or review fields. |
| AC-13 | Host restart reconciles durable attempts; an attempt without proof of live execution becomes interrupted without resending input. |
| AC-14 | Desktop retains resize and fullscreen; small screens use a single column and detail drawer; creation, execution, and review work by keyboard. |
| AC-15 | The prototype identifies simulated data; product acceptance uses real composition and replayable model flows, never simulation buttons. |

## Prototype review path

Open the [prototype](../../../../packages/client/ui-work-scheduler/prototype/agent-delivery.html), execute a backlog task, advance the demo through progress into review, inspect File diff, request rework, advance again, and approve. Also demonstrate stopping, simulated failure, approval waiting, disconnection, and thread view. The prototype accesses neither models nor the filesystem and does not represent implemented capabilities.
