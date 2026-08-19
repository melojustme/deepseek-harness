import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconArchiveOutline20, IconCheckOutline16, IconCloseOutline16, IconDownloadOutline16,
  IconListPenOutline16, IconPauseOutline16, IconPlayOutline16, IconPlusOutline16,
  IconQuestionOutline14, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { runnableTasks, type SchedulerTask, type TaskStatus } from './scheduler.ts'
import { STORAGE_KEY, type createWorkSchedulerStore } from './store.ts'
import css from './WorkScheduler.module.css'

type StoreProps = PropsStore<ReturnType<typeof createWorkSchedulerStore>>
export type SchedulerTriggerProps = PropsRuntime<'sidebar.footer.action'> & StoreProps
export type SchedulerPanelProps = PropsRuntime<'shell.overlay'> & StoreProps

const STATUS_LABEL: Record<TaskStatus, string> = {
  ready: '就绪', running: '进行中', 'sync-blocked': '同步阻塞', 'async-blocked': '异步阻塞', done: '完成',
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

function TaskCard({ task, index, onStatus }: { task: SchedulerTask; index: number; onStatus: (status: TaskStatus) => void }) {
  return (
    <article className={css.task} data-status={task.status}>
      <div className={css.taskTop}>
        <span className={css.index}>#{index + 1}</span>
        <span className={css.status}>{STATUS_LABEL[task.status]}</span>
      </div>
      <div className={css.description}>{task.description}</div>
      {(task.reason !== '' || task.wakeCondition !== '') && <div className={css.blockDetail}>{task.reason !== '' && <span>原因：{task.reason}</span>}{task.wakeCondition !== '' && <span>条件：{task.wakeCondition}</span>}</div>}
      <div className={css.taskActions}>
        {task.status !== 'running' && task.status !== 'done' && <button type="button" title="开始" onClick={() => { onStatus('running') }}><IconPlayOutline16 /></button>}
        {task.status !== 'sync-blocked' && task.status !== 'done' && <button type="button" title="同步阻塞" onClick={() => { onStatus('sync-blocked') }}><IconPauseOutline16 /></button>}
        {task.status !== 'async-blocked' && task.status !== 'done' && <button type="button" title="异步阻塞" onClick={() => { onStatus('async-blocked') }}>异步</button>}
        {task.status !== 'done' && <button type="button" title="完成" onClick={() => { onStatus('done') }}><IconCheckOutline16 /></button>}
      </div>
    </article>
  )
}

export function SchedulerPanel({ useStore, actions }: SchedulerPanelProps) {
  const state = useStore(value => value)
  const [processName, setProcessName] = useState('')
  const [taskText, setTaskText] = useState('')
  const [taskProcess, setTaskProcess] = useState('backlog')
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.document)) } catch { /* Browser storage can be disabled. */ }
  }, [state.document])
  useEffect(() => {
    if (!state.open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') actions.close() }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close) }
  }, [actions, state.open])

  if (!state.open) return null
  const runnable = runnableTasks(state.document)
  const submitProcess = (event: FormEvent) => {
    event.preventDefault()
    if (processName.trim() === '') return
    actions.addProcess(processName)
    setProcessName('')
  }
  const submitTask = (event: FormEvent) => {
    event.preventDefault()
    if (taskText.trim() === '') return
    actions.addTask(taskProcess === 'backlog' ? { description: taskText } : { description: taskText, processId: taskProcess })
    setTaskText('')
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
    try { actions.replace(JSON.parse(await file.text())) } catch { window.alert('无法导入：文件不是有效的调度数据。') }
    event.target.value = ''
  }
  const changeStatus = (task: SchedulerTask, status: TaskStatus) => {
    if (status === 'async-blocked' || status === 'sync-blocked') {
      const reason = window.prompt('阻塞原因（可留空）', task.reason) ?? task.reason
      const wakeCondition = window.prompt('解除条件（可留空）', task.wakeCondition) ?? task.wakeCondition
      actions.setTaskStatus(task.id, status, { reason, wakeCondition })
    } else actions.setTaskStatus(task.id, status)
  }

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label="工作调度">
      <header className={css.header}>
        <div><h1>工作调度</h1><p>{runnable.length} 个线程可以继续推进</p></div>
        <div className={css.headerActions}>
          <button type="button" title="使用说明" onClick={() => { actions.toggleHelp() }}><IconQuestionOutline14 /></button>
          <button type="button" title="导出" onClick={exportData}><IconDownloadOutline16 /></button>
          <button type="button" title="导入" onClick={() => { importRef.current?.click() }}>导入</button>
          <button type="button" title="关闭" onClick={() => { actions.close() }}><IconCloseOutline16 /></button>
          <input ref={importRef} className={css.hidden} type="file" accept="application/json" onChange={(event) => { void importData(event) }} />
        </div>
      </header>

      <div className={css.commandBar}>
        <form onSubmit={submitProcess}><input value={processName} onChange={(event) => { setProcessName(event.target.value) }} placeholder="线程名称" aria-label="线程名称" /><button type="submit"><IconPlusOutline16 />新建线程</button></form>
        <form onSubmit={submitTask}><input value={taskText} onChange={(event) => { setTaskText(event.target.value) }} placeholder="下一项工作" aria-label="任务内容" /><select value={taskProcess} onChange={(event) => { setTaskProcess(event.target.value) }} aria-label="任务位置"><option value="backlog">待分配</option>{state.document.processes.map(process => <option key={process.id} value={process.id}>{process.name}</option>)}</select><button type="submit"><IconPlusOutline16 />添加任务</button></form>
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
            return <section className={css.lane} key={process.id}><div className={css.laneHead}><input value={process.name} aria-label="线程名称" onChange={(event) => { actions.renameProcess(process.id, event.target.value) }} /><span>{tasks.length} 项</span></div><div className={css.taskList}>{tasks.length === 0 && <span className={css.laneEmpty}>空线程</span>}{tasks.map((task, index) => <TaskCard key={task.id} task={task} index={index} onStatus={(status) => { changeStatus(task, status) }} />)}</div></section>
          })}
        </section>

        <aside className={css.inspector}>
          <section>
            <h2>下一步</h2>
            {runnable.length === 0 ? <p className={css.muted}>暂无可执行任务</p> : runnable.map(item => (
              <div className={css.next} key={item.task.id}>
                <span>{item.process.name}</span>
                <strong>{item.task.description}</strong>
              </div>
            ))}
          </section>
          <section>
            <h2>待分配 <span>{state.document.backlogIds.length}</span></h2>
            {state.document.backlogIds.map((id) => {
              const task = state.document.tasks[id]
              if (task === undefined) return null
              const firstProcess = state.document.processes[0]
              return (
                <div className={css.sideTask} key={id}>
                  <span>{task.description}</span>
                  {firstProcess !== undefined && <button type="button" onClick={() => { actions.moveTask(id, { zone: 'process', processId: firstProcess.id, index: firstProcess.taskIds.length }) }}>排入</button>}
                </div>
              )
            })}
          </section>
          <section><h2>异步阻塞 <span>{state.document.blockedIds.length}</span></h2>{state.document.blockedIds.map(id => <div className={css.sideTask} key={id}><span>{state.document.tasks[id]?.description}</span><button type="button" onClick={() => { actions.wakeTask(id) }}>唤醒</button></div>)}</section>
          <section><h2><IconArchiveOutline20 size={16} /> 归档 <span>{state.document.archiveIds.length}</span></h2>{state.document.archiveIds.map(id => <div className={css.sideTask} key={id}><span>{state.document.tasks[id]?.description}</span><button type="button" onClick={() => { actions.moveTask(id, { zone: 'backlog', index: state.document.backlogIds.length }) }}>恢复</button></div>)}</section>
        </aside>
      </main>

      {state.helpOpen && <aside className={css.help}><div><h2>如何使用</h2><button type="button" title="关闭说明" onClick={() => { actions.toggleHelp() }}><IconCloseOutline16 /></button></div><ol><li><strong>建立线程</strong><span>按一个可独立推进的工作方向命名。</span></li><li><strong>按顺序添加任务</strong><span>每条线程只突出最前面的可执行任务。</span></li><li><strong>选择阻塞方式</strong><span>同步阻塞暂停本线程；异步阻塞移到右侧，其他任务继续。</span></li><li><strong>完成并归档</strong><span>完成项离开泳道，可随时恢复到待分配。</span></li></ol></aside>}
    </div>
  )
}
