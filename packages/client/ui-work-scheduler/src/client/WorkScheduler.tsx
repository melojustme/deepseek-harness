import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, DragEvent as ReactDragEvent, FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { InjectFace, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import {
  IconArchiveOutline20, IconCheckOutline16, IconCloseOutline16, IconDownloadOutline16,
  IconChevronDownOutline14, IconFullscreenOutline16, IconListPenOutline16, IconPauseOutline16, IconPlayOutline16,
  IconPlusOutline16, IconLinkOutline14, IconQuestionOutline14, IconSearchOutline16, Tooltip,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createSchedulerState, runnableTasks, type SchedulerState, type SchedulerTask, type TaskStatus } from './scheduler.ts'
import type { createWorkSchedulerStore } from './store.ts'
import css from './WorkScheduler.module.css'

type StoreProps = PropsStore<ReturnType<typeof createWorkSchedulerStore>>
export type SchedulerTriggerProps = PropsRuntime<'sidebar.footer.action'> & StoreProps

/** Callbacks the browser plugin injects into the scheduler panel. */
export interface WorkSchedulerInjected {
  /** Load the durable document for one workspace (normalized on arrival). */
  loadDocument: (workspaceId: WorkspaceId) => Promise<SchedulerState>
  /** Persist the whole document for one workspace. */
  saveDocument: (workspaceId: WorkspaceId, document: SchedulerState) => Promise<void>
  /** Create a Session in one Workspace and seed its unsent composer draft. */
  createSession: (workspaceId: WorkspaceId, draft: string) => Promise<SessionId>
  /** Open a Session through the Client runtime's native navigation. */
  openSession: (sessionId: SessionId) => void
}

export type SchedulerPanelProps = PropsRuntime<'shell.overlay'> & StoreProps & InjectFace<WorkSchedulerInjected>

/** Debounce window for auto-save: keystroke-level renames coalesce into one write. */
const SAVE_DEBOUNCE_MS = 400
const TASK_DRAG_TYPE = 'application/x-dsh-work-scheduler-task'
const WINDOW_MIN_WIDTH = 760
const WINDOW_MIN_HEIGHT = 560
const WINDOW_EDGE_GAP = 16
const SMALL_SCREEN_MAX_WIDTH = 760
const NEW_SESSION_CHOICE = Symbol('new-session')

type ComposerKind = 'process' | 'task'
type TaskSessionChoice = SessionId | typeof NEW_SESSION_CHOICE | ''

interface WindowGeometry {
  top: number
  left: number
  width: number
  height: number
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  ready: '就绪', running: '进行中', 'sync-blocked': '同步阻塞', 'async-blocked': '异步阻塞', done: '完成',
}

/**
 * The workspace a board belongs to: the current session's workspace, else the
 * most recently active workspace, else the first registered one. Undefined
 * means no Workspace exists — the board stays in-memory and unpinned.
 */
function resolveWorkspaceId(sessions: SessionListState, workspaces: WorkspaceListState): WorkspaceId | undefined {
  const current = sessions.current
  if (current !== undefined) {
    const owned = workspaces.items.find(item => item.sessionIds.includes(current))
    if (owned !== undefined) return owned.workspaceId
  }
  return workspaces.recentWorkspaceId ?? workspaces.items[0]?.workspaceId
}

function resolveSessionLabel(
  task: SchedulerTask,
  workspaceSessionIds: ReadonlySet<SessionId>,
  sessions: SessionListState,
): string | null | undefined {
  if (task.sessionId === undefined) return undefined
  if (!workspaceSessionIds.has(task.sessionId)) return null
  return sessions.byId[task.sessionId]?.displayTitle ?? null
}

export function SchedulerTrigger({ wide, useStore, actions }: SchedulerTriggerProps) {
  const open = useStore(state => state.open)
  return (
    <Tooltip label="工作调度" disabled={wide} delayMs={500}>
      <button type="button" className={css.trigger} data-active={open || undefined} aria-label="工作调度" onClick={() => { actions.open() }}>
        <IconListPenOutline16 size={wide ? 16 : 18} />
        {wide && <span>工作调度</span>}
      </button>
    </Tooltip>
  )
}

interface TaskCardProps {
  task: SchedulerTask
  index: number
  disabled: boolean
  sessionLabel: string | null | undefined
  todos: readonly TodoItem[] | null | undefined
  onStatus: (status: TaskStatus) => void
  onOpenSession: () => void
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
}

function TaskCard({
  task, index, disabled, sessionLabel, todos, onStatus, onOpenSession,
  onDragStart, onDragEnd, onDragOver, onDrop,
}: TaskCardProps) {
  const progress = task.status === 'running' && todos !== null && todos !== undefined && todos.length > 0
    ? todos
    : undefined
  const completed = progress?.filter(item => item.status === 'completed').length ?? 0
  const active = progress?.find(item => item.status === 'in_progress')
  return (
    <article
      className={css.task}
      data-status={task.status}
      draggable={!disabled}
      role="listitem"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={(event) => { event.stopPropagation(); onDrop(event) }}
    >
      <div className={css.taskTop}>
        <span className={css.index}>#{index + 1}</span>
        <span className={css.status}>{STATUS_LABEL[task.status]}</span>
      </div>
      <div className={css.description}>{task.description}</div>
      {progress !== undefined && (
        <div className={css.taskProgress}>
          <div
            className={css.taskProgressSegments}
            role="progressbar"
            aria-label={`工作进度 ${completed}/${progress.length}`}
            aria-valuemin={0}
            aria-valuemax={progress.length}
            aria-valuenow={completed}
          >
            {progress.map(item => <span data-status={item.status} key={item.content} />)}
          </div>
          <div className={css.taskProgressMeta}>
            <span>{active?.content ?? `${completed} 项已完成`}</span>
            <span>{completed}/{progress.length}</span>
          </div>
        </div>
      )}
      {task.sessionId !== undefined && (
        sessionLabel === null
          ? <span className={css.sessionMissing}><IconLinkOutline14 />会话不可用</span>
          : (
            <button type="button" className={css.sessionLink} aria-label={`打开会话：${sessionLabel}`} onClick={onOpenSession}>
              <IconLinkOutline14 /><span>{sessionLabel}</span>
            </button>
          )
      )}
      {(task.reason !== '' || task.wakeCondition !== '') && (
        <div className={css.blockDetail}>
          {task.reason !== '' && <span>原因：{task.reason}</span>}
          {task.wakeCondition !== '' && <span>条件：{task.wakeCondition}</span>}
        </div>
      )}
      <div className={css.taskActions}>
        {task.status !== 'running' && task.status !== 'done' && <button type="button" title="开始" disabled={disabled} onClick={() => { onStatus('running') }}><IconPlayOutline16 /></button>}
        {task.status !== 'sync-blocked' && task.status !== 'done' && <button type="button" title="同步阻塞" disabled={disabled} onClick={() => { onStatus('sync-blocked') }}><IconPauseOutline16 /></button>}
        {task.status !== 'async-blocked' && task.status !== 'done' && <button type="button" title="异步阻塞" disabled={disabled} onClick={() => { onStatus('async-blocked') }}>异步</button>}
        {task.status !== 'done' && <button type="button" title="完成" disabled={disabled} onClick={() => { onStatus('done') }}><IconCheckOutline16 /></button>}
      </div>
    </article>
  )
}

export function SchedulerPanel({
  useStore, useSessions, useWorkspaces, actions, loadDocument, saveDocument, createSession, openSession,
}: SchedulerPanelProps) {
  const state = useStore(value => value)
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const [processName, setProcessName] = useState('')
  const [taskText, setTaskText] = useState('')
  const [taskProcess, setTaskProcess] = useState('backlog')
  const [taskSession, setTaskSession] = useState<TaskSessionChoice>('')
  const [composer, setComposer] = useState<ComposerKind | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [sessionQuery, setSessionQuery] = useState('')
  const [taskSubmitting, setTaskSubmitting] = useState(false)
  const [taskSubmitError, setTaskSubmitError] = useState<string>()
  const [dragTaskId, setDragTaskId] = useState<string>()
  const [fullscreen, setFullscreen] = useState(false)
  const [windowGeometry, setWindowGeometry] = useState<WindowGeometry>()
  const importRef = useRef<HTMLInputElement>(null)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const processInputRef = useRef<HTMLInputElement>(null)
  const taskInputRef = useRef<HTMLTextAreaElement>(null)
  const sessionTriggerRef = useRef<HTMLButtonElement>(null)
  const sessionSearchRef = useRef<HTMLInputElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void)>()
  const taskSubmissionRef = useRef(0)
  const workspaceIdRef = useRef<WorkspaceId>()
  // The workspace the in-memory document was loaded from; saves are suppressed
  // until a load for the current workspace lands (a stale document must never
  // be written to a newer workspace during a switch).
  const loadedWorkspaceRef = useRef<WorkspaceId | undefined>(undefined)
  const skipSaveRef = useRef(false)

  const stopResize = useCallback(() => { resizeCleanupRef.current?.() }, [])
  const closeSessionPicker = useCallback(() => {
    setSessionPickerOpen(false)
    setSessionQuery('')
    sessionTriggerRef.current?.focus()
  }, [])
  const resetComposer = useCallback(() => {
    taskSubmissionRef.current += 1
    setComposer(null)
    setCreateMenuOpen(false)
    setSessionPickerOpen(false)
    setSessionQuery('')
    setProcessName('')
    setTaskText('')
    setTaskProcess('backlog')
    setTaskSession('')
    setTaskSubmitting(false)
    setTaskSubmitError(undefined)
    createTriggerRef.current?.focus()
  }, [])
  const startComposer = useCallback((kind: ComposerKind) => {
    taskSubmissionRef.current += 1
    setComposer(kind)
    setCreateMenuOpen(false)
    setSessionPickerOpen(false)
    setSessionQuery('')
    setProcessName('')
    setTaskText('')
    setTaskProcess('backlog')
    setTaskSession('')
    setTaskSubmitting(false)
    setTaskSubmitError(undefined)
  }, [])
  const closePanel = useCallback(() => {
    stopResize()
    resetComposer()
    setFullscreen(false)
    setWindowGeometry(undefined)
    actions.close()
  }, [actions, resetComposer, stopResize])

  const workspaceId = useMemo(() => resolveWorkspaceId(sessions, workspaces), [sessions, workspaces])
  workspaceIdRef.current = workspaceId
  const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
  const workspaceTitle = workspace?.title
  const workspaceSessionIds = workspace?.sessionIds ?? []
  const workspaceSessionSet = useMemo(() => new Set(workspaceSessionIds), [workspaceSessionIds])
  const sessionOptions = workspaceSessionIds.map(sessionId => ({
    sessionId,
    title: sessions.byId[sessionId]?.displayTitle ?? sessionId,
  }))
  const selectedSession = taskSession === NEW_SESSION_CHOICE || taskSession === ''
    ? undefined
    : sessionOptions.find(session => session.sessionId === taskSession)
  const selectedTaskSession = selectedSession?.sessionId ?? ''
  const selectedSessionLabel = taskSession === NEW_SESSION_CHOICE
    ? '新建并打开对话'
    : selectedSession?.title ?? '不关联对话'
  const normalizedSessionQuery = sessionQuery.trim().toLocaleLowerCase()
  const filteredSessionOptions = normalizedSessionQuery === ''
    ? sessionOptions
    : sessionOptions.filter(session => session.title.toLocaleLowerCase().includes(normalizedSessionQuery)
      || session.sessionId.toLocaleLowerCase().includes(normalizedSessionQuery))
  const selectedTaskProcess = taskProcess === 'backlog'
    || state.document.processes.some(process => process.id === taskProcess)
    ? taskProcess
    : 'backlog'

  // Load the durable document when the panel opens or the workspace changes.
  useEffect(() => {
    if (!state.open) return
    if (workspaceId === undefined) {
      if (loadedWorkspaceRef.current !== undefined) actions.replace(createSchedulerState())
      loadedWorkspaceRef.current = undefined
      actions.setStatus('ready')
      return
    }
    let cancelled = false
    actions.setStatus('loading')
    void loadDocument(workspaceId).then(
      (document) => {
        if (cancelled) return
        loadedWorkspaceRef.current = workspaceId
        skipSaveRef.current = true
        actions.replace(document)
        actions.setStatus('ready')
      },
      () => { if (!cancelled) actions.setStatus('error') },
    )
    return () => { cancelled = true }
  }, [state.open, workspaceId, loadDocument, actions])

  // Auto-save the document back to its workspace, debounced.
  useEffect(() => {
    if (workspaceId === undefined) return
    if (loadedWorkspaceRef.current !== workspaceId) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void saveDocument(workspaceId, state.document).catch((error: unknown) => {
        if (cancelled) return
        actions.setStatus('error')
        console.warn('work scheduler save failed:', error)
      })
    }, SAVE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [state.document, workspaceId, saveDocument, actions])

  useEffect(() => {
    if (!state.open) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (sessionPickerOpen) closeSessionPicker()
      else if (createMenuOpen) setCreateMenuOpen(false)
      else if (composer !== null) resetComposer()
      else closePanel()
    }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close) }
  }, [closePanel, closeSessionPicker, composer, createMenuOpen, resetComposer, sessionPickerOpen, state.open])

  useEffect(() => {
    if (composer === 'process') processInputRef.current?.focus()
    else if (composer === 'task') taskInputRef.current?.focus()
  }, [composer])

  useEffect(() => {
    if (sessionPickerOpen) sessionSearchRef.current?.focus()
  }, [sessionPickerOpen])

  useEffect(() => { resetComposer() }, [resetComposer, workspaceId])

  useEffect(() => () => { taskSubmissionRef.current += 1 }, [])

  useEffect(() => {
    if (!state.open) {
      stopResize()
      resetComposer()
      setFullscreen(false)
      setWindowGeometry(undefined)
    }
    return stopResize
  }, [resetComposer, state.open, stopResize])

  useEffect(() => {
    if (!state.open) return
    const fitWindowToViewport = () => {
      if (window.innerWidth <= SMALL_SCREEN_MAX_WIDTH) return
      setWindowGeometry((geometry) => {
        if (geometry === undefined) return geometry
        const availableWidth = Math.max(0, window.innerWidth - WINDOW_EDGE_GAP * 2)
        const availableHeight = Math.max(0, window.innerHeight - WINDOW_EDGE_GAP * 2)
        const width = Math.min(geometry.width, availableWidth)
        const height = Math.min(geometry.height, availableHeight)
        const left = Math.min(Math.max(geometry.left, WINDOW_EDGE_GAP), window.innerWidth - width - WINDOW_EDGE_GAP)
        const top = Math.min(Math.max(geometry.top, WINDOW_EDGE_GAP), window.innerHeight - height - WINDOW_EDGE_GAP)
        if (top === geometry.top && left === geometry.left && width === geometry.width && height === geometry.height) return geometry
        return { top, left, width, height }
      })
    }
    window.addEventListener('resize', fitWindowToViewport)
    return () => { window.removeEventListener('resize', fitWindowToViewport) }
  }, [state.open])

  if (!state.open) return null
  const runnable = runnableTasks(state.document)
  const editable = state.status === 'ready'
  const submitProcess = (event: FormEvent) => {
    event.preventDefault()
    if (processName.trim() === '') return
    actions.addProcess(processName)
    resetComposer()
  }
  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    if (taskText.trim() === '' || taskSubmitting) return
    const task = {
      description: taskText,
      ...selectedTaskProcess === 'backlog' ? {} : { processId: selectedTaskProcess },
    }
    if (taskSession !== NEW_SESSION_CHOICE) {
      actions.addTask({ ...task, ...selectedTaskSession === '' ? {} : { sessionId: selectedTaskSession } })
      resetComposer()
      return
    }
    if (workspaceId === undefined) {
      setTaskSubmitError('当前没有可用工作区。')
      return
    }
    const submission = ++taskSubmissionRef.current
    setTaskSubmitting(true)
    setTaskSubmitError(undefined)
    void createSession(workspaceId, taskText).then(
      (sessionId) => {
        if (taskSubmissionRef.current !== submission || workspaceIdRef.current !== workspaceId) return
        actions.addTask({ ...task, sessionId })
        closePanel()
        openSession(sessionId)
      },
      () => {
        if (taskSubmissionRef.current !== submission || workspaceIdRef.current !== workspaceId) return
        setTaskSubmitting(false)
        setTaskSubmitError('无法新建对话，请重试。')
      },
    )
  }
  const exportData = () => {
    const href = URL.createObjectURL(new Blob([JSON.stringify(state.document, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = href
    link.download = `dsh-work-scheduler-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(href)
  }
  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      actions.replace(parsed)
    } catch {
      window.alert('无法导入：文件不是有效的调度数据。')
    }
    event.target.value = ''
  }
  const changeStatus = (task: SchedulerTask, status: TaskStatus) => {
    if (status === 'async-blocked' || status === 'sync-blocked') {
      const reason = window.prompt('阻塞原因（可留空）', task.reason) ?? task.reason
      const wakeCondition = window.prompt('解除条件（可留空）', task.wakeCondition) ?? task.wakeCondition
      actions.setTaskStatus(task.id, status, { reason, wakeCondition })
    } else actions.setTaskStatus(task.id, status)
  }
  const allowTaskDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!editable) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const dropTask = (event: ReactDragEvent<HTMLElement>, processId: string, requestedIndex: number) => {
    if (!editable) return
    event.preventDefault()
    const taskId = event.dataTransfer.getData(TASK_DRAG_TYPE) || dragTaskId
    if (taskId === undefined || taskId === '') return
    const source = state.document.processes.find(process => process.taskIds.includes(taskId))
    const sourceIndex = source?.taskIds.indexOf(taskId) ?? -1
    const index = source?.id === processId && sourceIndex >= 0 && sourceIndex < requestedIndex
      ? requestedIndex - 1
      : requestedIndex
    actions.moveTask(taskId, { zone: 'process', processId, index: Math.max(0, index) })
    setDragTaskId(undefined)
  }
  const firstProcess = state.document.processes[0]
  const windowStyle: CSSProperties | undefined = fullscreen ? undefined : windowGeometry
  const toggleFullscreen = () => {
    stopResize()
    if (!fullscreen) {
      const bounds = windowRef.current?.getBoundingClientRect()
      if (bounds !== undefined) {
        setWindowGeometry({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height })
      }
    }
    setFullscreen(value => !value)
  }
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fullscreen || window.innerWidth <= SMALL_SCREEN_MAX_WIDTH) return
    const target = windowRef.current
    if (target === null) return
    event.preventDefault()
    stopResize()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const start = target.getBoundingClientRect()
    const geometry = { top: start.top, left: start.left, width: start.width, height: start.height }
    setWindowGeometry(geometry)
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(pointerId)

    function move(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return
      const maxWidth = Math.max(0, window.innerWidth - geometry.left - WINDOW_EDGE_GAP)
      const maxHeight = Math.max(0, window.innerHeight - geometry.top - WINDOW_EDGE_GAP)
      const minWidth = Math.min(WINDOW_MIN_WIDTH, maxWidth)
      const minHeight = Math.min(WINDOW_MIN_HEIGHT, maxHeight)
      const width = Math.min(maxWidth, Math.max(minWidth, geometry.width + pointerEvent.clientX - startX))
      const height = Math.min(maxHeight, Math.max(minHeight, geometry.height + pointerEvent.clientY - startY))
      setWindowGeometry({ ...geometry, width, height })
    }

    function finish(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId === pointerId) cleanup()
    }

    function cleanup() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', cleanup)
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = undefined
    }

    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', cleanup)
  }

  return (
    <div className={css.overlay}>
      <div
        ref={windowRef}
        className={css.window}
        data-fullscreen={fullscreen || undefined}
        data-positioned={!fullscreen && windowGeometry !== undefined || undefined}
        style={windowStyle}
        role="dialog"
        aria-modal="true"
        aria-label="工作调度"
      >
        <header className={css.header}>
          <div>
            <h1>工作调度</h1>
            <p>
              {workspaceTitle !== undefined && <span>{workspaceTitle} · </span>}
              {state.status === 'loading'
                ? '加载中…'
                : state.status === 'error'
                  ? '同步失败，更改不会保存'
                  : `${runnable.length} 个线程可以继续推进`}
            </p>
          </div>
          <div className={css.headerActions}>
            <Menu
              open={createMenuOpen}
              onClose={() => { setCreateMenuOpen(false) }}
              items={[
                { id: 'task', label: '新建任务', icon: <IconPlusOutline16 /> },
                { id: 'process', label: '新建线程', icon: <IconListPenOutline16 /> },
              ]}
              onSelect={(id) => { startComposer(id as ComposerKind) }}
              align="end"
              portal
              compact
              anchor={(
                <button
                  ref={createTriggerRef}
                  type="button"
                  className={css.createMenuButton}
                  disabled={!editable}
                  aria-haspopup="menu"
                  aria-expanded={createMenuOpen}
                  onClick={() => { setCreateMenuOpen(value => !value) }}
                >
                  <IconPlusOutline16 />新建<IconChevronDownOutline14 />
                </button>
              )}
            />
            <button type="button" title="使用说明" onClick={() => { actions.toggleHelp() }}><IconQuestionOutline14 /></button>
            <button type="button" title="导出" onClick={exportData}><IconDownloadOutline16 /></button>
            <button type="button" title="导入" disabled={!editable} onClick={() => { importRef.current?.click() }}>导入</button>
            <button
              type="button"
              className={css.modeToggle}
              title={fullscreen ? '还原' : '全屏'}
              aria-label={fullscreen ? '还原' : '全屏'}
              aria-pressed={fullscreen}
              onClick={toggleFullscreen}
            >
              <IconFullscreenOutline16 />
            </button>
            <button type="button" title="关闭" onClick={closePanel}><IconCloseOutline16 /></button>
            <input ref={importRef} className={css.hidden} type="file" accept="application/json" onChange={(event) => { void importData(event) }} />
          </div>
        </header>

        {composer !== null && (
          <div className={css.commandBar} data-composer={composer}>
            {composer === 'process' && (
              <form id="work-scheduler-process-composer" className={css.processComposer} onSubmit={submitProcess}>
                <div className={css.composerHeader}>
                  <h2>新建线程</h2>
                  <button type="button" className={css.composerClose} title="取消新建线程" onClick={resetComposer}><IconCloseOutline16 /></button>
                </div>
                <div className={css.processEditorRow}>
                  <input
                    ref={processInputRef}
                    value={processName}
                    disabled={!editable}
                    onChange={(event) => { setProcessName(event.target.value) }}
                    placeholder="输入线程名称"
                    aria-label="线程名称"
                  />
                  <button type="submit" className={css.addTask} disabled={!editable || processName.trim() === ''}><IconPlusOutline16 />创建线程</button>
                </div>
              </form>
            )}

            {composer === 'task' && (
              <form id="work-scheduler-task-composer" className={css.taskComposer} onSubmit={submitTask}>
                <div className={css.composerHeader}>
                  <h2>新建任务</h2>
                  <button type="button" className={css.composerClose} title="取消新建任务" onClick={resetComposer}><IconCloseOutline16 /></button>
                </div>

                <label className={css.taskContentField}>
                  <span>任务内容</span>
                  <textarea
                    ref={taskInputRef}
                    value={taskText}
                    disabled={!editable || taskSubmitting}
                    rows={2}
                    placeholder="描述要推进的工作"
                    onChange={(event) => { setTaskText(event.target.value); setTaskSubmitError(undefined) }}
                  />
                </label>

                <div className={css.composerMeta}>
                  <fieldset className={css.destinationField}>
                    <legend>放入</legend>
                    <div className={css.destinationRail}>
                      <label className={css.destinationOption} data-selected={selectedTaskProcess === 'backlog' || undefined}>
                        <input
                          type="radio"
                          name="task-process"
                          value="backlog"
                          checked={selectedTaskProcess === 'backlog'}
                          disabled={!editable || taskSubmitting}
                          onChange={() => { setTaskProcess('backlog') }}
                        />
                        <span>待分配</span>
                      </label>
                      {state.document.processes.map(process => (
                        <label
                          className={css.destinationOption}
                          data-selected={selectedTaskProcess === process.id || undefined}
                          key={process.id}
                        >
                          <input
                            type="radio"
                            name="task-process"
                            value={process.id}
                            checked={selectedTaskProcess === process.id}
                            disabled={!editable || taskSubmitting}
                            onChange={() => { setTaskProcess(process.id) }}
                          />
                          <span>{process.name}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className={css.sessionField}>
                    <span className={css.fieldLabel}>关联对话 <em>可选</em></span>
                    <button
                      ref={sessionTriggerRef}
                      type="button"
                      className={css.sessionTrigger}
                      disabled={taskSubmitting}
                      aria-label={taskSession === NEW_SESSION_CHOICE || selectedSession !== undefined
                        ? `选择关联对话，当前：${selectedSessionLabel}`
                        : '选择关联对话'}
                      aria-expanded={sessionPickerOpen}
                      aria-controls="work-scheduler-session-picker"
                      onClick={() => {
                        if (sessionPickerOpen) closeSessionPicker()
                        else setSessionPickerOpen(true)
                      }}
                    >
                      <IconLinkOutline14 />
                      <span>{selectedSessionLabel}</span>
                      <IconChevronDownOutline14 />
                    </button>
                    {sessionPickerOpen && (
                      <div id="work-scheduler-session-picker" className={css.sessionPicker}>
                        <label className={css.sessionSearch}>
                          <IconSearchOutline16 />
                          <input
                            ref={sessionSearchRef}
                            type="search"
                            value={sessionQuery}
                            aria-label="搜索对话"
                            placeholder="搜索对话"
                            onChange={(event) => { setSessionQuery(event.target.value) }}
                          />
                        </label>
                        <div className={css.sessionOptions} aria-label="可关联对话">
                          <button
                            type="button"
                            disabled={workspaceId === undefined}
                            data-selected={taskSession === NEW_SESSION_CHOICE || undefined}
                            aria-label="新建并打开对话"
                            onClick={() => { setTaskSession(NEW_SESSION_CHOICE); setTaskSubmitError(undefined); closeSessionPicker() }}
                          >
                            <span>新建并打开对话</span>
                            {taskSession === NEW_SESSION_CHOICE && <IconCheckOutline16 />}
                          </button>
                          <button
                            type="button"
                            data-selected={taskSession !== NEW_SESSION_CHOICE && selectedTaskSession === '' || undefined}
                            aria-label="不关联对话"
                            onClick={() => { setTaskSession(''); setTaskSubmitError(undefined); closeSessionPicker() }}
                          >
                            <span>不关联对话</span>
                            {taskSession !== NEW_SESSION_CHOICE && selectedTaskSession === '' && <IconCheckOutline16 />}
                          </button>
                          <div className={css.sessionOptionsDivider} role="separator"><span>已有对话</span></div>
                          {filteredSessionOptions.map(session => (
                            <button
                              type="button"
                              key={session.sessionId}
                              data-selected={selectedTaskSession === session.sessionId || undefined}
                              aria-label={`关联对话：${session.title}`}
                              onClick={() => { setTaskSession(session.sessionId); setTaskSubmitError(undefined); closeSessionPicker() }}
                            >
                              <span>{session.title}</span>
                              {session.sessionId === sessions.current && <small>当前</small>}
                              {selectedTaskSession === session.sessionId && <IconCheckOutline16 />}
                            </button>
                          ))}
                          {filteredSessionOptions.length === 0 && (
                            <p>{sessionOptions.length === 0 ? '当前工作区暂无已有对话' : '没有匹配的已有对话'}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className={css.composerActions}>
                  {taskSubmitError !== undefined && <p className={css.composerError} role="alert">{taskSubmitError}</p>}
                  <button type="button" className={css.cancelTask} onClick={resetComposer}>取消</button>
                  <button
                    type="submit"
                    className={css.addTask}
                    disabled={!editable || taskSubmitting || taskText.trim() === '' || taskSession === NEW_SESSION_CHOICE && workspaceId === undefined}
                  >
                    <IconPlusOutline16 />
                    {taskSubmitting ? '创建中…' : taskSession === NEW_SESSION_CHOICE ? '添加并打开' : '添加任务'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <main className={css.workspace}>
          <section className={css.board} aria-label="线程看板">
            {state.document.processes.length === 0 && (
              <div className={css.empty}>
                <IconListPenOutline16 size={24} />
                <strong>先建立一条工作线程</strong>
                <span>线程中的任务按顺序推进，同步阻塞会暂停后续任务。</span>
              </div>
            )}
            {state.document.processes.map((process) => {
              const tasks = process.taskIds.flatMap(id => state.document.tasks[id] === undefined ? [] : [state.document.tasks[id]])
              return (
                <section className={css.lane} key={process.id}>
                  <div className={css.laneHead}>
                    <input
                      value={process.name}
                      disabled={!editable}
                      aria-label="线程名称"
                      onChange={(event) => { actions.renameProcess(process.id, event.target.value) }}
                    />
                    <span>{tasks.length} 项</span>
                  </div>
                  <div
                    className={css.taskList}
                    role="list"
                    aria-label={`${process.name}任务`}
                    onDragOver={allowTaskDrop}
                    onDrop={(event) => { dropTask(event, process.id, tasks.length) }}
                  >
                    {tasks.length === 0 && <span className={css.laneEmpty}>空线程</span>}
                    {tasks.map((task, index) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        index={index}
                        disabled={!editable}
                        sessionLabel={resolveSessionLabel(task, workspaceSessionSet, sessions)}
                        todos={task.sessionId !== undefined && workspaceSessionSet.has(task.sessionId)
                          ? sessions.byId[task.sessionId]?.projectionValues?.todos
                          : undefined}
                        onStatus={(status) => { changeStatus(task, status) }}
                        onOpenSession={() => {
                          if (task.sessionId === undefined) return
                          openSession(task.sessionId)
                          closePanel()
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData(TASK_DRAG_TYPE, task.id)
                          setDragTaskId(task.id)
                        }}
                        onDragEnd={() => { setDragTaskId(undefined) }}
                        onDragOver={allowTaskDrop}
                        onDrop={(event) => {
                          const bounds = event.currentTarget.getBoundingClientRect()
                          const after = event.clientY >= bounds.top + bounds.height / 2
                          dropTask(event, process.id, index + (after ? 1 : 0))
                        }}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </section>

          <aside className={css.inspector}>
            <section>
              <h2>下一步</h2>
              {runnable.length === 0
                ? <p className={css.muted}>暂无可执行任务</p>
                : runnable.map(item => (
                  <div className={css.next} key={item.task.id}>
                    <span>{item.process.name}</span>
                    <strong>{item.task.description}</strong>
                  </div>
                ))}
            </section>
            <section>
              <h2>待分配 <span>{state.document.backlogIds.length}</span></h2>
              {state.document.backlogIds.flatMap((taskId) => {
                const task = state.document.tasks[taskId]
                if (task === undefined) return []
                return [
                  <div className={css.sideTask} key={taskId}>
                    <span>{task.description}</span>
                    {firstProcess !== undefined && (
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => {
                          actions.moveTask(taskId, {
                            zone: 'process',
                            processId: firstProcess.id,
                            index: firstProcess.taskIds.length,
                          })
                        }}
                      >
                        排入
                      </button>
                    )}
                  </div>,
                ]
              })}
            </section>
            <section><h2>异步阻塞 <span>{state.document.blockedIds.length}</span></h2>{state.document.blockedIds.map(id => <div className={css.sideTask} key={id}><span>{state.document.tasks[id]?.description}</span><button type="button" disabled={!editable} onClick={() => { actions.wakeTask(id) }}>唤醒</button></div>)}</section>
            <section><h2><IconArchiveOutline20 size={16} /> 归档 <span>{state.document.archiveIds.length}</span></h2>{state.document.archiveIds.map(id => <div className={css.sideTask} key={id}><span>{state.document.tasks[id]?.description}</span><button type="button" disabled={!editable} onClick={() => { actions.moveTask(id, { zone: 'backlog', index: state.document.backlogIds.length }) }}>恢复</button></div>)}</section>
          </aside>
        </main>

        {state.helpOpen && <aside className={css.help}><div><h2>如何使用</h2><button type="button" title="关闭说明" onClick={() => { actions.toggleHelp() }}><IconCloseOutline16 /></button></div><ol><li><strong>建立线程</strong><span>按一个可独立推进的工作方向命名。</span></li><li><strong>按顺序添加任务</strong><span>每条线程只突出最前面的可执行任务。</span></li><li><strong>选择阻塞方式</strong><span>同步阻塞暂停本线程；异步阻塞移到右侧，其他任务继续。</span></li><li><strong>完成并归档</strong><span>完成项离开泳道，可随时恢复到待分配。</span></li></ol></aside>}
        <div className={css.resizeHandle} data-testid="work-scheduler-resize-handle" aria-hidden="true" onPointerDown={startResize} />
      </div>
    </div>
  )
}
