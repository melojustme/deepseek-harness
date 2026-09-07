# Work Scheduler: task execution and review design

English | [中文](design.zh.md)

Status: proposed, not implemented. This is the technical reference for the [requirements](requirements.md); the [prototype](../../../../packages/client/ui-work-scheduler/prototype/agent-delivery.html) validates interactions only. The [Agent Note](../../../../.agents/notes/proposed/feature/2026-09-08-work-scheduler-agent-delivery.md) records the rationale.

## Existing implementation and extension points

At commit `b14d2218f9`, the Client contributes its panel through `sidebar.footer.action` and `shell.overlay`; the Host store saves whole version 2 documents, and the SOP tool updates stages through that store. Start and Complete currently change planning state only, while Session creation seeds an unsent draft. The port must distinguish these manual planning states from actual execution outcomes.

| Owner | Designed responsibility |
|---|---|
| `client/ui-work-scheduler` | Board/thread switching, creation, filters, details, execution and review commands through declared slots and injected callbacks |
| `client/runtime` object layer | Scheduler revisions, execution snapshots, notification ordering, framework-bound observable data for components |
| `work-scheduler/work-scheduler-store` | Versioned persistence and atomic conditional updates for tasks, ordering, attempt indexes, and reviews |
| Proposed `work-scheduler/work-scheduler-execution` | Service Definition: submission, cancellation, queries, reviews, events, branded task and attempt IDs |
| Proposed `work-scheduler/work-scheduler-execution-local` | Service Provider: native Session execution, worktrees, capacity, evidence finalization, recovery, disposal |
| `host/apiproxy` and `api/remotes` | Consumer: request validation, Workspace ownership, revisions, service dispatch, snapshot delivery |
| `work-scheduler/tool-work-scheduler` | Conditional updates to Session-owned SOP stages without execution or review write authority |
| `bundle/work-scheduler` | Compose definition, provider, persistence, transport, and Client contributions after their dependencies |

The Service Definition, Service Provider, and Consumer ship together. Browser components neither access Context, subscribe to external state, nor construct Session executors. Plugin stores hold filters, selection, drafts, and presentation only. Execution outlives panel mounting; closing the panel does not cancel tasks. This design leaves the agent loop unchanged.

## Data and authoritative sources

| Record | Required contents | Authority |
|---|---|---|
| Task | Branded `taskId`, Workspace, description, acceptance conditions, thread placement, manual blocks, current attempt reference | Scheduler storage |
| Attempt | Branded `attemptId`, submission idempotency key, Task revision, dedicated Session, working directory, baseline commit, start/end times, status, previous attempt reference | Execution service and durable records |
| Evidence | Attempt, terminal Session log position, observed checks, file inventory, diff digest, content locations, completeness | Provider evidence finalized from native logs and the isolated worktree |
| Review | Attempt, evidence version, approval or rework decision, actor, time, failed-check acceptance reason or feedback | Durable human command result |
| Snapshot | Document revision, execution state, queue reason, known evidence references, current connection state | Host snapshot consumed by revision |

Planning state stays out of model history. Each attempt's task text, acceptance conditions, and feedback enter the Session log through native input. Tool activity, Todos, errors, and output retain their native log or projection ownership. Views do not copy full logs into scheduler documents.

Scheduler documents advance to version 3 with the storage domain version. Older formats reject explicitly with instructions to export the old board before implementation. Any SQLite layout change monotonically increments `SCHEMA_VERSION`; Session format stays unchanged. Version 3 removes unconditional browser replacement: mutations carry `expectedRevision`, while only service commands write execution and review fields.

## Commands and commit points

These are proposed business operations, not declarations of existing APIs. Final methods update types, validation schemas, carriers, and generated contracts together. RPC identifiers remain carrier-owned.

| Operation | Input | Successful commit and failure behavior |
|---|---|---|
| Load / subscribe | Workspace, known revision | Return full snapshot; reconnect replaces with the latest revision and rejects reordered notifications |
| Edit / reorder | Task, expected revision, mutation | Publish after conditional update; conflicts retain drafts and require reload |
| Submit | Task, expected revision, idempotency key | Return after durable creation of one queued attempt; repeated keys return the original result |
| Cancel | Task, attempt, idempotency key | Queued cancellation terminates immediately; running cancellation waits for agent and subprocess quiescence |
| Read review | Task, attempt | Return fixed evidence and completeness; missing evidence or abnormal termination cannot be approved |
| Approve | Task, attempt, evidence hash, expected revision, required acceptance reason | Recheck files and log version before persisting approval; changes or conflicts reject stale review |
| Rework | Task, attempt, evidence hash, non-empty feedback, idempotency key | Atomically retain the decision and queue another attempt without duplicate input submission |

