import { describe, expect, it } from 'vitest'
import type { SchedulerAttempt, WorkSchedulerDocument } from '@deepseek-ai/dsh-client-connection/client'
import { resolveBoardDrop } from '../src/client/board-drop.ts'
import { addProcess, addTask, createSchedulerState } from '../src/client/scheduler.ts'

function planned(): WorkSchedulerDocument {
  return ['first', 'middle', 'last'].reduce(
    (document, id) => addTask(document, { id, description: id, acceptance: ['check'] }),
    createSchedulerState(),
  )
}

function withAttempt(document: WorkSchedulerDocument, taskId: string, status: SchedulerAttempt['status']) {
  // Only the task/status projection participates in gesture resolution.
  document.attempts['attempt'] = { taskId, status } as SchedulerAttempt
  return document
}

describe('board gestures', () => {
  it('reorders relative to the unfiltered owning queue without mutating task state', () => {
    const original = planned()
    const result = resolveBoardDrop(original, 'first', 'ready', 'last', true)
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.backlogIds).toEqual(['middle', 'last', 'first'])
    expect(result.document.tasks).toEqual(original.tasks)
    expect(original.backlogIds).toEqual(['first', 'middle', 'last'])
  })

  it('does not move an attempted task indirectly by sorting across its position', () => {
    const document = withAttempt(planned(), 'middle', 'running')
    expect(resolveBoardDrop(document, 'first', 'ready', 'last', true).kind).toBe('reject')
    expect(resolveBoardDrop(document, 'last', 'ready', 'last').kind).toBe('none')
  })

  it('keeps cross-thread arrangement in the explicit thread view', () => {
    let document = addProcess(planned(), 'separate')
    const processId = document.processes[0]?.id
    if (processId === undefined) throw new Error('expected thread')
    document = addTask(document, { id: 'other', description: 'other', processId })
    expect(resolveBoardDrop(document, 'first', 'ready', 'other').kind).toBe('reject')
  })

  it.each(['queued', 'preparing', 'running'] as const)('turns %s to pending into a stop intent', (status) => {
    expect(resolveBoardDrop(withAttempt(planned(), 'first', status), 'first', 'ready')).toEqual({
      kind: 'cancel',
      taskId: 'first',
    })
  })

  it('requires actual review evidence before approval and never synthesizes completion', () => {
    const document = withAttempt(planned(), 'first', 'running')
    expect(resolveBoardDrop(document, 'first', 'review').kind).toBe('reject')
    expect(resolveBoardDrop(document, 'first', 'approved').kind).toBe('reject')
    withAttempt(document, 'first', 'review')
    expect(resolveBoardDrop(document, 'first', 'approved')).toEqual({ kind: 'review', taskId: 'first' })
    expect(resolveBoardDrop(document, 'first', 'ready')).toEqual({ kind: 'rework', taskId: 'first' })
    expect(resolveBoardDrop(document, 'first', 'running')).toEqual({ kind: 'rework', taskId: 'first' })
  })

  it('preserves approved history and lets failed tasks request a fresh attempt', () => {
    const document = withAttempt(planned(), 'first', 'approved')
    expect(resolveBoardDrop(document, 'first', 'ready').kind).toBe('reject')
    expect(resolveBoardDrop(document, 'first', 'running').kind).toBe('reject')
    withAttempt(document, 'first', 'failed')
    expect(resolveBoardDrop(document, 'first', 'running')).toEqual({ kind: 'execute', taskId: 'first' })
  })
})
