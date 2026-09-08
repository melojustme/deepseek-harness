import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkSchedulerDocument, WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import { WorkSchedulerRuntime, emptySchedulerDocument } from '../src/client/work-scheduler.ts'
import { FakeApiClient, deferred, ok } from './fake-api.client.ts'

const a = 'workspace-a' as WorkspaceId
const b = 'workspace-b' as WorkspaceId
const runtimes: WorkSchedulerRuntime[] = []
afterEach(() => { runtimes.splice(0).forEach(runtime => { runtime.dispose() }); vi.useRealTimers() })
function harness() {
  vi.useFakeTimers()
  const api = new FakeApiClient()
  const runtime = new WorkSchedulerRuntime(api, 1000)
  runtimes.push(runtime)
  return { api, runtime }
}

async function settle() { await Promise.resolve(); await Promise.resolve() }

describe('scheduler runtime response ownership', () => {
  it('starts a new workspace read immediately and ignores the previous response', async () => {
    const { api, runtime } = harness()
    const first = deferred<ReturnType<typeof ok<{ document: WorkSchedulerDocument }>>>()
    api.workScheduler.load = ({ workspaceId }) => workspaceId === a ? first.promise : Promise.resolve(ok({ document: { ...emptySchedulerDocument(), revision: 7 } }))
    runtime.select(a)
    runtime.select(b)
    await settle()
    expect(runtime.getSnapshot()).toMatchObject({ workspaceId: b, status: 'ready', document: { revision: 7 } })
    first.resolve(ok({ document: { ...emptySchedulerDocument(), revision: 99 } }))
    await settle()
    expect(runtime.getSnapshot().document.revision).toBe(7)
  })

  it('fences an in-flight read from overwriting a durable edit', async () => {
    const { api, runtime } = harness()
    runtime.select(a); await settle()
    const stale = deferred<ReturnType<typeof ok<{ document: WorkSchedulerDocument }>>>()
    api.workScheduler.load = () => stale.promise
    const refresh = runtime.refresh()
    await runtime.edit(document => ({ ...document, processes: [{ id: 'thread', name: 'Development', taskIds: [] }] }))
    stale.resolve(ok({ document: emptySchedulerDocument() })); await refresh
    expect(runtime.getSnapshot().document.processes[0]?.name).toBe('Development')
    expect(runtime.getSnapshot().document.revision).toBe(1)
  })

  it('disables mutation on disconnect and resumes only after loading the new generation', async () => {
    const { api, runtime } = harness()
    runtime.select(a); await settle()
    runtime.setConnected(false)
    await expect(runtime.edit(document => document)).rejects.toThrow('同步')
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.calls.filter(call => call.method === 'workScheduler.load')).toHaveLength(1)
    runtime.setConnected(true); await settle()
    expect(runtime.getSnapshot().status).toBe('ready')
  })

  it('ignores a pending reply and makes no new requests after disposal', async () => {
    const { api, runtime } = harness()
    const pending = deferred<ReturnType<typeof ok<{ document: WorkSchedulerDocument }>>>()
    api.workScheduler.load = vi.fn(() => pending.promise)
    runtime.select(a)
    const before = runtime.getSnapshot()
    runtime.dispose()
    pending.resolve(ok({ document: { ...emptySchedulerDocument(), revision: 8 } })); await settle()
    runtime.select(b); await runtime.refresh(); await vi.advanceTimersByTimeAsync(2000)
    expect(runtime.getSnapshot()).toBe(before)
    expect(api.workScheduler.load).toHaveBeenCalledOnce()
  })
})
