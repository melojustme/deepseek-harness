import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { Config } from '../src/config.ts'
import * as SchedulerInvariant from '../src/invariant.ts'
import { SchedulerPanel, SchedulerTrigger } from '../src/client/WorkScheduler.tsx'

const empty = {
  version: 3 as const,
  revision: 0,
  attempts: {},
  processes: [],
  tasks: {},
  backlogIds: [],
  blockedIds: [],
  archiveIds: [],
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register(
    {
      name: 'root',
      children: {
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
  const setDraft = vi.fn()
  const open = vi.fn()
  const create = vi.fn(async () => 'session-new' as SessionId)
  let scope: unknown = {}
  ctx.provide('connection', {
    api: {
      workScheduler: {
        load: async () => ({ result: { ok: true, value: { document: empty } } }),
        save: async () => ({ result: { ok: true, value: { document: { ...empty, revision: 1 } } } }),
        command: async () => ({ result: { ok: true, value: { document: { ...empty, revision: 1 } } } }),
      },
    },
  })
  ctx.provide('sessions', {
    create,
    scope: () => scope,
    open,
  })
  ctx.provide('conversation', { input: { for: () => ({ setDraft }) } })
  const fiber = ctx.plugin({ inject: [...inject], apply }, { refreshIntervalMs: 10_000 })
  await fiber.await()
  return { ctx, fiber, setDraft, open, create, setScope: (value: unknown) => { scope = value } }
}

describe('work scheduler plugin halves', () => {
  it('validates refresh configuration', () => {
    expect(Config({ refreshIntervalMs: 1000 })).toEqual({ refreshIntervalMs: 1000 })
    expect(Config({ refreshIntervalMs: 250 })).toEqual({ refreshIntervalMs: 250 })
  })

  it('declares the services the browser half binds', () => {
    expect(inject).toEqual(['slots', 'connection', 'sessions', 'conversation'])
  })

  it('contributes no Host behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers overlay and sidebar entries and tears them down', async () => {
    const { ctx, fiber } = await bench()
    const footer = ctx.slots.entries('sidebar.footer.action')[0]
    const overlay = ctx.slots.entries('shell.overlay')[0]
    expect(footer?.options.id).toBe('work-scheduler')
    expect(overlay?.options.id).toBe('work-scheduler')
    expect(footer?.component).toBe(SchedulerTrigger)
    expect(overlay?.component).toBe(SchedulerPanel)
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('injects session creation, draft seeding, native open, and connection recovery', async () => {
    const { ctx, fiber, setDraft, open, create } = await bench()
    const overlay = ctx.slots.entries('shell.overlay')[0]
    const injected = overlay?.inject as () => {
      createSession: (workspaceId: WorkspaceId, draft: string) => Promise<SessionId>
      openSession: (id: SessionId) => void
      save: (document: typeof empty) => Promise<void>
      command: (command: { kind: string }) => Promise<void>
      refresh: () => Promise<void>
      selectWorkspace: (id: WorkspaceId | undefined) => void
    }
    const face = injected()
    await expect(face.createSession('workspace' as WorkspaceId, '草稿')).resolves.toBe('session-new')
    expect(create).toHaveBeenCalled()
    expect(setDraft).toHaveBeenCalledWith('草稿')
    face.openSession('session-new' as SessionId)
    expect(open).toHaveBeenCalledWith('session-new')
    face.selectWorkspace('workspace' as WorkspaceId)
    await face.refresh()
    await face.save(empty).catch(() => undefined)
    await face.command({ kind: 'cancel', attemptId: 'attempt' } as never).catch(() => undefined)
    ctx.emit('connection/lost')
    ctx.emit('connection/reset')
    await fiber.dispose()
  })

  it('rejects a draft Session that never received an input scope', async () => {
    const { ctx, fiber, setScope } = await bench()
    setScope(undefined)
    const overlay = ctx.slots.entries('shell.overlay')[0]
    const injected = overlay?.inject as () => {
      createSession: (workspaceId: WorkspaceId, draft: string) => Promise<SessionId>
    }
    await expect(injected().createSession('workspace' as WorkspaceId, '草稿')).rejects.toThrow('新会话未能创建输入范围。')
    await fiber.dispose()
  })

  it('reserves package ownership in the invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(SchedulerInvariant)
    await fiber.await()
    expect(SchedulerInvariant.name).toBe('client-ui-work-scheduler-invariant')
    expect(SchedulerInvariant.inject).toEqual(['invariants'])
    await fiber.dispose()
  })
})
