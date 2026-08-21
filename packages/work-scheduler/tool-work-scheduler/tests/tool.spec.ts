import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentCancelCause, InboxTarget } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { WorkSchedulerDocument, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import * as ToolWorkScheduler from '../src/index.ts'
import { registerWorkSchedulerTool } from '../src/tool.ts'

const signal = new AbortController().signal
const contexts: Context[] = []

function stubAgent(ctx: Context, rawId: string): { agent: Agent; disposeScope: () => Promise<void> } {
  const session = ctx.sessions.create(SessionId(rawId))
  const agent = {} as Agent
  const scope = createScope(ctx, agent)
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox,
    status: 'idle',
    ctx: scope.ctx,
    send(_message: UserMessage, _target: InboxTarget, _wakeup: boolean) {},
    runMaintenance: task => task(signal),
    cancel(_cause: AgentCancelCause) {},
    whenIdle: () => Promise.resolve(),
    followup(_message: UserMessage) {},
    steer(_message: UserMessage) {},
    inject(_message: UserMessage) {},
  } satisfies Agent)
  return { agent, disposeScope: () => scope.dispose() }
}

async function harness(member = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  let scoped: ReturnType<typeof stubAgent> | undefined
  const fixtureFiber = ctx.plugin({
    inject: ['sessions', 'tools'],
    apply(child: Context) {
      scoped = stubAgent(child, 'session-a')
    },
  })
  await fixtureFiber
  if (scoped === undefined) throw new Error('fixture dependencies did not activate')
  const { agent, disposeScope } = scoped
  const workspaceId = 'workspace-a' as WorkspaceId
  const workspace = {
    id: workspaceId,
    title: 'Harness',
    path: '/workspace',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    sessionIds: member ? [agent.id] : [],
  } as unknown as Workspace
  let document: WorkSchedulerDocument = {
    version: 2, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [],
  }
  let saves = 0
  ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
  ctx.provide('workSchedulerStore', {
    async load(id: WorkspaceId) {
      expect(id).toBe(workspaceId)
      return { document }
    },
    async save(id: WorkspaceId, next: WorkSchedulerDocument) {
      expect(id).toBe(workspaceId)
      saves += 1
      document = next
    },
  })
  const disposeTool = registerWorkSchedulerTool(ctx, agent.ctx, agent)
  return {
    ctx,
    agent,
    disposeScope: async () => {
      await disposeScope()
      await fixtureFiber.dispose()
    },
    disposeTool,
    workspaceId,
    document: () => document,
    saves: () => saves,
  }
}

async function execute(ctx: Context, agent: Agent, args: unknown): Promise<ToolExecutionResult> {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal,
    callId: CallId(`call-${Math.random()}`),
    name: 'sync_work_scheduler',
    arguments: args,
    agent,
  }))
}

function value(result: ToolExecutionResult): unknown {
  expect(result.isError).toBe(false)
  return result.isError ? undefined : result.value
}

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('sync_work_scheduler tool', () => {
  it('keeps the Loader-safe function-plugin export shape', () => {
    expect('default' in ToolWorkScheduler).toBe(false)
    expect(ToolWorkScheduler.name).toBe('tool-work-scheduler')
    expect(ToolWorkScheduler.inject).toEqual([
      'agents', 'tools', 'workspaceRegistry', 'workSchedulerStore',
    ])
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapExports = (value: unknown): unknown => loader.unwrapExports(value)
    expect(unwrapExports(ToolWorkScheduler)).toBe(ToolWorkScheduler)
  })

  it('mounts for a newly published root Agent and unloads with the plugin', async () => {
    const test = await harness()
    test.disposeTool()
    const fiber = await test.ctx.plugin(ToolWorkScheduler)
    const disposeAgent = test.ctx.agents.register(test.agent)
    expect(test.ctx.tools.schemas()).toEqual([])
    expect(test.ctx.tools.schemas(test.agent).map(schema => schema.name)).toEqual(['sync_work_scheduler'])
    await fiber.dispose()
    expect(test.ctx.tools.schemas(test.agent)).toEqual([])
    disposeAgent()
    await test.disposeScope()
  })

  it('mounts for a root Agent that already exists when the plugin loads', async () => {
    const test = await harness()
    test.disposeTool()
    const disposeAgent = test.ctx.agents.register(test.agent)
    const fiber = await test.ctx.plugin(ToolWorkScheduler)
    expect(test.ctx.tools.schemas(test.agent).map(schema => schema.name)).toEqual(['sync_work_scheduler'])
    await fiber.dispose()
    disposeAgent()
    await test.disposeScope()
  })

  it('is visible only to its Agent scope and is disposed with its owner', async () => {
    const test = await harness()
    expect(test.ctx.tools.schemas()).toEqual([])
    expect(test.ctx.tools.schemas(test.agent).map(schema => schema.name)).toEqual(['sync_work_scheduler'])
    test.disposeTool()
    expect(test.ctx.tools.schemas(test.agent)).toEqual([])
    await test.disposeScope()
  })

  it('resolves the current Session workspace and saves a bound SOP projection', async () => {
    const test = await harness()
    const result = await execute(test.ctx, test.agent, {
      workflow: '开发 SOP',
      stages: [
        { key: 'intake', name: '需求确认', status: 'completed' },
        { key: 'implement', name: '实现', status: 'in_progress' },
      ],
    })

    expect(value(result)).toEqual({
      workspaceId: test.workspaceId,
      sessionId: test.agent.id,
      processId: `sop:${test.agent.id}`,
      pending: 0,
      inProgress: 1,
      completed: 1,
    })
    expect(test.saves()).toBe(1)
    expect(Object.values(test.document().tasks).map(task => task.sessionId)).toEqual([
      test.agent.id,
      test.agent.id,
    ])
  })

  it('fails without writing when the Session is not assigned to a Workspace', async () => {
    const test = await harness(false)
    const result = await execute(test.ctx, test.agent, {
      workflow: '开发 SOP',
      stages: [{ key: 'intake', name: '需求确认', status: 'in_progress' }],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type).toBe('text')
    if (result.content[0]?.type !== 'text') throw new Error('expected text error content')
    expect(result.content[0].text).toContain('is not assigned to a Workspace')
    expect(test.saves()).toBe(0)
  })

  it('rejects an empty workflow snapshot without writing', async () => {
    const test = await harness()
    const result = await execute(test.ctx, test.agent, {
      workflow: '开发 SOP',
      stages: [],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type).toBe('text')
    if (result.content[0]?.type !== 'text') throw new Error('expected text error content')
    expect(result.content[0].text).toContain('stages must contain the complete workflow')
    expect(test.saves()).toBe(0)
  })
})
