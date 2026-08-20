import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent as ReactDragEvent, FormEvent } from 'react'
import type { InjectFace, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import {
  IconArchiveOutline20, IconCheckOutline16, IconCloseOutline16, IconDownloadOutline16,
  IconListPenOutline16, IconPauseOutline16, IconPlayOutline16, IconPlusOutline16,
  IconLinkOutline14, IconQuestionOutline14, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { createSchedulerState, runnableTasks, type SchedulerState, type SchedulerTask, type TaskStatus } from './scheduler.ts'
import type { createWorkSchedulerStore } from './store.ts'
import css from './WorkScheduler.module.css'

type StoreProps = PropsStore<ReturnType<typeof createWorkSchedulerStore>>
export type SchedulerTriggerProps = PropsRuntime<'sidebar.footer.action'> & StoreProps

/** Gateway-bound persistence callbacks the plugin injects into the panel. */
export interface WorkSchedulerInjected {
  /** Load the durable document for one workspace (normalized on arrival). */
  loadDocument: (workspaceId: WorkspaceId) => Promise<SchedulerState>
  /** Persist the whole document for one workspace. */
  saveDocument: (workspaceId: WorkspaceId, document: SchedulerState) => Promise<void>
  /** Open a Session through the Client runtime's native navigation. */
  openSession: (sessionId: SessionId) => void
}

export type SchedulerPanelProps = PropsRuntime<'shell.overlay'> & StoreProps & InjectFace<WorkSchedulerInjected>

/** Debounce window for auto-save: keystroke-level renames coalesce into one write. */
const SAVE_DEBOUNCE_MS = 400
const TASK_DRAG_TYPE = 'application/x-dsh-work-scheduler-task'

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
  onStatus: (status: TaskStatus) => void
  onOpenSession: () => void
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  onDrop: (event: ReactDragEvent<HTMLElement>) => void
}

function TaskCard({
  task, index, disabled, sessionLabel, onStatus, onOpenSession,
  onDragStart, onDragEnd, onDragOver, onDrop,
}: TaskCardProps) {
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
  useStore, useSessions, useWorkspaces, actions, loadDocument, saveDocument, openSession,
}: SchedulerPanelProps) {
  const state = useStore(value => value)
  const sessions = useSessions(value => value)
  const workspaces = useWorkspaces(value => value)
  const [processName, setProcessName] = useState('')
  const [taskText, setTaskText] = useState('')
  const [taskProcess, setTaskProcess] = useState('backlog')
  const [taskSession, setTaskSession] = useState<SessionId | ''>('')
  const [dragTaskId, setDragTaskId] = useState<string>()
  const importRef = useRef<HTMLInputElement>(null)
  // The workspace the in-memory document was loaded from; saves are suppressed
  // until a load for the current workspace lands (a stale document must never
  // be written to a newer workspace during a switch).
  const loadedWorkspaceRef = useRef<WorkspaceId | undefined>(undefined)
  const skipSaveRef = useRef(false)

  const workspaceId = useMemo(() => resolveWorkspaceId(sessions, workspaces), [sessions, workspaces])
  const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
  const workspaceTitle = workspace?.title
  const workspaceSessionIds = workspace?.sessionIds ?? []
  const workspaceSessionSet = useMemo(() => new Set(workspaceSessionIds), [workspaceSessionIds])
  const sessionOptions = workspaceSessionIds.map(sessionId => ({
    sessionId,
    title: sessions.byId[sessionId]?.displayTitle ?? sessionId,
  }))

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
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') actions.close() }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close) }
  }, [actions, state.open])

  if (!state.open) return null
  const runnable = runnableTasks(state.document)
  const editable = state.status === 'ready'
  const submitProcess = (event: FormEvent) => {
    event.preventDefault()
    if (processName.trim() === '') return
    actions.addProcess(processName)
    setProcessName('')
  }
  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    if (taskText.trim() === '') return
    actions.addTask({
      description: taskText,
      ...taskProcess === 'backlog' ? {} : { processId: taskProcess },
      ...taskSession === '' ? {} : { sessionId: taskSession },
    })
    setTaskText('')
    setTaskSession('')
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

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label="工作调度">
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
          <button type="button" title="使用说明" onClick={() => { actions.toggleHelp() }}><IconQuestionOutline14 /></button>
          <button type="button" title="导出" onClick={exportData}><IconDownloadOutline16 /></button>
          <button type="button" title="导入" disabled={!editable} onClick={() => { importRef.current?.click() }}>导入</button>
          <button type="button" title="关闭" onClick={() => { actions.close() }}><IconCloseOutline16 /></button>
          <input ref={importRef} className={css.hidden} type="file" accept="application/json" onChange={(event) => { void importData(event) }} />
        </div>
      </header>

      <div className={css.commandBar}>
        <form onSubmit={submitProcess}><input value={processName} disabled={!editable} onChange={(event) => { setProcessName(event.target.value) }} placeholder="线程名称" aria-label="线程名称" /><button type="submit" disabled={!editable}><IconPlusOutline16 />新建线程</button></form>
        <form onSubmit={submitTask}><input value={taskText} disabled={!editable} onChange={(event) => { setTaskText(event.target.value) }} placeholder="下一项工作" aria-label="任务内容" /><select value={taskProcess} disabled={!editable} onChange={(event) => { setTaskProcess(event.target.value) }} aria-label="任务位置"><option value="backlog">待分配</option>{state.document.processes.map(process => <option key={process.id} value={process.id}>{process.name}</option>)}</select><select value={taskSession} disabled={!editable} onChange={(event) => { setTaskSession(event.target.value === '' ? '' : event.target.value as SessionId) }} aria-label="关联会话"><option value="">不关联会话</option>{sessionOptions.map(session => <option key={session.sessionId} value={session.sessionId}>{session.title}</option>)}</select><button type="submit" disabled={!editable}><IconPlusOutline16 />添加任务</button></form>
      </div>

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
                      onStatus={(status) => { changeStatus(task, status) }}
                      onOpenSession={() => { if (task.sessionId !== undefined) openSession(task.sessionId) }}
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
    </div>
  )
}
