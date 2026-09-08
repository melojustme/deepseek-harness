/** Browser contributions for native task execution and review. */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { WorkSchedulerRuntime, type ClientContext, type SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SchedulerPanel, SchedulerTrigger, type WorkSchedulerInjected } from './WorkScheduler.tsx'
import { createWorkSchedulerStore } from './store.ts'

export { Config } from '../config.ts'
import type { Config } from '../config.ts'
/** Services read by the scheduler contribution. */
export const inject = ['slots', 'connection', 'sessions', 'conversation']

/**
 * Bind the runtime's observable document and command callbacks to native slots.
 * @param ctx - Client composition context.
 * @param config - Validated refresh settings.
 */
export function apply(ctx: ClientContext, config: Config): void {
  const store = createWorkSchedulerStore()
  const sessions = ctx.get('sessions') as SessionRuntime
  const connection = ctx.get('connection') as ConnectionHandle
  const runtime = new WorkSchedulerRuntime(connection.api, config.refreshIntervalMs)
  ctx.effect(() => () => { runtime.dispose() }, 'work-scheduler.runtime')
  ctx.on('connection/reset', () => { runtime.setConnected(true) })
  ctx.on('connection/lost', () => { runtime.setConnected(false) })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'work-scheduler', order: 10, store }, SchedulerTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'work-scheduler', order: 100, store,
    inject: (): WorkSchedulerInjected => ({
      hooks: { scheduler: runtime },
      selectWorkspace: id => { runtime.select(id) },
      refresh: () => runtime.refresh(),
      save: document => runtime.edit(() => document),
      command: command => runtime.command(command),
      createSession: async (workspaceId, draft) => {
        const id = await sessions.create({ workspaceId })
        const scope = sessions.scope(id)
        if (scope === undefined) throw new Error('新会话未能创建输入范围。')
        ctx.conversation.input.for(scope).setDraft(draft)
        return id
      },
      openSession: id => { ctx.sessions.open(id) },
    }),
  }, SchedulerPanel))
}
