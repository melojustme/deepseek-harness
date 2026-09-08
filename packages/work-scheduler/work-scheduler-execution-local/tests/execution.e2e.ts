/** Credentialed provider smoke against actual isolated filesystem output. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanups, commandId, harness } from './harness.ts'

afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it.skipIf(!process.env.DEEPSEEK_API_KEY)('writes and reviews a real-model artifact without changing the original workspace', async () => {
  const { ctx, workspace, load } = await harness({ live: true })
  const document = await ctx.workSchedulerStore.update(workspace.id, current => {
    current.tasks.task!.description = 'Create delivery.txt in the current directory containing exactly scheduler-live-check followed by a newline. Read it back to verify. Do not modify any other file.'
    current.tasks.task!.acceptance = ['delivery.txt contains exactly scheduler-live-check followed by a newline.']
  })
  await ctx.workSchedulerExecution.command(workspace.id, { kind: 'execute', taskId: 'task', expectedRevision: document.revision, commandId: commandId('live') })
  await vi.waitFor(async () => { const attempt = Object.values((await load()).attempts)[0]; expect(attempt?.status, attempt?.error).toBe('review') }, { timeout: 120000 })
  const attempt = Object.values((await load()).attempts)[0]!
  expect(await readFile(join(attempt.worktree!, 'delivery.txt'), 'utf8')).toBe('scheduler-live-check\n')
  await expect(readFile(join(workspace.path, 'delivery.txt'))).rejects.toThrow()
  expect(attempt.evidence!.diff).toContain('+scheduler-live-check')
}, 150000)
