/** Browser plugin for the local work scheduler surface. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SchedulerPanel, SchedulerTrigger } from './WorkScheduler.tsx'
import { createWorkSchedulerStore } from './store.ts'

/** Services required by the two scheduler slot contributions. */
export const inject = ['slots']

/** Register the sidebar entry and frame overlay against one shared store. */
export function apply(ctx: ClientContext): void {
  const store = createWorkSchedulerStore()
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'work-scheduler', order: 10, store,
  }, SchedulerTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'work-scheduler', order: 100, store,
  }, SchedulerPanel))
}
