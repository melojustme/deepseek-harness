import { describe, expect, it } from 'vitest'
import {
  addProcess, addTask, archiveTask, createSchedulerState, moveTask,
  normalizeSchedulerState, runnableTasks, setTaskStatus, wakeTask,
} from '../src/client/scheduler.ts'

describe('work scheduler domain', () => {
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

  it('normalizes imported state without duplicate placement or unknown task ids', () => {
    const normalized = normalizeSchedulerState({
      version: 1,
      processes: [{ id: 'p1', name: '线程', taskIds: ['a', 'missing', 'a'] }],
      tasks: { a: { id: 'a', description: '任务', status: 'ready' } },
      backlogIds: ['a', 'missing'],
      blockedIds: [],
      archiveIds: [],
    })

    expect(normalized.processes[0]?.taskIds).toEqual(['a'])
    expect(normalized.backlogIds).toEqual([])
  })
})
