# @deepseek-ai/dsh-work-scheduler-execution

English | [中文](README.zh.md)

Service Definition for `ctx.workSchedulerExecution`. Providers implement durable task admission, cancellation, thread yielding, evidence refresh, and human review. The gateway is the Consumer; [the local provider](../work-scheduler-execution-local/README.md) uses native Sessions and Git worktrees.

## Service

`command(workspaceId, command)` returns the durable scheduler document. Execution and review submissions carry a caller-generated identity for retries; conditional mutations carry the expected document revision. Providers validate Workspace ownership, preserve attempt snapshots, and reject stale review evidence. The browser-safe command and document types live in the [gateway API](../../host/apiproxy/README.md).

## Model Experience

None directly. The selected provider owns all logged model input and execution effects.

#### KV Cache effect

No direct effect; provider and preset composition determine model requests.

## Known Limitations and Deferred Work

- This abstract service does not execute tasks. Load a concrete provider and the scheduler store in the Host composition.
