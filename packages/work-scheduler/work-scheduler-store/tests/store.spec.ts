/**
 * Unit harness for the work scheduler store: hand-built context with the
 * storage hub, an in-memory sqlite backend, and a mounted domain facility —
 * the Loader-based real composition lives in loader-composition.spec.ts.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { Config as SqliteConfig, SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkSchedulerStoreService, workSchedulerDomainSpec } from '../src/index.ts'
import type { SchedulerAttemptId, SchedulerCommandId, WorkSchedulerDocument } from '@deepseek-ai/dsh-host-apiproxy/api'

type TaskSessionId = NonNullable<WorkSchedulerDocument['tasks'][string]['sessionId']>
const attemptId = '00000000-0000-4000-8000-000000000001' as SchedulerAttemptId
const commandId = 'execute-1' as SchedulerCommandId

const workspaceA = 'ws-a' as unknown as import('@deepseek-ai/dsh-host-apiproxy/api').WorkspaceId
const workspaceB = 'ws-b' as unknown as import('@deepseek-ai/dsh-host-apiproxy/api').WorkspaceId

function document(tasks: string[], sessionId?: TaskSessionId): WorkSchedulerDocument {
  return {
    version: 3, revision: 0, attempts: {},
    processes: [],
    tasks: Object.fromEntries(tasks.map((description, index) => [String(index), {
      id: String(index), description, acceptance: [], status: 'ready', reason: '', wakeCondition: '',
      ...sessionId === undefined ? {} : { sessionId },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }])),
    backlogIds: tasks.map((_, index) => String(index)),
    blockedIds: [],
    archiveIds: [],
  }
}

/** Boot the hub, sqlite backend, domain facility, and the store service. */
async function harness(): Promise<{ ctx: Context; store: WorkSchedulerStoreService; facility: DomainFacility }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend(new SqliteConfig({ path: ':memory:' }))
  ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(WorkSchedulerStoreService)
  return { ctx, store: ctx.workSchedulerStore as WorkSchedulerStoreService, facility }
}

describe('work scheduler store', () => {
  it('loads the empty document for a workspace with no stored document', async () => {
    const { ctx, store } = await harness()
    try {
      expect(await store.load(workspaceA)).toEqual({ document: document([]) })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('round-trips one document per workspace, isolated between workspaces', async () => {
    const { ctx, store } = await harness()
    try {
      const a = document(['检查构建'])
      const b = document(['写文档'])
      const savedA = await store.save(workspaceA, a)
      const savedB = await store.save(workspaceB, b)
      expect(await store.load(workspaceA)).toEqual({ document: savedA })
      expect(await store.load(workspaceB)).toEqual({ document: savedB })
      await expect(store.save(workspaceA, b)).rejects.toThrow('看板已被更新')
      const replaced = await store.save(workspaceA, { ...b, revision: savedA.revision })
      expect(await store.load(workspaceA)).toEqual({ document: replaced })
      expect(await store.load(workspaceB)).toEqual({ document: savedB })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('round-trips a task Session binding', async () => {
    const { ctx, store } = await harness()
    try {
      const bound = document(['检查会话'], 'session-1' as TaskSessionId)
      const saved = await store.save(workspaceA, bound)
      expect(await store.load(workspaceA)).toEqual({ document: saved })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects planning writes that rewrite execution records', async () => {
    const { ctx, store } = await harness()
    try {
      const saved = await store.save(workspaceA, document(['检查构建']))
      await store.update(workspaceA, (current) => {
        current.attempts[attemptId] = {
          id: attemptId,
          taskId: '0',
          commandId,
          status: 'running',
          description: '检查构建',
          acceptance: [],
          feedback: '',
          sessionId: 'session-1' as TaskSessionId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }
      })
      const current = (await store.load(workspaceA)).document
      await expect(store.save(workspaceA, { ...saved, revision: current.revision, attempts: {} })).rejects.toThrow(
        '执行和审查记录只能通过执行命令修改',
      )
      expect((await store.load(workspaceA)).document.attempts).not.toEqual({})
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('replaces one Workspace document with an empty board and leaves others untouched', async () => {
    const { ctx, store } = await harness()
    try {
      const savedA = await store.save(workspaceA, document(['检查构建']))
      const savedB = await store.save(workspaceB, document(['写文档']))
      await store.update(workspaceA, (current) => {
        current.attempts[attemptId] = {
          id: attemptId,
          taskId: '0',
          commandId,
          status: 'running',
          description: '检查构建',
          acceptance: [],
          feedback: '',
          sessionId: 'session-1' as TaskSessionId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }
      })
      const current = (await store.load(workspaceA)).document
      const cleared = await store.save(workspaceA, {
        version: 3, revision: current.revision, attempts: {}, processes: [], tasks: {},
        backlogIds: [], blockedIds: [], archiveIds: [],
      })
      expect(cleared.revision).toBe(current.revision + 1)
      expect(cleared.tasks).toEqual({})
      expect(cleared.attempts).toEqual({})
      expect((await store.load(workspaceB)).document.tasks).toEqual(savedB.tasks)
      expect(savedA.tasks['0']?.description).toBe('检查构建')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('closes the domain with the service fiber', async () => {
    const { ctx, facility } = await harness()
    expect(facility.get(workSchedulerDomainSpec.name)).toBeDefined()
    await ctx.fiber.dispose()
    expect(facility.get(workSchedulerDomainSpec.name)).toBeUndefined()
  })

  it('admits one concurrent revision and rejects the stale writer without losing data', async () => {
    const { ctx, store } = await harness()
    try {
      const results = await Promise.allSettled([
        store.save(workspaceA, document(['first'])),
        store.save(workspaceA, document(['second'])),
      ])
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
      const loaded = (await store.load(workspaceA)).document
      expect(loaded.revision).toBe(1)
      expect(loaded.tasks['0']?.description).toBe('first')
      loaded.tasks['0']!.description = 'unpersisted edit'
      expect((await store.load(workspaceA)).document.tasks['0']?.description).toBe('first')
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects duplicate placements and resumes writing after a rejected mutation', async () => {
    const { ctx, store } = await harness()
    try {
      const invalid = document(['task'])
      invalid.backlogIds.push('0')
      await expect(store.save(workspaceA, invalid)).rejects.toThrow('exactly one placement')
      expect((await store.save(workspaceA, document(['valid']))).revision).toBe(1)
      await expect(store.update(workspaceA, (current) => { delete current.tasks['0'] })).rejects.toThrow('Unknown placed task')
      expect((await store.load(workspaceA)).document.tasks['0']?.description).toBe('valid')
    } finally { await ctx.fiber.dispose() }
  })
})
