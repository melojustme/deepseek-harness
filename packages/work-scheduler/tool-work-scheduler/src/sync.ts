/**
 * Pure SOP-stage projection into one work-scheduler document.
 * @module @deepseek-ai/dsh-tool-work-scheduler/src/sync
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SchedulerTask, SchedulerTaskStatus, WorkSchedulerDocument,
} from '@deepseek-ai/dsh-host-apiproxy/api'

/** Lifecycle state supplied by the SOP orchestrator. */
export type SopStageStatus = 'pending' | 'in_progress' | 'completed'

/** One stable SOP stage projected as a scheduler task. */
export interface SopStage {
  /** Stable workflow-local key used in the deterministic task id. */
  readonly key: string
  /** User-facing scheduler task description. */
  readonly name: string
  /** Current stage lifecycle state. */
  readonly status: SopStageStatus
}

/** Inputs required to replace one Session's SOP projection. */
export interface SopStageSync {
  /** User-facing process name. */
  readonly workflow: string
  /** Session bound to every projected task. */
  readonly sessionId: SessionId
  /** ISO-8601 mutation instant used only for changed tasks. */
  readonly now: string
  /** Complete ordered stage list for this synchronization. */
  readonly stages: readonly SopStage[]
}

/** Map the SOP lifecycle to the scheduler lifecycle. */
function schedulerStatus(status: SopStageStatus): SchedulerTaskStatus {
  switch (status) {
    case 'pending': return 'ready'
    case 'in_progress': return 'running'
    case 'completed': return 'done'
  }
}

/** Compare the fields whose equality makes a repeated synchronization a no-op. */
function sameTask(task: SchedulerTask, desired: Omit<SchedulerTask, 'createdAt' | 'updatedAt'>): boolean {
  return task.id === desired.id
    && task.description === desired.description
    && task.sessionId === desired.sessionId
    && task.status === desired.status
    && task.reason === desired.reason
    && task.wakeCondition === desired.wakeCondition
    && task.origin === undefined
}

/**
 * Replace one Session's deterministic SOP process and tasks while preserving
 * every manual task and every other Session's projection.
 * @param document - Current scheduler document.
 * @param input - Complete ordered SOP stage snapshot.
 * @returns The next scheduler document; unchanged tasks retain timestamps and references.
 */
export function syncSopStages(
  document: WorkSchedulerDocument,
  input: SopStageSync,
): WorkSchedulerDocument {
  const processId = `sop:${input.sessionId}`
  const taskPrefix = `${processId}:`
  const managedIds = new Set(
    Object.entries(document.tasks)
      .filter(([id, task]) => id.startsWith(taskPrefix) && task.sessionId === input.sessionId)
      .map(([id]) => id),
  )
  const tasks: Record<string, SchedulerTask> = Object.fromEntries(
    Object.entries(document.tasks).filter(([id]) => !managedIds.has(id)),
  )
  const activeTaskIds: string[] = []
  const completedTaskIds: string[] = []

  for (const stage of input.stages) {
    const id = `${taskPrefix}${stage.key}`
    const desired = {
      id,
      description: stage.name,
      sessionId: input.sessionId,
      status: schedulerStatus(stage.status),
      reason: '',
      wakeCondition: '',
    } satisfies Omit<SchedulerTask, 'createdAt' | 'updatedAt'>
    const previous = document.tasks[id]
    tasks[id] = previous !== undefined && sameTask(previous, desired)
      ? previous
      : {
        ...desired,
        createdAt: previous?.createdAt ?? input.now,
        updatedAt: input.now,
      }
    if (stage.status === 'completed') completedTaskIds.push(id)
    else activeTaskIds.push(id)
  }

  const priorProcessIndex = document.processes.findIndex(process => process.id === processId)
  const processes = document.processes
    .filter(process => process.id !== processId)
    .map(process => ({
      ...process,
      taskIds: process.taskIds.filter(id => !managedIds.has(id)),
    }))
  const process = { id: processId, name: input.workflow, taskIds: activeTaskIds }
  processes.splice(priorProcessIndex < 0 ? processes.length : priorProcessIndex, 0, process)

  const withoutManaged = (ids: readonly string[]): string[] => ids.filter(id => !managedIds.has(id))
  return {
    version: 2,
    processes,
    tasks,
    backlogIds: withoutManaged(document.backlogIds),
    blockedIds: withoutManaged(document.blockedIds),
    archiveIds: [...withoutManaged(document.archiveIds), ...completedTaskIds],
  }
}
