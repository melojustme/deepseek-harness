/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-work-scheduler-execution-local`.
 * @module @deepseek-ai/dsh-work-scheduler-execution-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-work-scheduler-execution-local'

/** Cordis companion plugin name. */
export const name = 'work-scheduler-execution-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: this package's durable ownership is validated by the scheduler store; subprocess and Session providers own live resource invariants. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
