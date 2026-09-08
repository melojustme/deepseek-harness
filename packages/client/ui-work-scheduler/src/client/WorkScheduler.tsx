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
import { IconListPenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  addProcess,
  addTask,
  moveTask,
  normalizeSchedulerState,
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
  const [thread, setThread] = useState('all')
  const [composer, setComposer] = useState(false)
  const [editing, setEditing] = useState('')
  const [boundSession, setBoundSession] = useState('')
  const currentWorkspace = useRef(workspaceId)
  currentWorkspace.current = workspaceId
  const [description, setDescription] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [newThread, setNewThread] = useState('')
  const [taskThread, setTaskThread] = useState('backlog')
  const [feedback, setFeedback] = useState('')
  const [baseRef, setBaseRef] = useState('HEAD')
  const [tab, setTab] = useState('overview')
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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
  const windowRef = useRef<HTMLDivElement>(null)
  const selectedButton = useRef<HTMLButtonElement | null>(null)
  const task = document.tasks[view.selected]
  const attempt = task === undefined ? undefined : currentAttempt(document, task.id)
  const evidence = attempt?.evidence
  const session = attempt === undefined ? undefined : sessions.byId[attempt.sessionId]
  const todos = session?.projectionValues?.todos ?? []
  const ready = snapshot.status === 'ready' && snapshot.workspaceId === workspaceId && workspaceId !== undefined
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
    setThread('all')
    actions.select('')
  }, [workspaceId, actions])
  useEffect(() => {
    if (!view.open) {
      setFullscreen(false)
      setPendingDrop(undefined)
      setDragged(undefined)
      setDropTarget('')
      setDropPosition(undefined)
    }
  }, [view.open])
  useEffect(() => {
    if (composer) titleInput.current?.focus()
  }, [composer])
  useEffect(() => {
    if (!view.open) return
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pendingDrop !== undefined) setPendingDrop(undefined)
        else if (composer) setComposer(false)
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
  }, [actions, composer, pendingDrop, view.open, view.selected])
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
  const matching = [...new Set(ids)].filter(
    id =>
      document.tasks[id]?.description.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (thread === 'all' || document.processes.find(process => process.id === thread)?.taskIds.includes(id)),
  )
  const column = (id: string) => {
    const item = currentAttempt(document, id)
    return item?.status === 'approved'
      ? 'approved'
      : item?.status === 'review'
        ? 'review'
        : busy(item)
          ? 'running'
          : 'ready'
  }
  const lanes: [string, string][] =
    view.view === 'board'
      ? [
        ['ready', '待办'],
        ['running', '执行中'],
        ['review', '待审查'],
        ['approved', '已通过'],
      ]
      : [
        ...document.processes.map((process): [string, string] => [process.id, process.name]),
        ['backlog', '待分配 / 阻塞 / 归档'],
      ]
  const drop = (event: DragEvent, processId: string, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (!ready || view.view !== 'thread' || dragged === undefined) return
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
    void saveDocument(
      moveTask(
        document,
        taskId,
        processId === 'backlog' ? { zone: 'backlog', index } : { zone: 'process', processId, index },
      ),
    ).catch(report)
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
      void saveDocument(intent.document)
        .then(() => {
          if (workspaceId === currentWorkspace.current) setNotice('任务顺序已保存。')
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
    const intent = resolveBoardDrop(document, pendingDrop.taskId, pendingDrop.kind === 'execute' ? 'running' : 'ready')
    if (intent.kind !== pendingDrop.kind) {
      setPendingDrop(undefined)
      setNotice('任务状态已变化，请重新选择操作。')
      return
    }
    const item = currentAttempt(document, pendingDrop.taskId)
    const operation: SchedulerCommand | undefined =
      pendingDrop.kind === 'execute'
        ? {
          kind: 'execute',
          taskId: pendingDrop.taskId,
          baseRef: 'HEAD',
          expectedRevision: pendingDrop.revision,
          commandId: newCommandId(),
        }
        : item === undefined
          ? undefined
          : { kind: 'cancel', attemptId: item.id }
    setPendingDrop(undefined)
    if (operation !== undefined) void runCommand(operation)
  }
  const move = (direction: number) => {
    if (task === undefined) return
    const process = document.processes.find(item => item.taskIds.includes(task.id))
    const order = process?.taskIds ?? document.backlogIds
    const index = order.indexOf(task.id) + direction
    if (index < 0 || index >= order.length) return
    void saveDocument(
      moveTask(document, task.id, {
        zone: process === undefined ? 'backlog' : 'process',
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
    const next = editing
      ? structuredClone(document)
      : addTask(document, {
        description,
        acceptance: criteria,
        ...(boundSession ? { sessionId: boundSession as SessionId } : {}),
        ...(taskThread === 'backlog' ? {} : { processId: taskThread }),
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
              hidden={composer || task !== undefined}
              disabled={!ready}
              onClick={() => {
                setEditing('')
                setDescription('')
                setAcceptance('')
                setBoundSession('')
                setComposer(true)
              }}
            >
              新建任务
            </button>
            <details className={css.boardOptions}>
              <summary>看板选项</summary>
              <div>
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
        <div hidden={composer || task !== undefined} className={css.deliveryToolbar}>
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
          <button
            aria-pressed={view.view === 'board'}
            onClick={() => {
              actions.view('board')
            }}
          >
            状态看板
          </button>
          <button
            aria-pressed={view.view === 'thread'}
            onClick={() => {
              actions.view('thread')
            }}
          >
            线程视图
          </button>
          <input
            aria-label="搜索任务"
            placeholder="搜索任务"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <select
            aria-label="筛选线程"
            value={thread}
            onChange={(event) => {
              setThread(event.target.value)
            }}
          >
            <option value="all">全部线程</option>
            {document.processes.map(process => (
              <option key={process.id} value={process.id}>
                {process.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              void refresh()
            }}
          >
            刷新
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
            className={css.deliveryComposer}
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
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                }}
              />
            </label>
            <label>
              验收条件（每行一项）
              <textarea
                required
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
                  {workspace?.sessionIds.map(id => (
                    <option key={id} value={id}>
                      {sessions.byId[id]?.displayTitle ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                工作线程
                <select
                  disabled={!!editing}
                  value={taskThread}
                  onChange={(event) => {
                    setTaskThread(event.target.value)
                  }}
                >
                  <option value="backlog">待分配</option>
                  {document.processes.map(process => (
                    <option key={process.id} value={process.id}>
                      {process.name}
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
              <button className={css.primaryAction} disabled={!ready || !description.trim() || !acceptance.trim()}>
                保存待办
              </button>
            </div>
          </form>
        )}
        <main hidden={composer} className={css.deliveryContent} data-detail={task !== undefined || undefined}>
          <div
            hidden={task !== undefined}
            className={css.deliveryBoard}
            aria-label={view.view === 'board' ? '状态看板' : '线程看板'}
          >
            {lanes.map(([key, label]) => {
              const laneIds =
                key === 'backlog'
                  ? document.backlogIds
                  : (document.processes.find(process => process.id === key)?.taskIds ?? [])
              const rows = matching.filter(id =>
                view.view === 'board'
                  ? column(id) === key
                  : key === 'backlog'
                    ? !document.processes.some(process => process.taskIds.includes(id))
                    : laneIds.includes(id),
              )
              return (
                <section
                  className={css.deliveryLane}
                  data-drop-target={dropTarget === key || undefined}
                  aria-label={`${label}列`}
                  key={key}
                  onDragOver={(event) => {
                    if (ready && dragged !== undefined && pendingDrop === undefined) {
                      event.preventDefault()
                      setDropTarget(key)
                    }
                  }}
                  onDrop={(event) => {
                    if (view.view === 'board') boardDrop(event, key as BoardColumn)
                    else {
                      setDragged(undefined)
                      setDropTarget('')
                      setDropPosition(undefined)
                      drop(event, key, key === 'backlog' ? document.backlogIds.length : laneIds.length)
                    }
                  }}
                >
                  <h2>
                    {label} <span>{rows.length}</span>
                  </h2>
                  {view.view === 'thread' && key !== 'backlog' && (
                    <input
                      aria-label={`线程名称 ${label}`}
                      disabled={!ready}
                      defaultValue={label}
                      key={label}
                      onBlur={(event) => {
                        if (event.target.value.trim() && event.target.value !== label)
                          void saveDocument(renameProcess(document, key, event.target.value)).catch(report)
                      }}
                    />
                  )}
                  {rows.length === 0 && <p className={css.muted}>暂无任务</p>}
                  {rows.map((id) => {
                    const item = document.tasks[id],
                      current = currentAttempt(document, id),
                      live = current === undefined ? undefined : sessions.byId[current.sessionId]
                    if (item === undefined) throw new Error('任务不存在，请刷新看板。')
                    return (
                      <button
                        className={css.deliveryCard}
                        draggable={
                          ready && pendingDrop === undefined && (view.view === 'board' || current === undefined)
                        }
                        data-dragging={dragged?.taskId === id || undefined}
                        data-drop-position={
                          dropPosition?.id === id ? (dropPosition.after ? 'after' : 'before') : undefined
                        }
                        onDragOver={(event) => {
                          if (view.view !== 'board' || !ready || dragged === undefined || pendingDrop !== undefined)
                            return
                          event.preventDefault()
                          event.stopPropagation()
                          setDropTarget(key)
                          const bounds = event.currentTarget.getBoundingClientRect()
                          setDropPosition({ id, after: event.clientY > bounds.top + bounds.height / 2 })
                        }}
                        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
                        onDragEnd={() => {
                          setDragged(undefined)
                          setDropTarget('')
                          setDropPosition(undefined)
                        }}
                        onKeyDown={(event) => {
                          if (!event.altKey || view.view !== 'board' || !ready) return
                          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                          event.preventDefault()
                          selectedButton.current = event.currentTarget
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            const index =
                              lanes.findIndex(([lane]) => lane === key) + (event.key === 'ArrowLeft' ? -1 : 1)
                            const destination = lanes[index]?.[0]
                            if (destination !== undefined) boardGesture(id, destination as BoardColumn)
                          } else {
                            const index = rows.indexOf(id) + (event.key === 'ArrowUp' ? -1 : 1)
                            const target = rows[index]
                            if (target !== undefined)
                              boardGesture(id, key as BoardColumn, target, event.key === 'ArrowDown')
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
                        onDrop={(event) => {
                          if (view.view === 'board') boardDrop(event, key as BoardColumn, id)
                          else
                            drop(event, key, key === 'backlog' ? document.backlogIds.indexOf(id) : laneIds.indexOf(id))
                        }}
                        aria-pressed={view.selected === id}
                        key={id}
                        onClick={(event) => {
                          if (dragged !== undefined) return
                          selectedButton.current = event.currentTarget
                          actions.select(id)
                        }}
                      >
                        <small>
                          {document.processes.find(process => process.taskIds.includes(id))?.name ?? '待分配'}
                        </small>
                        <strong>{item.description}</strong>
                        <span>
                          {live?.pendingInteraction !== undefined
                            ? '等待用户操作'
                            : current === undefined
                              ? item.status.includes('blocked')
                                ? '已阻塞'
                                : item.status === 'done'
                                  ? '规划已完成'
                                  : '待办'
                              : LABEL[current.status]}
                        </span>
                        <small>{item.acceptance.length} 项验收条件</small>
                      </button>
                    )
                  })}
                </section>
              )
            })}
          </div>
          <aside
            className={css.deliveryDetails}
            data-planning={task === undefined || undefined}
            aria-label={task === undefined ? '线程管理' : '任务详情'}
          >
            {task === undefined ? (
              <details>
                <summary>管理工作线程</summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void saveDocument(addProcess(document, newThread))
                      .then(() => {
                        setNewThread('')
                      })
                      .catch(report)
                  }}
                >
                  <label>
                    新线程名称
                    <input
                      value={newThread}
                      onChange={(event) => {
                        setNewThread(event.target.value)
                      }}
                    />
                  </label>
                  <button disabled={!ready || !newThread.trim()}>添加线程</button>
                </form>
              </details>
            ) : (
              <>
                <button
                  ref={backButton}
                  onClick={() => {
                    actions.select('')
                  }}
                >
                  返回看板
                </button>
                <h2>{task.description}</h2>
                <p>{attempt === undefined ? '尚未执行' : LABEL[attempt.status]}</p>
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
                    <ul>
                      {task.acceptance.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
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
                      disabled={!ready || !baseRef.trim() || task.acceptance.length === 0}
                      onClick={() => {
                        void runCommand({
                          kind: 'execute',
                          taskId: task.id,
                          baseRef: baseRef.trim(),
                          expectedRevision: document.revision,
                          commandId: newCommandId(),
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
                  <details className={css.advancedOptions}>
                    <summary>编辑与任务安排</summary>
                    <div className={css.deliveryToolbar}>
                      <button
                        disabled={!ready}
                        onClick={() => {
                          setEditing(task.id)
                          setDescription(task.description)
                          setAcceptance(task.acceptance.join('\n'))
                          setBoundSession(task.sessionId ?? '')
                          setTaskThread(
                            document.processes.find(process => process.taskIds.includes(task.id))?.id ?? 'backlog',
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
                        暂停并让后续任务先行
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
                      分配线程
                      <select
                        disabled={!ready}
                        value={document.processes.find(process => process.taskIds.includes(task.id))?.id ?? 'backlog'}
                        onChange={(event) => {
                          const process = document.processes.find(item => item.id === event.target.value)
                          void saveDocument(
                            moveTask(
                              document,
                              task.id,
                              process === undefined
                                ? { zone: 'backlog', index: document.backlogIds.length }
                                : { zone: 'process', processId: process.id, index: process.taskIds.length },
                            ),
                          ).catch(report)
                        }}
                      >
                        <option value="backlog">待分配</option>
                        {document.processes.map(process => (
                          <option key={process.id} value={process.id}>
                            {process.name}
                          </option>
                        ))}
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
              </>
            )}
          </aside>
        </main>
      </div>
    </div>
  )
}
