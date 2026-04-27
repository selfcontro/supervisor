import { useMemo } from 'react'
import type { SessionTask } from '@/src/types/session'

const TERMINAL_TASK_STATUSES = new Set(['completed', 'rejected', 'failed', 'error', 'interrupted'])

export function useTaskMonitor(tasks: SessionTask[]) {
  return useMemo(() => {
    const sortedByUpdatedAt = tasks
      .slice()
      .sort(
        (left, right) =>
          new Date(right.updatedAt || right.createdAt).getTime() -
          new Date(left.updatedAt || left.createdAt).getTime()
      )

    const rootTasks = sortedByUpdatedAt.filter((task) => !task.parentTaskId).slice(0, 8)
    const recentTasks = sortedByUpdatedAt.slice(0, 8)
    const tasksById = new Map(tasks.map((task) => [task.id, task] as const))

    const activeRootTask =
      sortedByUpdatedAt
        .filter((task) => !task.parentTaskId && task.agentId === 'agent-main')
        .find((task) => !TERMINAL_TASK_STATUSES.has(task.status)) || null
    const awaitingFinishRootTask =
      sortedByUpdatedAt
        .filter((task) => !task.parentTaskId && task.agentId === 'agent-main')
        .find((task) => task.status === 'awaiting_finish') || null

    return {
      rootTasks,
      recentTasks,
      tasksById,
      activeRootTask,
      awaitingFinishRootTask,
      hasActiveRootTask: Boolean(activeRootTask),
    }
  }, [tasks])
}
