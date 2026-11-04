/** Translate board gestures into planning edits or native execution intents. */
import type { WorkSchedulerDocument } from '@deepseek-ai/dsh-client-connection/client'
import { archiveTask, moveTask, setTaskStatus } from './scheduler.ts'

/** Status columns displayed by the optional execution board. */
export type BoardColumn = 'ready' | 'running' | 'review' | 'approved'

/** A gesture never creates execution evidence or changes an attempt directly. */
export type BoardDrop =
  | { kind: 'save'; document: WorkSchedulerDocument }
  | { kind: 'execute' | 'cancel' | 'review' | 'rework'; taskId: string }
  | { kind: 'reject'; reason: string }
  | { kind: 'none' }

/** Copy shown only when an attempted task is dragged to approved without review evidence. */
const EVIDENCE_REQUIRED = '先完成执行并检查本轮证据，才能通过审查。'

function latestAttempt(document: WorkSchedulerDocument, taskId: string) {
  return Object.values(document.attempts).filter(item => item.taskId === taskId).at(-1)
}

function reorderUnattempted(
  document: WorkSchedulerDocument,
  taskId: string,
  targetId: string | undefined,
  after: boolean,
): BoardDrop {
  if (targetId === taskId) return { kind: 'none' }
  const next = structuredClone(document)
  const groups = [
    ...next.processes.map(process => process.taskIds),
    next.backlogIds,
    next.blockedIds,
    next.archiveIds,
  ]
  const order = groups.find(ids => ids.includes(taskId))
  if (order === undefined) return { kind: 'reject', reason: '任务没有有效位置，请刷新看板。' }
  if (targetId !== undefined && !order.includes(targetId)) {
    return { kind: 'reject', reason: '跨列安排请使用规划看板；执行看板只调整原队列中的顺序。' }
  }
  const previous = [...order]
  order.splice(order.indexOf(taskId), 1)
  const index = targetId === undefined ? order.length : order.indexOf(targetId) + (after ? 1 : 0)
  order.splice(index, 0, taskId)
  for (const item of Object.values(document.attempts)) {
    if (previous.indexOf(item.taskId) !== order.indexOf(item.taskId)) {
      return { kind: 'reject', reason: '不能越过已有执行记录的任务；请在未执行任务之间调整顺序。' }
    }
  }
  return previous.every((id, position) => id === order[position]) ? { kind: 'none' } : { kind: 'save', document: next }
}

/**
 * Resolve a drop using the latest durable document and an optional insertion target.
 * Unattempted cards are personal planning: they may move to in-progress or done
 * without Host execution evidence. Attempted cards keep evidence-bound review.
 * @param document - Current Workspace document.
 * @param taskId - Task being moved.
 * @param destination - Requested status column.
 * @param targetId - Card at the insertion point, omitted for the end of the owning collection.
 * @param after - Insert after the target instead of before it.
 * @returns A planning edit, command intent, or explanation of a rejected gesture.
 */
export function resolveBoardDrop(
  document: WorkSchedulerDocument,
  taskId: string,
  destination: BoardColumn,
  targetId?: string,
  after = false,
): BoardDrop {
  const task = document.tasks[taskId]
  if (task === undefined) return { kind: 'reject', reason: '任务不存在，请刷新看板。' }
  const attempt = latestAttempt(document, taskId)
  const status = attempt?.status

  if (attempt === undefined) {
    if (destination === 'approved') {
      return task.status === 'done'
        ? reorderUnattempted(document, taskId, targetId, after)
        : { kind: 'save', document: archiveTask(document, taskId) }
    }
    if (destination === 'review') {
      return { kind: 'reject', reason: '待审查只用于已执行的任务。勾选完成请拖到已通过。' }
    }
    if (destination === 'running') {
      if (task.status === 'done') {
        return { kind: 'save', document: setTaskStatus(moveTask(document, taskId, { zone: 'backlog', index: document.backlogIds.length }), taskId, 'running') }
      }
      if (task.status === 'running') return reorderUnattempted(document, taskId, targetId, after)
      return { kind: 'save', document: setTaskStatus(document, taskId, 'running') }
    }
    if (task.status === 'done') {
      return { kind: 'save', document: moveTask(document, taskId, { zone: 'backlog', index: document.backlogIds.length }) }
    }
    if (task.status === 'running' || task.status.includes('blocked')) {
      return { kind: 'save', document: setTaskStatus(document, taskId, 'ready') }
    }
    return reorderUnattempted(document, taskId, targetId, after)
  }

  if (destination === 'running') {
    if (status === undefined || status === 'failed' || status === 'stopped' || status === 'interrupted') {
      return { kind: 'execute', taskId }
    }
    if (status === 'review') return { kind: 'rework', taskId }
    return { kind: 'reject', reason: '当前轮次不能重新执行；已通过的结果请作为新任务继续。' }
  }
  if (destination === 'approved') {
    return status === 'review'
      ? { kind: 'review', taskId }
      : { kind: 'reject', reason: EVIDENCE_REQUIRED }
  }
  if (destination === 'review') {
    return status === 'review'
      ? { kind: 'review', taskId }
      : { kind: 'reject', reason: '执行正常结束后会自动进入待审查，拖动不能生成审查证据。' }
  }
  if (status === 'queued' || status === 'preparing' || status === 'running') return { kind: 'cancel', taskId }
  if (status === 'review') return { kind: 'rework', taskId }
  return { kind: 'reject', reason: '已有执行记录的任务保留原位置，请使用重试或新建任务。' }
}
