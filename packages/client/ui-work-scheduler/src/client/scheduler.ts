/** Pure state transitions for the browser work scheduler. */

import type {
  SchedulerProcess, SchedulerTask, SchedulerTaskOrigin, SchedulerTaskStatus, SessionId, WorkSchedulerDocument,
} from '@deepseek-ai/dsh-client-connection/client'

// The document vocabulary is the gateway contract, browser-shared with the
// host store (`@deepseek-ai/dsh-work-scheduler-store`); this module re-exports
// it under the local names and owns the client-only input shapes and every
// state transition.
/** Scheduler task lifecycle status used by client transitions. */
export type TaskStatus = SchedulerTaskStatus
/** Placement restored when an asynchronously blocked task wakes. */
export type TaskOrigin = SchedulerTaskOrigin
/** Complete versioned scheduler document held by the client store. */
export type SchedulerState = WorkSchedulerDocument
export type {
  SchedulerProcess, SchedulerTask, SchedulerTaskOrigin, SchedulerTaskStatus, WorkSchedulerDocument,
} from '@deepseek-ai/dsh-client-connection/client'

/** Input accepted when adding a task to a process or the backlog. */
export interface AddTaskInput {
  id?: string
  description: string
  acceptance?: string[]
  sessionId?: SessionId
  processId?: string
  status?: TaskStatus
}

/** Destination collection and insertion index for a task move. */
export interface MoveTarget {
  zone: 'process' | 'backlog' | 'blocked' | 'archive'
  processId?: string
  index: number
}

import { workSchedulerDocumentSchema } from '@deepseek-ai/dsh-client-connection/client'

/**
 * Create an empty scheduler document.
 * @returns a version 3 document with no processes or tasks.
 */
export function createSchedulerState(): SchedulerState {
  return { version: 3, revision: 0, attempts: {}, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [] }
}

