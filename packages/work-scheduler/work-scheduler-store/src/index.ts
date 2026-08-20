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
  version: 2,
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
  version: 2, processes: [], tasks: {}, backlogIds: [], blockedIds: [], archiveIds: [],
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
      const domain = await this.ready.catch(() => undefined)
      await domain?.close()
    }, 'work-scheduler-store.closeDomain')
  }

  load(workspaceId: WorkspaceId): Promise<{ document: WorkSchedulerDocument }> {
    return this.ready.then(domain => ({ document: domain.table('documents').get(workspaceId) ?? EMPTY_DOCUMENT }))
  }

  save(workspaceId: WorkspaceId, document: WorkSchedulerDocument): Promise<void> {
    return this.ready.then(domain => domain.table('documents').put(workspaceId, document))
  }
}

export default WorkSchedulerStoreService
