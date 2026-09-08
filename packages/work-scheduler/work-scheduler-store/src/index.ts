/**
 * Per-workspace work scheduler document store: the durable half of the dsh
 * Web work scheduler. One versioned JSON document per workspace over the
 * storage domain form (`ctx.storageDomain`); the medium (json file tree or
 * sqlite) is decided by the composition's storage-domain routing, never by
 * this package. The document vocabulary (types + zod schema) and the
 * {@link WorkSchedulerStore} contract live in the gateway's api/ layer
 * (`@deepseek-ai/dsh-host-apiproxy/api`) because the browser client shares
 * them; this package reuses the same schema for its durable records, so a
 * document accepted over the wire always passes the durable read boundary on
 * reopen.
 * @module @deepseek-ai/dsh-work-scheduler-store
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  defineDomain, domainTable, type Domain, type DomainTableSpec,
} from '@deepseek-ai/dsh-storage-domain'
import { workSchedulerDocumentSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  WorkSchedulerDocument, WorkSchedulerStore, WorkspaceId,
} from '@deepseek-ai/dsh-host-apiproxy/api'

/**
 * The durable scheduler document domain: one record per workspace keyed by
 * its id, validated against the shared document schema at the durable read
 * boundary. Bumping the document shape bumps this version together with the
 * schema.
 */
export const workSchedulerDomainSpec = defineDomain({
  name: 'work_scheduler',
  version: 3,
  tables: {
    // Wire<T> admits explicit undefined for Zod's optional-property typing;
    // durable JSON cannot retain it, so the same parser narrows on reopen.
    documents: domainTable<WorkspaceId, WorkSchedulerDocument>(
      workSchedulerDocumentSchema as unknown as DomainTableSpec<WorkspaceId, WorkSchedulerDocument>['valueSchema'],
    ),
  },
})

/** Empty document served before the first save; schema-identical, never stored. */
const EMPTY_DOCUMENT: WorkSchedulerDocument = {
  version: 3, revision: 0, attempts: {}, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [],
}

/**
 * The store service: opens the `work_scheduler` domain once on activation and
 * serves reads from memory and writes through the domain's single write chain
 * (durability first, then memory, then `domain/changed`). The domain closes
 * with the service fiber; reopening after a crash revalidates every stored
 * record against the schema.
 */
export class WorkSchedulerStoreService extends Service implements WorkSchedulerStore {
  /** The domain form must be mounted before the store can open its domain. */
  static inject = ['storageDomain']

  /** The open domain; resolution failures surface to every method call. */
  private writes: Promise<unknown> = Promise.resolve()

  private readonly ready: Promise<Domain<typeof workSchedulerDomainSpec>>

  /**
   * @param ctx - Context carrying the storage domain facility.
   */
  constructor(ctx: Context) {
    super(ctx, 'workSchedulerStore')
    this.ready = ctx.storageDomain.open(workSchedulerDomainSpec)
    // Mark the rejection handled: every method re-awaits `ready`, so an open
    // failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    this.ready.catch(() => {})
    ctx.effect(() => async () => {
      await this.writes
      const domain = await this.ready.catch(() => undefined)
      await domain?.close()
    }, 'work-scheduler-store.closeDomain')
  }

  load(workspaceId: WorkspaceId): Promise<{ document: WorkSchedulerDocument }> {
    return this.ready.then(domain => ({ document: structuredClone(domain.table('documents').get(workspaceId) ?? EMPTY_DOCUMENT) }))
  }

  save(workspaceId: WorkspaceId, document: WorkSchedulerDocument): Promise<WorkSchedulerDocument> {
    return this.update(workspaceId, current => {
      if (document.revision !== current.revision) throw new Error('看板已被更新，请刷新后重试；当前草稿尚未保存。')
      if (JSON.stringify(document.attempts) !== JSON.stringify(current.attempts)) throw new Error('执行和审查记录只能通过执行命令修改。')
      for (const attempt of Object.values(current.attempts)) {
        if (JSON.stringify(document.tasks[attempt.taskId]) !== JSON.stringify(current.tasks[attempt.taskId])) {
          throw new Error('已有执行记录的任务不能被规划写入覆盖；请使用返工。')
        }
        const placement = (value: WorkSchedulerDocument) => [...value.processes.map(process => [process.id, process.taskIds.indexOf(attempt.taskId)]), ['backlog', value.backlogIds.indexOf(attempt.taskId)], ['blocked', value.blockedIds.indexOf(attempt.taskId)], ['archive', value.archiveIds.indexOf(attempt.taskId)]].filter(row => row[1] !== -1)
        if (JSON.stringify(placement(document)) !== JSON.stringify(placement(current))) throw new Error('已有执行记录的任务不能重新排序。')
      }
      Object.assign(current, structuredClone(document))
    })
  }

  update(workspaceId: WorkspaceId, mutate: (document: WorkSchedulerDocument) => void): Promise<WorkSchedulerDocument> {
    const operation = this.writes.then(async () => {
      const domain = await this.ready
      const current = structuredClone(domain.table('documents').get(workspaceId) ?? EMPTY_DOCUMENT)
      const revision = current.revision
      mutate(current)
      current.revision = revision + 1
      const parsed = workSchedulerDocumentSchema.parse(current) as WorkSchedulerDocument
      await domain.table('documents').put(workspaceId, parsed)
      return structuredClone(parsed)
    })
    // Each caller receives its own rejection; a failed mutation must not block later writers.
    this.writes = operation.catch(() => {})
    return operation
  }
}

export default WorkSchedulerStoreService
