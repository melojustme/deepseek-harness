/** Native Session orchestration with durable admission, cancellation, and fixed Git evidence. */
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SchedulerAttempt, SchedulerAttemptId, SchedulerCommand, SchedulerEvidence, WorkSchedulerDocument, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import WorkSchedulerExecutionService from '@deepseek-ai/dsh-work-scheduler-execution'
import { SchedulerGit, type GitConfig } from './git.ts'

/** Host scheduling, Git limits, and retained artifact location. */
export interface Config extends GitConfig {
  /** Absolute parent directory for retained execution worktrees. */
  worktreeRoot: string
  /** Maximum preparing or running attempts across registered Workspaces. */
  maxConcurrentRuns: number
  /** Maximum queued attempts admitted in one Workspace. */
  maxQueuedRuns: number
  /** Queue scan interval in milliseconds. */
  dispatchIntervalMs: number
}

const pending = (attempt: SchedulerAttempt) => ['queued', 'preparing', 'running', 'stopping'].includes(attempt.status)
const latest = (document: WorkSchedulerDocument, taskId: string) => Object.values(document.attempts).filter(attempt => attempt.taskId === taskId).at(-1)
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

interface Run {
  controller: AbortController
  done: Promise<void>
  handle?: AgentHandle
}

/** Native provider; execution survives panel closure and artifacts remain until explicitly removed. */
export default class LocalWorkSchedulerExecution extends WorkSchedulerExecutionService {
  static inject = ['workSchedulerStore', 'workspaceRegistry', 'agents', 'sessions', 'agentDefaultModel', 'agentPresets', 'llm', 'subprocess', 'sessionPersistence']
  static Config: z<Partial<Config>, Config> = z.object({
    worktreeRoot: z.string().required(),
    maxConcurrentRuns: z.natural().min(1).default(1),
    maxQueuedRuns: z.natural().min(1).default(100),
    dispatchIntervalMs: z.natural().min(100).default(1000),
    gitTimeoutMs: z.natural().min(1).default(60000),
    gitGraceMs: z.natural().min(1).default(1000),
    maxEvidenceBytes: z.natural().min(1024).default(1048576),
  })

