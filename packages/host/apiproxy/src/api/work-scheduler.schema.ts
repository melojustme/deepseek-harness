/**
 * workScheduler domain zod schemas (names derived from map keys:
 * workSchedulerLoadRequestSchema / workSchedulerLoadValueSchema / …). The
 * document schema is the single wire/durable vocabulary: the host store's
 * domain spec reuses it, so a document accepted over the wire always passes
 * the durable read boundary on reopen.
 */

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
export const schedulerTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  sessionId: sessionIdSchema.optional(),
  status: schedulerTaskStatusSchema,
  reason: z.string(),
  wakeCondition: z.string(),
  origin: schedulerTaskOriginSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<SchedulerTask>>

/** One execution thread. */
export const schedulerProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  taskIds: z.array(z.string()),
}) satisfies z.ZodType<Wire<SchedulerProcess>>

/** The whole scheduler document; `version` pins the literal 2. */
export const workSchedulerDocumentSchema = z.object({
  version: z.literal(2),
  processes: z.array(schedulerProcessSchema),
  tasks: z.record(z.string(), schedulerTaskSchema),
  backlogIds: z.array(z.string()),
  blockedIds: z.array(z.string()),
  archiveIds: z.array(z.string()),
}) satisfies z.ZodType<Wire<WorkSchedulerDocument>>

/** workScheduler.load request payload. */
export const workSchedulerLoadRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workScheduler.load'>>>

/** workScheduler.load response value. */
export const workSchedulerLoadValueSchema = z.object({
  document: workSchedulerDocumentSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'workScheduler.load'>>>

/** workScheduler.save request payload. */
export const workSchedulerSaveRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  document: workSchedulerDocumentSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'workScheduler.save'>>>

/** workScheduler.save response value. */
export const workSchedulerSaveValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'workScheduler.save'>>>
