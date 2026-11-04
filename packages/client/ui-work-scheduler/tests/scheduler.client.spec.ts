import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import {
  addProcess, addTask, archiveTask, createSchedulerState, isClearedSchedulerDocument, moveTask,
  normalizeSchedulerState, renameProcess, runnableTasks, setTaskStatus, wakeTask,
} from '../src/client/scheduler.ts'

describe('work scheduler domain', () => {
  it('builds a version-compatible empty document for a Workspace reset', () => {
    const empty = createSchedulerState(4)
    expect(empty).toEqual({
      version: 3, revision: 4, attempts: {}, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [],
    })
    expect(isClearedSchedulerDocument(empty)).toBe(true)
    expect(isClearedSchedulerDocument(addTask(empty, { id: 'task', description: '留下' }))).toBe(false)
  })

  it('retains Session bindings and rejects unsupported persisted versions', () => {
    const sessionId = 'session-1' as SessionId
    const added = addTask(createSchedulerState(), { id: 'bound', description: '检查会话', sessionId })
    expect(normalizeSchedulerState(added).tasks.bound?.sessionId).toBe(sessionId)
    expect(() => normalizeSchedulerState({ ...added, version: 2 })).toThrow()
  })

  it('runs only the first task before a synchronous block in each thread', () => {
    let state = createSchedulerState()
    state = addProcess(state, '发布流程', 'p1')
    state = addTask(state, { id: 't1', description: '检查变更', processId: 'p1' })
    state = addTask(state, { id: 't2', description: '等待审批', processId: 'p1', status: 'sync-blocked' })
    state = addTask(state, { id: 't3', description: '发布', processId: 'p1' })

    expect(runnableTasks(state).map(item => item.task.id)).toEqual(['t1'])

    state = setTaskStatus(state, 't1', 'done')
    expect(runnableTasks(state)).toEqual([])
  })

  it('moves asynchronously blocked work out of its thread and wakes it at its origin', () => {
    let state = addProcess(createSchedulerState(), '开发', 'p1')
    state = addTask(state, { id: 'a', description: '实现', processId: 'p1' })
    state = addTask(state, { id: 'b', description: '等待 CI', processId: 'p1' })
    state = setTaskStatus(state, 'b', 'async-blocked', { reason: '队列繁忙', wakeCondition: 'CI 完成' })

    expect(state.processes[0]?.taskIds).toEqual(['a'])
    expect(state.blockedIds).toEqual(['b'])
    expect(state.tasks.b?.origin).toEqual({ zone: 'process', processId: 'p1', index: 1 })

    state = wakeTask(state, 'b')
    expect(state.processes[0]?.taskIds).toEqual(['a', 'b'])
    expect(state.tasks.b?.status).toBe('ready')
  })

  it('archives completed work and restores it to the backlog', () => {
    let state = addTask(createSchedulerState(), { id: 't1', description: '记录结论' })
    state = archiveTask(state, 't1')
    expect(state.archiveIds).toEqual(['t1'])
    expect(state.backlogIds).toEqual([])

    state = moveTask(state, 't1', { zone: 'backlog', index: 0 })
    expect(state.archiveIds).toEqual([])
    expect(state.backlogIds).toEqual(['t1'])
    expect(state.tasks.t1?.status).toBe('ready')
  })

  it('rejects duplicate placement and unknown task ids without repairing data', () => {
    const added = addTask(createSchedulerState(), { id: 'task', description: '任务' })
    expect(() => normalizeSchedulerState({ ...added, backlogIds: ['task', 'task'] })).toThrow('exactly one placement')
    expect(() => normalizeSchedulerState({ ...added, backlogIds: ['missing'] })).toThrow('Unknown placed task')
  })

  it('preserves an asynchronous block origin through durable parsing', () => {
    let state = addProcess(createSchedulerState(), '线程', 'p1')
    state = addTask(state, { id: 'a', description: '前置', processId: 'p1' })
    state = addTask(state, { id: 'b', description: '等待 CI', processId: 'p1' })
    state = setTaskStatus(state, 'b', 'async-blocked')
    const parsed = normalizeSchedulerState(state)
    expect(parsed.tasks.b?.origin).toEqual({ zone: 'process', processId: 'p1', index: 1 })
    expect(wakeTask(parsed, 'b').processes[0]?.taskIds).toEqual(['a', 'b'])
  })

  it('fills unnamed columns and tasks and ignores invalid renames', () => {
    const unnamed = addProcess(createSchedulerState(), '   ')
    expect(unnamed.processes[0]?.name).toBe('列 1')
    expect(renameProcess(unnamed, 'missing', '新名').processes[0]?.name).toBe('列 1')
    expect(addTask(createSchedulerState(), { id: 'blank', description: '  ' }).tasks.blank?.description).toBe('未命名任务')
  })

  it('places created work by status and ignores unknown ids', () => {
    let state = addProcess(createSchedulerState(), '开发', 'p1')
    state = addTask(state, { id: 'blocked', description: '等', processId: 'p1', status: 'async-blocked' })
    expect(state.blockedIds).toEqual(['blocked'])
    state = addTask(state, { id: 'done', description: '完', status: 'done' })
    expect(state.archiveIds).toEqual(['done'])
    expect(moveTask(state, 'missing', { zone: 'backlog', index: 0 }).backlogIds).toEqual(state.backlogIds)
    expect(moveTask(state, 'done', { zone: 'process', processId: 'gone', index: 0 }).backlogIds).toContain('done')
    expect(setTaskStatus(state, 'missing', 'ready')).toEqual(state)
    expect(archiveTask(state, 'missing')).toEqual(state)
    expect(wakeTask(state, 'done')).toEqual(state)
  })

  it('returns an asynchronously blocked task to the backlog and restores a missing origin process', () => {
    let state = addProcess(createSchedulerState(), '开发', 'p1')
    state = addTask(state, { id: 'a', description: '实现', processId: 'p1' })
    state = setTaskStatus(state, 'a', 'async-blocked')
    expect(setTaskStatus(state, 'a', 'ready').tasks.a?.status).toBe('ready')
    state.processes = []
    expect(wakeTask(state, 'a').backlogIds).toContain('a')
    let backlog = addTask(createSchedulerState(), { id: 'b', description: '待办' })
    backlog = setTaskStatus(backlog, 'b', 'async-blocked')
    expect(wakeTask(backlog, 'b').backlogIds).toEqual(['b'])
    const archived = addTask(createSchedulerState(), { id: 'done', description: '完', status: 'done' })
    expect(setTaskStatus(archived, 'done', 'async-blocked').blockedIds).toEqual(['done'])
    let duplicate = addProcess(createSchedulerState(), '开发', 'p1')
    duplicate = addTask(duplicate, { id: 'c', description: '重复', processId: 'p1' })
    duplicate.blockedIds.push('c')
    expect(setTaskStatus(duplicate, 'c', 'async-blocked').blockedIds).toEqual(['c'])
    let noOrigin = addTask(createSchedulerState(), { id: 'd', description: '无来源' })
    noOrigin = setTaskStatus(noOrigin, 'd', 'async-blocked')
    delete noOrigin.tasks.d?.origin
    expect(wakeTask(noOrigin, 'd').backlogIds).toEqual(['d'])
  })

  it('skips completed work, missing ids, and non-runnable statuses when listing runnable tasks', () => {
    let state = addProcess(createSchedulerState(), '空', 'empty')
    state = addProcess(state, '开发', 'p1')
    state = addTask(state, { id: 'done', description: '完', processId: 'p1', status: 'done' })
    state.processes[1]!.taskIds.push('ghost')
    state = addTask(state, { id: 'wait', description: '等', processId: 'p1', status: 'sync-blocked' })
    expect(runnableTasks(state)).toEqual([])
    let blocked = addProcess(createSchedulerState(), '开发', 'p1')
    blocked = addTask(blocked, { id: 'async', description: '异步', processId: 'p1' })
    blocked.tasks.async!.status = 'async-blocked'
    expect(runnableTasks(blocked)).toEqual([])
  })
})
