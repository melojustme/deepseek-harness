/** Durable execution and review data shared by scheduler providers and clients. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from './workspace.ts'
import type { WorkSchedulerDocument } from './work-scheduler.ts'

/** Identity of one admitted execution, independent of its Session. */
export type SchedulerAttemptId = Branded<'SchedulerAttemptId'>
/** Client-generated identity retained across a command retry. */
export type SchedulerCommandId = Branded<'SchedulerCommandId'>
/** Host-owned execution lifecycle; review and approval are distinct terminal outcomes. */
export type SchedulerExecutionStatus = 'queued' | 'preparing' | 'running' | 'stopping' | 'review' | 'approved' | 'failed' | 'stopped' | 'interrupted'

/** Fixed Git and Session evidence for a completed attempt. */
export interface SchedulerEvidence {
  hash: string
  commit: string
  logSeq: number
  logHash: string
  diff: string
  truncated: boolean
  summary: string
  /** Actual tool records, never an inferred claim that tests passed. */
  tools: Array<{ name: string; arguments: string; result: string; failed: boolean }>
}

/** One immutable human decision against a fixed evidence version. */
export interface SchedulerReview {
  commandId: SchedulerCommandId
  decision: 'approved' | 'rework'
  evidenceHash: string
  feedback: string
  actor: 'local-user'
  time: string
}

/** Persisted execution record; only the execution service may change these fields. */
export interface SchedulerAttempt {
  id: SchedulerAttemptId
  taskId: string
  commandId: SchedulerCommandId
  status: SchedulerExecutionStatus
  description: string
  acceptance: string[]
  feedback: string
  sessionId: SessionId
  createdAt: string
  updatedAt: string
  previousId?: SchedulerAttemptId
  worktree?: string
  baseCommit?: string
  baseRef?: string
  error?: string
  evidence?: SchedulerEvidence
  evidenceRefreshes?: Array<{ commandId: SchedulerCommandId; inputHash: string }>
  review?: SchedulerReview
}

/** Commands requiring Host-owned admission or review. */
export type SchedulerCommand =
  | { kind: 'execute'; taskId: string; baseRef?: string; commandId: SchedulerCommandId; expectedRevision: number }
  | { kind: 'cancel'; attemptId: SchedulerAttemptId }
  | { kind: 'yield'; attemptId: SchedulerAttemptId; expectedRevision: number }
  | { kind: 'resume'; attemptId: SchedulerAttemptId; expectedRevision: number }
  | { kind: 'approve' | 'rework' | 'refresh-review'; attemptId: SchedulerAttemptId; commandId: SchedulerCommandId; expectedRevision: number; evidenceHash: string; feedback: string }

/** Native execution capability consumed by the gateway. */
export interface WorkSchedulerExecution {
  /**
   * Admit or settle one workspace-owned command; duplicate submission keys reuse their attempt.
   * @param workspaceId - Registered workspace owning the task.
   * @param command - Execution or review operation.
   * @returns The durable document after the command commits.
   */
  command(workspaceId: WorkspaceId, command: SchedulerCommand): Promise<WorkSchedulerDocument>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-owned scheduler execution provider. */
    workSchedulerExecution: WorkSchedulerExecution
  }
}