The service validates Task, Session, and worktree ownership against the requested Workspace. Arbitrary user-supplied paths cannot become execution directories. Editing, execution, SOP updates, and reviews share a per-Workspace serialized conditional mutation operation so stale reads cannot overwrite other writers.

## Execution lifecycle

Submission first creates a durable queued attempt. When thread and capacity permit, the service allocates a worktree and dedicated Session, records preparation, and submits work through native Session input. Running is published only after this attempt's durable input receipt. Preparation or admission rejection records failure; optimistic UI never proves execution began.

The caller supplies a stable idempotency key, and the attempt durably references its input receipt. A crash can occur between sending and recording, so recovery first checks recorded Session input. Uncertain admission becomes interrupted and requires human inspection rather than blind resending. General Session idle notifications cannot replace the attempt's receipt, complete execution interval, and terminal evidence.

One task occupies each thread. Pending review retains that position; approval or explicit asynchronous yielding allows later submitted work to prepare. Other threads use configured capacity without submitting untouched backlog tasks. `maxConcurrentRuns`, queue capacity, evidence display bounds, and retention policy are validated Config fields.

One cancellation controller owns preparation, running, and release. Repeated cancellation is idempotent; cancellation during preparation rolls back allocated resources. Running cancellation requests native termination and waits for execution and subprocess exit. Completion, cancellation, and errors race toward one terminal commit; every event is checked against its attempt so old attempts cannot mutate new ones.

Host restart reconciles nonterminal records with Session logs and actual execution resources. Completed attempts with intact evidence can recover review; attempts with a verifiable live owner recover monitoring; others become interrupted. Plugin disposal stops admission and publication before cancelling and awaiting owned resources. Worktree artifacts follow retention policy; cleanup never targets the user's original directory.

## Diffs and review

The first attempt uses a user-selected Git commit, defaulting to current HEAD. Uncommitted original-workspace changes are excluded with a visible pre-submission notice. Rework starts in a new isolated directory from the retained previous-attempt artifact snapshot. The provider may create local internal snapshot commits to fix baselines, but does not move user branches or push. This behavior is visible before execution; including original uncommitted changes requires a separate future design.

After normal termination, the provider fixes a tracked-and-untracked file inventory and content hashes. Diffs bind the baseline, attempt, terminal log position, and content hash. Binary files show metadata; oversized files show truncation and a complete-artifact entry rather than appearing unchanged. Prototype line diffs are examples; implementation reuses native diff presentation and file access policy.

Check evidence comes from actual tool calls and results, naming the command, working directory, exit code, and interruption state. Commands not reliably identifiable as checks remain tool records rather than automatically passing tests. Approval can accept failed checks with a human reason, but cannot accept unfinished execution, incomplete evidence, or changed diffs. Approval records a decision only; artifacts remain in the worktree, and branch integration requires subsequent explicit work.

## Interaction and accessibility

The window retains resizing and fullscreen. The main area offers status-board and thread views, with Workspace, connection state, capacity, search, and creation controls above. Task selection exposes description, acceptance conditions, attempts, and Overview / Log / Diff tabs.

Running tasks show native Todo counts and current tool activity. Waiting tasks link to the native approval or question. Review provides approval, feedback, and a full Session entry. Empty, missing-Workspace, loading, error, disconnected, and conflicting states have textual explanations; disconnected clients cannot mutate. Small screens use a single column and fullscreen details with a Back control.

Cards and actions work by keyboard. Move up / Move down supplement dragging. Progress uses actual-count `progressbar` semantics and updates use polite `aria-live`. Closing details returns focus to the card. Escape dismisses the innermost editor first without cancelling execution. States use text as well as color.

## Verification and implementation slices

| Slice | Deliverable and required evidence |
|---|---|
| This commit | Bilingual requirements/design, proposed Agent Note, standalone simulated prototype; interaction, layout, link, and consistency checks |
| Durable execution | Definition/provider/Consumer, version 3, conditional updates; unit coverage for duplicates, conflicts, cancellation races, recovery, cross-Workspace rejection; real Loader composition for activation and disposal |
| Client and review | Declarative slots, native live data, fixed evidence, human decisions; component coverage for disabled states, focus, and errors; requirement-by-requirement acceptance |
| Product acceptance | Creation, execution, waiting, review, and rework in real Web composition with keyless replay snapshots; real isolated Git directories for diffs; credentialed provider e2e; real-flow GIF for the GUI PR |

This commit contains the first slice only. Implementation must not use prototype clocks, preset check results, or localStorage as its execution mechanism. Before shipping, verify AutoMaker licensing and preserve MIT attribution and required third-party notices when copying source.
