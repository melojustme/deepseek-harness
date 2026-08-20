/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-scheduler-store`.
 * @module @deepseek-ai/dsh-work-scheduler-store/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-scheduler-store'

/** Cordis companion plugin name. */
export const name = 'work-scheduler-store-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every write this service makes flows through the
 * domain write chain, and the storage-domain invariant already cross-checks
 * each `domain/changed` emission against live domain state — including this
 * package's `work_scheduler` domain. Durability and reopen revalidation are
 * medium round-trip behaviors covered by the package tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
