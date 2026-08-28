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
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/work-scheduler-sop-round', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./snapshots/work-scheduler-sop-round/session.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/work-scheduler-sop-round/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
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

    const session = scaffold.ctx.sessions.list().find(item => item.id === sessionId)
    expect(session).toBeDefined()
    session!.append('todo/write', {
      todos: [
        { content: 'Confirm interaction', status: 'completed' },
        { content: 'Implement progress', status: 'in_progress' },
        { content: 'Verify browser', status: 'pending' },
      ],
    })
  }, 120_000)

  it('opens windowed, changes display modes, and follows the bound Session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-work-scheduler-session-link'))
    await page.getByRole('button', { name: /^(?:New session|新.*会话)$/ }).last().click()
    await page.getByText('Into the Unknown', { exact: false }).waitFor({ timeout: 15_000 })

    await page.getByRole('button', { name: '工作调度' }).click()
    const dialog = page.getByRole('dialog', { name: '工作调度' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByText('Implementation', { exact: true }).first().waitFor({ timeout: 10_000 })
    const desktopViewport = page.viewportSize()!
    const windowed = await dialog.boundingBox()
    expect(windowed).not.toBeNull()
    expect(windowed!.width).toBeCloseTo(desktopViewport.width * 0.92, 0)
    expect(windowed!.height).toBeCloseTo(desktopViewport.height * 0.86, 0)
    expect(windowed!.x).toBeGreaterThan(0)
    expect(windowed!.y).toBeGreaterThan(0)

    await page.setViewportSize({ width: 800, height: 600 })
    expect(await dialog.boundingBox()).toEqual({ x: 20, y: 20, width: 760, height: 560 })
    await page.setViewportSize(desktopViewport)
    expect(await dialog.boundingBox()).toEqual(windowed)

    await dialog.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '新建任务' }).click()
    await dialog.getByRole('textbox', { name: '任务内容' }).fill('校验新建任务体验')
    await dialog.getByRole('button', { name: '选择关联对话' }).click()
    await dialog.getByRole('searchbox', { name: '搜索对话' }).waitFor()
    const composerSnapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label="工作调度"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(UI_EXPECTED, composerSnapshot, MODE)
    await dialog.getByText('当前', { exact: true }).click()
    await dialog.getByRole('button', { name: '添加任务' }).click()
    await dialog.getByText('校验新建任务体验', { exact: true }).waitFor()
    expect(await dialog.locator('select[aria-label="关联会话"]').count()).toBe(0)

    await dialog.getByRole('button', { name: '全屏' }).click()
    const fullscreen = await dialog.boundingBox()
    expect(fullscreen).toEqual({ x: 0, y: 0, width: desktopViewport.width, height: desktopViewport.height })
    await dialog.getByRole('button', { name: '还原' }).click()
    const restored = await dialog.boundingBox()
    expect(restored).toEqual(windowed)

    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = await dialog.boundingBox()
    expect(mobile).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    expect(await dialog.getByRole('button', { name: '全屏' }).isVisible()).toBe(false)
    await dialog.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '新建任务' }).click()
    await dialog.getByRole('button', { name: '选择关联对话' }).click()
    await page.setViewportSize({ width: 320, height: 568 })
    const mobileOverflow = await dialog.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(mobileOverflow.scrollHeight).toBe(mobileOverflow.clientHeight)
    expect(mobileOverflow.scrollWidth).toBe(mobileOverflow.clientWidth)
    expect((await dialog.getByRole('region', { name: '线程看板' }).boundingBox())!.height).toBeGreaterThan(0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.setViewportSize(desktopViewport)

    await dialog.getByRole('button', { name: /^打开会话：/ }).first().click()
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    await page.getByText('SOP_SYNC_DONE', { exact: true }).waitFor({ timeout: 15_000 })

    const existingSessionIds = new Set(scaffold.ctx.workspaceRegistry.list().flatMap(item => item.sessionIds))
    await page.getByRole('button', { name: '工作调度' }).click()
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '新建任务' }).click()
    await dialog.getByRole('textbox', { name: '任务内容' }).fill('在新对话继续推进')
    await dialog.getByRole('button', { name: '选择关联对话' }).click()
    await dialog.getByRole('button', { name: '新建并打开对话' }).click()
    await dialog.getByRole('button', { name: '添加并打开' }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    const conversationInput = page.locator('textarea').first()
    await conversationInput.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await conversationInput.inputValue()).toBe('在新对话继续推进')

    const createdSessionIds = scaffold.ctx.workspaceRegistry.list()
      .flatMap(item => item.sessionIds)
      .filter(sessionId => !existingSessionIds.has(sessionId))
    expect(createdSessionIds).toHaveLength(1)
    const createdSessionId = createdSessionIds[0]!
    const createdWorkspace = scaffold.ctx.workspaceRegistry.list()
      .find(item => item.sessionIds.includes(createdSessionId))
    expect(createdWorkspace).toBeDefined()
    await expect.poll(async () => {
      const updatedDocument = (await scaffold.ctx.workSchedulerStore.load(createdWorkspace!.id)).document
      return Object.values(updatedDocument.tasks).some(task => (
        task.description === '在新对话继续推进' && task.sessionId === createdSessionId
      ))
    }, { timeout: 10_000 }).toBe(true)
  })

  it('keeps a closed fixture inventory and a clean browser console', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ui.expected.md'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
