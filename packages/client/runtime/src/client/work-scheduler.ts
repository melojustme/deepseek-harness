/** Workspace scheduler documents, conditional writes, and refresh ownership outside React. */
import type { IApiClient, SchedulerCommand, WorkSchedulerDocument, WorkspaceId } from '@deepseek-ai/dsh-client-connection/client'
import { Notifier } from './sessions/notifier.ts'

/** Published scheduler state; errors retain the last known document for inspection. */
export interface SchedulerSnapshot {
  workspaceId: WorkspaceId | undefined
  document: WorkSchedulerDocument
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  error: string | undefined
}

/**
 * Construct an empty version-three document.
 * @returns An unpersisted revision-zero board.
 */
export function emptySchedulerDocument(): WorkSchedulerDocument {
  return { version: 3, revision: 0, attempts: {}, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [] }
}

/** One selected Workspace's server-owned board, independent of panel visibility. */
export class WorkSchedulerRuntime {
  private state: SchedulerSnapshot = { workspaceId: undefined, document: emptySchedulerDocument(), status: 'idle', error: undefined }
  private readonly notifier = new Notifier(() => {})
  private generation = 0
  private timer: ReturnType<typeof setInterval>
  private refreshGeneration: number | undefined
  private disposed = false
  private connected = true
  private mutationPending = false

  constructor(private readonly api: IApiClient, refreshIntervalMs: number) {
    this.timer = setInterval(() => { void this.refresh() }, refreshIntervalMs)
  }

  /** Read current scheduler state.
   * @returns The reference-stable current snapshot.
   */
  getSnapshot(): SchedulerSnapshot { return this.state }
  /**
   * Subscribe through the framework's observable binding.
   * @param listener - Notification callback.
   * @returns Listener disposer.
   */
  subscribe(listener: () => void): () => void { return this.notifier.subscribe(listener) }

  /**
   * Select a Workspace and invalidate outstanding reads from the previous selection.
   * @param workspaceId - Current Workspace, or absence before registration.
   */
  select(workspaceId: WorkspaceId | undefined): void {
    if (this.disposed || this.state.workspaceId === workspaceId) return
    this.generation++
    this.state = { workspaceId, document: emptySchedulerDocument(), status: workspaceId === undefined ? 'idle' : 'loading', error: undefined }
    this.notifier.markDirty()
    void this.refresh()
  }

  /** Refresh after a reconnect or explicit retry; mutations never consume stale reads. */
  async refresh(): Promise<void> {
    const workspaceId = this.state.workspaceId
    if (this.disposed || !this.connected || workspaceId === undefined || this.refreshGeneration === this.generation || this.mutationPending) return
    const generation = this.generation
    this.refreshGeneration = generation
    try {
      const response = await this.api.workScheduler.load({ workspaceId })
      if (generation !== this.generation || this.mutationPending) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      const document = response.result.value.document
      if (document.revision < this.state.document.revision) return
      this.publish({ document, status: 'ready', error: undefined })
    } catch (error: unknown) {
      if (generation === this.generation && !this.mutationPending) this.failure(error)
    } finally { if (this.refreshGeneration === generation) this.refreshGeneration = undefined }
  }

  /**
   * Save a planning mutation against the current revision; execution fields remain Host-owned.
   * @param transform - Pure document edit.
   * @returns Completion after durability, or rejection with the draft retained by its caller.
   */
  edit(transform: (document: WorkSchedulerDocument) => WorkSchedulerDocument): Promise<void> {
    return this.mutate(workspaceId => this.api.workScheduler.save({ workspaceId, document: transform(this.state.document) }))
  }

  /**
   * Submit an idempotent execution or versioned review operation.
   * @param command - Stable caller-owned command, retained for transport retries.
   * @returns Completion after the durable command response.
   */
  command(command: SchedulerCommand): Promise<void> {
    return this.mutate(workspaceId => this.api.workScheduler.command({ workspaceId, command }))
  }

  /**
   * Fence responses and writes when the shared stream loses its generation.
   * @param connected - Whether the shared connection is ready to synchronize.
   */
  setConnected(connected: boolean): void {
    if (this.disposed) return
    this.connected = connected
    this.generation++
    if (connected) void this.refresh()
    else this.failure(new Error('连接已断开；重新连接后恢复看板同步。'))
  }

  /** Stop refresh work and invalidate responses; native Host execution continues. */
  dispose(): void { this.disposed = true; clearInterval(this.timer); this.generation++ }

  private async mutate(operation: (workspaceId: WorkspaceId) => ReturnType<IApiClient['workScheduler']['save']>): Promise<void> {
    const workspaceId = this.state.workspaceId
    if (this.disposed || !this.connected || workspaceId === undefined || this.mutationPending || this.state.status !== 'ready') throw new Error('请等待看板同步完成。')
    this.mutationPending = true
    const generation = ++this.generation
    this.publish({ status: 'saving', error: undefined })
    try {
      const response = await operation(workspaceId)
      if (!response.result.ok) throw new Error(response.result.error.message)
      if (generation === this.generation) this.publish({ document: response.result.value.document, status: 'ready', error: undefined })
    } catch (error: unknown) {
      if (generation === this.generation) this.failure(error)
      throw error
    } finally { this.mutationPending = false; if (!this.disposed && generation !== this.generation) void this.refresh() }
  }

  private failure(error: unknown): void { this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) }) }
  private publish(update: Partial<SchedulerSnapshot>): void {
    this.state = { ...this.state, ...update }
    this.notifier.markDirty()
  }
}
