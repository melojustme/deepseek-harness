import { describe, expect, it } from 'vitest'
import type { SchedulerAttempt, WorkSchedulerDocument } from '@deepseek-ai/dsh-client-connection/client'
import { resolveBoardDrop } from '../src/client/board-drop.ts'
import { addProcess, addTask, createSchedulerState, setTaskStatus } from '../src/client/scheduler.ts'

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

  it('archives a personal task dropped on approved without asking for worktree evidence', () => {
    const original = planned()
    const result = resolveBoardDrop(original, 'first', 'approved')
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.archiveIds).toEqual(['first'])
    expect(result.document.backlogIds).toEqual(['middle', 'last'])
    expect(result.document.tasks.first?.status).toBe('done')
    expect(result).not.toEqual({
      kind: 'reject',
      reason: '先完成执行并检查本轮证据，才能通过审查。',
    })
  })

  it('marks an unattempted task in progress without starting Host execution', () => {
    const result = resolveBoardDrop(planned(), 'first', 'running')
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.tasks.first?.status).toBe('running')
    expect(result.document.backlogIds).toContain('first')
  })

  it('rejects review for an unattempted personal task and points at 已通过', () => {
    expect(resolveBoardDrop(planned(), 'first', 'review')).toEqual({
      kind: 'reject',
      reason: '待审查只用于已执行的任务。勾选完成请拖到已通过。',
    })
  })

  it('reorders an already completed personal task inside 已通过', () => {
    const document = planned()
    const archived = resolveBoardDrop(document, 'first', 'approved')
    if (archived.kind !== 'save') throw new Error('expected archive')
    const result = resolveBoardDrop(archived.document, 'first', 'approved', 'first')
    expect(result.kind).toBe('none')
  })

  it('restores a completed personal task to in-progress without an attempt', () => {
    const archived = resolveBoardDrop(planned(), 'first', 'approved')
    if (archived.kind !== 'save') throw new Error('expected archive')
    const result = resolveBoardDrop(archived.document, 'first', 'running')
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.tasks.first?.status).toBe('running')
    expect(result.document.archiveIds).not.toContain('first')
  })

  it('returns a completed personal task to 待办 without an attempt', () => {
    const archived = resolveBoardDrop(planned(), 'first', 'approved')
    if (archived.kind !== 'save') throw new Error('expected archive')
    const result = resolveBoardDrop(archived.document, 'first', 'ready')
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.tasks.first?.status).toBe('ready')
    expect(result.document.backlogIds.at(-1)).toBe('first')
  })

  it('returns a blocked or in-progress personal task to 待办 without an attempt', () => {
    const running = resolveBoardDrop(planned(), 'first', 'running')
    if (running.kind !== 'save') throw new Error('expected planning edit')
    const ready = resolveBoardDrop(running.document, 'first', 'ready')
    expect(ready.kind).toBe('save')
    if (ready.kind !== 'save') throw new Error('expected planning edit')
    expect(ready.document.tasks.first?.status).toBe('ready')
    const blocked = setTaskStatus(planned(), 'first', 'sync-blocked')
    const unblocked = resolveBoardDrop(blocked, 'first', 'ready')
    expect(unblocked.kind).toBe('save')
    if (unblocked.kind !== 'save') throw new Error('expected planning edit')
    expect(unblocked.document.tasks.first?.status).toBe('ready')
  })

  it('rejects a missing task', () => {
    expect(resolveBoardDrop(planned(), 'missing', 'approved')).toEqual({
      kind: 'reject',
      reason: '任务不存在，请刷新看板。',
    })
  })

  it('rejects an unplaced task and inserts before a same-queue neighbor', () => {
    const unplaced = planned()
    unplaced.backlogIds = unplaced.backlogIds.filter(id => id !== 'first')
    expect(resolveBoardDrop(unplaced, 'first', 'ready')).toEqual({
      kind: 'reject',
      reason: '任务没有有效位置，请刷新看板。',
    })
    const result = resolveBoardDrop(planned(), 'last', 'ready', 'first', false)
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.backlogIds).toEqual(['last', 'first', 'middle'])
  })

  it('opens review when an attempted review card is dropped on 待审查', () => {
    expect(resolveBoardDrop(withAttempt(planned(), 'first', 'review'), 'first', 'review')).toEqual({
      kind: 'review',
      taskId: 'first',
    })
  })

  it('appends to the owning queue and ignores unrelated attempts', () => {
    const result = resolveBoardDrop(planned(), 'first', 'ready')
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.backlogIds).toEqual(['middle', 'last', 'first'])
    expect(resolveBoardDrop(planned(), 'first', 'ready', 'middle', false).kind).toBe('none')
    expect(resolveBoardDrop(withAttempt(planned(), 'ghost', 'running'), 'first', 'ready', 'last', true).kind).toBe('save')
  })

  it('reorders an unattempted in-progress card in its owning queue', () => {
    const running = resolveBoardDrop(planned(), 'first', 'running')
    if (running.kind !== 'save') throw new Error('expected planning edit')
    const result = resolveBoardDrop(running.document, 'first', 'running', 'last', true)
    expect(result.kind).toBe('save')
    if (result.kind !== 'save') throw new Error('expected planning edit')
    expect(result.document.backlogIds).toEqual(['middle', 'last', 'first'])
  })
})
