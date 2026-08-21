/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-work-scheduler`.
 * @module @deepseek-ai/dsh-tool-work-scheduler/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-work-scheduler'

/** Cordis companion plugin name. */
export const name = 'tool-work-scheduler-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: tool registration is an effect and document validity belongs to the store. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
