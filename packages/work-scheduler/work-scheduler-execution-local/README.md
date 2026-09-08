# @deepseek-ai/dsh-work-scheduler-execution-local

English | [中文](README.zh.md)

Native provider for [scheduler execution](../work-scheduler-execution/README.md). It consumes the scheduler store, Workspace registry, agent factory, Session persistence, model selection, presets, and managed subprocess services. The [Web scheduler bundle](../../bundle/work-scheduler/README.md) supplies the composition.

## Admission and lifecycle

Execution validates the task, acceptance criteria, model, preset, and selected Git revision before committing a queued attempt. The attempt retains its resolved base commit, immutable task input, command identity, and dedicated Session ID. Duplicate submissions reuse the attempt; stale revisions reject. The dispatcher respects global capacity and ordered thread predecessors. Approval releases a predecessor; explicit asynchronous yielding removes its thread position while retaining its return location.

Each admitted run creates a detached worktree below `worktreeRoot`, then mounts the selected native preset in a dedicated Session. Its canonical worktree directory has a separate Workspace registration; the original scheduler document owns the attempt. User branch references and uncommitted original files remain unchanged. Native follow-up input and completed turn events establish success; an idle notification alone is insufficient.

Cancellation aborts preparation or model work, publishes stopping, and waits for native Session disposal before recording stopped. Host disposal stops admission and joins owned runs. On activation, queued records can dispatch; other ownerless pending records become interrupted and require human inspection before retry. Failed or stopped retries use a newly selected base; rework uses the previous retained artifact commit.

## Review evidence

Normal completion releases the agent before collecting evidence. Git snapshots include tracked modifications and nonignored new files; `refs/dsh/scheduler/<attempt-id>` retains the internal commit for rework and inspection. Evidence binds the input commit, output tree, complete Session log digest, and terminal sequence. Display data includes a bounded binary-capable diff, assistant summary, and actual tool arguments/results. Tool errors and native bash nonzero or interrupted results remain failures; arbitrary tool text is not classified as a passing test.

Review rejects an active Session, changed log, mismatched evidence hash, or changed worktree. Refresh fixes new file evidence and retains its retry identity. Approval requires an acceptance reason when tool records contain failures. Rework requires feedback and creates another attempt from the fixed output. Human decisions are durable and never merge or push user branches.

## Configuration and artifacts

`worktreeRoot` is a required absolute directory. `maxConcurrentRuns`, `maxQueuedRuns`, and `dispatchIntervalMs` control admission and scheduling; `gitTimeoutMs`, `gitGraceMs`, and `maxEvidenceBytes` bound managed Git work and display evidence. Config validation supplies defaults; see the [configuration catalog](../../../docs/config-catalog.md).

Artifacts and internal refs are retained indefinitely. Cleanup is an explicit separate operation using Git worktree/ref management after checking the corresponding attempt; the plugin never recursively removes a user's repository. Worktrees provide change isolation, while the selected preset determines tool permissions and sandbox policy.

## Model Experience

### Dedicated task input

#### What the model sees

A native user message contains the frozen task description, acceptance bullets, optional rework feedback, and the instruction to finish work in the isolated directory, run relevant checks, summarize actual results and unfinished work, and avoid pushing or merging. The exact text is owned by `executionPrompt`. Presets own tool schemas and other prompt content. The complete input, tool calls, and responses remain in the dedicated Session log.

#### Token effect

One task input per attempt, proportional to description, criteria, and feedback. Rework starts a new Session and does not replay the previous attempt's full conversation.

#### KV Cache effect

The task input follows the preset prefix. A new attempt starts a separate Session; the provider does not mutate an existing reusable conversation prefix.

## Known Limitations and Deferred Work

- Git and an existing commit are required; original uncommitted changes and ignored files are excluded from snapshots.
- Worktrees, Sessions, Workspace registrations, and internal refs require explicit retention management. No automatic merge, push, PR creation, or garbage collection is performed.
- Restart recovery conservatively interrupts uncertain nonqueued attempts. It does not adopt an external process or automatically resend model input.
- Display limits may require inspecting full Session logs and retained Git artifacts. Approval identifies the fixed snapshot, not future edits to its directory.
