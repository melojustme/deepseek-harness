/**
 * Real-composition guard: the store boots from a test-only cordis.yml through
 * the actual Loader, persists a document through the sqlite backend, and a
 * second composition on the same database file reads it back — the durable
 * contract the product surface relies on. Only the medium (a temp file) and
 * the two sqlite-backed boots are real; everything else is the shipped code.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkSchedulerStoreService from '../src/index.ts'
import type { WorkSchedulerDocument, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const DOCUMENT: WorkSchedulerDocument = {
  version: 2,
  processes: [{ id: 'p1', name: '发布', taskIds: ['t1'] }],
  tasks: { t1: { id: 't1', description: '检查构建', status: 'ready', reason: '', wakeCondition: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } },
  backlogIds: [], blockedIds: [], archiveIds: [],
}

/** Boot one composition on a fresh temp dir and the given sqlite file. */
async function loadComposition(
  dbPath: string,
  consumer: { name: string; apply: (ctx: Context) => void },
): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-work-scheduler-store-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: storage',
    '  name: \'@deepseek-ai/dsh-storage\'',
    '- id: storage-sqlite',
    '  name: \'@deepseek-ai/dsh-storage-sqlite\'',
    '  config:',
    `    path: ${JSON.stringify(dbPath)}`,
    '- id: storage-domain',
    '  name: \'@deepseek-ai/dsh-storage-domain\'',
    '  config:',
    '    backend: sqlite',
    '- id: work-scheduler-store',
    '  name: \'@deepseek-ai/dsh-work-scheduler-store\'',
    `- id: ${consumer.name}`,
    `  name: test-${consumer.name}`,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-sqlite', { name: StorageSqlite.name, inject: StorageSqlite.inject, Config: StorageSqlite.Config, apply: StorageSqlite.apply }],
    ['@deepseek-ai/dsh-storage-domain', { name: StorageDomain.name, inject: StorageDomain.inject, Config: StorageDomain.Config, apply: StorageDomain.apply }],
    ['@deepseek-ai/dsh-work-scheduler-store', WorkSchedulerStoreService],
    [`test-${consumer.name}`, consumer],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('work scheduler store real composition', () => {
  it('persists a document durably across separate boots on one sqlite file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-work-scheduler-store-'))
    const dbPath = join(root, 'storage.sqlite')
    const workspaceId = 'ws-1' as WorkspaceId

    let saveDone: Promise<void> | undefined
    const writer = {
      name: 'writer',
      apply: (ctx: Context) => {
        ctx.inject(['workSchedulerStore'], (child: Context) => {
          saveDone = child.workSchedulerStore.save(workspaceId, DOCUMENT)
        })
      },
    }
    const first = await loadComposition(dbPath, writer)
    await vi.waitFor(() => { expect(saveDone).toBeDefined() })
    await saveDone!
    await first.fiber.dispose()
    context = undefined

    let loaded: WorkSchedulerDocument | undefined
    const reader = {
      name: 'reader',
      apply: (ctx: Context) => {
        ctx.inject(['workSchedulerStore'], async (child: Context) => {
          loaded = (await child.workSchedulerStore.load(workspaceId)).document
        })
      },
    }
    const second = await loadComposition(dbPath, reader)
    await vi.waitFor(() => { expect(loaded).toBeDefined() })
    await second.fiber.dispose()
    context = undefined

    expect(loaded).toEqual(DOCUMENT)
  })
})