  private readonly git: SchedulerGit
  private readonly runs = new Map<SchedulerAttemptId, Run>()
  private closed = false
  private dispatching = false
  private commands: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    if (!isAbsolute(config.worktreeRoot)) throw new Error('worktreeRoot must be an absolute directory')
    this.git = new SchedulerGit(ctx, config)
    ctx.effect(() => async () => {
      this.closed = true
      for (const run of this.runs.values()) run.controller.abort()
      await Promise.allSettled([...this.runs.values()].map(run => run.done))
      await this.commands.catch(() => {})
    }, 'work-scheduler-execution.stop')
  }

  protected async [Service.init](): Promise<void> {
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      const { document } = await this.ctx.workSchedulerStore.load(workspace.id)
      if (!Object.values(document.attempts).some(attempt => pending(attempt) && attempt.status !== 'queued')) continue
      await this.ctx.workSchedulerStore.update(workspace.id, current => {
        for (const attempt of Object.values(current.attempts)) {
          if (!pending(attempt) || attempt.status === 'queued') continue
          attempt.status = 'interrupted'
          attempt.error = 'Host 已重启，无法证明该轮执行仍有所有者；请检查日志后重试。'
          attempt.updatedAt = new Date().toISOString()
        }
      })
    }
    this.ctx.effect(() => {
      const timer = setInterval(() => { void this.dispatch().catch(error => this.ctx.logger.error(error)) }, this.config.dispatchIntervalMs)
      return () => { clearInterval(timer) }
    }, 'work-scheduler-execution.dispatch')
    await this.dispatch()
  }

  command(workspaceId: WorkspaceId, command: SchedulerCommand): Promise<WorkSchedulerDocument> {
    const operation = this.commands.then(() => this.applyCommand(workspaceId, command))
    this.commands = operation.catch(() => {})
    return operation
  }

  private async applyCommand(workspaceId: WorkspaceId, command: SchedulerCommand): Promise<WorkSchedulerDocument> {
    if (this.closed) throw new Error('执行服务正在关闭。')
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) throw new Error('工作区不存在。')
    const { document } = await this.ctx.workSchedulerStore.load(workspaceId)
    if ('commandId' in command) {
      const refreshed = Object.values(document.attempts).find(attempt => attempt.evidenceRefreshes?.some(receipt => receipt.commandId === command.commandId))
      if (refreshed !== undefined) {
        const receipt = refreshed.evidenceRefreshes!.find(item => item.commandId === command.commandId)!
        if (command.kind === 'refresh-review' && refreshed.id === command.attemptId && receipt.inputHash === command.evidenceHash) return document
        throw new Error('提交标识已用于其他操作。')
      }
      const reviewed = Object.values(document.attempts).find(attempt => attempt.review?.commandId === command.commandId)
      if (reviewed !== undefined) {
        if (command.kind === 'approve' && reviewed.id === command.attemptId && reviewed.review?.decision === 'approved' && reviewed.review.evidenceHash === command.evidenceHash && reviewed.review.feedback === command.feedback.trim()) return document
        if (command.kind !== 'rework' || reviewed.id !== command.attemptId || reviewed.review?.decision !== 'rework' || reviewed.review.evidenceHash !== command.evidenceHash || reviewed.review.feedback !== command.feedback.trim()) throw new Error('提交标识已用于其他操作。')
      }
      const duplicate = Object.values(document.attempts).find(attempt => attempt.commandId === command.commandId)
      if (duplicate !== undefined) {
        if (command.kind === 'execute' && duplicate.taskId === command.taskId && duplicate.baseRef === (command.baseRef ?? 'HEAD')) return document
        if (command.kind === 'rework' && duplicate.previousId === command.attemptId && duplicate.feedback === command.feedback.trim() && reviewed?.review?.evidenceHash === command.evidenceHash) return document
        throw new Error('提交标识已用于其他操作。')
      }
    }
    if (command.kind === 'cancel') {
      const attempt = document.attempts[command.attemptId]
      if (attempt === undefined) throw new Error('执行轮次不属于此工作区。')
      if (!pending(attempt)) return document
      const run = this.runs.get(attempt.id)
      if (run !== undefined) {
        await this.ctx.workSchedulerStore.update(workspaceId, current => {
          const owned = current.attempts[attempt.id]!
          if (pending(owned)) { owned.status = 'stopping'; owned.updatedAt = new Date().toISOString() }
        })
        run.controller.abort()
        await run.done
        return (await this.ctx.workSchedulerStore.load(workspaceId)).document
      }
      return this.ctx.workSchedulerStore.update(workspaceId, current => {
        const owned = current.attempts[attempt.id]!
        if (owned.status !== 'queued') throw new Error('执行状态已变化，请刷新。')
        owned.status = 'stopped'
        owned.updatedAt = new Date().toISOString()
      })
    }
    if (command.kind === 'yield' || command.kind === 'resume') {
      return this.ctx.workSchedulerStore.update(workspaceId, current => {
        if (current.revision !== command.expectedRevision) throw new Error('看板已变化，请刷新后重试。')
        const owned = current.attempts[command.attemptId]
        if (owned === undefined || latest(current, owned.taskId)?.id !== owned.id || !['queued', 'review'].includes(owned.status)) throw new Error('只能调整排队或待审查轮次的线程占位。')
        const task = current.tasks[owned.taskId]!
        if (command.kind === 'yield') {
          if (task.status === 'async-blocked') return
          const process = current.processes.find(item => item.taskIds.includes(task.id))
          if (process === undefined) throw new Error('任务尚未分配线程。')
          const index = process.taskIds.indexOf(task.id)
          task.origin = { zone: 'process', processId: process.id, index }
          process.taskIds.splice(index, 1)
          current.blockedIds.push(task.id)
          task.status = 'async-blocked'
        } else {
          if (task.status !== 'async-blocked') return
          const origin = task.origin
          const process = origin?.zone === 'process' ? current.processes.find(item => item.id === origin.processId) : undefined
          if (process === undefined || origin === undefined) throw new Error('原线程不存在，无法恢复占位。')
          current.blockedIds = current.blockedIds.filter(id => id !== task.id)
          process.taskIds.splice(Math.min(origin.index, process.taskIds.length), 0, task.id)
          delete task.origin
          task.status = 'ready'
        }
        task.updatedAt = new Date().toISOString()
      })
    }
    if (document.revision !== command.expectedRevision) throw new Error('看板已变化，请刷新后重试。')
    if (command.kind === 'execute') {
      const task = Object.hasOwn(document.tasks, command.taskId) ? document.tasks[command.taskId] : undefined
      if (task === undefined || !task.description.trim() || task.acceptance.length === 0) throw new Error('请填写任务描述和至少一项验收条件。')
      const previous = latest(document, task.id)
      if (previous !== undefined && (pending(previous) || previous.status === 'review' || previous.status === 'approved')) throw new Error('任务已有执行或待审查结果。')
      const selection = this.ctx.agentDefaultModel.currentSelection()
      await this.ctx.llm.resolveModelInfo(selection.provider, selection.model)
      await this.ctx.agentPresets.resolve()
      const baseRef = command.baseRef ?? 'HEAD'
      const baseCommit = (await this.git.run(workspace.path, ['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`])).text.trim()
      return this.admit(workspaceId, command, task.id, undefined, baseCommit)
    }
    const attempt = document.attempts[command.attemptId]
    if (attempt === undefined || latest(document, attempt.taskId)?.id !== attempt.id || attempt.status !== 'review' || attempt.evidence === undefined || attempt.worktree === undefined) throw new Error('该轮次没有可审查的正常执行结果。')
    if (attempt.worktree !== join(this.config.worktreeRoot, attempt.id)) throw new Error('执行目录与提供者配置不匹配。')
    if (this.ctx.agents.get(attempt.sessionId) !== undefined) throw new Error('执行会话仍在运行，不能审查。')
    const inspection = await this.ctx.sessionPersistence.inspect(attempt.sessionId)
    if ((inspection.events.at(-1)?.seq ?? -1) !== attempt.evidence.logSeq || hashLog(inspection.events) !== attempt.evidence.logHash) throw new Error('执行日志已变化，不能审查旧轮次。')
    if (attempt.evidence.hash !== command.evidenceHash) throw new Error('审查证据已变化，请刷新。')
    const tree = await this.git.tree(attempt.worktree)
    const fixedTree = (await this.git.run(attempt.worktree, ['rev-parse', `${attempt.evidence.commit}^{tree}`])).text.trim()
    if (command.kind === 'refresh-review') {
      const base = attempt.baseCommit!
      const commit = (await this.git.run(attempt.worktree, ['commit-tree', tree, '-p', base, '-m', 'Scheduler review snapshot'])).text.trim()
      await this.git.run(attempt.worktree, ['update-ref', `refs/dsh/scheduler/${attempt.id}`, commit])
      const diff = await this.git.run(attempt.worktree, ['diff', '--no-ext-diff', '--no-textconv', '--binary', base, tree, '--'], undefined, true)
      const evidence = executionEvidence(inspection.events, base, tree, commit, diff, this.config.maxEvidenceBytes)
      return this.ctx.workSchedulerStore.update(workspaceId, current => {
        if (current.revision !== command.expectedRevision) throw new Error('看板已变化，请刷新。')
        const owned = current.attempts[attempt.id]!
        owned.evidence = evidence
        owned.evidenceRefreshes = [...owned.evidenceRefreshes ?? [], { commandId: command.commandId, inputHash: command.evidenceHash }]
        owned.updatedAt = new Date().toISOString()
      })
    }
    if (tree !== fixedTree) throw new Error('文件已在审查期间变化，不能通过旧证据；请先恢复固定版本或重新执行。')
    if (attempt.evidence.tools.some(tool => tool.failed) && !command.feedback.trim()) throw new Error('存在失败的工具或检查，请填写接受原因。')
    if (command.kind === 'rework') {
      if (!command.feedback.trim()) throw new Error('请填写返工意见。')
      return this.admit(workspaceId, command, attempt.taskId, attempt)
    }
    return this.ctx.workSchedulerStore.update(workspaceId, current => {
      if (current.revision !== command.expectedRevision) throw new Error('看板已变化，请刷新。')
      const owned = current.attempts[attempt.id]!
      owned.status = 'approved'
      owned.review = { commandId: command.commandId, decision: 'approved', evidenceHash: command.evidenceHash, feedback: command.feedback.trim(), actor: 'local-user', time: new Date().toISOString() }
      owned.updatedAt = owned.review.time
    })
  }

  private admit(workspaceId: WorkspaceId, command: Extract<SchedulerCommand, { kind: 'execute' }> | Extract<SchedulerCommand, { evidenceHash: string }>, taskId: string, previous?: SchedulerAttempt, baseCommit?: string): Promise<WorkSchedulerDocument> {
    return this.ctx.workSchedulerStore.update(workspaceId, document => {
      if (document.revision !== command.expectedRevision) throw new Error('看板已变化，请刷新。')
      if (Object.values(document.attempts).filter(attempt => attempt.status === 'queued').length >= this.config.maxQueuedRuns) throw new Error('执行队列已满。')
      const task = document.tasks[taskId]!
      const id = randomUUID() as SchedulerAttemptId
      const now = new Date().toISOString()
      document.attempts[id] = {
        id, taskId, commandId: command.commandId, status: 'queued', description: task.description,
        acceptance: [...task.acceptance], feedback: command.kind === 'rework' ? command.feedback.trim() : '',
        sessionId: `scheduler-${id}` as SessionId, createdAt: now, updatedAt: now,
        ...previous === undefined ? { baseCommit: baseCommit!, baseRef: command.kind === 'execute' ? command.baseRef ?? 'HEAD' : 'HEAD' } : { previousId: previous.id, baseCommit: previous.evidence!.commit },
      }
      if (previous !== undefined && command.kind === 'rework') {
        document.attempts[previous.id]!.review = { commandId: command.commandId, decision: 'rework', evidenceHash: command.evidenceHash, feedback: command.feedback.trim(), actor: 'local-user', time: now }
      }
    })
  }

  private async dispatch(): Promise<void> {
    if (this.closed || this.dispatching) return
    this.dispatching = true
    try {
      for (const workspace of this.ctx.workspaceRegistry.list()) {
        const { document } = await this.ctx.workSchedulerStore.load(workspace.id)
        for (const attempt of Object.values(document.attempts)) {
          if (this.closed || this.runs.size >= this.config.maxConcurrentRuns) return
          if (attempt.status !== 'queued' || this.runs.has(attempt.id)) continue
          const task = document.tasks[attempt.taskId]!
          if (task.status === 'sync-blocked' || task.status === 'async-blocked') continue
          const process = document.processes.find(item => item.taskIds.includes(task.id))
          if (process !== undefined && process.taskIds.slice(0, process.taskIds.indexOf(task.id)).some(id => {
            const prior = latest(document, id)
            return prior === undefined ? document.tasks[id]?.status !== 'done' : prior.status !== 'approved'
          })) continue
          const run: Run = { controller: new AbortController(), done: Promise.resolve() }
          this.runs.set(attempt.id, run)
          run.done = this.run(workspace.id, workspace.path, attempt, run).catch(error => this.ctx.logger.error(error)).finally(() => { this.runs.delete(attempt.id) })
        }
      }
    } finally { this.dispatching = false }
  }

  private async run(workspaceId: WorkspaceId, repository: string, attempt: SchedulerAttempt, run: Run): Promise<void> {
    const signal = run.controller.signal
    const change = (mutate: (owned: SchedulerAttempt) => void) => this.ctx.workSchedulerStore.update(workspaceId, document => {
      const owned = document.attempts[attempt.id]!
      mutate(owned)
      owned.updatedAt = new Date().toISOString()
    })
    let events: readonly SessionEvent[] = []
    try {
      await change(owned => {
        if (owned.status !== 'queued') throw new Error('执行排队已取消。')
        owned.status = 'preparing'
      })
      signal.throwIfAborted()
      const document = (await this.ctx.workSchedulerStore.load(workspaceId)).document
      const base = document.attempts[attempt.id]!.baseCommit!
      const path = join(this.config.worktreeRoot, attempt.id)
      await change(owned => { owned.worktree = path; owned.baseCommit = base })
      await this.git.create(repository, path, base, signal)
      const preset = await this.ctx.agentPresets.resolve()
      const selection = this.ctx.agentDefaultModel.currentSelection()
      run.handle = await this.ctx.agents.create({
        sessionId: attempt.sessionId, meta: { cwd: path, agentPreset: preset.id }, signal,
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: async agentCtx => {
          installModelSelection(agentCtx, { current: selection, assembled: undefined })
          await this.ctx.agentPresets.mount(agentCtx, preset.id)
        },
      })
      const agent = run.handle.agent
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('执行需要持久 Session 日志。')
      const executionWorkspace = await this.ctx.workspaceRegistry.create(path)
      await executionWorkspace.attachSession(agent.id)
      const cancel = () => { agent.cancel({ kind: 'user' }) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        signal.throwIfAborted()
        const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: executionPrompt(attempt) }] })
        agent.followup(message)
        if (!await this.ctx.sessions.flush(agent.session)) throw new Error('执行需要持久 Session 日志。')
        await change(owned => { owned.status = signal.aborted ? 'stopping' : 'running' })
        await agent.whenIdle()
        events = [...agent.session.events]
        if (!events.some(event => event.type === 'user/message' && event.data.id === message.id)) throw new Error('本轮输入没有进入模型请求。')
        const end = events.findLast(event => event.type === 'turn/end')
        if (end?.type !== 'turn/end' || end.data.reason.kind !== 'completed') throw new Error(end?.type === 'turn/end' ? JSON.stringify(end.data.reason) : '执行没有正常终结记录。')
        await this.ctx.sessions.flush(agent.session)
      } finally { signal.removeEventListener('abort', cancel) }
      await run.handle.dispose()
      delete run.handle
      events = [...agent.session.events]
      signal.throwIfAborted()
      const tree = await this.git.tree(path, signal)
      const commit = (await this.git.run(path, ['commit-tree', tree, '-p', base, '-m', 'Scheduler execution snapshot'], signal)).text.trim()
      await this.git.run(path, ['update-ref', `refs/dsh/scheduler/${attempt.id}`, commit], signal)
      const diff = await this.git.run(path, ['diff', '--no-ext-diff', '--no-textconv', '--binary', base, tree, '--'], signal, true)
      const evidence = executionEvidence(events, base, tree, commit, diff, this.config.maxEvidenceBytes)
      await change(owned => { signal.throwIfAborted(); owned.evidence = evidence; owned.status = 'review' })
    } catch (error: unknown) {
      if (run.handle !== undefined) {
        try { await run.handle.dispose() } catch (cleanupError: unknown) {
          await change(owned => { owned.status = 'interrupted'; owned.error = `执行资源释放失败：${messageOf(cleanupError)}` })
          throw cleanupError
        }
        delete run.handle
      }
      await change(owned => {
        if (owned.status === 'stopped') return
        owned.status = signal.aborted ? 'stopped' : 'failed'
        owned.error = messageOf(error)
      })
    }
  }
}

