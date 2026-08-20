/** Browser plugin for the work scheduler surface. */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { normalizeSchedulerState, type SchedulerState } from './scheduler.ts'
import { SchedulerPanel, SchedulerTrigger, type WorkSchedulerInjected } from './WorkScheduler.tsx'
import { createWorkSchedulerStore } from './store.ts'

/** Services required by the two scheduler slot contributions. */
export const inject = ['slots', 'connection', 'sessions']

/**
 * Register the sidebar entry and frame overlay against one shared store, with
 * gateway-bound document persistence injected into the panel: the durable
 * copy lives in the host store (`@deepseek-ai/dsh-work-scheduler-store`),
 * keyed by workspace.
 */
export function apply(ctx: ClientContext): void {
  const store = createWorkSchedulerStore()
  const api = (ctx.get('connection') as ConnectionHandle).api
  const sessions = ctx.get('sessions') as unknown as ISessions
  const loadDocument: WorkSchedulerInjected['loadDocument'] = async (workspaceId: WorkspaceId) => {
    const response = await api.workScheduler.load({ workspaceId })
    if (!response.result.ok) throw new Error(response.result.error.message)
    return normalizeSchedulerState(response.result.value.document)
  }
  const saveDocument: WorkSchedulerInjected['saveDocument'] = async (workspaceId: WorkspaceId, document: SchedulerState) => {
    const response = await api.workScheduler.save({ workspaceId, document })
    if (!response.result.ok) throw new Error(response.result.error.message)
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'work-scheduler', order: 10, store,
  }, SchedulerTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'work-scheduler', order: 100, store,
    inject: (): WorkSchedulerInjected => ({
      loadDocument,
      saveDocument,
      openSession: (sessionId) => { sessions.open(sessionId) },
    }),
  }, SchedulerPanel))
}
