/** Shared scheduler planning, conditional persistence, and native execution API. */

import type { SchedulerAttempt, SchedulerCommand } from './work-scheduler-execution.ts'
import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from './workspace.ts'

/** Lifecycle state of one scheduled task. */
export type SchedulerTaskStatus = 'ready' | 'running' | 'sync-blocked' | 'async-blocked' | 'done'

/** Pre-block placement of an asynchronously blocked task, for wake-up return. */
export type SchedulerTaskOrigin =
  | { zone: 'process'; processId: string; index: number }
  | { zone: 'backlog'; index: number }

/** One scheduled task row. */
export interface SchedulerTask {
  /** Document-unique task id. */
  id: string
  /** User-written description. */
  description: string
  /** Explicit criteria included in each execution input. */
  acceptance: string[]
  /** Optional Session opened when the user follows this task's association. */
  sessionId?: SessionId
  status: SchedulerTaskStatus
  /** Block reason, non-empty only while the task is blocked. */
  reason: string
  /** Wake condition, non-empty only while the task is blocked. */
  wakeCondition: string
  /** Pre-block placement; present only for an asynchronously blocked task. */
  origin?: SchedulerTaskOrigin
  /** ISO-8601 creation instant. */
  createdAt: string
  /** ISO-8601 last-mutation instant. */
  updatedAt: string
}

/** One execution thread: an ordered task queue. */
export interface SchedulerProcess {
  id: string
  name: string
  taskIds: string[]
}

/**
 * The whole scheduler document. `version: 3` is the only accepted literal;
 * a future format bumps it and the host store's domain version together.
 */
export interface WorkSchedulerDocument {
  version: 3
  revision: number
  attempts: Record<string, SchedulerAttempt>
  processes: SchedulerProcess[]
  tasks: Record<string, SchedulerTask>
  backlogIds: string[]
  blockedIds: string[]
  archiveIds: string[]
}

/** Work-scheduler unary methods (the map keys workScheduler.* of RpcMethodMap). */
export interface WorkSchedulerApi {
  /**
   * Read one workspace's scheduler document. Absent documents resolve to the
   * empty document, never an error, so the board opens identically on first
   * use.
   */
  load(request: RpcRequest<{ workspaceId: WorkspaceId }>): Promise<RpcResponse<{ document: WorkSchedulerDocument }>>

  /**
   * Save planning changes at the current revision without overwriting execution records. The payload schema
   * validates the full document at the wire boundary; the host store
   * revalidates stored records at the durable read boundary.
   */
  save(request: RpcRequest<{ workspaceId: WorkspaceId; document: WorkSchedulerDocument }>): Promise<RpcResponse<{ document: WorkSchedulerDocument }>>
  /** Apply an execution or review command and return its durable result. */
  command(request: RpcRequest<{ workspaceId: WorkspaceId; command: SchedulerCommand }>): Promise<RpcResponse<{ document: WorkSchedulerDocument }>>

}

/**
 * Store contract the gateway consumes and `@deepseek-ai/dsh-work-scheduler-store`
 * implements. Owned here, beside the wire contract, because the document
 * vocabulary is browser-shared; the store plugin is a thin durable adapter
 * over the storage domain form.
 */
export interface WorkSchedulerStore {
  /**
   * Read one workspace's scheduler document, resolving the empty document
   * when none is stored.
   * @param workspaceId - owning workspace.
   * @returns the stored or empty document.
   */
  load(workspaceId: WorkspaceId): Promise<{ document: WorkSchedulerDocument }>
  /**
   * Save planning changes at the current revision without overwriting execution records.
   * @param workspaceId - owning workspace.
   * @param document - the full next document (no partial merge).
   * @returns The incremented document after durability; conflicts reject.
   */
  save(workspaceId: WorkspaceId, document: WorkSchedulerDocument): Promise<WorkSchedulerDocument>
  /**
   * Serialize a trusted Host mutation with every other writer.
   * @param workspaceId - Owning workspace.
   * @param mutate - Pure mutation of a detached current document; throws to reject.
   * @returns The next durable revision.
   */
  update(workspaceId: WorkspaceId, mutate: (document: WorkSchedulerDocument) => void): Promise<WorkSchedulerDocument>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The per-workspace scheduler document store, mounted by @deepseek-ai/dsh-work-scheduler-store. */
    workSchedulerStore: WorkSchedulerStore
  }
}
