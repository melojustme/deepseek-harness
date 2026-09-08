// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SchedulerSnapshot, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SchedulerAttempt, SchedulerAttemptId, SchedulerCommandId, SessionId, WorkspaceId, WorkSchedulerDocument } from '@deepseek-ai/dsh-client-connection/client'
import { SchedulerPanel, SchedulerTrigger, type SchedulerPanelProps, type SchedulerTriggerProps } from '../src/client/WorkScheduler.tsx'
import { addTask, createSchedulerState } from '../src/client/scheduler.ts'
import { createWorkSchedulerStore } from '../src/client/store.ts'

const workspaceId = 'workspace-a' as WorkspaceId
const sessionId = 'session-a' as SessionId
const attemptId = '00000000-0000-4000-8000-000000000001' as SchedulerAttemptId
const taskDocument = () => addTask(createSchedulerState(), { id: 'task', description: '实现面板', acceptance: ['实际检查通过'] })
const attempt = (status: SchedulerAttempt['status']): SchedulerAttempt => ({
  id: attemptId, taskId: 'task', commandId: 'execute' as SchedulerCommandId, sessionId, status,
  description: '实现面板', acceptance: ['实际检查通过'], feedback: '', createdAt: '', updatedAt: '',
  worktree: '/worktrees/attempt', baseCommit: 'base',
  evidence: { hash: 'fixed-evidence', commit: 'snapshot', logSeq: 10, logHash: 'log', diff: '+ implemented', summary: '完成面板', truncated: false, tools: [] },
})

function mount(document = taskDocument(), status: SchedulerSnapshot['status'] = 'ready') {
  const store = createWorkSchedulerStore().create()
  let snapshot: SchedulerSnapshot = { workspaceId, document, status, error: undefined }
  const listeners = new Set<() => void>()
  const publish = (update: Partial<SchedulerSnapshot>) => { snapshot = { ...snapshot, ...update }; listeners.forEach(listener => { listener() }) }
  const save = vi.fn(async (next: WorkSchedulerDocument) => { publish({ document: { ...next, revision: next.revision + 1 } }) })
  const command = vi.fn(async () => {})
  const openSession = vi.fn()
  const workspaces: WorkspaceListState = {
    items: [{ workspaceId, path: '/workspace', title: '工作区', sessionIds: [sessionId], createdAt: '', updatedAt: '' }],
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: workspaceId,
  }
  const sessions = { current: sessionId, ids: [sessionId], byId: { [sessionId]: { id: sessionId, displayTitle: '开发会话' } } } as SessionListState
  const props = {
    useStore: <T,>(select: (state: ReturnType<typeof store.getSnapshot>) => T) => select(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    useScheduler: <T,>(select: (state: SchedulerSnapshot) => T) => select(useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => snapshot)),
    useSessions: <T,>(select: (state: SessionListState) => T) => select(sessions),
    useWorkspaces: <T,>(select: (state: WorkspaceListState) => T) => select(workspaces),
    actions: store.actions, selectWorkspace: vi.fn(), save, command, refresh: vi.fn(async () => {}), openSession,
    createSession: vi.fn(async () => sessionId),
  }
  const view = render(<><SchedulerTrigger {...props as unknown as SchedulerTriggerProps} wide /><SchedulerPanel {...props as unknown as SchedulerPanelProps} /></>)
  fireEvent.click(view.getByRole('button', { name: '工作调度' }))
  return { ...view, store, save, command, openSession, publish, snapshot: () => snapshot }
}

afterEach(cleanup)

describe('native work scheduler panel', () => {
  it('disables writes before the workspace has loaded', () => {
    const view = mount(taskDocument(), 'loading')
    expect((view.getByRole('button', { name: '新建任务' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves acceptance criteria and a Session association without starting execution', async () => {
    const view = mount(createSchedulerState())
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.change(view.getByLabelText('任务描述'), { target: { value: '添加看板' } })
    fireEvent.change(view.getByLabelText('验收条件（每行一项）'), { target: { value: '支持新建\n支持审查' } })
    fireEvent.change(view.getByLabelText('关联会话'), { target: { value: sessionId } })
    fireEvent.click(view.getByRole('button', { name: '保存待办' }))
    await waitFor(() => { expect(view.save).toHaveBeenCalledOnce() })
    expect(Object.values(view.snapshot().document.tasks)[0]).toMatchObject({ description: '添加看板', acceptance: ['支持新建', '支持审查'], sessionId })
    expect(view.command).not.toHaveBeenCalled()
  })

  it('retains a failed draft for correction and retry', async () => {
    const view = mount(createSchedulerState())
    view.save.mockRejectedValueOnce(new Error('revision conflict'))
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.change(view.getByLabelText('任务描述'), { target: { value: '保留草稿' } })
    fireEvent.change(view.getByLabelText('验收条件（每行一项）'), { target: { value: '验证' } })
    fireEvent.click(view.getByRole('button', { name: '保存待办' }))
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('revision conflict') })
    expect((view.getByLabelText('任务描述') as HTMLTextAreaElement).value).toBe('保留草稿')
  })

  it('retries the same execution command after an uncertain transport result', async () => {
    const view = mount()
    view.command.mockRejectedValueOnce(new Error('connection lost'))
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '执行任务' }))
    await waitFor(() => { expect(view.getByRole('button', { name: '重试原请求' })).toBeTruthy() })
    fireEvent.click(view.getByRole('button', { name: '重试原请求' }))
    await waitFor(() => { expect(view.command).toHaveBeenCalledTimes(2) })
    expect(view.command.mock.calls[1]).toEqual(view.command.mock.calls[0])
  })

  it('keeps execution alive when the window closes and opens native logs', () => {
    const document = taskDocument(); document.attempts[attemptId] = attempt('running')
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '关闭' }))
    expect(view.command).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    fireEvent.click(view.getByRole('button', { name: '打开执行会话' }))
    expect(view.openSession).toHaveBeenCalledWith(sessionId)
  })

  it('submits review decisions against the displayed evidence and requires rework feedback', async () => {
    const document = taskDocument(); document.attempts[attemptId] = attempt('review')
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    expect((view.getByRole('button', { name: '提交返工' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(view.getByLabelText('返工意见 / 接受失败检查的原因'), { target: { value: '补充测试' } })
    fireEvent.click(view.getByRole('button', { name: '提交返工' }))
    await waitFor(() => { expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rework', attemptId, evidenceHash: 'fixed-evidence', feedback: '补充测试', expectedRevision: 0 })) })
    act(() => { view.publish({ document: { ...document, revision: 1 } }) })
    expect(view.snapshot().document.revision).toBe(1)
  })
})
