/** Native scheduler board and versioned human review. */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { InjectFace, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot, SchedulerSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SchedulerAttempt,
  SchedulerCommand,
  SchedulerCommandId,
  SchedulerExecutionStatus,
  SessionId,
  WorkspaceId,
  WorkSchedulerDocument,
} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import { Button, IconListPenOutline16, Modal, RiskConfirmation, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  addProcess,
  addTask,
  createSchedulerState,
  isClearedSchedulerDocument,
  moveTask,
  normalizeSchedulerState,
  removeTask,
  renameProcess,
  setTaskStatus,
  wakeTask,
} from './scheduler.ts'
import { resolveBoardDrop, type BoardColumn } from './board-drop.ts'
import type { createWorkSchedulerStore } from './store.ts'
import css from './WorkScheduler.module.css'

type StoreProps = PropsStore<ReturnType<typeof createWorkSchedulerStore>>
/** Sidebar props derived from the slot and shared view state. */
export type SchedulerTriggerProps = PropsRuntime<'sidebar.footer.action'> & StoreProps
/** Runtime snapshot and plain callbacks supplied by the plugin. */
export interface WorkSchedulerInjected {
  hooks: { scheduler: ObservableSnapshot<SchedulerSnapshot> }
  selectWorkspace: (id: WorkspaceId | undefined) => void
  refresh: () => Promise<void>
  save: (document: WorkSchedulerDocument) => Promise<void>
  command: (command: SchedulerCommand) => Promise<void>
  openSession: (id: SessionId) => void
  createSession: (workspaceId: WorkspaceId, draft: string) => Promise<SessionId>
}
/** Overlay props derived from its four registered channels. */
export type SchedulerPanelProps = PropsRuntime<'shell.overlay'> & StoreProps & InjectFace<WorkSchedulerInjected>
const LABEL: Record<SchedulerExecutionStatus, string> = {
  queued: '排队',
  preparing: '准备中',
  running: '执行中',
  stopping: '停止中',
  review: '待审查',
  approved: '已通过',
  failed: '失败',
  stopped: '已停止',
  interrupted: '已中断',
}
const busy = (attempt: SchedulerAttempt | undefined) =>
  attempt !== undefined && ['queued', 'preparing', 'running', 'stopping'].includes(attempt.status)
const currentAttempt = (document: WorkSchedulerDocument, id: string) =>
  Object.values(document.attempts)
    .filter(attempt => attempt.taskId === id)
    .at(-1)
const newCommandId = () => crypto.randomUUID() as SchedulerCommandId
const executionColumn = (document: WorkSchedulerDocument, id: string) => {
  const item = currentAttempt(document, id)
  const task = document.tasks[id]
  if (item?.status === 'approved' || task?.status === 'done') return 'approved'
  if (item?.status === 'review') return 'review'
  if (busy(item) || task?.status === 'running') return 'running'
  return 'ready'
}

/**
 * Open the shared scheduler overlay.
 * @param props - Sidebar slot and shared view state.
 * @returns Sidebar action.
 */
export function SchedulerTrigger({ wide, useStore, actions }: SchedulerTriggerProps) {
  const open = useStore(state => state.open)
  return (
    <Tooltip label="工作调度" disabled={wide} delayMs={500}>
      <button
        type="button"
        className={css.trigger}
        data-active={open || undefined}
        aria-label="工作调度"
        onClick={() => {
          actions.open()
        }}
      >
        <IconListPenOutline16 />
        {wide && '工作调度'}
      </button>
    </Tooltip>
  )
}

/**
 * Render the Host-owned board and its versioned review actions.
 * @param props - Framework hooks and injected operations.
 * @returns The open scheduler window.
 */
