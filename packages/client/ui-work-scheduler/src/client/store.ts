/** Shared viewing state for the scheduler's sidebar action and overlay. */
import type { WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** Default personal kanban versus the optional execution/review board. */
export type SchedulerView = 'planning' | 'execution'

interface ViewState {
  open: boolean
  view: SchedulerView
  selected: string
  workspaceId: WorkspaceId | undefined
}

type ViewActions = {
  open: (draft: ViewState) => void
  close: (draft: ViewState) => void
  select: (draft: ViewState, id: string) => void
  workspace: (draft: ViewState, id: WorkspaceId) => void
  view: (draft: ViewState, view: SchedulerView) => void
}

/**
 * Create view state; documents and execution remain in the runtime object layer.
 * @returns Uninstantiated slot store handle.
 */
export function createWorkSchedulerStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({
    init: () => ({
      open: false,
      view: 'planning' as SchedulerView,
      selected: '',
      workspaceId: undefined as WorkspaceId | undefined,
    }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false },
      select: (draft, id: string) => { draft.selected = id },
      workspace: (draft, id: WorkspaceId) => { draft.workspaceId = id },
      view: (draft, view: SchedulerView) => { draft.view = view },
    },
  })
}