function copyState(state: SchedulerState): SchedulerState {
  return {
    ...state,
    processes: state.processes.map(process => ({ ...process, taskIds: [...process.taskIds] })),
    tasks: Object.fromEntries(
      Object.entries(state.tasks).map(([id, task]) =>
        [id, task.origin === undefined ? { ...task } : { ...task, origin: { ...task.origin } }],
      ),
    ),
    backlogIds: [...state.backlogIds],
    blockedIds: [...state.blockedIds],
    archiveIds: [...state.archiveIds],
  }
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Add one execution thread.
 * @param state - source document.
 * @param name - user-entered process name.
 * @param processId - optional stable id; generated when omitted.
 * @returns a new document containing the process.
 */
export function addProcess(state: SchedulerState, name: string, processId = id('thread')): SchedulerState {
  const next = copyState(state)
  next.processes.push({ id: processId, name: name.trim() || `线程 ${next.processes.length + 1}`, taskIds: [] })
  return next
}

/**
 * Rename an execution thread.
 * @param state - source document.
 * @param processId - process to rename.
 * @param name - non-empty replacement name.
 * @returns a new document, unchanged when the process or name is invalid.
 */
export function renameProcess(state: SchedulerState, processId: string, name: string): SchedulerState {
  const next = copyState(state)
  const process = next.processes.find(item => item.id === processId)
  if (process !== undefined && name.trim() !== '') process.name = name.trim()
  return next
}

/**
 * Add one task to a process or the backlog.
 * @param state - source document.
 * @param input - task content, optional process, status, and stable id.
 * @returns a new document containing the task in its status-appropriate collection.
 */
export function addTask(state: SchedulerState, input: AddTaskInput): SchedulerState {
  const next = copyState(state)
  const taskId = input.id ?? id('task')
  const now = new Date().toISOString()
  next.tasks[taskId] = {
    id: taskId,
    description: input.description.trim() || '未命名任务',
    acceptance: input.acceptance ?? [],
    ...input.sessionId === undefined ? {} : { sessionId: input.sessionId },
    status: input.status ?? 'ready',
    reason: '',
    wakeCondition: '',
    createdAt: now,
    updatedAt: now,
  }
  const process = input.processId === undefined ? undefined : next.processes.find(item => item.id === input.processId)
  if (process === undefined) next.backlogIds.push(taskId)
  else process.taskIds.push(taskId)
  if (input.status === 'async-blocked') return setTaskStatus(next, taskId, 'async-blocked')
  if (input.status === 'done') return archiveTask(next, taskId)
  return next
}

function removePlacement(state: SchedulerState, taskId: string): TaskOrigin | undefined {
  for (const process of state.processes) {
    const index = process.taskIds.indexOf(taskId)
    if (index >= 0) {
      process.taskIds.splice(index, 1)
      return { zone: 'process', processId: process.id, index }
    }
  }
  const backlogIndex = state.backlogIds.indexOf(taskId)
  if (backlogIndex >= 0) {
    state.backlogIds.splice(backlogIndex, 1)
    return { zone: 'backlog', index: backlogIndex }
  }
  state.blockedIds = state.blockedIds.filter(id => id !== taskId)
  state.archiveIds = state.archiveIds.filter(id => id !== taskId)
  return undefined
}

/**
 * Move a task between scheduler collections.
 * @param state - source document.
 * @param taskId - task to move.
 * @param target - destination collection and insertion index.
 * @returns a new document with status and placement updated together.
 */
export function moveTask(state: SchedulerState, taskId: string, target: MoveTarget): SchedulerState {
  const next = copyState(state)
  const task = next.tasks[taskId]
  if (task === undefined) return next
  removePlacement(next, taskId)
  if (target.zone === 'process') {
    const process = next.processes.find(item => item.id === target.processId)
    if (process === undefined) next.backlogIds.splice(Math.min(target.index, next.backlogIds.length), 0, taskId)
    else process.taskIds.splice(Math.min(target.index, process.taskIds.length), 0, taskId)
    task.status = task.status === 'done' || task.status === 'async-blocked' ? 'ready' : task.status
  } else if (target.zone === 'backlog') {
    next.backlogIds.splice(Math.min(target.index, next.backlogIds.length), 0, taskId)
    task.status = 'ready'
  } else if (target.zone === 'blocked') {
    next.blockedIds.splice(Math.min(target.index, next.blockedIds.length), 0, taskId)
    task.status = 'async-blocked'
  } else {
    next.archiveIds.splice(Math.min(target.index, next.archiveIds.length), 0, taskId)
    task.status = 'done'
  }
  task.updatedAt = new Date().toISOString()
  return next
}

/**
 * Change task status and maintain the owning collection.
 * @param state - source document.
 * @param taskId - task to update.
 * @param status - next lifecycle status.
 * @param details - optional block reason and wake condition.
 * @returns a new document with consistent status and placement.
 */
export function setTaskStatus(
  state: SchedulerState,
  taskId: string,
  status: TaskStatus,
  details: { reason?: string; wakeCondition?: string } = {},
): SchedulerState {
  if (status === 'done') return archiveTask(state, taskId)
  const next = copyState(state)
  const task = next.tasks[taskId]
  if (task === undefined) return next
  if (status === 'async-blocked') {
    const origin = removePlacement(next, taskId)
    if (origin !== undefined) task.origin = origin
    if (!next.blockedIds.includes(taskId)) next.blockedIds.push(taskId)
  } else if (task.status === 'async-blocked') {
    next.blockedIds = next.blockedIds.filter(id => id !== taskId)
    next.backlogIds.push(taskId)
    delete task.origin
  }
  task.status = status
  task.reason = details.reason?.trim() ?? (status.includes('blocked') ? task.reason : '')
  task.wakeCondition = details.wakeCondition?.trim() ?? (status.includes('blocked') ? task.wakeCondition : '')
  task.updatedAt = new Date().toISOString()
  return next
}

/**
 * Complete and archive a task.
 * @param state - source document.
 * @param taskId - task to archive.
 * @returns a new document with the task in the archive.
 */
export function archiveTask(state: SchedulerState, taskId: string): SchedulerState {
  const next = copyState(state)
  const task = next.tasks[taskId]
  if (task === undefined) return next
  removePlacement(next, taskId)
  next.archiveIds.push(taskId)
  task.status = 'done'
  task.updatedAt = new Date().toISOString()
  return next
}

/**
 * Restore an asynchronous wait to its recorded position.
 * @param state - source document.
 * @param taskId - asynchronously blocked task to wake.
 * @returns a new document with the task ready at its recorded or fallback position.
 */
export function wakeTask(state: SchedulerState, taskId: string): SchedulerState {
  const next = copyState(state)
  const task = next.tasks[taskId]
  if (task === undefined || task.status !== 'async-blocked') return next
  next.blockedIds = next.blockedIds.filter(id => id !== taskId)
  const origin = task.origin
  if (origin?.zone === 'process') {
    const process = next.processes.find(item => item.id === origin.processId)
    if (process !== undefined) process.taskIds.splice(Math.min(origin.index, process.taskIds.length), 0, taskId)
    else next.backlogIds.push(taskId)
  } else {
    next.backlogIds.splice(Math.min(origin?.index ?? next.backlogIds.length, next.backlogIds.length), 0, taskId)
  }
  task.status = 'ready'
  delete task.origin
  task.reason = ''
  task.wakeCondition = ''
  task.updatedAt = new Date().toISOString()
  return next
}

/**
 * Return the next executable task from every process.
 * @param state - scheduler document to inspect.
 * @returns each process paired with its next runnable task.
 */
export function runnableTasks(state: SchedulerState): Array<{ process: SchedulerProcess; task: SchedulerTask }> {
  return state.processes.flatMap((process) => {
    for (const taskId of process.taskIds) {
      const task = state.tasks[taskId]
      if (task === undefined || task.status === 'done') continue
      if (task.status === 'sync-blocked') return []
      return task.status === 'ready' || task.status === 'running' ? [{ process, task }] : []
    }
    return []
  })
}

/**
 * Parse imported documents without repairing or discarding execution evidence.
 * @param value - Untrusted imported JSON.
 * @returns Validated version-three document; invalid or older documents throw.
 */
export function normalizeSchedulerState(value: unknown): SchedulerState {
  return workSchedulerDocumentSchema.parse(value) as SchedulerState
}
