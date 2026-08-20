import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type {
  RpcRequest, WorkSchedulerDocument, WorkSchedulerStore, WorkspaceId,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { schedulerTaskSchema } from '@deepseek-ai/dsh-host-apiproxy/api/work-scheduler.schema'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const WORKSPACE_ID = 'ws-1' as WorkspaceId
const DOCUMENT: WorkSchedulerDocument = {
  version: 2,
  processes: [],
  tasks: {},
  backlogIds: [],
  blockedIds: [],
  archiveIds: [],
}

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('work-scheduler-test'), payload }
}

async function api(ctx: Context) {
  await ctx.plugin(UserQuestionService)
  return createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test' }),
    cwd: '/tmp',
  }).workScheduler
}

describe('work scheduler API', () => {
  it('validates and retains an optional non-empty Session binding', () => {
    const task = {
      id: 'task-1', description: '检查会话', status: 'ready' as const,
      reason: '', wakeCondition: '', sessionId: 'session-1',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }

    expect(schedulerTaskSchema.parse(task)).toEqual(task)
    expect(schedulerTaskSchema.safeParse({ ...task, sessionId: '' }).success).toBe(false)
  })

  it('fails loudly when the store service is absent', async () => {
    const scheduler = await api(new Context())
    const response = await scheduler.load(request({ workspaceId: WORKSPACE_ID }))

    expect(response.result).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: 'work scheduler store is absent: this deployment does not mount @deepseek-ai/dsh-work-scheduler-store in its composition',
        details: {},
      },
    })
  })

  it('delegates load and save to the store', async () => {
    const ctx = new Context()
    const load = vi.fn(async () => ({ document: DOCUMENT }))
    const save = vi.fn(async () => {})
    const store: WorkSchedulerStore = {
      load,
      save,
    }
    ctx.provide('workSchedulerStore', store)

    const scheduler = await api(ctx)
    expect((await scheduler.load(request({ workspaceId: WORKSPACE_ID }))).result)
      .toEqual({ ok: true, value: { document: DOCUMENT } })
    expect((await scheduler.save(request({ workspaceId: WORKSPACE_ID, document: DOCUMENT }))).result)
      .toEqual({ ok: true, value: {} })
    expect(load).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(save).toHaveBeenCalledWith(WORKSPACE_ID, DOCUMENT)
  })

  it('maps store failures to internal errors', async () => {
    const ctx = new Context()
    ctx.provide('workSchedulerStore', {
      load: async () => { throw new Error('read failed') },
      save: async () => { throw new Error('write failed') },
    })

    const scheduler = await api(ctx)
    const loaded = await scheduler.load(request({ workspaceId: WORKSPACE_ID }))
    const saved = await scheduler.save(request({ workspaceId: WORKSPACE_ID, document: DOCUMENT }))
    expect(loaded.result).toMatchObject({ ok: false, error: { code: 'internal', message: 'work scheduler load failed: read failed' } })
    expect(saved.result).toMatchObject({ ok: false, error: { code: 'internal', message: 'work scheduler save failed: write failed' } })
  })
})
