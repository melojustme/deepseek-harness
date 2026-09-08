import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import {
  addProcess, addTask, archiveTask, createSchedulerState, moveTask,
  normalizeSchedulerState, runnableTasks, setTaskStatus, wakeTask,
} from '../src/client/scheduler.ts'

describe('work scheduler domain', () => {
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
})
