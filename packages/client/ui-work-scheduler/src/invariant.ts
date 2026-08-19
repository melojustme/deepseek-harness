/** Package-owned invariant companion for the browser-only scheduler plugin. */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-work-scheduler'

/** Cordis companion plugin name. */
export const name = 'client-ui-work-scheduler-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser plugin contributes two effect-owned slot
 * entries; client assembly tests prove their registration and disposal.
 */
const install: InvariantInstaller = () => {}

/** Register the intentional empty runtime check. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
