/**
 * workScheduler domain zod schemas (names derived from map keys:
 * workSchedulerLoadRequestSchema / workSchedulerLoadValueSchema / …). The
 * document schema is the single wire/durable vocabulary: the host store's
 * domain spec reuses it, so a document accepted over the wire always passes
 * the durable read boundary on reopen.
 */

import type { SchedulerAttemptId, SchedulerCommandId } from './work-scheduler-execution.ts'
import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema, workspaceIdSchema } from './sessions.schema.ts'
import type {
  SchedulerProcess, SchedulerTask, SchedulerTaskOrigin, SchedulerTaskStatus, WorkSchedulerDocument,
} from './work-scheduler.ts'

/** Task lifecycle status enum (mirror of {@link SchedulerTaskStatus}). */
export const schedulerTaskStatusSchema = z.enum(['ready', 'running', 'sync-blocked', 'async-blocked', 'done']) satisfies z.ZodType<SchedulerTaskStatus>

/** Pre-block placement of an asynchronously blocked task. */
export const schedulerTaskOriginSchema = z.discriminatedUnion('zone', [
  z.object({ zone: z.literal('process'), processId: z.string(), index: z.number().int().nonnegative() }),
  z.object({ zone: z.literal('backlog'), index: z.number().int().nonnegative() }),
]) satisfies z.ZodType<Wire<SchedulerTaskOrigin>>

/** One scheduled task row. */
export const schedulerTaskSchema: z.ZodType<Wire<SchedulerTask>> = z.object({
  id: z.string(),
  description: z.string(),
  acceptance: z.array(z.string().trim().min(1)),
  sessionId: sessionIdSchema.optional(),
  status: schedulerTaskStatusSchema,
  reason: z.string(),
  wakeCondition: z.string(),
  origin: schedulerTaskOriginSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One execution thread. */
export const schedulerProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  taskIds: z.array(z.string()),
}) satisfies z.ZodType<Wire<SchedulerProcess>>

/** Durable execution identifiers. */
const attemptId = z.string().uuid().transform(value => value as SchedulerAttemptId)
const commandId = z.string().min(1).transform(value => value as SchedulerCommandId)
const evidenceSchema = z.object({
  hash: z.string(), commit: z.string(), logSeq: z.number().int(), logHash: z.string(), diff: z.string(), truncated: z.boolean(), summary: z.string(),
  tools: z.array(z.object({ name: z.string(), arguments: z.string(), result: z.string(), failed: z.boolean() })),
})
const attemptSchema = z.object({
  id: attemptId, taskId: z.string().min(1), commandId,
  status: z.enum(['queued', 'preparing', 'running', 'stopping', 'review', 'approved', 'failed', 'stopped', 'interrupted']),
  description: z.string(), acceptance: z.array(z.string()), feedback: z.string(), sessionId: sessionIdSchema,
  createdAt: z.string(), updatedAt: z.string(), previousId: attemptId.optional(), worktree: z.string().optional(),
  baseCommit: z.string().optional(), baseRef: z.string().optional(), error: z.string().optional(), evidence: evidenceSchema.optional(),
  evidenceRefreshes: z.array(z.object({ commandId, inputHash: z.string() })).optional(),
  review: z.object({ commandId, decision: z.enum(['approved', 'rework']), evidenceHash: z.string(), feedback: z.string(), actor: z.literal('local-user'), time: z.string() }).optional(),
})
const reviewFields = { attemptId, commandId, expectedRevision: z.number().int().nonnegative(), evidenceHash: z.string().min(1), feedback: z.string() }
const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('execute'), baseRef: z.string().trim().min(1).optional(), taskId: z.string().min(1), commandId, expectedRevision: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('cancel'), attemptId }),
  z.object({ kind: z.literal('yield'), attemptId, expectedRevision: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('resume'), attemptId, expectedRevision: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('refresh-review'), ...reviewFields }),
  z.object({ kind: z.literal('approve'), ...reviewFields }),
  z.object({ kind: z.literal('rework'), ...reviewFields, feedback: z.string().trim().min(1) }),
])

