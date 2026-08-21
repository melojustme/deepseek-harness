/**
 * Agent-scoped model tool for synchronizing SOP stages into a Workspace board.
 * @module @deepseek-ai/dsh-tool-work-scheduler/src/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-work-scheduler-store'
import type {} from '@deepseek-ai/dsh-workspace'
import { syncSopStages } from './sync.ts'
import type { SopStage, SopStageStatus } from './sync.ts'

const TOOL_NAME = 'sync_work_scheduler'
const STAGE_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const DESCRIPTION =
  'Synchronize the complete ordered development-SOP stage list into the current Session\'s '
  + 'Workspace work scheduler. Call after every SOP phase transition. The tool resolves Workspace '
  + 'and Session ids from the calling agent, preserves manual work, and replaces only this Session\'s '
  + 'SOP tasks. A Session that is not assigned to a Workspace fails without writing.'

interface SyncResult {
  readonly workspaceId: string
  readonly sessionId: string
  readonly processId: string
  readonly pending: number
  readonly inProgress: number
  readonly completed: number
}

/** Validate semantic constraints not expressible in the parameter schema. */
function validateInput(workflow: string, stages: readonly SopStage[]): void {
  if (workflow.trim().length === 0) {
    throw new HarnessError('workflow must be non-empty after trimming', 'WORK_SCHEDULER_INVALID_SYNC')
  }
  if (stages.length === 0) {
    throw new HarnessError('stages must contain the complete workflow', 'WORK_SCHEDULER_INVALID_SYNC')
  }
  const keys = new Set<string>()
  let inProgress = 0
  for (const stage of stages) {
    if (!STAGE_KEY.test(stage.key)) {
      throw new HarnessError(
        `stage key '${stage.key}' must use lowercase letters, digits, and internal hyphens`,
        'WORK_SCHEDULER_INVALID_SYNC',
      )
    }
    if (keys.has(stage.key)) {
      throw new HarnessError(`stage key '${stage.key}' is duplicated`, 'WORK_SCHEDULER_INVALID_SYNC')
    }
    keys.add(stage.key)
    if (stage.name.trim().length === 0) {
      throw new HarnessError(`stage '${stage.key}' name must be non-empty`, 'WORK_SCHEDULER_INVALID_SYNC')
    }
    if (stage.status === 'in_progress') inProgress += 1
  }
  if (inProgress > 1) {
    throw new HarnessError('at most one stage may be in_progress', 'WORK_SCHEDULER_INVALID_SYNC')
  }
}

/** Resolve the one Workspace whose validated Session account contains the caller. */
function workspaceFor(rootCtx: Context, agent: Agent): WorkspaceId {
  const matches = rootCtx.workspaceRegistry.list()
    .filter(workspace => workspace.sessionIds.includes(agent.id))
  const [workspace, secondWorkspace] = matches
  if (workspace === undefined) {
    throw new HarnessError(
      `Session '${agent.id}' is not assigned to a Workspace`,
      'WORK_SCHEDULER_WORKSPACE_NOT_FOUND',
    )
  }
  if (secondWorkspace !== undefined) {
    throw new HarnessError(
      `Session '${agent.id}' is assigned to multiple Workspaces`,
      'WORK_SCHEDULER_WORKSPACE_AMBIGUOUS',
    )
  }
  return workspace.id
}

/** Pure generic pending card for one SOP synchronization. */
function presentCall(args: { workflow: string }): GenericCallView {
  return { card: 'generic', title: 'Sync work scheduler', kind: 'other', rawInput: args.workflow }
}

/** Count one lifecycle state in the submitted stage snapshot. */
function count(stages: readonly SopStage[], status: SopStageStatus): number {
  return stages.filter(stage => stage.status === status).length
}

/**
 * Register the scheduler synchronization tool in one Agent's scope.
 * @param rootCtx - Composition context carrying Workspace and scheduler services.
 * @param toolCtx - Agent-scoped context that owns the tool registration.
 * @param agent - Exact Agent whose Session the tool synchronizes.
 * @returns The exact tool registration disposer.
 */
export function registerWorkSchedulerTool(rootCtx: Context, toolCtx: Context, agent: Agent): () => void {
  return toolCtx.tools.register(defineTool({
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      workflow: {
        type: 'string',
        required: true,
        description: 'User-facing name for this development workflow.',
      },
      stages: {
        type: 'array',
        required: true,
        description: 'Complete ordered SOP stage list. Send every stage on every synchronization.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', required: true, description: 'Stable lowercase stage key.' },
            name: { type: 'string', required: true, description: 'User-facing stage name.' },
            status: {
              type: 'string',
              required: true,
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current stage lifecycle state.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspaceId: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
          processId: { type: 'string', required: true },
          pending: { type: 'integer', required: true },
          inProgress: { type: 'integer', required: true },
          completed: { type: 'integer', required: true },
        },
      },
      render: (_args, value: SyncResult) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall,
    async execute(args, exec): Promise<SyncResult> {
      if (exec.agent !== agent) {
        throw new HarnessError(
          'sync_work_scheduler requires its owning calling Agent',
          'WORK_SCHEDULER_AGENT_MISMATCH',
        )
      }
      validateInput(args.workflow, args.stages)
      exec.signal.throwIfAborted()
      const workspaceId = workspaceFor(rootCtx, agent)
      const { document } = await rootCtx.workSchedulerStore.load(workspaceId)
      exec.signal.throwIfAborted()
      const now = new Date().toISOString()
      const next = syncSopStages(document, {
        workflow: args.workflow.trim(),
        sessionId: agent.id,
        stages: args.stages.map(stage => ({ ...stage, name: stage.name.trim() })),
        now,
      })
      await rootCtx.workSchedulerStore.save(workspaceId, next)
      return {
        workspaceId,
        sessionId: agent.id,
        processId: `sop:${agent.id}`,
        pending: count(args.stages, 'pending'),
        inProgress: count(args.stages, 'in_progress'),
        completed: count(args.stages, 'completed'),
      }
    },
  }))
}
