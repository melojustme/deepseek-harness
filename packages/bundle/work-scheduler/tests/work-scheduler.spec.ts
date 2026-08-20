/** Installable work-scheduler bundle manifest and patch-list contract. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-work-scheduler bundle', () => {
  it('declares a parseable layer containing storage, Host, and Client contributions', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ id?: string; config?: Record<string, unknown>; insert?: Array<{ id?: string; name?: string }> }>
    const storage = parsed.find(patch => patch.id === 'storage-domain')
    expect(storage?.config).toEqual({ backend: 'json', routes: { work_scheduler: 'sqlite' } })
    const rows = parsed.flatMap(patch => patch.insert ?? [])
    expect(rows).toContainEqual({ id: 'work-scheduler-store', name: '@deepseek-ai/dsh-work-scheduler-store' })
    expect(rows).toContainEqual({ id: 'ui-work-scheduler', name: '@deepseek-ai/dsh-client-ui-work-scheduler' })
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-work-scheduler-store')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-client-ui-work-scheduler')
  })
})
