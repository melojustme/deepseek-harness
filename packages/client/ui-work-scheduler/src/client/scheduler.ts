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

const VALID_STATUS = new Set<TaskStatus>(['ready', 'running', 'sync-blocked', 'async-blocked', 'done'])

/**
 * Create an empty scheduler document.
 * @returns a version 2 document with no processes or tasks.
 */
export function createSchedulerState(): SchedulerState {
  return { version: 2, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [] }
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

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function taskOrigin(value: unknown): TaskOrigin | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const input = value as Partial<TaskOrigin>
  const index = input.index
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined
  if (input.zone === 'backlog') return { zone: 'backlog', index }
  if (input.zone !== 'process' || typeof input.processId !== 'string' || input.processId === '') return undefined
  return { zone: 'process', processId: input.processId, index }
}

/**
 * Validate and repair an imported or Host-loaded scheduler document.
 * @param value - untrusted JSON-compatible input.
 * @returns a version 2 document with unique, status-consistent task placements.
 */
export function normalizeSchedulerState(value: unknown): SchedulerState {
  const input = record(value)
  if (input === undefined || input.version !== 2) return createSchedulerState()
  const rawTasks = record(input.tasks) ?? {}
  const tasks: Record<string, SchedulerTask> = {}
  for (const [taskId, raw] of Object.entries(rawTasks)) {
    const item = record(raw)
    if (item === undefined) continue
    const now = new Date().toISOString()
    const status = VALID_STATUS.has(item.status as TaskStatus) ? item.status as TaskStatus : 'ready'
    const origin = status === 'async-blocked' ? taskOrigin(item.origin) : undefined
    tasks[taskId] = {
      id: taskId,
      description: text(item.description, '未命名任务'),
      ...typeof item.sessionId === 'string' && item.sessionId !== '' ? { sessionId: item.sessionId as SessionId } : {},
      status,
      reason: typeof item.reason === 'string' ? item.reason : '',
      wakeCondition: typeof item.wakeCondition === 'string' ? item.wakeCondition : '',
      createdAt: text(item.createdAt, now),
      updatedAt: text(item.updatedAt, now),
      ...origin === undefined ? {} : { origin },
    }
  }
  const placed = new Set<string>()
  const take = (ids: unknown, accept?: (task: SchedulerTask) => boolean): string[] => {
    if (!Array.isArray(ids)) return []
    return ids.filter((taskId): taskId is string => {
      if (typeof taskId !== 'string' || placed.has(taskId)) return false
      const task = tasks[taskId]
      if (task === undefined || (accept !== undefined && !accept(task))) return false
      placed.add(taskId)
      return true
    })
  }
  const rawProcesses = Array.isArray(input.processes) ? input.processes as unknown[] : []
  const processes = rawProcesses.flatMap((raw, index) => {
    const process = record(raw)
    if (process === undefined) return []
    return [{ id: text(process.id, id('thread')), name: text(process.name, `线程 ${index + 1}`), taskIds: take(process.taskIds, task => task.status !== 'done' && task.status !== 'async-blocked') }]
  })
  const blockedIds = take(input.blockedIds, task => task.status === 'async-blocked')
  const archiveIds = take(input.archiveIds, task => task.status === 'done')
  const backlogIds = take(input.backlogIds, task => task.status !== 'done' && task.status !== 'async-blocked')
  for (const [taskId, task] of Object.entries(tasks)) {
    if (placed.has(taskId)) continue
    if (task.status === 'done') archiveIds.push(taskId)
    else if (task.status === 'async-blocked') blockedIds.push(taskId)
    else backlogIds.push(taskId)
  }
  return { version: 2, processes, tasks, backlogIds, blockedIds, archiveIds }
}
