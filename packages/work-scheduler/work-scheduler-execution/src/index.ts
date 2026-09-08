/** Service Definition for durable task execution and human review. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { SchedulerCommand, WorkSchedulerDocument, WorkspaceId, WorkSchedulerExecution } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Provider-replaceable execution service consumed by the scheduler gateway. */
export default abstract class WorkSchedulerExecutionService extends Service implements WorkSchedulerExecution {
  constructor(ctx: Context) {
    if (new.target === WorkSchedulerExecutionService) throw new Error('Load a concrete work scheduler execution provider, such as @deepseek-ai/dsh-work-scheduler-execution-local')
    super(ctx, 'workSchedulerExecution')
  }

  /**
   * Apply an owned execution or review operation.
   * @param workspaceId - Registered workspace owning the task.
   * @param command - Admission, cancellation, or versioned review.
   * @returns The durable document after the operation commits.
   */
  abstract command(workspaceId: WorkspaceId, command: SchedulerCommand): Promise<WorkSchedulerDocument>
}
