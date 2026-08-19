/** Pure state transitions for the browser work scheduler. */

export type TaskStatus = 'ready' | 'running' | 'sync-blocked' | 'async-blocked' | 'done'

export interface TaskOrigin {
  zone: 'process' | 'backlog'
  processId?: string
  index: number
}

export interface SchedulerTask {
  id: string
  description: string
  status: TaskStatus
  reason: string
  wakeCondition: string
  origin?: TaskOrigin
  createdAt: string
  updatedAt: string
}

export interface SchedulerProcess {
  id: string
  name: string
  taskIds: string[]
}

export interface SchedulerState {
  version: 1
  processes: SchedulerProcess[]
  tasks: Record<string, SchedulerTask>
  backlogIds: string[]
  blockedIds: string[]
  archiveIds: string[]
}

export interface AddTaskInput {
  id?: string
  description: string
  processId?: string
  status?: TaskStatus
}

export interface MoveTarget {
  zone: 'process' | 'backlog' | 'blocked' | 'archive'
  processId?: string
  index: number
}

const VALID_STATUS = new Set<TaskStatus>(['ready', 'running', 'sync-blocked', 'async-blocked', 'done'])

/** Create an empty scheduler document. */
export function createSchedulerState(): SchedulerState {
  return { version: 1, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [] }
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

/** Add one execution thread. */
export function addProcess(state: SchedulerState, name: string, processId = id('thread')): SchedulerState {
  const next = copyState(state)
  next.processes.push({ id: processId, name: name.trim() || `线程 ${next.processes.length + 1}`, taskIds: [] })
  return next
}

/** Rename an execution thread. */
export function renameProcess(state: SchedulerState, processId: string, name: string): SchedulerState {
  const next = copyState(state)
  const process = next.processes.find(item => item.id === processId)
  if (process !== undefined && name.trim() !== '') process.name = name.trim()
  return next
}

/** Add one task to a thread or the backlog. */
export function addTask(state: SchedulerState, input: AddTaskInput): SchedulerState {
  const next = copyState(state)
  const taskId = input.id ?? id('task')
  const now = new Date().toISOString()
  next.tasks[taskId] = {
    id: taskId,
    description: input.description.trim() || '未命名任务',
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

/** Move a task between scheduler collections. */
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

/** Change task status and maintain the owning collection. */
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

/** Complete and archive a task. */
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

/** Restore an asynchronous wait to its recorded position. */
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

/** Return the next executable task from every thread. */
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

/** Validate and repair scheduler JSON imported from durable browser storage. */
export function normalizeSchedulerState(value: unknown): SchedulerState {
  if (value === null || typeof value !== 'object') return createSchedulerState()
  const input = value as Partial<SchedulerState>
  const rawTasks = input.tasks !== null && typeof input.tasks === 'object' ? input.tasks : {}
  const tasks: Record<string, SchedulerTask> = {}
  for (const [taskId, raw] of Object.entries(rawTasks)) {
    if (raw === null || typeof raw !== 'object') continue
    const item = raw as Partial<SchedulerTask>
    const now = new Date().toISOString()
    tasks[taskId] = {
      id: taskId,
      description: text(item.description, '未命名任务'),
      status: VALID_STATUS.has(item.status as TaskStatus) ? item.status as TaskStatus : 'ready',
      reason: typeof item.reason === 'string' ? item.reason : '',
      wakeCondition: typeof item.wakeCondition === 'string' ? item.wakeCondition : '',
      createdAt: text(item.createdAt, now),
      updatedAt: text(item.updatedAt, now),
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
  const processes = Array.isArray(input.processes) ? input.processes.flatMap((raw, index) => {
    if (raw === null || typeof raw !== 'object') return []
    const process = raw as Partial<SchedulerProcess>
    return [{ id: text(process.id, id('thread')), name: text(process.name, `线程 ${index + 1}`), taskIds: take(process.taskIds, task => task.status !== 'done' && task.status !== 'async-blocked') }]
  }) : []
  const blockedIds = take(input.blockedIds, task => task.status === 'async-blocked')
  const archiveIds = take(input.archiveIds, task => task.status === 'done')
  const backlogIds = take(input.backlogIds, task => task.status !== 'done' && task.status !== 'async-blocked')
  for (const [taskId, task] of Object.entries(tasks)) {
    if (placed.has(taskId)) continue
    if (task.status === 'done') archiveIds.push(taskId)
    else if (task.status === 'async-blocked') blockedIds.push(taskId)
    else backlogIds.push(taskId)
  }
  return { version: 1, processes, tasks, backlogIds, blockedIds, archiveIds }
}