/**
 * Assemble the exact task and feedback logged as the execution's user input.
 * @param attempt - Admitted immutable task snapshot.
 * @returns Model-visible task text.
 */
export function executionPrompt(attempt: SchedulerAttempt): string {
  return `任务：${attempt.description}\n\n验收条件：\n${attempt.acceptance.map(item => `- ${item}`).join('\n')}\n\n${attempt.feedback ? `返工意见：${attempt.feedback}\n\n` : ''}在当前隔离工作目录完成任务，运行相关检查，并总结修改、实际检查结果和未完成项。不要推送或合并到用户分支。`
}

/**
 * Project immutable log evidence without interpreting arbitrary commands as successful tests.
 * @param events - Complete owned execution log through normal completion.
 * @param base - Input commit.
 * @param tree - Fixed output tree.
 * @param commit - Retained snapshot for rework.
 * @param diff - Bounded display diff.
 * @param limit - Combined display evidence budget in bytes.
 * @returns Versioned review evidence.
 */
export function executionEvidence(events: readonly SessionEvent[], base: string, tree: string, commit: string, diff: { text: string; truncated: boolean }, limit: number): SchedulerEvidence {
  const logSeq = events.at(-1)?.seq ?? -1
  const tools: SchedulerEvidence['tools'] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const result = events.find(item => item.type === 'tool/result' && item.data.message.source.callId === event.data.callId)
    tools.push({ name: event.data.name, arguments: event.data.arguments, result: result === undefined ? '未完成' : JSON.stringify(result.data), failed: result === undefined || (result.type === 'tool/result' && (result.data.error !== undefined || result.data.message.content.some(block => block.type === 'tool-result' && (block.isError === true || (event.data.name === 'bash' && block.content.some(content => content.type === 'text' && failedShellResult(content.text))))))) })
  }
  const assistant = events.findLast(event => event.type === 'assistant/message')
  const summary = assistant?.type === 'assistant/message' ? assistant.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '没有执行摘要。'
  const logHash = hashLog(events)
  const evidence: SchedulerEvidence = { hash: createHash('sha256').update(JSON.stringify([base, tree, logHash])).digest('hex'), commit, logSeq, logHash, diff: diff.text, truncated: diff.truncated, summary, tools }
  if (Buffer.byteLength(JSON.stringify(evidence)) > limit) {
    evidence.truncated = true
    evidence.diff = ''
    evidence.summary = '显示证据超过限制；请在专属 Session 和保留的 worktree 查看完整结果。'
    evidence.tools = tools.map(tool => ({ name: tool.name, arguments: '', result: '详见 Session 日志', failed: tool.failed }))
    if (Buffer.byteLength(JSON.stringify(evidence)) > limit) throw new Error('证据清单超过配置限制，不能完成审查。')
  }
  return evidence
}

/** Interpret only the native bash JSON result, leaving other tool output uninterpreted. */
function failedShellResult(text: string): boolean {
  let value: unknown
  try { value = JSON.parse(text) } catch { return false /* Non-JSON display text carries no structured shell status. */ }
  if (value === null || typeof value !== 'object') return false
  return ('exitCode' in value && value.exitCode !== 0) || ('timedOut' in value && value.timedOut === true) || ('aborted' in value && value.aborted === true)
}

/** Digest the complete immutable log, including tool results and terminal reason. */
function hashLog(events: readonly SessionEvent[]): string {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex')
}
