/** Interaction and durable document store for the work scheduler. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  addProcess, addTask, createSchedulerState, moveTask, normalizeSchedulerState,
  renameProcess, setTaskStatus, wakeTask,
  type AddTaskInput, type MoveTarget, type SchedulerState, type TaskStatus,
} from './scheduler.ts'

export const STORAGE_KEY = 'dsh.work-scheduler.v1'

export interface WorkSchedulerState {
  open: boolean
  helpOpen: boolean
  document: SchedulerState
}

type WorkSchedulerActions = {
  open: (draft: WorkSchedulerState) => void
  close: (draft: WorkSchedulerState) => void
  toggleHelp: (draft: WorkSchedulerState) => void
  replace: (draft: WorkSchedulerState, state: SchedulerState) => void
  reset: (draft: WorkSchedulerState) => void
  addProcess: (draft: WorkSchedulerState, name: string, id?: string) => void
  renameProcess: (draft: WorkSchedulerState, processId: string, name: string) => void
  addTask: (draft: WorkSchedulerState, input: AddTaskInput) => void
  moveTask: (draft: WorkSchedulerState, taskId: string, target: MoveTarget) => void
  setTaskStatus: (draft: WorkSchedulerState, taskId: string, status: TaskStatus, details?: {
    reason?: string
    wakeCondition?: string
  }) => void
  wakeTask: (draft: WorkSchedulerState, taskId: string) => void
}

function load(storage: Pick<Storage, 'getItem'>): SchedulerState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    return raw === null ? createSchedulerState() : normalizeSchedulerState(JSON.parse(raw))
  } catch {
    return createSchedulerState()
  }
}

/** Create a scheduler store bound to browser storage. */
export function createWorkSchedulerStore(storage: Pick<Storage, 'getItem'> = localStorage): EngineStoreHandle<WorkSchedulerState, WorkSchedulerActions> {
  return defineStore({
    init: () => ({ open: false, helpOpen: false, document: load(storage) }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false; draft.helpOpen = false },
      toggleHelp: (draft) => { draft.helpOpen = !draft.helpOpen },
      replace: (draft, state) => { draft.document = normalizeSchedulerState(state) },
      reset: (draft) => { draft.document = createSchedulerState() },
      addProcess: (draft, name, id) => { draft.document = addProcess(draft.document, name, id) },
      renameProcess: (draft, processId, name) => { draft.document = renameProcess(draft.document, processId, name) },
      addTask: (draft, input) => { draft.document = addTask(draft.document, input) },
      moveTask: (draft, taskId, target) => { draft.document = moveTask(draft.document, taskId, target) },
      setTaskStatus: (draft, taskId, status, details) => { draft.document = setTaskStatus(draft.document, taskId, status, details) },
      wakeTask: (draft, taskId) => { draft.document = wakeTask(draft.document, taskId) },
    },
  })
}
