/** Real Git, SQLite, Session logs, presets, and agent loop; only model output is scripted. */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentPresets, { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as Sqlite from '@deepseek-ai/dsh-storage-sqlite'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import Store from '@deepseek-ai/dsh-work-scheduler-store'
import type { SchedulerCommandId, WorkSchedulerDocument } from '@deepseek-ai/dsh-host-apiproxy/api'
import Execution from '../src/index.ts'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { fileURLToPath } from 'node:url'

class Model extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  hang = false
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.hang) {
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => { resolve() }, { once: true })
      })
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Completed; no checks were run.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Completed; no checks were run.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const cleanups: Array<() => Promise<void>> = []
export const commandId = (value: string) => value as SchedulerCommandId

export async function harness(options: { external?: { baseURL: string; key: string }; live?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delivery-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const repository = join(root, 'repository')
  await mkdir(repository)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
  git('init', '--quiet'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@localhost')
  await writeFile(join(repository, 'README.md'), 'initial\n')
  git('add', '.'); git('commit', '-qm', 'initial')
  const presets = join(root, 'presets')
  await mkdir(join(presets, 'standard'), { recursive: true })
  await writeFile(join(presets, 'standard', COMPOSITION_FILE), "- name: '@deepseek-ai/dsh-tool-fs'\n")
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  vi.stubEnv('DSH_SCHEDULER_RUNTIME_ROOT', root)
  vi.stubEnv('DSH_SCHEDULER_PRESET_ROOT', presets)
  vi.stubEnv('DSH_HOME', join(root, 'home'))
  vi.stubEnv('DSH_SCHEDULER_PROVIDER', options.external || options.live ? 'deepseek-official' : 'script')
  vi.stubEnv('DSH_SCHEDULER_MODEL', options.external || options.live ? 'deepseek-v4-flash' : 'script')
  if (options.external) { vi.stubEnv('DEEPSEEK_BASE_URL', options.external.baseURL); vi.stubEnv('DEEPSEEK_API_KEY', options.external.key) }
  cleanups.push(async () => { vi.unstubAllEnvs() })
  const modules = new Map<string, unknown>([
    ['dsh-fs-local', FileSystem], ['dsh-tool-fs', ToolFs],
    ['dsh-llm', LlmRuntime], ['dsh-llm-deepseek', DeepSeek], ['dsh-session', SessionStore], ['dsh-system-prompt', SystemPrompt],
    ['dsh-tools', ToolRuntime], ['dsh-agent', AgentRegistry], ['dsh-agent-loop', AgentLoop], ['dsh-agent-default-model', AgentDefaultModel],
    ['dsh-agent-presets', AgentPresets], ['dsh-session-persistence-jsonl', JsonlPersistence], ['dsh-storage', Storage], ['dsh-storage-sqlite', Sqlite],
    ['dsh-storage-domain', Domain], ['dsh-workspace', WorkspaceRegistry], ['dsh-work-scheduler-store', Store], ['dsh-subprocess-local', LocalSubprocess],
    ['dsh-work-scheduler-execution-local', Execution],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    const module = modules.get(specifier.replace('@deepseek-ai/', ''))
    if (module === undefined) throw new Error(`Unexpected Loader import: ${specifier}`)
    return module
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/work-scheduler/cordis.yml', import.meta.url))
  const runtimeConfig = join(root, 'cordis.yml')
  await writeFile(runtimeConfig, await readFile(configPath))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(runtimeConfig).href } })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(item => item.options.id === 'work-scheduler-execution')!
  const stopExecution = () => ctx.loader.update(entry.id, { disabled: true })
  const model = new Model()
  ctx.effect(() => ctx.llm.registerAdapter(['script'], model))
  const workspace = await ctx.workspaceRegistry.create(repository)
  let document: WorkSchedulerDocument = {
    version: 3, revision: 0, attempts: {}, processes: [],
    tasks: { task: { id: 'task', description: 'Inspect the repository', acceptance: ['State actual checks'], status: 'ready', reason: '', wakeCondition: '', createdAt: '', updatedAt: '' } },
    backlogIds: ['task'], blockedIds: [], archiveIds: [],
  }
  document = await ctx.workSchedulerStore.save(workspace.id, document)
  const load = async () => (await ctx.workSchedulerStore.load(workspace.id)).document
  const submit = () => ctx.workSchedulerExecution.command(workspace.id, { kind: 'execute', taskId: 'task', expectedRevision: document.revision, commandId: commandId('execute-1') })
  return { ctx, root, workspace, model, load, submit, git, stopExecution }
}
