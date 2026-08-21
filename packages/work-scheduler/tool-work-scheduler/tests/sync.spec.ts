import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkSchedulerDocument } from '@deepseek-ai/dsh-host-apiproxy/api'
import { syncSopStages } from '../src/sync.ts'

const sessionA = 'session-a' as SessionId
const sessionB = 'session-b' as SessionId
const sessionWithPrefix = 'session-a:child' as SessionId
const earlier = '2026-08-20T00:00:00.000Z'
const now = '2026-08-21T00:00:00.000Z'

function emptyDocument(): WorkSchedulerDocument {
  return { version: 2, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [] }
}

describe('SOP stage synchronization', () => {
  it('binds active stages to the session and archives completed stages', () => {
    const result = syncSopStages(emptyDocument(), {
      workflow: '开发 SOP',
      sessionId: sessionA,
      now,
      stages: [
        { key: 'intake', name: '需求确认', status: 'completed' },
        { key: 'implement', name: '实现', status: 'in_progress' },
        { key: 'verify', name: '验证', status: 'pending' },
      ],
    })

    expect(result.processes).toEqual([{
      id: 'sop:session-a',
      name: '开发 SOP',
      taskIds: ['sop:session-a:implement', 'sop:session-a:verify'],
    }])
    expect(result.tasks['sop:session-a:intake']).toMatchObject({
      sessionId: sessionA, description: '需求确认', status: 'done', createdAt: now, updatedAt: now,
    })
    expect(result.tasks['sop:session-a:implement']).toMatchObject({
      sessionId: sessionA, description: '实现', status: 'running', createdAt: now, updatedAt: now,
    })
    expect(result.tasks['sop:session-a:verify']).toMatchObject({
      sessionId: sessionA, description: '验证', status: 'ready', createdAt: now, updatedAt: now,
    })
    expect(result.archiveIds).toEqual(['sop:session-a:intake'])
  })

  it('replaces only its session namespace and preserves manual and other-session work', () => {
    const source: WorkSchedulerDocument = {
      version: 2,
      processes: [
        { id: 'manual', name: '人工线程', taskIds: ['manual-task'] },
        { id: 'sop:session-b', name: '其他 SOP', taskIds: ['sop:session-b:plan'] },
        { id: 'sop:session-a:child', name: '前缀相同的 SOP', taskIds: ['sop:session-a:child:plan'] },
        { id: 'sop:session-a', name: '旧 SOP', taskIds: ['sop:session-a:old'] },
      ],
      tasks: {
        'manual-task': { id: 'manual-task', description: '人工任务', status: 'running', reason: '', wakeCondition: '', createdAt: earlier, updatedAt: earlier },
        'sop:session-b:plan': { id: 'sop:session-b:plan', description: '其他计划', sessionId: sessionB, status: 'ready', reason: '', wakeCondition: '', createdAt: earlier, updatedAt: earlier },
        'sop:session-a:child:plan': { id: 'sop:session-a:child:plan', description: '前缀相同的计划', sessionId: sessionWithPrefix, status: 'ready', reason: '', wakeCondition: '', createdAt: earlier, updatedAt: earlier },
        'sop:session-a:old': { id: 'sop:session-a:old', description: '旧阶段', sessionId: sessionA, status: 'ready', reason: '', wakeCondition: '', createdAt: earlier, updatedAt: earlier },
      },
      backlogIds: [],
      blockedIds: [],
      archiveIds: [],
    }

    const result = syncSopStages(source, {
      workflow: '开发 SOP', sessionId: sessionA, now,
      stages: [{ key: 'plan', name: '实施计划', status: 'in_progress' }],
    })

    expect(result.processes).toEqual([
      source.processes[0],
      source.processes[1],
      source.processes[2],
      { id: 'sop:session-a', name: '开发 SOP', taskIds: ['sop:session-a:plan'] },
    ])
    expect(result.tasks['manual-task']).toBe(source.tasks['manual-task'])
    expect(result.tasks['sop:session-b:plan']).toBe(source.tasks['sop:session-b:plan'])
    expect(result.tasks['sop:session-a:child:plan']).toBe(source.tasks['sop:session-a:child:plan'])
    expect(result.tasks).not.toHaveProperty('sop:session-a:old')
  })

  it('is idempotent and permits a completed stage to return to active work', () => {
    const completed = syncSopStages(emptyDocument(), {
      workflow: '开发 SOP', sessionId: sessionA, now: earlier,
      stages: [{ key: 'verify', name: '验证', status: 'completed' }],
    })
    expect(syncSopStages(completed, {
      workflow: '开发 SOP', sessionId: sessionA, now,
      stages: [{ key: 'verify', name: '验证', status: 'completed' }],
    })).toEqual(completed)

    const reopened = syncSopStages(completed, {
      workflow: '开发 SOP', sessionId: sessionA, now,
      stages: [{ key: 'verify', name: '验证', status: 'in_progress' }],
    })
    expect(reopened.tasks['sop:session-a:verify']).toMatchObject({
      status: 'running', createdAt: earlier, updatedAt: now,
    })
    expect(reopened.processes[0]?.taskIds).toEqual(['sop:session-a:verify'])
    expect(reopened.archiveIds).toEqual([])
  })
})
