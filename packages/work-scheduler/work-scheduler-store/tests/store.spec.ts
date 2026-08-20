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
import type { WorkSchedulerDocument } from '@deepseek-ai/dsh-host-apiproxy/api'

type TaskSessionId = NonNullable<WorkSchedulerDocument['tasks'][string]['sessionId']>

const workspaceA = 'ws-a' as unknown as import('@deepseek-ai/dsh-host-apiproxy/api').WorkspaceId
const workspaceB = 'ws-b' as unknown as import('@deepseek-ai/dsh-host-apiproxy/api').WorkspaceId

function document(tasks: string[], sessionId?: TaskSessionId): WorkSchedulerDocument {
  return {
    version: 2,
    processes: [],
    tasks: Object.fromEntries(tasks.map((description, index) => [String(index), {
      id: String(index), description, status: 'ready', reason: '', wakeCondition: '',
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
      await store.save(workspaceA, a)
      await store.save(workspaceB, b)
      expect(await store.load(workspaceA)).toEqual({ document: a })
      expect(await store.load(workspaceB)).toEqual({ document: b })
      // Overwrite semantics: the last save wins for one workspace.
      await store.save(workspaceA, b)
      expect(await store.load(workspaceA)).toEqual({ document: b })
      expect(await store.load(workspaceB)).toEqual({ document: b })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('round-trips a task Session binding', async () => {
    const { ctx, store } = await harness()
    try {
      const bound = document(['检查会话'], 'session-1' as TaskSessionId)
      await store.save(workspaceA, bound)
      expect(await store.load(workspaceA)).toEqual({ document: bound })
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
})
