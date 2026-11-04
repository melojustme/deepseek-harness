// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SchedulerSnapshot, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SchedulerAttempt,
  SchedulerAttemptId,
  SchedulerCommandId,
  SessionId,
  WorkspaceId,
  WorkSchedulerDocument,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  SchedulerPanel,
  SchedulerTrigger,
  type SchedulerPanelProps,
  type SchedulerTriggerProps,
} from '../src/client/WorkScheduler.tsx'
import { addProcess, addTask, createSchedulerState } from '../src/client/scheduler.ts'
import { createWorkSchedulerStore } from '../src/client/store.ts'

const workspaceId = 'workspace-a' as WorkspaceId
const workspaceB = 'workspace-b' as WorkspaceId
const sessionId = 'session-a' as SessionId
const attemptId = '00000000-0000-4000-8000-000000000001' as SchedulerAttemptId
const taskDocument = () =>
  addTask(createSchedulerState(), { id: 'task', description: '实现面板', acceptance: ['实际检查通过'] })
const attempt = (
  status: SchedulerAttempt['status'],
  extras: Partial<SchedulerAttempt> = {},
): SchedulerAttempt => ({
  id: attemptId,
  taskId: 'task',
  commandId: 'execute' as SchedulerCommandId,
  sessionId,
  status,
  description: '实现面板',
  acceptance: ['实际检查通过'],
  feedback: '',
  createdAt: '',
  updatedAt: '',
  worktree: '/worktrees/attempt',
  baseCommit: 'base',
  evidence: {
    hash: 'fixed-evidence',
    commit: 'snapshot',
    logSeq: 10,
    logHash: 'log',
    diff: '+ implemented',
    summary: '完成面板',
    truncated: false,
    tools: [],
  },
  ...extras,
})

function transfer() {
  const values = new Map<string, string>()
  return {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
  }
}

function rect() {
  return { top: 0, height: 40, left: 0, width: 100, bottom: 40, right: 100, x: 0, y: 0, toJSON() {} }
}

function mount(
  document = taskDocument(),
  status: SchedulerSnapshot['status'] = 'ready',
  options: {
    wide?: boolean
    open?: boolean
    workspaces?: WorkspaceListState
    sessions?: SessionListState
    snapshotError?: string
  } = {},
) {
  const store = createWorkSchedulerStore().create()
  let snapshot: SchedulerSnapshot = {
    workspaceId,
    document,
    status,
    error: options.snapshotError,
  }
  const listeners = new Set<() => void>()
  const publish = (update: Partial<SchedulerSnapshot>) => {
    snapshot = { ...snapshot, ...update }
    listeners.forEach((listener) => {
      listener()
    })
  }
  const save = vi.fn(async (next: WorkSchedulerDocument) => {
    publish({ document: { ...next, revision: next.revision + 1 } })
  })
  const command = vi.fn(async () => {})
  const openSession = vi.fn()
  const refresh = vi.fn(async () => {})
  const createSession = vi.fn(async () => sessionId)
  const selectWorkspace = vi.fn()
  const workspaces: WorkspaceListState = options.workspaces ?? {
    items: [
      { workspaceId, path: '/workspace', title: '工作区', sessionIds: [sessionId], createdAt: '', updatedAt: '' },
    ],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: workspaceId,
  }
  const sessions = options.sessions ?? {
    current: sessionId,
    ids: [sessionId],
    byId: { [sessionId]: { id: sessionId, displayTitle: '开发会话' } },
  } as SessionListState
  const props = {
    useStore: <T,>(select: (state: ReturnType<typeof store.getSnapshot>) => T) =>
      select(
        useSyncExternalStore(
          listener => store.subscribe(listener),
          () => store.getSnapshot(),
        ),
      ),
    useScheduler: <T,>(select: (state: SchedulerSnapshot) => T) =>
      select(
        useSyncExternalStore(
          (listener) => {
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          },
          () => snapshot,
        ),
      ),
    useSessions: <T,>(select: (state: SessionListState) => T) => select(sessions),
    useWorkspaces: <T,>(select: (state: WorkspaceListState) => T) => select(workspaces),
    actions: store.actions,
    selectWorkspace,
    save,
    command,
    refresh,
    openSession,
    createSession,
  }
  const view = render(
    <>
      <SchedulerTrigger {...(props as unknown as SchedulerTriggerProps)} wide={options.wide ?? true} />
      <SchedulerPanel {...(props as unknown as SchedulerPanelProps)} />
    </>,
  )
  if (options.open !== false) fireEvent.click(view.getByRole('button', { name: '工作调度' }))
  return {
    ...view,
    store,
    save,
    command,
    openSession,
    refresh,
    createSession,
    selectWorkspace,
    publish,
    snapshot: () => snapshot,
    sessions,
    workspaces,
  }
}