/** The whole scheduler document; version 3 rejects invalid ownership and duplicate placement. */
export const workSchedulerDocumentSchema: z.ZodType<Wire<WorkSchedulerDocument>> = z.object({
  version: z.literal(3),
  revision: z.number().int().nonnegative(),
  attempts: z.record(z.string(), attemptSchema),
  processes: z.array(schedulerProcessSchema),
  tasks: z.record(z.string(), schedulerTaskSchema),
  backlogIds: z.array(z.string()),
  blockedIds: z.array(z.string()),
  archiveIds: z.array(z.string()),
}).superRefine((document, context) => {
  const fail = (message: string) => { context.addIssue({ code: 'custom', message }) }
  const processIds = document.processes.map(process => process.id)
  if (new Set(processIds).size !== processIds.length) fail('Duplicate scheduler process id')
  const placements = [...document.processes.flatMap(process => process.taskIds), ...document.backlogIds, ...document.blockedIds, ...document.archiveIds]
  if (new Set(placements).size !== placements.length) fail('A task must have exactly one placement')
  for (const id of placements) if (!Object.hasOwn(document.tasks, id)) fail(`Unknown placed task: ${id}`)
  for (const [id, task] of Object.entries(document.tasks)) {
    if (id !== task.id || !placements.includes(id)) fail(`Invalid task ownership: ${id}`)
    if ((task.status === 'async-blocked') !== document.blockedIds.includes(id)) fail(`Invalid blocked placement: ${id}`)
    if ((task.status === 'done') !== document.archiveIds.includes(id)) fail(`Invalid archive placement: ${id}`)
    if (task.origin?.zone === 'process' && !processIds.includes(task.origin.processId!)) fail(`Unknown origin process: ${id}`)
  }
  const sessions = new Set<string>()
  const commands = new Set<string>()
  for (const [id, attempt] of Object.entries(document.attempts)) {
    if (id !== attempt.id || !Object.hasOwn(document.tasks, attempt.taskId)) fail(`Invalid attempt ownership: ${id}`)
    if (sessions.has(attempt.sessionId) || commands.has(attempt.commandId)) fail(`Duplicate attempt identity: ${id}`)
    sessions.add(attempt.sessionId)
    commands.add(attempt.commandId)
    if (attempt.previousId !== undefined) {
      const visited = new Set<string>([id])
      let cursor: string | undefined = attempt.previousId
      while (cursor !== undefined && Object.hasOwn(document.attempts, cursor)) {
        if (visited.has(cursor)) { fail(`Cyclic attempt history: ${id}`); break }
        visited.add(cursor)
        cursor = document.attempts[cursor]!.previousId
      }
      const previous = document.attempts[attempt.previousId]
      if (previous === undefined || previous.taskId !== attempt.taskId || previous.id === id || previous.createdAt > attempt.createdAt) fail(`Invalid previous attempt: ${id}`)
    }
    if (['review', 'approved'].includes(attempt.status) && (attempt.evidence === undefined || attempt.worktree === undefined || attempt.baseCommit === undefined)) fail(`Missing review evidence: ${id}`)
    if (attempt.status === 'approved' && attempt.review?.decision !== 'approved') fail(`Missing approval: ${id}`)
  }
})

/** workScheduler.load request payload. */
export const workSchedulerLoadRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workScheduler.load'>>>

/** workScheduler.load response value. */
export const workSchedulerLoadValueSchema: z.ZodType<Wire<ResponseValue<'workScheduler.load'>>> = z.object({
  document: workSchedulerDocumentSchema,
})

/** workScheduler.save request payload. */
export const workSchedulerSaveRequestSchema: z.ZodType<Wire<RequestPayload<'workScheduler.save'>>> = z.object({
  workspaceId: workspaceIdSchema,
  document: workSchedulerDocumentSchema,
})

/** workScheduler.save response value. */
export const workSchedulerSaveValueSchema: z.ZodType<Wire<ResponseValue<'workScheduler.save'>>> = z.object({ document: workSchedulerDocumentSchema }) satisfies z.ZodType<Wire<ResponseValue<'workScheduler.save'>>>

/** Execution and review request payload. */
export const workSchedulerCommandRequestSchema = z.object({ workspaceId: workspaceIdSchema, command: commandSchema }) satisfies z.ZodType<Wire<RequestPayload<'workScheduler.command'>>>
/** Durable result of an execution or review command. */
export const workSchedulerCommandValueSchema: z.ZodType<Wire<ResponseValue<'workScheduler.command'>>> = workSchedulerSaveValueSchema
