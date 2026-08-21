/**
 * Agent-scoped development-SOP synchronization for the work scheduler.
 * @module @deepseek-ai/dsh-tool-work-scheduler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { registerWorkSchedulerTool } from './tool.ts'

export { syncSopStages } from './sync.ts'
export type { SopStage, SopStageStatus, SopStageSync } from './sync.ts'
export { registerWorkSchedulerTool } from './tool.ts'

/** Cordis function-plugin name. */
export const name = 'tool-work-scheduler'
/** Services required before root Agents receive the synchronization tool. */
export const inject = ['agents', 'tools', 'workspaceRegistry', 'workSchedulerStore']

type AgentCleanup = () => void | Promise<void>

/** Install one exact scoped tool for every current and future root Agent. */
export function apply(ctx: Context): void {
  const cleanups = new Map<Agent, AgentCleanup>()
  let stopping = false

  ctx.effect(() => {
    const mount = (agent: Agent): void => {
      if (stopping || cleanups.has(agent) || !ctx.agents.roots().includes(agent)) return
      const cleanup = agent.ctx.effect(() => {
        const disposeTool = registerWorkSchedulerTool(ctx, agent.ctx, agent)
        return () => {
          disposeTool()
          if (cleanups.get(agent) === cleanup) cleanups.delete(agent)
        }
      }, 'tool-work-scheduler.agentTool()')
      cleanups.set(agent, cleanup)
    }
    const stopCreated = ctx.on('agent/created', ({ agent }) => { mount(agent) })
    for (const agent of ctx.agents.roots()) mount(agent)
    return async () => {
      stopping = true
      stopCreated()
      const owned = [...cleanups.values()]
      cleanups.clear()
      await Promise.allSettled(owned.map(cleanup => Promise.resolve(cleanup())))
    }
  }, 'tool-work-scheduler.lifecycle()')
}
