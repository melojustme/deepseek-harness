// Keyless replay through the shipped Web composition: the model calls the
// Agent-scoped SOP tool, the Host persists its Workspace projection, and the
// browser follows the projected task's native Session association.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-work-scheduler-store'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  assertFixtureInventory, fixtureUserPrompts, launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/work-scheduler-sop-round', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./snapshots/work-scheduler-sop-round/session.jsonl', import.meta.url))
const PROMPT = 'Use sync_work_scheduler exactly once with workflow "Development SOP" and stages intake completed, implement in_progress, and verify pending. Use names Intake, Implementation, and Verification. Then reply exactly SOP_SYNC_DONE and stop.'

describe('web e2e: SOP stages synchronize into the Workspace board', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 15 })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('executes the scoped tool and persists a Session-bound projection', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-work-scheduler-sop-round'))
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled

    const call = sessionEvents.find(
      (event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
        event.type === 'tool/call' && event.data.name === 'sync_work_scheduler',
    )
    expect(call).toBeDefined()
    const result = sessionEvents.find(
      (event): event is Extract<SessionEvent, { type: 'tool/result' }> =>
        event.type === 'tool/result' && event.data.message.source.callId === call?.data.callId,
    )
    expect(result?.data.message.content[0].isError).toBe(false)

    const workspace = scaffold.ctx.workspaceRegistry.list()
      .find(item => item.sessionIds.includes(sessionId))
    expect(workspace).toBeDefined()
    const document = (await scaffold.ctx.workSchedulerStore.load(workspace!.id)).document
    expect(document.processes).toEqual([{
      id: `sop:${sessionId}`,
      name: 'Development SOP',
      taskIds: [`sop:${sessionId}:implement`, `sop:${sessionId}:verify`],
    }])
    expect(document.tasks[`sop:${sessionId}:implement`]).toMatchObject({
      description: 'Implementation', status: 'running', sessionId,
    })
    expect(document.archiveIds).toEqual([`sop:${sessionId}:intake`])
  }, 120_000)

  it('opens the bound Session from the scheduler after navigating away', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-work-scheduler-session-link'))
    await page.getByRole('button', { name: /^(?:New session|新.*会话)$/ }).last().click()
    await page.getByText('Into the Unknown', { exact: false }).waitFor({ timeout: 15_000 })

    await page.getByRole('button', { name: '工作调度' }).click()
    const dialog = page.getByRole('dialog', { name: '工作调度' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByText('Implementation', { exact: true }).first().waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: /^打开会话：/ }).first().click()
    await dialog.getByTitle('关闭').click()
    await page.getByText('SOP_SYNC_DONE', { exact: true }).waitFor({ timeout: 15_000 })
  })

  it('keeps a closed fixture inventory and a clean browser console', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
