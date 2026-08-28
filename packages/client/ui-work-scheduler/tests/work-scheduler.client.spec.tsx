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
    expect(view.queryByRole('textbox', { name: '任务内容' })).toBeNull()

    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    const taskInput = view.getByRole('textbox', { name: '任务内容' })
    expect(document.activeElement).toBe(taskInput)
    fireEvent.change(taskInput, { target: { value: '检查构建' } })
    fireEvent.click(view.getByRole('radio', { name: '发布' }))
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))

    expect(view.getAllByText('检查构建')).toHaveLength(2)
    expect(view.getByText(/1 个线程可以继续推进/)).toBeTruthy()
    expect(view.queryByRole('textbox', { name: '任务内容' })).toBeNull()
  })

  it('toggles application fullscreen and restores the captured window geometry', () => {
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    const dialog = view.getByRole('dialog', { name: '工作调度' })
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      top: 70, left: 64, right: 1264, bottom: 770, width: 1200, height: 700,
    } as DOMRect)

    const fullscreen = view.getByRole('button', { name: '全屏' })
    fullscreen.focus()
    fireEvent.click(fullscreen)

    const restore = view.getByRole('button', { name: '还原' })
    expect(restore).toBe(fullscreen)
    expect(restore.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(restore)

    fireEvent.click(restore)
    expect(view.getByRole('button', { name: '全屏' })).toBe(fullscreen)
    expect(fullscreen.getAttribute('aria-pressed')).toBe('false')
    expect(dialog.style.top).toBe('70px')
    expect(dialog.style.left).toBe('64px')
    expect(dialog.style.width).toBe('1200px')
    expect(dialog.style.height).toBe('700px')
  })

  it('resets window mode and geometry after closing and reopening', async () => {
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    const dialog = view.getByRole('dialog', { name: '工作调度' })
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      top: 70, left: 64, right: 1264, bottom: 770, width: 1200, height: 700,
    } as DOMRect)
    fireEvent.click(view.getByRole('button', { name: '全屏' }))
    fireEvent.click(view.getByRole('button', { name: '关闭' }))
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))

    await waitFor(() => {
      expect(view.getByRole('button', { name: '全屏' }).getAttribute('aria-pressed')).toBe('false')
    })
    const reopened = view.getByRole('dialog', { name: '工作调度' })
    expect(reopened.style.top).toBe('')
    expect(reopened.style.left).toBe('')
    expect(reopened.style.width).toBe('')
    expect(reopened.style.height).toBe('')
  })

  it('resizes from the bottom right within minimum bounds and stops after pointer release', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    const dialog = view.getByRole('dialog', { name: '工作调度' })
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      top: 50, left: 60, right: 1060, bottom: 750, width: 1000, height: 700,
    } as DOMRect)
    const handle = view.getByTestId('work-scheduler-resize-handle')

    fireEvent.pointerDown(handle, { clientX: 1060, clientY: 750, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 700, clientY: 400, pointerId: 1 })
    expect(dialog.style.width).toBe('760px')
    expect(dialog.style.height).toBe('560px')

    fireEvent.pointerUp(window, { pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 1100, clientY: 760, pointerId: 1 })
    expect(dialog.style.width).toBe('760px')
    expect(dialog.style.height).toBe('560px')
  })

  it('binds a new task to a Workspace Session and leaves the scheduler when opening it', async () => {
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })
    act(() => { view.instance.actions.addProcess('开发', 'p1') })

    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.change(view.getByRole('textbox', { name: '任务内容' }), { target: { value: '继续实现' } })
    fireEvent.click(view.getByRole('radio', { name: '开发' }))
    fireEvent.click(view.getByRole('button', { name: '选择关联对话' }))
    expect(view.queryByRole('combobox', { name: '关联会话' })).toBeNull()
    const sessionSearch = view.getByRole('searchbox', { name: '搜索对话' })
    expect(document.activeElement).toBe(sessionSearch)
    fireEvent.change(sessionSearch, { target: { value: '评审' } })
    expect(view.queryByRole('button', { name: '关联对话：实现会话' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '关联对话：评审会话' }))
    const selectedSession = view.getByRole('button', { name: '选择关联对话，当前：评审会话' })
    expect(document.activeElement).toBe(selectedSession)
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))

    const task = Object.values(view.instance.getSnapshot().document.tasks)[0]
    expect(task?.sessionId).toBe(SECOND_SESSION_ID)
    fireEvent.click(view.getByRole('button', { name: '打开会话：评审会话' }))
    expect(view.openSession).toHaveBeenCalledWith(SECOND_SESSION_ID)
    expect(view.queryByRole('dialog', { name: '工作调度' })).toBeNull()
  })

  it('closes task-creation layers in order and resets the draft', async () => {
    const view = mountScheduler()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })

    const taskTrigger = view.getByRole('button', { name: '新建任务' })
    fireEvent.click(taskTrigger)
    fireEvent.change(view.getByRole('textbox', { name: '任务内容' }), { target: { value: '未提交草稿' } })
    const sessionTrigger = view.getByRole('button', { name: '选择关联对话' })
    fireEvent.click(sessionTrigger)
    const sessionSearch = view.getByRole('searchbox', { name: '搜索对话' })
    expect(document.activeElement).toBe(sessionSearch)
    fireEvent.change(sessionSearch, { target: { value: '评审' } })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('searchbox', { name: '搜索对话' })).toBeNull()
    expect(view.getByRole('textbox', { name: '任务内容' })).toBeTruthy()
    expect(document.activeElement).toBe(sessionTrigger)

    fireEvent.click(view.getByRole('button', { name: '选择关联对话' }))
    expect((view.getByRole('searchbox', { name: '搜索对话' }) as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('textbox', { name: '任务内容' })).toBeNull()
    expect(view.getByRole('dialog', { name: '工作调度' })).toBeTruthy()
    expect(document.activeElement).toBe(taskTrigger)

    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    expect((view.getByRole('textbox', { name: '任务内容' }) as HTMLTextAreaElement).value).toBe('')
    expect((view.getByRole('radio', { name: '待分配' }) as HTMLInputElement).checked).toBe(true)
    expect(view.getByRole('button', { name: '选择关联对话' })).toBeTruthy()
  })

  it('shows an accurate empty state when the Workspace has no linkable Sessions', async () => {
    const view = mountScheduler({ workspaces: workspacesSnapshot([]) })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })

    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.click(view.getByRole('button', { name: '选择关联对话' }))

    expect(view.getByText('当前工作区没有可关联对话')).toBeTruthy()
    expect(view.queryByRole('combobox', { name: '关联会话' })).toBeNull()
  })

  it('drops a pending Session choice when it leaves the active Workspace', async () => {
    const workspaces = workspacesSnapshot()
    const view = mountScheduler({ workspaces })
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    await waitFor(() => { expect(view.instance.getSnapshot().status).toBe('ready') })

    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.change(view.getByRole('textbox', { name: '任务内容' }), { target: { value: '重新确认关联' } })
    fireEvent.click(view.getByRole('button', { name: '选择关联对话' }))
    fireEvent.click(view.getByRole('button', { name: '关联对话：评审会话' }))

    workspaces.items[0] = { ...workspaces.items[0]!, sessionIds: [SESSION_ID] }
    act(() => { view.instance.actions.addProcess('触发刷新', 'p1') })
    expect(view.getByRole('button', { name: '选择关联对话' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))

    const task = Object.values(view.instance.getSnapshot().document.tasks)[0]
    expect(task?.sessionId).toBeUndefined()
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
