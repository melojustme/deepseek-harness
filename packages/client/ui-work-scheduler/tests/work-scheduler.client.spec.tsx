// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import {
  SchedulerPanel, SchedulerTrigger,
  type SchedulerPanelProps, type SchedulerTriggerProps, type WorkSchedulerInjected,
} from '../src/client/WorkScheduler.tsx'
import { createSchedulerState } from '../src/client/scheduler.ts'
import { createWorkSchedulerStore } from '../src/client/store.ts'

const WORKSPACE_ID = 'ws-1' as WorkspaceId
const SESSION_ID = 'sess-1' as SessionId
const SECOND_SESSION_ID = 'sess-2' as SessionId

function sessionsSnapshot(): SessionListState {
  return {
    current: SESSION_ID,
    ids: [SESSION_ID, SECOND_SESSION_ID],
    byId: {
      [SESSION_ID]: { id: SESSION_ID, displayTitle: '实现会话' },
      [SECOND_SESSION_ID]: { id: SECOND_SESSION_ID, displayTitle: '评审会话' },
    },
  } as SessionListState
}

function workspacesSnapshot(sessionIds: SessionId[] = [SESSION_ID, SECOND_SESSION_ID]): WorkspaceListState {
  return {
    items: [{
      workspaceId: WORKSPACE_ID, path: '/tmp/ws', title: '工作区', sessionIds,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
    recentWorkspaceId: WORKSPACE_ID,
  }
}

function mountScheduler(overrides?: {
  loadDocument?: WorkSchedulerInjected['loadDocument']
  saveDocument?: WorkSchedulerInjected['saveDocument']
  sessions?: SessionListState
  workspaces?: WorkspaceListState
  openSession?: (sessionId: SessionId) => void
}) {
  const instance = createWorkSchedulerStore().create()
  const useStore = <T,>(select: (state: ReturnType<typeof instance.getSnapshot>) => T): T =>
    select(useSyncExternalStore(
      listener => instance.subscribe(listener),
      () => instance.getSnapshot(),
    ))
  const loadDocument = overrides?.loadDocument ?? vi.fn(async () => createSchedulerState())
  const saveDocument = overrides?.saveDocument ?? vi.fn(async () => {})
  const openSession = overrides?.openSession ?? vi.fn()
  const runtime = {
    useStore,
    actions: instance.actions,
    useSessions: (select: (state: SessionListState) => unknown) => select(overrides?.sessions ?? sessionsSnapshot()),
    useWorkspaces: (select: (state: WorkspaceListState) => unknown) => select(overrides?.workspaces ?? workspacesSnapshot()),
    loadDocument,
    saveDocument,
    openSession,
  }
  const triggerProps = { ...runtime, wide: true } as unknown as SchedulerTriggerProps
  const panelProps = runtime as unknown as SchedulerPanelProps
  const view = render(<><SchedulerTrigger {...triggerProps} /><SchedulerPanel {...panelProps} /></>)
  return { instance, loadDocument, saveDocument, openSession, ...view }
}

function taskCard(view: ReturnType<typeof mountScheduler>, description: string): HTMLElement {
  const card = view.getAllByText(description).map(node => node.closest('article')).find(node => node !== null)
  if (card === undefined) throw new Error(`task card not found: ${description}`)
  return card
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('work scheduler surface', () => {
  it('keeps an unpinned board in memory when no workspace exists', async () => {
    vi.useFakeTimers()
    const view = mountScheduler({
      sessions: { current: undefined } as SessionListState,
      workspaces: { ...workspacesSnapshot(), items: [], recentWorkspaceId: undefined },
    })

    act(() => { view.instance.actions.open() })
    await act(async () => { await Promise.resolve() })
    act(() => { view.instance.actions.addProcess('临时', 'p1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(view.saveDocument).not.toHaveBeenCalled()
  })

  it('keeps the unpinned in-memory board when the panel is reopened', async () => {
    const view = mountScheduler({
      sessions: { current: undefined } as SessionListState,
      workspaces: { ...workspacesSnapshot(), items: [], recentWorkspaceId: undefined },
    })

    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })
    act(() => { view.instance.actions.addProcess('临时', 'p1') })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))

    await waitFor(() => { expect(view.getByDisplayValue('临时')).toBeTruthy() })
    expect(view.saveDocument).not.toHaveBeenCalled()
  })

  it('disables document edits until the durable load completes', async () => {
    let resolveLoad!: (document: ReturnType<typeof createSchedulerState>) => void
    const view = mountScheduler({
      loadDocument: vi.fn(() => new Promise<ReturnType<typeof createSchedulerState>>((resolve) => { resolveLoad = resolve })),
    })

    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    const createButton = view.getByRole('button', { name: '新建线程' }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    act(() => { resolveLoad(createSchedulerState()) })
    await waitFor(() => { expect(createButton.disabled).toBe(false) })
  })

  it('opens from the sidebar, loads the durable document, and creates a thread and its first task', async () => {
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    expect(view.getByRole('dialog', { name: '工作调度' })).toBeTruthy()
    await waitFor(() => { expect(view.loadDocument).toHaveBeenCalledWith(WORKSPACE_ID) })

    fireEvent.change(view.getByRole('textbox', { name: '线程名称' }), { target: { value: '发布' } })
    fireEvent.click(view.getByRole('button', { name: '新建线程' }))
    fireEvent.change(view.getByRole('textbox', { name: '任务内容' }), { target: { value: '检查构建' } })
    fireEvent.change(view.getByRole('combobox', { name: '任务位置' }), { target: { value: view.instance.getSnapshot().document.processes[0]!.id } })
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))

    expect(view.getAllByText('检查构建')).toHaveLength(2)
    expect(view.getByText(/1 个线程可以继续推进/)).toBeTruthy()
  })

  it('binds a new task to a Workspace Session and opens it from the card', async () => {
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })
    act(() => { view.instance.actions.addProcess('开发', 'p1') })

    fireEvent.change(view.getByRole('textbox', { name: '任务内容' }), { target: { value: '继续实现' } })
    fireEvent.change(view.getByRole('combobox', { name: '任务位置' }), { target: { value: 'p1' } })
    fireEvent.change(view.getByRole('combobox', { name: '关联会话' }), { target: { value: SECOND_SESSION_ID } })
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))

    const task = Object.values(view.instance.getSnapshot().document.tasks)[0]
    expect(task?.sessionId).toBe(SECOND_SESSION_ID)
    fireEvent.click(view.getByRole('button', { name: '打开会话：评审会话' }))
    expect(view.openSession).toHaveBeenCalledWith(SECOND_SESSION_ID)
  })

  it('marks a binding unavailable when its Session is outside the current Workspace', async () => {
    const view = mountScheduler({
      workspaces: workspacesSnapshot([SESSION_ID]),
      loadDocument: vi.fn(async () => ({
        version: 2,
        processes: [{ id: 'p1', name: '开发', taskIds: ['t1'] }],
        tasks: { t1: { id: 't1', description: '继续评审', status: 'ready', reason: '', wakeCondition: '', sessionId: SECOND_SESSION_ID, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } },
        backlogIds: [], blockedIds: [], archiveIds: [],
      } as never)),
    })

    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.getByText('会话不可用')).toBeTruthy() })
    expect(view.queryByRole('button', { name: /打开会话/ })).toBeNull()
  })

  it('drags a task into another thread', async () => {
    const view = mountScheduler({
      loadDocument: vi.fn(async () => ({
        version: 2,
        processes: [
          { id: 'p1', name: '开发', taskIds: ['t1'] },
          { id: 'p2', name: '测试', taskIds: [] },
        ],
        tasks: { t1: { id: 't1', description: '实现功能', status: 'ready', reason: '', wakeCondition: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } },
        backlogIds: [], blockedIds: [], archiveIds: [],
      } as never)),
    })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(taskCard(view, '实现功能')).toBeTruthy() })
    const source = taskCard(view, '实现功能')
    const target = view.getByRole('list', { name: '测试任务' })
    const dataTransfer = { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn(), getData: () => 't1' }

    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })

    expect(view.instance.getSnapshot().document.processes).toEqual([
      expect.objectContaining({ id: 'p1', taskIds: [] }),
      expect.objectContaining({ id: 'p2', taskIds: ['t1'] }),
    ])
  })

  it('reorders a task before another card in the same thread', async () => {
    const descriptions = { a: '任务 A', b: '任务 B', c: '任务 C' }
    const view = mountScheduler({
      loadDocument: vi.fn(async () => ({
        version: 2,
        processes: [{ id: 'p1', name: '开发', taskIds: ['a', 'b', 'c'] }],
        tasks: Object.fromEntries(Object.entries(descriptions).map(([id, description]) => [id, { id, description, status: 'ready', reason: '', wakeCondition: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }])),
        backlogIds: [], blockedIds: [], archiveIds: [],
      } as never)),
    })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(taskCard(view, '任务 C')).toBeTruthy() })
    const source = taskCard(view, '任务 C')
    const target = taskCard(view, '任务 A')
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 100 } as DOMRect)
    const dataTransfer = { effectAllowed: 'uninitialized', dropEffect: 'none', setData: vi.fn(), getData: () => 'c' }

    fireEvent.dragStart(source, { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer, clientY: 10 })
    fireEvent.drop(target, { dataTransfer, clientY: 10 })

    expect(view.instance.getSnapshot().document.processes[0]?.taskIds).toEqual(['c', 'a', 'b'])
  })

  it('persists document changes back to the workspace and closes on Escape', async () => {
    const view = mountScheduler()
    act(() => { view.instance.actions.open() })
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })
    act(() => { view.instance.actions.addProcess('开发', 'p1') })
    await waitFor(() => {
      expect(view.saveDocument).toHaveBeenCalledWith(WORKSPACE_ID, expect.objectContaining({
        processes: [expect.objectContaining({ id: 'p1', name: '开发' })],
      }))
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '工作调度' })).toBeNull()
  })

  it('renders the durable document after load resolves', async () => {
    const view = mountScheduler({
      loadDocument: vi.fn(async () => ({
        version: 2 as const,
        processes: [{ id: 'p1', name: '发布', taskIds: ['t1'] }],
        tasks: { t1: { id: 't1', description: '检查构建', status: 'ready' as const, reason: '', wakeCondition: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } },
        backlogIds: [], blockedIds: [], archiveIds: [],
      })),
    })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.getAllByText('检查构建')).toHaveLength(2) })
    expect(view.getByText(/工作区 ·/)).toBeTruthy()
  })

  it('shows the sync-failure state when the durable load rejects', async () => {
    const view = mountScheduler({ loadDocument: vi.fn(async () => { throw new Error('unreachable') }) })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.getByText('同步失败，更改不会保存')).toBeTruthy() })
  })

  it('shows the sync-failure state and disables edits when a save rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = mountScheduler({ saveDocument: vi.fn(async () => { throw new Error('disk full') }) })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })
    act(() => { view.instance.actions.addProcess('开发', 'p1') })

    await waitFor(() => { expect(view.getByText('同步失败，更改不会保存')).toBeTruthy() })
    expect((view.getByRole('button', { name: '新建线程' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