export function SchedulerPanel({
  useStore,
  useScheduler,
  useSessions,
  useWorkspaces,
  actions,
  selectWorkspace,
  save,
  command,
  refresh,
  openSession,
  createSession,
}: SchedulerPanelProps) {
  const view = useStore(value => value)
  const snapshot = useScheduler(value => value)
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const workspaceId =
    view.workspaceId ??
    workspaces.items.find(item => sessions.current !== undefined && item.sessionIds.includes(sessions.current))
      ?.workspaceId ??
    workspaces.recentWorkspaceId ??
    workspaces.items[0]?.workspaceId
  const document = snapshot.document
  const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
  const backButton = useRef<HTMLButtonElement>(null)
  const confirmDropButton = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const [composer, setComposer] = useState(false)
  const [editing, setEditing] = useState('')
  const [boundSession, setBoundSession] = useState('')
  const currentWorkspace = useRef(workspaceId)
  currentWorkspace.current = workspaceId
  const [description, setDescription] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [newThread, setNewThread] = useState('')
  const [addingColumn, setAddingColumn] = useState(false)
  const [taskThread, setTaskThread] = useState('backlog')
  const [feedback, setFeedback] = useState('')
  const [baseRef, setBaseRef] = useState('HEAD')
  const [tab, setTab] = useState('overview')
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [clearing, setClearing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [deleting, setDeleting] = useState('')
  const [dragged, setDragged] = useState<{ taskId: string; workspaceId: WorkspaceId; revision: number }>()
  const [dropTarget, setDropTarget] = useState('')
  const [dropPosition, setDropPosition] = useState<{ id: string; after: boolean }>()
  const [pendingDrop, setPendingDrop] = useState<{
    taskId: string
    workspaceId: WorkspaceId
    revision: number
    kind: 'execute' | 'cancel'
  }>()
  const [retry, setRetry] = useState<SchedulerCommand>()
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const columnInput = useRef<HTMLInputElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const selectedButton = useRef<HTMLButtonElement | null>(null)
  const task = document.tasks[view.selected]
  const attempt = task === undefined ? undefined : currentAttempt(document, task.id)
  const evidence = attempt?.evidence
  const session = attempt === undefined ? undefined : sessions.byId[attempt.sessionId]
  const todos = session?.projectionValues?.todos ?? []
  const ready = snapshot.status === 'ready' && snapshot.workspaceId === workspaceId && workspaceId !== undefined
  const planning = view.view === 'planning'
  useEffect(() => {
    selectWorkspace(workspaceId)
  }, [selectWorkspace, workspaceId])
  useEffect(() => {
    setFeedback('')
    setBaseRef('HEAD')
    setTab('overview')
    setRetry(undefined)
    setError('')
  }, [view.selected, attempt?.id, workspaceId])
  useEffect(() => {
    setComposer(false)
    setDragged(undefined)
    setDropTarget('')
    setDropPosition(undefined)
    setPendingDrop(undefined)
    setNotice('')
    setEditing('')
    setDescription('')
    setAcceptance('')
    setBoundSession('')
    setTaskThread('backlog')
    setClearing(false)
    setAcknowledged(false)
    setDeleting('')
    setAddingColumn(false)
    setNewThread('')
    actions.select('')
  }, [workspaceId, actions])
  useEffect(() => {
    if (!view.open) {
      setFullscreen(false)
      setPendingDrop(undefined)
      setDragged(undefined)
      setDropTarget('')
      setDropPosition(undefined)
      setClearing(false)
      setAcknowledged(false)
      setDeleting('')
    }
  }, [view.open])
  useEffect(() => {
    if (composer || editing) titleInput.current?.focus()
  }, [composer, editing])
  useEffect(() => {
    if (addingColumn) columnInput.current?.focus()
  }, [addingColumn])
  useEffect(() => {
    if (!view.open) return
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (clearing) {
          setClearing(false)
          setAcknowledged(false)
        } else if (deleting) setDeleting('')
        else if (pendingDrop !== undefined) setPendingDrop(undefined)
        else if (composer) setComposer(false)
        else if (editing) {
          setEditing('')
          setDescription('')
          setAcceptance('')
          setBoundSession('')
        }
        else if (addingColumn) setAddingColumn(false)
        else if (view.selected) {
          actions.select('')
          selectedButton.current?.focus()
        } else actions.close()
      }
      if (event.key !== 'Tab') return
      const element = windowRef.current
      if (element === null) return
      const controls = [
        ...element.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary',
        ),
      ].filter(element => element.getClientRects().length > 0)
      const first = controls[0],
        last = controls.at(-1)
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    globalThis.document.addEventListener('keydown', keyboard)
    return () => {
      globalThis.document.removeEventListener('keydown', keyboard)
    }
  }, [actions, addingColumn, clearing, composer, deleting, editing, pendingDrop, view.open, view.selected])
  useEffect(() => {
    if (!view.open || composer) return
    if (pendingDrop !== undefined) confirmDropButton.current?.focus()
    else if (view.selected) backButton.current?.focus()
    else selectedButton.current?.focus()
  }, [view.open, view.selected, composer, pendingDrop])
  if (!view.open) return null
  const report = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }
  const saveDocument = (next: WorkSchedulerDocument) => {
    setError('')
    return save(next)
  }
  const runCommand = async (operation: SchedulerCommand) => {
    setError('')
    setRetry(operation)
    try {
      await command(operation)
      setRetry(undefined)
    } catch (cause: unknown) {
      report(cause)
    }
  }
  const ids = [
    ...document.processes.flatMap(process => process.taskIds),
    ...document.backlogIds,
    ...document.blockedIds,
    ...document.archiveIds,
  ]
  const matching = [...new Set(ids)].filter(id =>
    (document.tasks[id]?.description ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  const lanes: { key: string; label: string; zone?: 'process' | 'backlog' | 'blocked' | 'archive'; processId?: string }[] =
    planning
      ? [
        { key: 'backlog', label: '待办', zone: 'backlog' },
        ...document.processes.map(process => ({
          key: process.id,
          label: process.name,
          zone: 'process' as const,
          processId: process.id,
        })),
        { key: 'blocked', label: '已暂停', zone: 'blocked' as const },
        { key: 'archive', label: '已完成', zone: 'archive' as const },
      ]
      : [
        { key: 'ready', label: '待办' },
        { key: 'running', label: '进行中' },
        { key: 'review', label: '待审查' },
        { key: 'approved', label: '已通过' },
      ]
  const laneIds = (lane: (typeof lanes)[number]) => {
    if (lane.zone === 'backlog') return document.backlogIds
    if (lane.zone === 'blocked') return document.blockedIds
    if (lane.zone === 'archive') return document.archiveIds
    if (lane.zone === 'process' && lane.processId !== undefined) {
      return document.processes.find(process => process.id === lane.processId)?.taskIds ?? []
    }
    return matching.filter(id => executionColumn(document, id) === lane.key)
  }
  const dropPlanning = (event: DragEvent, lane: (typeof lanes)[number], index: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (!ready || !planning || dragged === undefined || lane.zone === undefined) return
    if (dragged.workspaceId !== workspaceId || dragged.revision !== document.revision) {
      setNotice('拖动期间看板已更新，请重新拖动。')
      return
    }
    const taskId = event.dataTransfer.getData('application/x-dsh-task')
    if (
      event.dataTransfer.getData('application/x-dsh-workspace') !== workspaceId ||
      document.tasks[taskId] === undefined ||
      currentAttempt(document, taskId) !== undefined
    )
      return
    const target =
      lane.zone === 'process' && lane.processId !== undefined
        ? { zone: 'process' as const, processId: lane.processId, index }
        : { zone: lane.zone, index }
    void saveDocument(moveTask(document, taskId, target))
      .then(() => {
        if (workspaceId === currentWorkspace.current && lane.zone === 'archive') setNotice('已勾选完成。')
      })
      .catch(report)
  }
  const boardGesture = (taskId: string, destination: BoardColumn, targetId?: string, after = false) => {
    if (!ready || pendingDrop !== undefined) return
    setNotice('')
    const intent = resolveBoardDrop(document, taskId, destination, targetId, after)
    if (intent.kind === 'reject') {
      setNotice(intent.reason)
      return
    }
    if (intent.kind === 'none') return
    if (intent.kind === 'save') {
      const done = intent.document.tasks[taskId]?.status === 'done'
      void saveDocument(intent.document)
        .then(() => {
          if (workspaceId === currentWorkspace.current) setNotice(done ? '已勾选完成。' : '任务顺序已保存。')
        })
        .catch((cause: unknown) => {
          if (workspaceId === currentWorkspace.current) report(cause)
        })
      return
    }
    if (intent.kind === 'review' || intent.kind === 'rework') {
      actions.select(taskId)
      setNotice(intent.kind === 'review' ? '请检查本轮结果，再点击通过审查。' : '请填写返工意见，再提交新一轮执行。')
      return
    }
    setPendingDrop({ taskId, workspaceId, revision: document.revision, kind: intent.kind })
  }
  const boardDrop = (event: DragEvent, destination: BoardColumn, targetId?: string) => {
    event.preventDefault()
    event.stopPropagation()
    setDropTarget('')
    setDropPosition(undefined)
    const transfer = dragged
    setDragged(undefined)
    if (transfer === undefined || transfer.workspaceId !== workspaceId || !ready) return
    if (transfer.revision !== document.revision) {
      setNotice('拖动期间看板已更新，请重新拖动。')
      return
    }
    if (
      event.dataTransfer.getData('application/x-dsh-task') !== transfer.taskId ||
      event.dataTransfer.getData('application/x-dsh-workspace') !== workspaceId
    )
      return
    const bounds = event.currentTarget.getBoundingClientRect()
    boardGesture(
      transfer.taskId,
      destination,
      targetId,
      targetId !== undefined && event.clientY > bounds.top + bounds.height / 2,
    )
  }
  const confirmDrop = () => {
    if (pendingDrop === undefined || !ready) return
    if (pendingDrop.workspaceId !== workspaceId || pendingDrop.revision !== document.revision) {
      setPendingDrop(undefined)
      setNotice('看板已更新，请重新选择操作。')
      return
    }
    const item = currentAttempt(document, pendingDrop.taskId)
    if (pendingDrop.kind === 'execute') {
      if (item !== undefined && !['failed', 'stopped', 'interrupted'].includes(item.status)) {
        setPendingDrop(undefined)
        setNotice('任务状态已变化，请重新选择操作。')
        return
      }
      setPendingDrop(undefined)
      void runCommand({
        kind: 'execute',
        taskId: pendingDrop.taskId,
        baseRef: 'HEAD',
        expectedRevision: pendingDrop.revision,
        commandId: newCommandId(),
      })
      return
    }
    if (item === undefined || !busy(item)) {
      setPendingDrop(undefined)
      setNotice('任务状态已变化，请重新选择操作。')
      return
    }
    setPendingDrop(undefined)
    void runCommand({ kind: 'cancel', attemptId: item.id })
  }
  const move = (direction: number) => {
    if (task === undefined) return
    const process = document.processes.find(item => item.taskIds.includes(task.id))
    const order =
      process?.taskIds ??
      (document.blockedIds.includes(task.id)
        ? document.blockedIds
        : document.archiveIds.includes(task.id)
          ? document.archiveIds
          : document.backlogIds)
    const index = order.indexOf(task.id) + direction
    if (index < 0 || index >= order.length) return
    const zone = process !== undefined
      ? 'process'
      : document.blockedIds.includes(task.id)
        ? 'blocked'
        : document.archiveIds.includes(task.id)
          ? 'archive'
          : 'backlog'
    void saveDocument(
      moveTask(document, task.id, {
        zone,
        ...(process === undefined ? {} : { processId: process.id }),
        index,
      }),
    ).catch(report)
  }
  const submitTask = async () => {
    const selectedWorkspace = workspaceId
    const criteria = acceptance
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
    const lane = taskThread === 'backlog' || taskThread === 'blocked' || taskThread === 'archive'
      ? {}
      : { processId: taskThread }
    const next = editing
      ? structuredClone(document)
      : addTask(document, {
        description,
        acceptance: criteria,
        ...(boundSession ? { sessionId: boundSession as SessionId } : {}),
        ...lane,
        ...(taskThread === 'archive' ? { status: 'done' as const } : {}),
        ...(taskThread === 'blocked' ? { status: 'async-blocked' as const } : {}),
      })
    if (editing) {
      const edited = next.tasks[editing]
      if (edited === undefined) throw new Error('要编辑的任务不存在，请刷新看板。')
      edited.description = description.trim()
      edited.acceptance = criteria
      edited.updatedAt = new Date().toISOString()
      if (boundSession) edited.sessionId = boundSession as SessionId
      else delete edited.sessionId
    }
    await saveDocument(next)
    if (selectedWorkspace !== currentWorkspace.current) return
    setComposer(false)
    setEditing('')
    setDescription('')
    setAcceptance('')
    setBoundSession('')
  }
  const startCreate = (lane = 'backlog') => {
    setEditing('')
    setDescription('')
    setAcceptance('')
    setBoundSession('')
    setTaskThread(lane)
    setComposer(true)
  }
  const startEdit = (id: string) => {
    const item = document.tasks[id]
    if (item === undefined) return
    setComposer(false)
    setEditing(id)
    setDescription(item.description)
    setAcceptance(item.acceptance.join('\n'))
    setBoundSession(item.sessionId ?? '')
    setTaskThread(
      document.processes.find(process => process.taskIds.includes(id))?.id
        ?? (document.blockedIds.includes(id) ? 'blocked' : document.archiveIds.includes(id) ? 'archive' : 'backlog'),
    )
    actions.select('')
  }
  const confirmDelete = () => {
    if (!ready || !deleting) return
    const selectedWorkspace = workspaceId
    const id = deleting
    setDeleting('')
    void saveDocument(removeTask(document, id))
      .then(() => {
        if (selectedWorkspace !== currentWorkspace.current) return
        setNotice('已删除任务。')
        if (view.selected === id) actions.select('')
      })
      .catch(report)
  }
  const submitColumn = () => {
    if (!newThread.trim()) return
    void saveDocument(addProcess(document, newThread))
      .then(() => {
        if (workspaceId !== currentWorkspace.current) return
        setNewThread('')
        setAddingColumn(false)
      })
      .catch(report)
  }
  const clearBoard = () => {
    if (!ready || !clearing || !acknowledged) return
    const selectedWorkspace = workspaceId
    setClearing(false)
    setAcknowledged(false)
    void saveDocument(createSchedulerState(document.revision))
      .then(() => {
        if (selectedWorkspace !== currentWorkspace.current) return
        setNotice('已清空当前工作区看板。')
        actions.select('')
      })
      .catch(report)
  }
  const exportDocument = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
    const anchor = globalThis.document.createElement('a')
    anchor.href = url
    anchor.download = 'work-scheduler.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const open = (id: SessionId) => {
    if (workspaceId !== undefined) actions.workspace(workspaceId)
    openSession(id)
    actions.close()
  }
  const cardLabel = (id: string) => {
    const item = document.tasks[id]
    const current = currentAttempt(document, id)
    const live = current === undefined ? undefined : sessions.byId[current.sessionId]
    if (live?.pendingInteraction !== undefined) return '等待用户操作'
    if (current === undefined) {
      if (item?.status.includes('blocked')) return '已暂停'
      if (item?.status === 'done') return '已完成'
      if (item?.status === 'running') return '进行中'
      return '待办'
    }
    return LABEL[current.status]
  }
  const emptyBoard = Object.keys(document.tasks).length === 0
  return (
    <div className={css.overlay}>
      <div
        ref={windowRef}
        className={`${css.window} ${css.deliveryWindow}`}
        data-fullscreen={fullscreen || undefined}
        role="dialog"
        aria-modal="true"
        aria-label="工作调度"
      >
        <header className={css.header}>
          <div>
            <h1>工作调度</h1>
            <p>
              {workspace?.title ?? '请先创建工作区'} · 运行{' '}
              {Object.values(document.attempts).filter(item => busy(item) && item.status !== 'queued').length} · 排队{' '}
              {Object.values(document.attempts).filter(item => item.status === 'queued').length}
            </p>
          </div>
          <div className={css.headerActions}>
            <button
              className={css.primaryAction}
              hidden={composer || editing !== '' || task !== undefined}
              disabled={!ready}
              onClick={() => {
                startCreate()
              }}
            >
              新建任务
            </button>
            <button
              disabled={!ready || isClearedSchedulerDocument(document)}
              onClick={() => {
                setAcknowledged(false)
                setClearing(true)
              }}
            >
              清空看板
            </button>
            <details className={css.boardOptions}>
              <summary>看板选项</summary>
              <div>
                <button disabled={!ready} onClick={() => { void refresh() }}>
                  刷新
                </button>
                <button
                  aria-pressed={!planning}
                  onClick={() => {
                    actions.view(planning ? 'execution' : 'planning')
                  }}
                >
                  {planning ? '执行看板' : '规划看板'}
                </button>
                <button disabled={!ready} onClick={exportDocument}>
                  导出
                </button>
                <label>
                  导入
                  <input
                    aria-label="导入看板"
                    type="file"
                    accept="application/json,.json"
                    disabled={!ready}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      const selectedWorkspace = workspaceId
                      if (file)
                        void file
                          .text()
                          .then((text) => {
                            if (selectedWorkspace !== currentWorkspace.current)
                              throw new Error('工作区已切换，请重新导入。')
                            const imported = normalizeSchedulerState(JSON.parse(text))
                            return saveDocument({ ...imported, revision: document.revision })
                          })
                          .catch(report)
                      event.target.value = ''
                    }}
                  />
                </label>
              </div>
            </details>
            <button
              onClick={() => {
                setFullscreen(!fullscreen)
              }}
            >
              {fullscreen ? '还原' : '全屏'}
            </button>
            <button
              onClick={() => {
                actions.close()
              }}
            >
              关闭
            </button>
          </div>
        </header>
        <div hidden={task !== undefined} className={css.deliveryToolbar}>
          <select
            aria-label="看板工作区"
            value={workspaceId ?? ''}
            onChange={(event) => {
              actions.workspace(event.target.value as WorkspaceId)
            }}
          >
            {workspaces.items.map(item => (
              <option key={item.workspaceId} value={item.workspaceId}>
                {item.title}
              </option>
            ))}
          </select>
          <input
            aria-label="搜索任务"
            placeholder="搜索任务"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <button
            hidden={!planning}
            disabled={!ready}
            onClick={() => {
              setAddingColumn(true)
            }}
          >
            添加列
          </button>
          <span aria-live="polite">
            {snapshot.status === 'ready'
              ? '已连接'
              : snapshot.status === 'saving'
                ? '保存中…'
                : snapshot.status === 'error'
                  ? '连接或保存失败'
                  : '加载中…'}
          </span>
        </div>
        {notice && (
          <p className={css.deliveryNotice} role="status">
            {notice}
          </p>
        )}
        {pendingDrop !== undefined && (
          <section className={css.dropConfirmation} aria-label="确认任务操作">
            <h2>{pendingDrop.kind === 'execute' ? '开始执行这个任务？' : '停止这个任务？'}</h2>
            <p>{document.tasks[pendingDrop.taskId]?.description}</p>
            <p>
              {pendingDrop.kind === 'execute'
                ? '将从 HEAD 创建独立工作目录并使用当前模型执行。'
                : '将请求停止本轮任务，等待资源释放后更新状态。'}
            </p>
            <button
              onClick={() => {
                setPendingDrop(undefined)
              }}
            >
              取消操作
            </button>
            <button ref={confirmDropButton} className={css.primaryAction} disabled={!ready} onClick={confirmDrop}>
              {pendingDrop.kind === 'execute' ? '确认执行' : '确认停止'}
            </button>
          </section>
        )}
        {(error || snapshot.error) && (
          <div className={css.deliveryError} role="alert">
            {error || snapshot.error}
            {retry !== undefined && (
              <button
                disabled={!ready}
                onClick={() => {
                  void runCommand(retry)
                }}
              >
                重试原请求
              </button>
            )}
          </div>
        )}
        {composer && (
          <form
            className={css.inlineComposer}
            onSubmit={(event) => {
              event.preventDefault()
              void submitTask().catch(report)
            }}
          >
            <h2>{editing ? '编辑任务' : '新建任务'}</h2>
            <label>
              任务描述
              <textarea
                ref={titleInput}
                required
                placeholder="要做什么"
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                }}
              />
            </label>
            <label>
              验收条件（可选，每行一项）
              <textarea
                placeholder="可选，每行一项"
                value={acceptance}
                onChange={(event) => {
                  setAcceptance(event.target.value)
                }}
              />
            </label>
            <label>
              放到
              <select
                disabled={!!editing}
                value={taskThread}
                onChange={(event) => {
                  setTaskThread(event.target.value)
                }}
              >
                <option value="backlog">待办</option>
                {document.processes.map(process => (
                  <option key={process.id} value={process.id}>
                    {process.name}
                  </option>
                ))}
                <option value="blocked">已暂停</option>
                <option value="archive">已完成</option>
              </select>
            </label>
            <details>
              <summary>更多选项</summary>
              <label>
                关联会话
                <select
                  value={boundSession}
                  onChange={(event) => {
                    setBoundSession(event.target.value)
                  }}
                >
                  <option value="">不关联</option>
                  {workspace?.sessionIds.map(id => (
                    <option key={id} value={id}>
                      {sessions.byId[id]?.displayTitle ?? id}
                    </option>
                  ))}
                </select>
              </label>
            </details>
            <div className={css.editorActions}>
              <button
                type="button"
                onClick={() => {
                  setComposer(false)
                }}
              >
                取消
              </button>
              <button className={css.primaryAction} disabled={!ready || !description.trim()}>
                {editing ? '保存' : '添加任务'}
              </button>
            </div>
          </form>
        )}
        <main className={css.deliveryContent} data-detail={task !== undefined || undefined}>
          <div
            hidden={task !== undefined}
            className={css.deliveryBoard}
            aria-label={planning ? '规划看板' : '执行看板'}
          >
            {lanes.map((lane) => {
              const rows = matching.filter(id =>
                planning
                  ? laneIds(lane).includes(id)
                  : executionColumn(document, id) === lane.key,
              )
              const order = planning ? laneIds(lane) : rows
              return (
                <section
                  className={css.deliveryLane}
                  data-drop-target={dropTarget === lane.key || undefined}
                  aria-label={`${lane.label}列`}
                  key={lane.key}
                  onDragOver={(event) => {
                    if (ready && dragged !== undefined && pendingDrop === undefined) {
                      event.preventDefault()
                      setDropTarget(lane.key)
                    }
                  }}
                  onDrop={(event) => {
                    if (planning) {
                      setDragged(undefined)
                      setDropTarget('')
                      setDropPosition(undefined)
                      dropPlanning(event, lane, order.length)
                    } else boardDrop(event, lane.key as BoardColumn)
                  }}
                >
                  <h2>
                    {lane.label} <span>{rows.length}</span>
                  </h2>
                  {planning && lane.zone === 'process' && (
                    <input
                      aria-label={`列名称 ${lane.label}`}
                      disabled={!ready}
                      defaultValue={lane.label}
                      key={lane.label}
                      onBlur={(event) => {
                        if (event.target.value.trim() && event.target.value !== lane.label)
                          void saveDocument(renameProcess(document, lane.key, event.target.value)).catch(report)
                      }}
                    />
                  )}
                  {rows.length === 0 && (
                    <p className={css.muted}>
                      {emptyBoard && lane.key === 'backlog' ? '点「新建任务」或列内「添加」开始规划。' : '暂无任务'}
                    </p>
                  )}
                  {rows.map((id) => {
                    const item = document.tasks[id],
                      current = currentAttempt(document, id)
                    if (item === undefined) return null
                    const personal = planning && current === undefined
                    return (
                      <div
                        className={css.cardShell}
                        data-drop-position={
                          dropPosition?.id === id ? (dropPosition.after ? 'after' : 'before') : undefined
                        }
                        key={id}
                        onDragOver={(event) => {
                          if (!ready || dragged === undefined || pendingDrop !== undefined) return
                          event.preventDefault()
                          event.stopPropagation()
                          setDropTarget(lane.key)
                          const bounds = event.currentTarget.getBoundingClientRect()
                          setDropPosition({ id, after: event.clientY > bounds.top + bounds.height / 2 })
                        }}
                        onDrop={(event) => {
                          if (planning) {
                            dropPlanning(
                              event,
                              lane,
                              lane.zone === undefined ? rows.indexOf(id) : order.indexOf(id),
                            )
                          } else boardDrop(event, lane.key as BoardColumn, id)
                        }}
                      >
                        {editing === id && !composer ? (
                          <form
                            className={css.inPlaceEditor}
                            onSubmit={(event) => {
                              event.preventDefault()
                              void submitTask().catch(report)
                            }}
                          >
                            <label>
                              任务描述
                              <textarea
                                ref={titleInput}
                                required
                                value={description}
                                onChange={(event) => {
                                  setDescription(event.target.value)
                                }}
                              />
                            </label>
                            <label>
                              验收条件（可选，每行一项）
                              <textarea
                                value={acceptance}
                                onChange={(event) => {
                                  setAcceptance(event.target.value)
                                }}
                              />
                            </label>
                            <details>
                              <summary>更多选项</summary>
                              <label>
                                关联会话
                                <select
                                  value={boundSession}
                                  onChange={(event) => {
                                    setBoundSession(event.target.value)
                                  }}
                                >
                                  <option value="">不关联</option>
                                  {workspace?.sessionIds.map(session => (
                                    <option key={session} value={session}>
                                      {sessions.byId[session]?.displayTitle ?? session}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </details>
                            <div className={css.editorActions}>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing('')
                                  setDescription('')
                                  setAcceptance('')
                                  setBoundSession('')
                                }}
                              >
                                取消
                              </button>
                              <button className={css.primaryAction} disabled={!ready || !description.trim()}>
                                保存
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <button
                              className={css.deliveryCard}
                              draggable={ready && pendingDrop === undefined && editing !== id
                                && (!planning || current === undefined)}
                              data-dragging={dragged?.taskId === id || undefined}
                              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
                              onDragEnd={() => {
                                setDragged(undefined)
                                setDropTarget('')
                                setDropPosition(undefined)
                              }}
                              onKeyDown={(event) => {
                                if (!event.altKey || !ready) return
                                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                                event.preventDefault()
                                selectedButton.current = event.currentTarget
                                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                                  const index =
                                    lanes.findIndex(item => item.key === lane.key)
                                    + (event.key === 'ArrowLeft' ? -1 : 1)
                                  const destination = lanes[index]
                                  if (destination === undefined) return
                                  if (planning && destination.zone !== undefined && current === undefined) {
                                    const idsAt = laneIds(destination)
                                    void saveDocument(
                                      moveTask(
                                        document,
                                        id,
                                        destination.zone === 'process' && destination.processId !== undefined
                                          ? { zone: 'process', processId: destination.processId, index: idsAt.length }
                                          : { zone: destination.zone, index: idsAt.length },
                                      ),
                                    )
                                      .then(() => {
                                        if (
                                          workspaceId === currentWorkspace.current
                                          && destination.zone === 'archive'
                                        ) {
                                          setNotice('已勾选完成。')
                                        }
                                      })
                                      .catch(report)
                                  } else if (!planning) boardGesture(id, destination.key as BoardColumn)
                                } else {
                                  const index = rows.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)
                                  const target = rows[index]
                                  if (target === undefined) return
                                  if (planning && lane.zone !== undefined && current === undefined) {
                                    void saveDocument(
                                      moveTask(
                                        document,
                                        id,
                                        lane.zone === 'process' && lane.processId !== undefined
                                          ? { zone: 'process', processId: lane.processId, index }
                                          : { zone: lane.zone, index },
                                      ),
                                    ).catch(report)
                                  } else if (!planning) {
                                    boardGesture(id, lane.key as BoardColumn, target, event.key === 'ArrowDown')
                                  }
                                }
                              }}
                              onDragStart={(event) => {
                                if (workspaceId === undefined || !ready) {
                                  event.preventDefault()
                                  return
                                }
                                selectedButton.current = event.currentTarget
                                setDragged({ taskId: id, workspaceId, revision: document.revision })
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('application/x-dsh-task', id)
                                event.dataTransfer.setData('application/x-dsh-workspace', workspaceId)
                              }}
                              aria-pressed={view.selected === id}
                              onClick={(event) => {
                                if (dragged !== undefined) return
                                selectedButton.current = event.currentTarget
                                actions.select(id)
                              }}
                            >
                              <strong>{item.description}</strong>
                              <span>{cardLabel(id)}</span>
                              {item.acceptance.length > 0 && <small>{item.acceptance.length} 项验收条件</small>}
                            </button>
                            {personal && (
                              <div className={css.cardActions}>
                                <button
                                  type="button"
                                  disabled={!ready}
                                  onClick={() => {
                                    startEdit(id)
                                  }}
                                >
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  disabled={!ready}
                                  onClick={() => {
                                    setDeleting(id)
                                  }}
                                >
                                  删除
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  {planning && (
                    <button
                      type="button"
                      className={css.laneAdd}
                      disabled={!ready}
                      aria-label={`在${lane.label}列添加`}
                      onClick={() => {
                        startCreate(lane.zone === 'process' ? lane.key : lane.zone ?? 'backlog')
                      }}
                    >
                      添加
                    </button>
                  )}
                </section>
              )
            })}
            {planning && addingColumn && (
              <form
                className={css.deliveryLane}
                onSubmit={(event) => {
                  event.preventDefault()
                  submitColumn()
                }}
              >
                <h2>新列</h2>
                <input
                  ref={columnInput}
                  aria-label="新列名称"
                  value={newThread}
                  onChange={(event) => {
                    setNewThread(event.target.value)
                  }}
                />
                <button disabled={!ready || !newThread.trim()}>添加</button>
              </form>
            )}
          </div>
          {task !== undefined && (
            <aside className={css.deliveryDetails} aria-label="任务详情">
              <button
                ref={backButton}
                onClick={() => {
                  actions.select('')
                }}
              >
                返回看板
              </button>
              <h2>{task.description}</h2>
              <p>{attempt === undefined ? (task.status === 'done' ? '已完成' : '尚未执行') : LABEL[attempt.status]}</p>
              <nav className={css.deliveryToolbar}>
                {[
                  ['overview', '概览'],
                  ['log', '执行记录'],
                  ['diff', '文件差异'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={tab === value}
                    onClick={() => {
                      if (value !== undefined) setTab(value)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {tab === 'overview' && (
                <>
                  <h3>验收条件</h3>
                  {task.acceptance.length === 0 ? <p className={css.muted}>未填写</p> : (
                    <ul>
                      {task.acceptance.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {todos.length > 0 && (
                    <>
                      <progress
                        aria-label="工作进度"
                        value={todos.filter(item => item.status === 'completed').length}
                        max={todos.length}
                      />
                      <p>{todos.find(item => item.status === 'in_progress')?.content}</p>
                    </>
                  )}
                  {session?.pendingInteraction !== undefined && (
                    <p>等待审批、计划确认或问题答复，请打开执行会话处理。</p>
                  )}
                  {attempt?.error && <p role="alert">{attempt.error}</p>}
                  {attempt?.evidence && (
                    <>
                      <h3>执行摘要</h3>
                      <p className={css.deliveryText}>{attempt.evidence.summary}</p>
                      <p>请核对实际工具记录；未运行的检查不能视为通过。</p>
                    </>
                  )}
                </>
              )}
              {tab === 'log' && (
                <>
                  {attempt === undefined ? (
                    <p>尚无执行记录</p>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          open(attempt.sessionId)
                        }}
                      >
                        打开完整执行会话 / 处理审批
                      </button>
                      {attempt.evidence?.tools.map((tool, index) => (
                        <details key={index}>
                          <summary>
                            {tool.name} · {tool.failed ? '失败或未完成' : '已返回结果'}
                          </summary>
                          <pre>{tool.arguments}</pre>
                          <pre>{tool.result}</pre>
                        </details>
                      ))}
                    </>
                  )}
                </>
              )}
              {tab === 'diff' &&
                (evidence === undefined ? (
                  <p>正常结束后固定本轮文件差异。</p>
                ) : (
                  <>
                    {attempt?.status === 'review' && (
                      <button
                        disabled={!ready}
                        onClick={() => {
                          void runCommand({
                            kind: 'refresh-review',
                            attemptId: attempt.id,
                            expectedRevision: document.revision,
                            evidenceHash: evidence.hash,
                            feedback: '',
                            commandId: newCommandId(),
                          })
                        }}
                      >
                        重新固定文件证据
                      </button>
                    )}
                    <p>
                      证据 {evidence.hash.slice(0, 12)} · 日志 {evidence.logSeq}
                    </p>
                    {evidence.truncated && <p>显示已截断，请核对完整产物。</p>}
                    <pre className={css.deliveryDiff}>{evidence.diff || '此处无可显示差异，请核对完整产物。'}</pre>
                  </>
                ))}
              {attempt?.worktree && <p className={css.deliveryText}>产物目录：{attempt.worktree}</p>}
              {attempt !== undefined && (
                <button
                  onClick={() => {
                    open(attempt.sessionId)
                  }}
                >
                  打开执行会话
                </button>
              )}
              {(!attempt || ['failed', 'stopped', 'interrupted'].includes(attempt.status)) && (
                <>
                  <p className={css.deliveryNotice}>
                    执行使用所选 Git 版本，不带入原工作区未提交改动。将在隔离 worktree 执行并创建仅本地的内部快照。
                  </p>
                  <details className={css.advancedOptions}>
                    <summary>高级执行设置</summary>
                    <label>
                      Git 起始版本
                      <input
                        value={baseRef}
                        onChange={(event) => {
                          setBaseRef(event.target.value)
                        }}
                      />
                    </label>
                  </details>
                  <button
                    className={css.primaryAction}
                    disabled={!ready || !baseRef.trim()}
                    onClick={() => {
                      if (workspaceId === undefined) return
                      setPendingDrop({
                        taskId: task.id,
                        workspaceId,
                        revision: document.revision,
                        kind: 'execute',
                      })
                    }}
                  >
                    {attempt ? '重试任务' : '执行任务'}
                  </button>
                </>
              )}
              {attempt !== undefined && busy(attempt) && (
                <button
                  disabled={!ready || attempt.status === 'stopping'}
                  onClick={() => {
                    void runCommand({ kind: 'cancel', attemptId: attempt.id })
                  }}
                >
                  {attempt.status === 'queued' ? '取消排队' : '停止执行'}
                </button>
              )}
              {attempt?.status === 'review' && evidence && (
                <>
                  <p className={css.deliveryNotice}>通过审查只确认本轮产物，不自动合入用户分支、推送或合并。</p>
                  <label>
                    返工意见 / 接受失败检查的原因
                    <textarea
                      value={feedback}
                      onChange={(event) => {
                        setFeedback(event.target.value)
                      }}
                    />
                  </label>
                  <div className={css.deliveryToolbar}>
                    <button
                      className={css.primaryAction}
                      disabled={!ready}
                      onClick={() => {
                        void runCommand({
                          kind: 'approve',
                          attemptId: attempt.id,
                          expectedRevision: document.revision,
                          evidenceHash: evidence.hash,
                          feedback,
                          commandId: newCommandId(),
                        })
                      }}
                    >
                      通过审查
                    </button>
                    <button
                      disabled={!ready || !feedback.trim()}
                      onClick={() => {
                        void runCommand({
                          kind: 'rework',
                          attemptId: attempt.id,
                          expectedRevision: document.revision,
                          evidenceHash: evidence.hash,
                          feedback,
                          commandId: newCommandId(),
                        })
                      }}
                    >
                      提交返工
                    </button>
                  </div>
                </>
              )}
              {attempt !== undefined && ['queued', 'review'].includes(attempt.status) && (
                <button
                  disabled={!ready}
                  onClick={() => {
                    void runCommand({
                      kind: task.status === 'async-blocked' ? 'resume' : 'yield',
                      attemptId: attempt.id,
                      expectedRevision: document.revision,
                    })
                  }}
                >
                  {task.status === 'async-blocked' ? '恢复线程占位' : '异步让出线程'}
                </button>
              )}
              {attempt?.status === 'approved' && (
                <p className={css.deliveryNotice}>审查已通过，产物保留在 worktree，未合入用户分支。</p>
              )}
              {task.sessionId && (
                <button
                  onClick={() => {
                    if (task.sessionId !== undefined) open(task.sessionId)
                  }}
                >
                  打开关联会话
                </button>
              )}
              {attempt === undefined && (
                <details className={css.advancedOptions} open>
                  <summary>任务安排</summary>
                  <div className={css.deliveryToolbar}>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        setEditing(task.id)
                        setDescription(task.description)
                        setAcceptance(task.acceptance.join('\n'))
                        setBoundSession(task.sessionId ?? '')
                        setTaskThread(
                          document.processes.find(process => process.taskIds.includes(task.id))?.id
                            ?? (document.blockedIds.includes(task.id)
                              ? 'blocked'
                              : document.archiveIds.includes(task.id) ? 'archive' : 'backlog'),
                        )
                        setComposer(true)
                      }}
                    >
                      编辑任务
                    </button>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        const selectedWorkspace = workspaceId
                        if (selectedWorkspace === undefined) return
                        void createSession(selectedWorkspace, task.description)
                          .then((id) => {
                            if (selectedWorkspace !== currentWorkspace.current) return
                            const next = structuredClone(document)
                            next.tasks[task.id] = { ...task, sessionId: id }
                            return saveDocument(next)
                          })
                          .catch(report)
                      }}
                    >
                      创建草稿会话
                    </button>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        move(-1)
                      }}
                    >
                      上移
                    </button>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        move(1)
                      }}
                    >
                      下移
                    </button>
                    <button
                      disabled={!ready || task.status === 'done'}
                      onClick={() => {
                        void saveDocument(moveTask(document, task.id, { zone: 'archive', index: document.archiveIds.length }))
                          .then(() => {
                            if (workspaceId === currentWorkspace.current) setNotice('已勾选完成。')
                          })
                          .catch(report)
                      }}
                    >
                      勾选完成
                    </button>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        void saveDocument(setTaskStatus(document, task.id, 'sync-blocked')).catch(report)
                      }}
                    >
                      暂停并等待
                    </button>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        void saveDocument(setTaskStatus(document, task.id, 'async-blocked')).catch(report)
                      }}
                    >
                      让后续任务先做
                    </button>
                    <button
                      disabled={!ready}
                      onClick={() => {
                        void saveDocument(
                          task.status === 'async-blocked'
                            ? wakeTask(document, task.id)
                            : setTaskStatus(document, task.id, 'ready'),
                        ).catch(report)
                      }}
                    >
                      恢复任务
                    </button>
                  </div>
                  <label>
                    放到
                    <select
                      disabled={!ready}
                      value={
                        document.blockedIds.includes(task.id)
                          ? 'blocked'
                          : document.archiveIds.includes(task.id)
                            ? 'archive'
                            : document.processes.find(process => process.taskIds.includes(task.id))?.id ?? 'backlog'
                      }
                      onChange={(event) => {
                        const value = event.target.value
                        const process = document.processes.find(item => item.id === value)
                        void saveDocument(
                          moveTask(
                            document,
                            task.id,
                            value === 'blocked'
                              ? { zone: 'blocked', index: document.blockedIds.length }
                              : value === 'archive'
                                ? { zone: 'archive', index: document.archiveIds.length }
                                : process === undefined
                                  ? { zone: 'backlog', index: document.backlogIds.length }
                                  : { zone: 'process', processId: process.id, index: process.taskIds.length },
                          ),
                        ).catch(report)
                      }}
                    >
                      <option value="backlog">待办</option>
                      {document.processes.map(process => (
                        <option key={process.id} value={process.id}>
                          {process.name}
                        </option>
                      ))}
                      <option value="blocked">已暂停</option>
                      <option value="archive">已完成</option>
                    </select>
                  </label>
                </details>
              )}
              <details className={css.advancedOptions}>
                <summary>执行历史</summary>
                {Object.values(document.attempts)
                  .filter(item => item.taskId === task.id)
                  .map((item, index) => (
                    <details key={item.id}>
                      <summary>
                        第 {index + 1} 轮 · {LABEL[item.status]}
                      </summary>
                      <p>{item.review?.feedback || item.error || '暂无审查意见'}</p>
                      <button
                        onClick={() => {
                          open(item.sessionId)
                        }}
                      >
                        查看本轮日志
                      </button>
                      {item.evidence && <pre>{item.evidence.diff}</pre>}
                    </details>
                  ))}
              </details>
            </aside>
          )}
        </main>
        <Modal
          open={deleting !== ''}
          title="删除这个任务？"
          closeLabel="关闭"
          description={`将从看板移除「${document.tasks[deleting]?.description ?? ''}」。此操作无法撤销。`}
          onClose={() => {
            setDeleting('')
          }}
          footer={(
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleting('')
                }}
              >
                取消
              </Button>
              <Button variant="primary" disabled={!ready} onClick={confirmDelete}>
                删除任务
              </Button>
            </>
          )}
        />
        <RiskConfirmation
          open={clearing}
          title="清空当前工作区看板？"
          description="将删除这个工作区的全部任务、列和执行记录。其他工作区不受影响。此操作无法撤销。"
          acknowledgeLabel="我了解此操作无法撤销"
          cancelLabel="取消"
          confirmLabel="清空看板"
          acknowledged={acknowledged}
          disabled={!ready}
          onAcknowledgedChange={setAcknowledged}
          onCancel={() => {
            setAcknowledged(false)
            setClearing(false)
          }}
          onConfirm={clearBoard}
        />
      </div>
    </div>
  )
}
