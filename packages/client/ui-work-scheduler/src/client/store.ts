/** Interaction and durable document store for the work scheduler. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  addProcess, addTask, createSchedulerState, moveTask, normalizeSchedulerState,
  renameProcess, setTaskStatus, wakeTask,
  type AddTaskInput, type MoveTarget, type SchedulerState, type TaskStatus,
} from './scheduler.ts'

/** Durable load/save state controlling whether scheduler edits are enabled. */
export type WorkSchedulerLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Browser store state shared by the scheduler trigger and panel. */
export interface WorkSchedulerState {
  open: boolean
  helpOpen: boolean
  document: SchedulerState
  /** Durable-load lifecycle: idle before the first load, error when the host is unreachable. */
  status: WorkSchedulerLoadStatus
}

type WorkSchedulerActions = {
  open: (draft: WorkSchedulerState) => void
  close: (draft: WorkSchedulerState) => void
  toggleHelp: (draft: WorkSchedulerState) => void
  setStatus: (draft: WorkSchedulerState, status: WorkSchedulerLoadStatus) => void
  replace: (draft: WorkSchedulerState, state: unknown) => void
  reset: (draft: WorkSchedulerState) => void
  addProcess: (draft: WorkSchedulerState, name: string, id?: string) => void
  renameProcess: (draft: WorkSchedulerState, processId: string, name: string) => void
  addTask: (draft: WorkSchedulerState, input: AddTaskInput) => void
  moveTask: (draft: WorkSchedulerState, taskId: string, target: MoveTarget) => void
  setTaskStatus: (
    draft: WorkSchedulerState,
    taskId: string,
    status: TaskStatus,
    details?: { reason?: string; wakeCondition?: string },
  ) => void
  wakeTask: (draft: WorkSchedulerState, taskId: string) => void
}

/**
 * Create the scheduler store. Persistence is not the store's business: the
 * plugin wires `load`/`save` through the gateway, and the panel drives them —
 * the store only holds the in-memory document and its load lifecycle.
 * @returns an uninstantiated store handle for both scheduler slot contributions.
 */
export function createWorkSchedulerStore(): EngineStoreHandle<WorkSchedulerState, WorkSchedulerActions> {
  return defineStore({
    init: () => ({ open: false, helpOpen: false, document: createSchedulerState(), status: 'idle' }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false; draft.helpOpen = false },
      toggleHelp: (draft) => { draft.helpOpen = !draft.helpOpen },
      setStatus: (draft, status) => { draft.status = status },
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
