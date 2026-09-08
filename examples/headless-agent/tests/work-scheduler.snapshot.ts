/** Logged delivery input and human decisions through the runnable scheduler composition. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanups, commandId, harness } from '../../../packages/work-scheduler/work-scheduler-execution-local/tests/harness.ts'

afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it('records execution and rework as distinct native Session inputs before human approval', async () => {
  const { ctx, workspace, submit, load } = await harness()
  await submit()
  await vi.waitFor(async () => { expect(Object.values((await load()).attempts)[0]?.status).toBe('review') }, { timeout: 15000 })
  let document = await load()
  const first = Object.values(document.attempts)[0]!
  await ctx.workSchedulerExecution.command(workspace.id, { kind: 'rework', attemptId: first.id, commandId: commandId('rework'), expectedRevision: document.revision, evidenceHash: first.evidence!.hash, feedback: 'Explain which checks were actually run.' })
  await vi.waitFor(async () => { expect(Object.values((await load()).attempts).at(-1)?.status).toBe('review') }, { timeout: 15000 })
  document = await load()
  const second = Object.values(document.attempts).at(-1)!
  document = await ctx.workSchedulerExecution.command(workspace.id, { kind: 'approve', attemptId: second.id, commandId: commandId('approve'), expectedRevision: document.revision, evidenceHash: second.evidence!.hash, feedback: '' })
  const transcript = []
  for (const attempt of Object.values(document.attempts)) {
    const inspection = await ctx.sessionPersistence.inspect(attempt.sessionId)
    transcript.push({
      status: attempt.status,
      messages: inspection.events.flatMap(event => event.type === 'user/message' ? [{ role: 'user', content: event.data.content }] : event.type === 'assistant/message' ? [{ role: 'assistant', content: event.data.message.content }] : []),
      tools: attempt.evidence!.tools,
      diff: attempt.evidence!.diff,
      summary: attempt.evidence!.summary,
      review: { decision: attempt.review!.decision, feedback: attempt.review!.feedback },
    })
  }
  await expect(JSON.stringify(transcript, null, 2) + '\n').toMatchFileSnapshot('./snapshots/work-scheduler/transcript.expected.json')
})
