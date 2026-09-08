/** Native execution, review, cancellation, and recovery through the Loader composition. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanups, commandId, harness } from './harness.ts'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import Execution from '../src/index.ts'

afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('native scheduler delivery', () => {
  it('admits once, produces durable review, rejects stale files, and preserves rework input', async () => {
    const { ctx, workspace, model, load, submit, git } = await harness()
    const originalHead = git('rev-parse', 'HEAD')
    const admitted = await submit()
    expect(Object.keys((await submit()).attempts)).toEqual(Object.keys(admitted.attempts))
    await vi.waitFor(async () => { const attempt = Object.values((await load()).attempts)[0]; expect(attempt?.status, attempt?.error).toBe('review') }, { timeout: 15000 })
    let document = await load()
    const attempt = Object.values(document.attempts)[0]!
    expect(model.requests).toHaveLength(1)
    expect((await ctx.sessionPersistence.inspect(attempt.sessionId)).events.at(-1)?.seq).toBe(attempt.evidence!.logSeq)
    expect(git('rev-parse', `refs/dsh/scheduler/${attempt.id}`)).toBe(attempt.evidence!.commit)
    expect(git('rev-parse', 'HEAD')).toBe(originalHead)
    await writeFile(join(attempt.worktree!, 'README.md'), 'changed after execution\n')
    const review = { kind: 'approve' as const, attemptId: attempt.id, commandId: commandId('approve-1'), expectedRevision: document.revision, evidenceHash: attempt.evidence!.hash, feedback: '' }
    await expect(ctx.workSchedulerExecution.command(workspace.id, review)).rejects.toThrow('文件已在审查期间变化')
    const refresh = { ...review, kind: 'refresh-review' as const, commandId: commandId('refresh-1') }
    document = await ctx.workSchedulerExecution.command(workspace.id, refresh)
    expect((await ctx.workSchedulerExecution.command(workspace.id, refresh)).revision).toBe(document.revision)
    const evidence = document.attempts[attempt.id]!.evidence!
    expect(evidence.diff).toContain('changed after execution')
    const rework = { ...review, kind: 'rework' as const, commandId: commandId('rework-1'), expectedRevision: document.revision, evidenceHash: evidence.hash, feedback: 'Verify again' }
    await ctx.workSchedulerExecution.command(workspace.id, rework)
    await ctx.workSchedulerExecution.command(workspace.id, rework)
    await vi.waitFor(async () => { expect(Object.values((await load()).attempts).at(-1)?.status).toBe('review') }, { timeout: 15000 })
    document = await load()
    const second = Object.values(document.attempts).at(-1)!
    expect(second.baseCommit).toBe(evidence.commit)
    expect(model.requests).toHaveLength(2)
    expect(JSON.stringify(model.requests[1]?.messages)).toContain('Verify again')
    const approval = { ...review, attemptId: second.id, commandId: commandId('approve-2'), expectedRevision: document.revision, evidenceHash: second.evidence!.hash }
    const approved = await ctx.workSchedulerExecution.command(workspace.id, approval)
    expect(approved.attempts[second.id]!.status).toBe('approved')
    expect((await ctx.workSchedulerExecution.command(workspace.id, approval)).revision).toBe(approved.revision)
    expect(git('rev-parse', 'HEAD')).toBe(originalHead)
  }, 40000)

  it('cancels active model work and waits for native Session release', async () => {
    const { ctx, workspace, model, load, submit } = await harness()
    model.hang = true
    await submit()
    await vi.waitFor(() => { expect(model.requests).toHaveLength(1) }, { timeout: 15000 })
    const attempt = Object.values((await load()).attempts)[0]!
    const stopped = await ctx.workSchedulerExecution.command(workspace.id, { kind: 'cancel', attemptId: attempt.id })
    expect(stopped.attempts[attempt.id]!.status).toBe('stopped')
    expect(ctx.agents.get(attempt.sessionId)).toBeUndefined()
    expect(stopped.attempts[attempt.id]!.evidence).toBeUndefined()
    expect((await ctx.workSchedulerExecution.command(workspace.id, { kind: 'cancel', attemptId: attempt.id })).revision).toBe(stopped.revision)
  }, 30000)

  it('keeps later thread work queued through review until explicitly yielded', async () => {
    const { ctx, workspace, load, submit, model } = await harness()
    await submit()
    await vi.waitFor(async () => { expect(Object.values((await load()).attempts)[0]?.status).toBe('review') }, { timeout: 15000 })
    let document = await ctx.workSchedulerStore.update(workspace.id, current => {
      current.tasks.second = { ...current.tasks.task!, id: 'second', description: 'Second task' }
      current.backlogIds = []
      current.processes = [{ id: 'thread', name: 'Development', taskIds: ['task', 'second'] }]
    })
    document = await ctx.workSchedulerExecution.command(workspace.id, { kind: 'execute', taskId: 'second', expectedRevision: document.revision, commandId: commandId('execute-second') })
    const first = Object.values(document.attempts)[0]!
    await new Promise(resolve => { setTimeout(resolve, 250) })
    expect(model.requests).toHaveLength(1)
    document = await ctx.workSchedulerExecution.command(workspace.id, { kind: 'yield', attemptId: first.id, expectedRevision: document.revision })
    expect(document.blockedIds).toEqual(['task'])
    await vi.waitFor(async () => { expect(Object.values((await load()).attempts).at(-1)?.status).toBe('review') }, { timeout: 15000 })
    expect(model.requests).toHaveLength(2)
    document = await load()
    document = await ctx.workSchedulerExecution.command(workspace.id, { kind: 'resume', attemptId: first.id, expectedRevision: document.revision })
    expect(document.processes[0]?.taskIds).toEqual(['task', 'second'])
    expect(document.attempts[first.id]!.status).toBe('review')
  }, 30000)

  it('marks an ownerless preparing attempt interrupted on provider activation', async () => {
    const { ctx, workspace, load, stopExecution, root } = await harness()
    await stopExecution()
    const id = '00000000-0000-4000-8000-000000000001' as import('@deepseek-ai/dsh-host-apiproxy/api').SchedulerAttemptId
    await ctx.workSchedulerStore.update(workspace.id, current => {
      current.attempts[id] = { id, taskId: 'task', commandId: commandId('lost'), status: 'preparing', description: 'Task', acceptance: ['Check'], feedback: '', sessionId: 'lost-session' as import('@deepseek-ai/dsh-session').SessionId, createdAt: '', updatedAt: '' }
    })
    await ctx.plugin(Execution, Execution.Config({ worktreeRoot: join(root, 'worktrees') }))
    expect((await load()).attempts[id]!.status).toBe('interrupted')
    await expect(ctx.workSchedulerExecution.command('unknown' as typeof workspace.id, { kind: 'cancel', attemptId: id })).rejects.toThrow('工作区不存在')
  })


  it('executes the native filesystem tool through the shipping DeepSeek HTTP adapter', async () => {
    const server = await startMockLlmServer({ sequence: ['tool_call_success', 'success'], toolName: 'write', toolArguments: JSON.stringify({ file_path: 'delivery.txt', content: 'verified output\n' }), successText: 'Created delivery.txt.' })
    cleanups.push(() => server.close())
    const { submit, load, workspace, git } = await harness({ external: { baseURL: server.baseURL, key: 'scheduler-test-key' } })
    const original = git('rev-parse', 'HEAD')
    await submit()
    await vi.waitFor(async () => { const attempt = Object.values((await load()).attempts)[0]; expect(attempt?.status, attempt?.error).toBe('review') }, { timeout: 15000 })
    const attempt = Object.values((await load()).attempts)[0]!
    expect(await readFile(join(attempt.worktree!, 'delivery.txt'), 'utf8')).toBe('verified output\n')
    await expect(readFile(join(workspace.path, 'delivery.txt'))).rejects.toThrow()
    expect(attempt.evidence!.diff).toContain('+verified output')
    expect(attempt.evidence!.tools).toEqual([expect.objectContaining({ name: 'write', failed: false })])
    expect(server.requests).toHaveLength(2)
    expect(git('rev-parse', 'HEAD')).toBe(original)
  }, 30000)

})