afterEach(cleanup)

describe('native work scheduler panel', () => {
  it('opens a planning board where a personal task can be checked off without review evidence', async () => {
    const view = mount()
    expect(view.getByLabelText('规划看板')).toBeTruthy()
    expect(view.queryByLabelText('状态看板')).toBeNull()
    const card = view.getByRole('button', { name: /实现面板/ })
    const dataTransfer = transfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(view.getByRole('region', { name: '已完成列' }), { dataTransfer })
    await waitFor(() => {
      expect(view.save).toHaveBeenCalled()
    })
    expect(view.snapshot().document.archiveIds).toEqual(['task'])
    expect(view.snapshot().document.tasks.task?.status).toBe('done')
    expect(view.command).not.toHaveBeenCalled()
    expect(view.getByRole('status').textContent).toContain('已勾选完成')
    expect(view.getByRole('status').textContent).not.toContain('先完成执行并检查本轮证据，才能通过审查。')
  })

  it('lets an unattempted card move to 已通过 on the optional execution board without the evidence banner', async () => {
    const view = mount()
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    const card = view.getByRole('button', { name: /实现面板/ })
    const dataTransfer = transfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(view.getByRole('region', { name: '已通过列' }), { dataTransfer })
    await waitFor(() => {
      expect(view.save).toHaveBeenCalled()
    })
    expect(view.snapshot().document.tasks.task?.status).toBe('done')
    expect(view.queryByRole('status')?.textContent).not.toContain('先完成执行并检查本轮证据，才能通过审查。')
    expect(view.command).not.toHaveBeenCalled()
  })

  it('still requires review evidence before approving an executed attempt', () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('running')
    const view = mount(document)
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    const card = view.getByRole('button', { name: /实现面板/ })
    const dataTransfer = transfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(view.getByRole('region', { name: '已通过列' }), { dataTransfer })
    expect(view.command).not.toHaveBeenCalled()
    expect(view.save).not.toHaveBeenCalled()
    expect(view.getByRole('status').textContent).toContain('先完成执行并检查本轮证据，才能通过审查。')
  })

  it('requires confirmation before details execution submits a Host command', async () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '执行任务' }))
    expect(view.command).not.toHaveBeenCalled()
    expect(view.getByRole('button', { name: '确认执行' })).toBe(globalThis.document.activeElement)
    fireEvent.click(view.getByRole('button', { name: '确认执行' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'execute', taskId: 'task', expectedRevision: 0 }),
      )
    })
    expect(view.save).not.toHaveBeenCalled()
  })

  it('rejects a confirmation after the document revision changes', () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '执行任务' }))
    act(() => {
      view.publish({ document: { ...view.snapshot().document, revision: 1 } })
    })
    fireEvent.click(view.getByRole('button', { name: '确认执行' }))
    expect(view.command).not.toHaveBeenCalled()
    expect(view.getByRole('status').textContent).toContain('看板已更新')
  })

  it('opens evidence review instead of approving a dropped executed task', () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('review')
    const view = mount(document)
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowRight', altKey: true })
    expect(view.getByRole('button', { name: '通过审查' })).toBeTruthy()
    expect(view.command).not.toHaveBeenCalled()
    expect(view.save).not.toHaveBeenCalled()
  })

  it('cancels the confirmation without stopping an active attempt', () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('running')
    const view = mount(document)
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    const card = view.getByRole('button', { name: /实现面板/ })
    fireEvent.keyDown(card, { key: 'ArrowLeft', altKey: true })
    expect(view.getByRole('button', { name: '确认停止' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '取消操作' }))
    expect(view.command).not.toHaveBeenCalled()
    expect(view.snapshot().document.attempts[attemptId]?.status).toBe('running')
  })

  it('ignores a stale drag and disables keyboard moves while disconnected', () => {
    const view = mount()
    const dataTransfer = transfer()
    const card = view.getByRole('button', { name: /实现面板/ })
    fireEvent.dragStart(card, { dataTransfer })
    act(() => {
      view.publish({ document: { ...view.snapshot().document, revision: 1 } })
    })
    fireEvent.drop(view.getByRole('region', { name: '已完成列' }), { dataTransfer })
    expect(view.getByRole('status').textContent).toContain('拖动期间看板已更新')
    act(() => {
      view.publish({ status: 'error' })
    })
    fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true })
    expect(view.save).not.toHaveBeenCalled()
    expect(view.command).not.toHaveBeenCalled()
  })

  it('disables writes before the workspace has loaded', () => {
    const view = mount(taskDocument(), 'loading')
    expect((view.getByRole('button', { name: '新建任务' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: '清空看板' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('uses separate board and detail views and returns focus to the selected card', async () => {
    const view = mount()
    const card = view.getByRole('button', { name: /实现面板/ })
    const board = view.getByLabelText('规划看板')
    fireEvent.click(card)
    expect(board.hidden).toBe(true)
    expect(view.getByRole('button', { name: '返回看板' })).toBe(globalThis.document.activeElement)
    expect(view.getByLabelText('Git 起始版本').closest('details')?.open).toBe(false)
    fireEvent.click(view.getByRole('button', { name: '返回看板' }))
    await waitFor(() => {
      expect(globalThis.document.activeElement).toBe(card)
    })
    expect(board.hidden).toBe(false)
    expect(view.command).not.toHaveBeenCalled()
  })

  it('keeps the board visible while composing and reveals an empty-state hint', () => {
    const view = mount(createSchedulerState())
    expect(view.getByText('点「新建任务」开始规划。')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    expect(view.getByLabelText('规划看板').hidden).toBe(false)
    fireEvent.click(view.getByRole('button', { name: '取消' }))
    expect(view.save).not.toHaveBeenCalled()
  })

  it('saves acceptance criteria and a Session association without starting execution', async () => {
    const view = mount(createSchedulerState())
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.change(view.getByLabelText('任务描述'), { target: { value: '添加看板' } })
    fireEvent.change(view.getByLabelText('验收条件（可选，每行一项）'), { target: { value: '支持新建\n支持审查' } })
    fireEvent.click(view.getByText('更多选项'))
    fireEvent.change(view.getByLabelText('关联会话'), { target: { value: sessionId } })
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))
    await waitFor(() => {
      expect(view.save).toHaveBeenCalledOnce()
    })
    expect(Object.values(view.snapshot().document.tasks)[0]).toMatchObject({
      description: '添加看板',
      acceptance: ['支持新建', '支持审查'],
      sessionId,
    })
    expect(view.command).not.toHaveBeenCalled()
  })

  it('retains a failed draft for correction and retry', async () => {
    const view = mount(createSchedulerState())
    view.save.mockRejectedValueOnce(new Error('revision conflict'))
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.change(view.getByLabelText('任务描述'), { target: { value: '保留草稿' } })
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toContain('revision conflict')
    })
    expect((view.getByLabelText('任务描述') as HTMLTextAreaElement).value).toBe('保留草稿')
  })

  it('clears the current Workspace document after confirmation and leaves a success notice', async () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: '清空看板' }))
    const confirm = view.getByRole('dialog', { name: '清空当前工作区看板？' })
    expect((within(confirm).getByRole('button', { name: '清空看板' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(confirm).getByRole('checkbox'))
    fireEvent.click(within(confirm).getByRole('button', { name: '清空看板' }))
    await waitFor(() => {
      expect(view.save).toHaveBeenCalledWith(expect.objectContaining({
        version: 3,
        revision: 0,
        tasks: {},
        attempts: {},
        processes: [],
        backlogIds: [],
        blockedIds: [],
        archiveIds: [],
      }))
    })
    expect(view.getByRole('status').textContent).toContain('已清空当前工作区看板。')
  })

  it('retries the same execution command after an uncertain transport result', async () => {
    const view = mount()
    view.command.mockRejectedValueOnce(new Error('connection lost'))
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '执行任务' }))
    fireEvent.click(view.getByRole('button', { name: '确认执行' }))
    await waitFor(() => {
      expect(view.getByRole('button', { name: '重试原请求' })).toBeTruthy()
    })
    fireEvent.click(view.getByRole('button', { name: '重试原请求' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledTimes(2)
    })
    expect(view.command.mock.calls[1]).toEqual(view.command.mock.calls[0])
  })

  it('keeps execution alive when the window closes and opens native logs', () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('running')
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '关闭' }))
    expect(view.command).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    fireEvent.click(view.getByRole('button', { name: '打开执行会话' }))
    expect(view.openSession).toHaveBeenCalledWith(sessionId)
  })

  it('submits review decisions against the displayed evidence and requires rework feedback', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('review')
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    expect((view.getByRole('button', { name: '提交返工' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(view.getByLabelText('返工意见 / 接受失败检查的原因'), { target: { value: '补充测试' } })
    fireEvent.click(view.getByRole('button', { name: '提交返工' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'rework',
          attemptId,
          evidenceHash: 'fixed-evidence',
          feedback: '补充测试',
          expectedRevision: 0,
        }),
      )
    })
    act(() => {
      view.publish({ document: { ...document, revision: 1 } })
    })
    expect(view.snapshot().document.revision).toBe(1)
  })

  it('moves personal tasks between planning lanes with drag, drop-on-card, and keyboard', async () => {
    const document = addProcess(taskDocument(), '开发', 'p1')
    document.backlogIds.push('ghost')
    const view = mount(document)
    const card = view.getByRole('button', { name: /实现面板/ })
    const dataTransfer = transfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.dragOver(view.getByRole('region', { name: '开发列' }))
    fireEvent.drop(view.getByRole('region', { name: '开发列' }), { dataTransfer })
    await waitFor(() => {
      expect(view.snapshot().document.processes[0]?.taskIds).toEqual(['task'])
    })
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowRight', altKey: true })
    await waitFor(() => {
      expect(view.snapshot().document.blockedIds).toEqual(['task'])
    })
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowRight', altKey: true })
    await waitFor(() => {
      expect(view.getByRole('status').textContent).toContain('已勾选完成')
    })
  })

  it('reorders two personal cards in the same planning lane', async () => {
    let document = addTask(taskDocument(), { id: 'second', description: '第二项' })
    document = addProcess(document, '开发', 'p1')
    const view = mount(document)
    const first = view.getByRole('button', { name: /实现面板/ })
    fireEvent.keyDown(first, { key: 'ArrowDown', altKey: true })
    await waitFor(() => {
      expect(view.snapshot().document.backlogIds).toEqual(['second', 'task'])
    })
    const dataTransfer = transfer()
    fireEvent.dragStart(view.getByRole('button', { name: /第二项/ }), { dataTransfer })
    fireEvent.dragOver(view.getByRole('button', { name: /实现面板/ }), { clientY: 30, currentTarget: { getBoundingClientRect: rect } })
    fireEvent.drop(view.getByRole('button', { name: /实现面板/ }), {
      dataTransfer,
      clientY: 30,
      currentTarget: { getBoundingClientRect: rect },
    })
    await waitFor(() => {
      expect(view.save.mock.calls.length).toBeGreaterThan(1)
    })
  })

  it('adds, names, and uses a planning column', async () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: '添加列' }))
    fireEvent.change(view.getByLabelText('新列名称'), { target: { value: '发布' } })
    fireEvent.submit(view.getByLabelText('新列名称').closest('form')!)
    await waitFor(() => {
      expect(view.snapshot().document.processes[0]?.name).toBe('发布')
    })
    fireEvent.blur(view.getByLabelText('列名称 发布'), { target: { value: '上线' } })
    await waitFor(() => {
      expect(view.snapshot().document.processes[0]?.name).toBe('上线')
    })
  })

  it('filters cards, toggles fullscreen, refreshes, and exports the document', () => {
    const createObjectURL = vi.fn(() => 'blob:board')
    const revokeObjectURL = vi.fn()
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const click = vi.fn()
    const nativeCreate = globalThis.document.createElement.bind(globalThis.document)
    const createSpy = vi.spyOn(globalThis.document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') return { click, href: '', download: '' } as unknown as HTMLAnchorElement
      return nativeCreate(tag)
    }) as typeof document.createElement)
    try {
      const view = mount()
      fireEvent.change(view.getByLabelText('搜索任务'), { target: { value: '没有这个' } })
      expect(view.queryByRole('button', { name: /实现面板/ })).toBeNull()
      fireEvent.change(view.getByLabelText('搜索任务'), { target: { value: '' } })
      fireEvent.click(view.getByText('看板选项'))
      fireEvent.click(view.getByRole('button', { name: '刷新' }))
      expect(view.refresh).toHaveBeenCalled()
      fireEvent.click(view.getByRole('button', { name: '导出' }))
      expect(createObjectURL).toHaveBeenCalled()
      expect(click).toHaveBeenCalled()
      fireEvent.click(view.getByRole('button', { name: '全屏' }))
      expect(view.getByRole('dialog', { name: '工作调度' }).dataset.fullscreen).toBe('true')
      fireEvent.click(view.getByRole('button', { name: '还原' }))
      expect(view.getByRole('dialog', { name: '工作调度' }).dataset.fullscreen).toBeUndefined()
    } finally {
      createSpy.mockRestore()
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    }
  })

  it('imports a version-3 board and reports malformed JSON', async () => {
    const view = mount()
    fireEvent.click(view.getByText('看板选项'))
    const input = view.getByLabelText('导入看板')
    const imported = addTask(createSchedulerState(), { id: 'imported', description: '导入任务' })
    fireEvent.change(input, {
      target: { files: [new File([JSON.stringify(imported)], 'board.json', { type: 'application/json' })] },
    })
    await waitFor(() => {
      expect(view.snapshot().document.tasks.imported?.description).toBe('导入任务')
    })
    fireEvent.change(input, {
      target: { files: [new File(['{'], 'bad.json', { type: 'application/json' })] },
    })
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toMatch(/JSON|Unexpected/)
    })
  })

  it('edits a personal task, checks it off from details, and restores it', async () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '编辑任务' }))
    fireEvent.change(view.getByLabelText('任务描述'), { target: { value: '改写面板' } })
    fireEvent.click(view.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.description).toBe('改写面板')
    })
    fireEvent.click(view.getByRole('button', { name: '勾选完成' }))
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.status).toBe('done')
    })
    fireEvent.change(view.getByLabelText('放到'), { target: { value: 'backlog' } })
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.status).toBe('ready')
    })
  })

  it('blocks, yields, and wakes a personal task from details', async () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '暂停并等待' }))
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.status).toBe('sync-blocked')
    })
    fireEvent.click(view.getByRole('button', { name: '让后续任务先做' }))
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.status).toBe('async-blocked')
    })
    fireEvent.click(view.getByRole('button', { name: '恢复任务' }))
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.status).toBe('ready')
    })
    fireEvent.click(view.getByRole('button', { name: '上移' }))
    fireEvent.click(view.getByRole('button', { name: '下移' }))
    fireEvent.click(view.getByRole('button', { name: '创建草稿会话' }))
    await waitFor(() => {
      expect(view.createSession).toHaveBeenCalled()
    })
  })

  it('confirms details execution, then rejects a stale attempt state', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('running')
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '停止执行' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancel' }))
    })
    fireEvent.click(view.getByRole('button', { name: '返回看板' }))
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowLeft', altKey: true })
    act(() => {
      view.publish({
        document: { ...view.snapshot().document, attempts: { [attemptId]: attempt('approved') } },
      })
    })
    fireEvent.click(view.getByRole('button', { name: '确认停止' }))
    expect(view.getByRole('status').textContent).toContain('任务状态已变化')
  })

  it('opens review evidence, logs, diffs, and submits approval', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('review', {
      evidence: {
        hash: 'fixed-evidence',
        commit: 'snapshot',
        logSeq: 10,
        logHash: 'log',
        diff: '',
        summary: '完成面板',
        truncated: true,
        tools: [{ name: 'bash', failed: false, arguments: '{}', result: 'ok' }],
      },
    })
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    expect(view.getByText('完成面板')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '执行记录' }))
    fireEvent.click(view.getByText('bash · 已返回结果'))
    fireEvent.click(view.getByRole('button', { name: '打开完整执行会话 / 处理审批' }))
    expect(view.openSession).toHaveBeenCalledWith(sessionId)
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    fireEvent.click(view.getByRole('button', { name: '文件差异' }))
    fireEvent.click(view.getByRole('button', { name: '重新固定文件证据' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refresh-review' }))
    })
    fireEvent.click(view.getByRole('button', { name: '通过审查' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'approve' }))
    })
  })

  it('shows live todos, pending interaction, and approved history', () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('approved', { error: '上次失败已保留' })
    document.tasks.task!.sessionId = sessionId
    const sessions = {
      current: sessionId,
      ids: [sessionId],
      byId: {
        [sessionId]: {
          id: sessionId,
          displayTitle: '开发会话',
          pendingInteraction: 'approval',
          projectionValues: {
            todos: [
              { content: '已完成项', status: 'completed' },
              { content: '正在实现', status: 'in_progress' },
            ],
          },
        },
      },
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    } as SessionListState
    const view = mount(document, 'ready', { sessions })
    fireEvent.click(view.getByRole('button', { name: /等待用户操作/ }))
    expect(view.getByLabelText('工作进度')).toBeTruthy()
    expect(view.getByText('正在实现')).toBeTruthy()
    expect(view.getByText('等待审批、计划确认或问题答复，请打开执行会话处理。')).toBeTruthy()
    expect(view.getByText('审查已通过，产物保留在 worktree，未合入用户分支。')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '打开关联会话' }))
    expect(view.openSession).toHaveBeenCalledWith(sessionId)
  })

  it('retries a failed attempt from details and yields a queued thread', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('failed')
    document.tasks.task!.status = 'async-blocked'
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '重试任务' }))
    fireEvent.click(view.getByRole('button', { name: '确认执行' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'execute' }))
    })
    act(() => {
      view.publish({
        document: {
          ...document,
          revision: 1,
          attempts: { [attemptId]: attempt('queued') },
        },
      })
    })
    fireEvent.click(view.getByRole('button', { name: '恢复线程占位' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resume' }))
    })
  })

  it('cancels a queued attempt and reports a non-Error command failure', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('queued')
    const view = mount(document)
    view.command.mockRejectedValueOnce('wire down')
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '取消排队' }))
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toContain('wire down')
    })
  })

  it('closes nested UI with Escape and traps Tab inside the dialog', () => {
    HTMLElement.prototype.getClientRects = function getClientRects() {
      return [rect()] as unknown as DOMRectList
    }
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.keyDown(globalThis.document, { key: 'Escape' })
    expect(view.queryByLabelText('任务描述')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '添加列' }))
    fireEvent.keyDown(globalThis.document, { key: 'Escape' })
    expect(view.queryByLabelText('新列名称')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.keyDown(globalThis.document, { key: 'Escape' })
    expect(view.queryByRole('button', { name: '返回看板' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '清空看板' }))
    fireEvent.keyDown(globalThis.document, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '清空当前工作区看板？' })).toBeNull()
    const dialog = view.getByRole('dialog', { name: '工作调度' })
    const controls = [...dialog.querySelectorAll<HTMLElement>('button,input,textarea,select,summary')].filter(
      element => element.getClientRects().length > 0,
    )
    controls.at(-1)?.focus()
    fireEvent.keyDown(globalThis.document, { key: 'Tab' })
    controls[0]?.focus()
    fireEvent.keyDown(globalThis.document, { key: 'Tab', shiftKey: true })
    fireEvent.keyDown(globalThis.document, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '工作调度' })).toBeNull()
  })

  it('rejects execution-board review for an unattempted card and archives on 已通过', async () => {
    const view = mount()
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    const card = view.getByRole('button', { name: /实现面板/ })
    const dataTransfer = transfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(view.getByRole('region', { name: '待审查列' }), { dataTransfer })
    expect(view.getByRole('status').textContent).toContain('待审查只用于已执行的任务')
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(view.getByRole('region', { name: '已通过列' }), { dataTransfer })
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.status).toBe('done')
    })
    expect(view.queryByRole('status')?.textContent).not.toContain('先完成执行并检查本轮证据，才能通过审查。')
  })

  it('marks an unattempted execution-board card in progress without a Host command', async () => {
    const view = mount()
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    const card = view.getByRole('button', { name: /实现面板/ })
    const dataTransfer = transfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(view.getByRole('region', { name: '进行中列' }), { dataTransfer })
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.status).toBe('running')
    })
    expect(view.command).not.toHaveBeenCalled()
  })

  it('confirms execution from a failed execution-board gesture', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('failed')
    const view = mount(document)
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowRight', altKey: true })
    fireEvent.click(view.getByRole('button', { name: '确认执行' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'execute' }))
    })
  })

  it('cancels confirmation with Escape and ignores a mismatched drop payload', () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('running')
    const view = mount(document)
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(globalThis.document, { key: 'Escape' })
    expect(view.queryByRole('button', { name: '确认停止' })).toBeNull()
    const dataTransfer = transfer()
    dataTransfer.setData('application/x-dsh-task', 'other')
    fireEvent.dragStart(view.getByRole('button', { name: /实现面板/ }), { dataTransfer: transfer() })
    fireEvent.drop(view.getByRole('region', { name: '已通过列' }), { dataTransfer })
    expect(view.command).not.toHaveBeenCalled()
  })

  it('switches Workspace, reports saving, and keeps the icon-only trigger', () => {
    const workspaces: WorkspaceListState = {
      items: [
        { workspaceId, path: '/a', title: '工作区', sessionIds: [sessionId], createdAt: '', updatedAt: '' },
        { workspaceId: workspaceB, path: '/b', title: '另一工作区', sessionIds: [], createdAt: '', updatedAt: '' },
      ],
      archivedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: workspaceId,
    }
    const view = mount(taskDocument(), 'saving', { workspaces, wide: false, open: false })
    expect(view.getByRole('button', { name: '工作调度' }).textContent).not.toContain('工作调度')
    fireEvent.click(view.getByRole('button', { name: '工作调度' }))
    expect(view.getByText('保存中…')).toBeTruthy()
    fireEvent.change(view.getByLabelText('看板工作区'), { target: { value: workspaceB } })
    expect(view.store.getSnapshot().workspaceId).toBe(workspaceB)
  })

  it('shows a snapshot error without a retry control and skips writes without a Workspace', () => {
    const view = mount(createSchedulerState(), 'error', {
      snapshotError: 'host unreachable',
      workspaces: {
        items: [],
        archivedSessionIds: [],
        state: 'idle',
        phase: 'ready',
        error: null,
        baselinesReady: true,
        recentWorkspaceId: undefined,
      },
    })
    expect(view.getByText('请先创建工作区', { exact: false })).toBeTruthy()
    expect(view.getByRole('alert').textContent).toContain('host unreachable')
    expect(view.queryByRole('button', { name: '重试原请求' })).toBeNull()
  })

  it('does not submit a planning column without a name', () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: '添加列' }))
    fireEvent.submit(view.getByLabelText('新列名称').closest('form')!)
    expect(view.save).not.toHaveBeenCalled()
  })

  it('places a personal task on a process, blocked, and archive lane from details', async () => {
    const view = mount(addProcess(taskDocument(), '开发', 'p1'))
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.change(view.getByLabelText('放到'), { target: { value: 'p1' } })
    await waitFor(() => {
      expect(view.snapshot().document.processes[0]?.taskIds).toEqual(['task'])
    })
    fireEvent.change(view.getByLabelText('放到'), { target: { value: 'blocked' } })
    await waitFor(() => {
      expect(view.snapshot().document.blockedIds).toEqual(['task'])
    })
    fireEvent.change(view.getByLabelText('放到'), { target: { value: 'archive' } })
    await waitFor(() => {
      expect(view.snapshot().document.archiveIds).toEqual(['task'])
    })
  })

  it('reports a failed planning save and ignores attempted cards on the planning board', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('running')
    const view = mount(document)
    view.save.mockRejectedValueOnce(new Error('save failed'))
    const personal = addTask(taskDocument(), { id: 'personal', description: '个人任务' })
    act(() => {
      view.publish({ document: personal })
    })
    const card = view.getByRole('button', { name: /个人任务/ })
    const dataTransfer = transfer()
    fireEvent.dragStart(card, { dataTransfer })
    fireEvent.drop(view.getByRole('region', { name: '已完成列' }), { dataTransfer })
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toContain('save failed')
    })
  })

  it('opens rework details from the execution board and confirms a still-running stop', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('review')
    const view = mount(document)
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.click(view.getByRole('button', { name: '执行看板' }))
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowLeft', altKey: true })
    expect(view.getByRole('status').textContent).toContain('请填写返工意见')
    act(() => {
      view.publish({ document: { ...document, attempts: { [attemptId]: attempt('running') } } })
    })
    fireEvent.click(view.getByRole('button', { name: '返回看板' }))
    fireEvent.keyDown(view.getByRole('button', { name: /实现面板/ }), { key: 'ArrowLeft', altKey: true })
    fireEvent.click(view.getByRole('button', { name: '确认停止' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancel' }))
    })
  })

  it('rejects execute confirmation after the attempt starts running', () => {
    const view = mount()
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '执行任务' }))
    act(() => {
      view.publish({
        document: { ...view.snapshot().document, attempts: { [attemptId]: attempt('running') } },
      })
    })
    fireEvent.click(view.getByRole('button', { name: '确认执行' }))
    expect(view.getByRole('status').textContent).toContain('任务状态已变化')
  })

  it('yields a review thread and opens historical logs', async () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('review')
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '异步让出线程' }))
    await waitFor(() => {
      expect(view.command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'yield' }))
    })
    fireEvent.click(view.getByText('查看本轮日志'))
    expect(view.openSession).toHaveBeenCalledWith(sessionId)
  })

  it('abandons an edit when the task disappears and clears a session binding', async () => {
    const bound = addTask(createSchedulerState(), {
      id: 'task',
      description: '实现面板',
      sessionId,
    })
    const view = mount(bound)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '编辑任务' }))
    fireEvent.click(view.getByText('更多选项'))
    fireEvent.change(view.getByLabelText('关联会话'), { target: { value: '' } })
    fireEvent.click(view.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(view.snapshot().document.tasks.task?.sessionId).toBeUndefined()
    })
    fireEvent.click(view.getByRole('button', { name: '编辑任务' }))
    act(() => {
      view.publish({ document: createSchedulerState(1) })
    })
    fireEvent.click(view.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toContain('要编辑的任务不存在')
    })
  })

  it('creates a task on a named column and ignores a drag click', async () => {
    const view = mount(addProcess(createSchedulerState(), '开发', 'p1'))
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.change(view.getByLabelText('任务描述'), { target: { value: '列上的任务' } })
    fireEvent.change(view.getByLabelText('放到'), { target: { value: 'p1' } })
    fireEvent.click(view.getByRole('button', { name: '添加任务' }))
    await waitFor(() => {
      expect(view.snapshot().document.processes[0]?.taskIds).toHaveLength(1)
    })
    const card = view.getByRole('button', { name: /列上的任务/ })
    fireEvent.dragStart(card, { dataTransfer: transfer() })
    fireEvent.click(card)
    expect(view.queryByRole('button', { name: '返回看板' })).toBeNull()
  })

  it('renders a failed tool record and an empty log', () => {
    const document = taskDocument()
    document.attempts[attemptId] = attempt('failed', {
      evidence: {
        hash: 'fixed-evidence',
        commit: 'snapshot',
        logSeq: 1,
        logHash: 'log',
        diff: '+ x',
        summary: '失败',
        truncated: false,
        tools: [{ name: 'bash', failed: true, arguments: '{}', result: 'boom' }],
      },
    })
    const view = mount(document)
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '执行记录' }))
    expect(view.getByText('bash · 失败或未完成')).toBeTruthy()
    act(() => {
      view.publish({ document: taskDocument() })
    })
    fireEvent.click(view.getByRole('button', { name: '执行记录' }))
    expect(view.getByText('尚无执行记录')).toBeTruthy()
  })

  it('rejects an import after the Workspace changes and ignores an empty file input', async () => {
    const workspaces: WorkspaceListState = {
      items: [
        { workspaceId, path: '/a', title: '工作区', sessionIds: [sessionId], createdAt: '', updatedAt: '' },
        { workspaceId: workspaceB, path: '/b', title: '另一工作区', sessionIds: [], createdAt: '', updatedAt: '' },
      ],
      archivedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: workspaceId,
    }
    const view = mount(taskDocument(), 'ready', { workspaces })
    fireEvent.click(view.getByText('看板选项'))
    fireEvent.change(view.getByLabelText('导入看板'), { target: { files: [] } })
    const imported = addTask(createSchedulerState(), { id: 'imported', description: '导入任务' })
    fireEvent.change(view.getByLabelText('导入看板'), {
      target: { files: [new File([JSON.stringify(imported)], 'board.json', { type: 'application/json' })] },
    })
    fireEvent.change(view.getByLabelText('看板工作区'), { target: { value: workspaceB } })
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toContain('工作区已切换')
    })
  })

  it('clears drag state, ignores off-lane keyboard moves, and edits the Git ref', () => {
    const view = mount(addProcess(taskDocument(), '开发', 'p1'))
    const card = view.getByRole('button', { name: /实现面板/ })
    fireEvent.dragStart(card, { dataTransfer: transfer() })
    fireEvent.dragEnd(card)
    fireEvent.keyDown(card, { key: 'ArrowLeft', altKey: true })
    fireEvent.keyDown(card, { key: 'Enter', altKey: true })
    fireEvent.click(card)
    fireEvent.change(view.getByLabelText('Git 起始版本'), { target: { value: 'main' } })
    expect((view.getByLabelText('Git 起始版本') as HTMLInputElement).value).toBe('main')
  })

  it('shows a Session id when the registry has no title', () => {
    const sessions = {
      current: sessionId,
      ids: [sessionId],
      byId: { [sessionId]: { id: sessionId } },
    } as SessionListState
    const view = mount(createSchedulerState(), 'ready', { sessions })
    fireEvent.click(view.getByRole('button', { name: '新建任务' }))
    fireEvent.click(view.getByText('更多选项'))
    expect(view.getByRole('option', { name: sessionId })).toBeTruthy()
  })

  it('abandons draft session creation after the Workspace changes', async () => {
    const workspaces: WorkspaceListState = {
      items: [
        { workspaceId, path: '/a', title: '工作区', sessionIds: [sessionId], createdAt: '', updatedAt: '' },
        { workspaceId: workspaceB, path: '/b', title: '另一工作区', sessionIds: [], createdAt: '', updatedAt: '' },
      ],
      archivedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: workspaceId,
    }
    const view = mount(taskDocument(), 'ready', { workspaces })
    let finish: (id: SessionId) => void = () => {}
    view.createSession.mockImplementationOnce(() => new Promise<SessionId>((resolve) => { finish = resolve }))
    fireEvent.click(view.getByRole('button', { name: /实现面板/ }))
    fireEvent.click(view.getByRole('button', { name: '创建草稿会话' }))
    act(() => {
      view.store.actions.workspace(workspaceB)
    })
    finish(sessionId)
    await waitFor(() => {
      expect(view.createSession).toHaveBeenCalled()
    })
    expect(view.save).not.toHaveBeenCalled()
  })
})
