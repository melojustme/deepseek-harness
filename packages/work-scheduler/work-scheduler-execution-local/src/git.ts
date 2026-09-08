/** Isolated Git worktrees and immutable review snapshots through managed subprocesses. */
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'

/** Deployment limits for Git commands and their complete captured output. */
export interface GitConfig {
  /** Maximum duration of one Git command in milliseconds. */
  gitTimeoutMs: number
  /** Grace period before force-stopping a cancelled Git process tree. */
  gitGraceMs: number
  /** Byte limit for each Git output stream and the displayed review evidence. */
  maxEvidenceBytes: number
}

/** Managed Git operations; no command changes the user's branch. */
export class SchedulerGit {
  constructor(private readonly ctx: Context, private readonly config: GitConfig) {}

  /**
   * Execute Git with an argument vector, bounded output, and an owned deadline.
   * @param cwd - Git directory validated by the owning execution.
   * @param args - Literal Git arguments.
   * @param signal - Execution cancellation.
   * @param allowTruncated - Whether a display-only diff may return a marked tail.
   * @returns Captured text and whether its beginning was omitted.
   */
  async run(cwd: string, args: string[], signal?: AbortSignal, allowTruncated = false): Promise<{ text: string; truncated: boolean }> {
    const deadline = AbortSignal.timeout(this.config.gitTimeoutMs)
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    const child = this.ctx.subprocess.spawn({
      argv: ['git', ...args], cwd, signal: combined,
      graceMs: this.config.gitGraceMs,
      env: { GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'DeepSeek Harness', GIT_AUTHOR_EMAIL: 'harness@localhost', GIT_COMMITTER_NAME: 'DeepSeek Harness', GIT_COMMITTER_EMAIL: 'harness@localhost' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxEvidenceBytes }, stderr: { maxBytes: this.config.maxEvidenceBytes } },
    })
    const outcome = await child.done
    await child.waitForExit()
    combined.throwIfAborted()
    const output = child.collected.stdout!.readFrom(0)
    if (outcome.exitCode !== 0) throw new Error(`Git ${args[0]}: ${child.collected.stderr!.readFrom(0).text}`)
    if (output.lossy && !allowTruncated) throw new Error('Git 输出超过配置限制，无法固定完整执行证据。')
    return { text: output.text, truncated: output.lossy }
  }

  /**
   * Allocate a detached worktree under the provider's owned root.
   * @param repository - Registered workspace directory.
   * @param path - Provider-generated execution directory.
   * @param base - Verified commit id.
   * @param signal - Preparation cancellation.
   */
  async create(repository: string, path: string, base: string, signal: AbortSignal): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await this.run(repository, ['worktree', 'add', '--detach', path, base], signal)
  }

  /**
   * Write a Git tree containing tracked changes and nonignored new files.
   * @param path - Execution-owned worktree.
   * @param signal - Evidence cancellation.
   * @returns Immutable tree id.
   */
  async tree(path: string, signal?: AbortSignal): Promise<string> {
    const canonical = await realpath(path)
    if (!samePath(canonical, join(await realpath(dirname(path)), basename(path)))) throw new Error('执行目录被替换为符号链接，无法固定证据。')
    const gitDirectory = (await this.run(path, ['rev-parse', '--absolute-git-dir'], signal)).text.trim()
    const backlink = (await readFile(join(gitDirectory, 'gitdir'), 'utf8')).trim()
    if (!samePath(await realpath(backlink), await realpath(join(canonical, '.git')))) throw new Error('Git worktree 的目录归属已变化。')
    await this.run(path, ['add', '--all', '--', '.'], signal)
    return (await this.run(path, ['write-tree'], signal)).text.trim()
  }
}

/** Windows path identity is case-insensitive; other hosts retain native spelling. */
function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right
}
