'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionTask, TaskStatus } from '@/src/types/session'

export type TaskItem = SessionTask

interface TaskListProps {
  tasks: TaskItem[]
  onTaskClick?: (task: TaskItem) => void
  selectedTaskId?: string
}

const statusConfig: Record<TaskStatus, { label: string; color: string; bgColor: string }> = {
  assigned: { label: 'Assigned', color: '#93c5fd', bgColor: 'rgba(59,130,246,0.2)' },
  pending: { label: 'Pending', color: '#fbbf24', bgColor: 'rgba(245,158,11,0.2)' },
  planning: { label: 'Planning', color: '#22d3ee', bgColor: 'rgba(34,211,238,0.2)' },
  executing: { label: 'Executing', color: '#7dd3fc', bgColor: 'rgba(14,165,233,0.2)' },
  reviewing: { label: 'Reviewing', color: '#6ee7b7', bgColor: 'rgba(16,185,129,0.2)' },
  completed: { label: 'Completed', color: '#86efac', bgColor: 'rgba(34,197,94,0.2)' },
  awaiting_finish: { label: 'Awaiting Finish', color: '#fde68a', bgColor: 'rgba(251,191,36,0.2)' },
  rejected: { label: 'Rejected', color: '#fca5a5', bgColor: 'rgba(239,68,68,0.2)' },
  interrupted: { label: 'Interrupted', color: '#fca5a5', bgColor: 'rgba(244,114,182,0.2)' },
  failed: { label: 'Failed', color: '#fca5a5', bgColor: 'rgba(239,68,68,0.2)' },
  working: { label: 'Working', color: '#7dd3fc', bgColor: 'rgba(14,165,233,0.2)' },
  waiting: { label: 'Waiting', color: '#cbd5e1', bgColor: 'rgba(148,163,184,0.18)' },
  error: { label: 'Error', color: '#fca5a5', bgColor: 'rgba(239,68,68,0.2)' },
  idle: { label: 'Idle', color: '#cbd5e1', bgColor: 'rgba(148,163,184,0.18)' },
}

export default function TaskList({ tasks, onTaskClick, selectedTaskId }: TaskListProps) {
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const prevTasksRef = useRef<TaskItem[]>([])
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const newIds = tasks.filter((task) => !prevTasksRef.current.find((previous) => previous.id === task.id)).map((task) => task.id)
    if (newIds.length > 0) {
      setRecentlyAdded(new Set(newIds))
      const timeoutId = window.setTimeout(() => setRecentlyAdded(new Set()), 1500)
      return () => window.clearTimeout(timeoutId)
    }

    prevTasksRef.current = tasks
    return undefined
  }, [tasks])

  useEffect(() => {
    prevTasksRef.current = tasks
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const scopedTasks = filter === 'all' ? [...tasks] : tasks.filter((task) => task.status === filter)
    const byId = new Map(scopedTasks.map((task) => [task.id, task] as const))
    const parents = scopedTasks
      .filter((task) => !task.parentTaskId || !byId.has(task.parentTaskId))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

    const ordered: Array<TaskItem & { depth: number }> = []

    const pushTask = (task: TaskItem, depth: number) => {
      ordered.push({ ...task, depth })

      const children = scopedTasks
        .filter((candidate) => candidate.parentTaskId === task.id)
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())

      children.forEach((child) => pushTask(child, depth + 1))
    }

    parents.forEach((task) => pushTask(task, 0))
    return ordered
  }, [tasks, filter])

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(['all', 'pending', 'executing', 'completed'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setFilter(item)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              filter === item
                ? 'border border-[rgba(14,165,233,0.38)] bg-[rgba(14,165,233,0.18)] text-[var(--ink)] shadow-[0_12px_18px_-16px_rgba(14,165,233,0.9)]'
                : 'border border-[var(--line)] bg-[rgba(15,23,42,0.52)] text-[var(--ink-soft)] hover:border-[var(--line-strong)] hover:bg-[rgba(15,23,42,0.74)]'
            }`}
          >
            {item === 'all' ? 'All' : statusConfig[item]?.label || item}
          </button>
        ))}
      </div>

      <div className="scroll-area flex-1 overflow-y-auto pr-1">
        {filteredTasks.length > 0 ? (
          <div className="space-y-2">
            {filteredTasks.map((task) => {
              const config = statusConfig[task.status] || { label: task.status, color: '#cbd5e1', bgColor: 'rgba(148,163,184,0.18)' }
              const isSelected = selectedTaskId === task.id
              const isNew = recentlyAdded.has(task.id)
              const depth = 'depth' in task ? task.depth : 0
              const isChild = depth > 0

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onTaskClick?.(task)}
                  className={`frame-surface frame-muted cursor-pointer rounded-2xl border p-4 transition-all duration-200 ${
                    isSelected
                      ? 'border-[rgba(14,165,233,0.42)] bg-[rgba(14,165,233,0.14)]'
                      : isChild
                        ? 'border-[rgba(125,211,252,0.12)] bg-[rgba(10,15,26,0.64)] hover:border-[rgba(125,211,252,0.28)] hover:bg-[rgba(15,23,42,0.78)]'
                        : 'border-[var(--line)] bg-[rgba(15,23,42,0.55)] hover:border-[var(--line-strong)] hover:bg-[rgba(15,23,42,0.78)]'
                  } ${isNew ? 'animate-[taskPop_0.3s_ease-out]' : ''} w-full text-left focus:outline-none focus:ring-2 focus:ring-[rgba(14,165,233,0.38)]`}
                  aria-pressed={isSelected}
                  style={{
                    marginLeft: depth > 0 ? `${Math.min(depth, 3) * 18}px` : undefined,
                    width: depth > 0 ? `calc(100% - ${Math.min(depth, 3) * 18}px)` : '100%',
                  }}
                >
                  <div className="flex items-start gap-3">
                    {isChild ? (
                      <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-[rgba(125,211,252,0.85)]" />
                    ) : null}
                    <span
                      className="inline-flex shrink-0 items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] leading-[1.2]"
                      style={{ backgroundColor: config.bgColor, color: config.color }}
                    >
                      {config.label}
                    </span>
                    <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-[var(--ink)]">{task.description}</p>
                  </div>
                  <div className={`mt-2 flex items-center gap-2 ${isChild ? 'ml-[5rem]' : 'ml-[4.4rem]'}`}>
                    <span className="text-xs text-[var(--ink-muted)]">{new Date(task.createdAt).toLocaleTimeString()}</span>
                    {task.agentId ? <span className="text-xs text-[var(--ink-soft)]">· {task.agentId}</span> : null}
                    {isChild ? <span className="text-xs text-[rgba(125,211,252,0.82)]">subagent</span> : null}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center text-[var(--ink-muted)]">
            <svg className="mb-2 h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <p className="text-sm">No tasks yet</p>
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes taskPop {
          0% {
            transform: scale(0.95);
            opacity: 0;
          }
          50% {
            transform: scale(1.02);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}
