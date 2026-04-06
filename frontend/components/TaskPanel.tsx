'use client'

import { useEffect, useRef } from 'react'

interface Task {
  id: string
  description: string
  status: string
  logs: string[]
}

interface TaskPanelProps {
  tasks: Task[]
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: '待处理', className: 'status-badge status-pending' },
  planning: { label: '规划中', className: 'status-badge bg-[rgba(124,58,237,0.13)] text-[#7c3aed]' },
  executing: { label: '执行中', className: 'status-badge bg-[rgba(3,105,161,0.13)] text-[#0369a1]' },
  reviewing: { label: '审查中', className: 'status-badge bg-[rgba(15,118,110,0.13)] text-[#0f766e]' },
  working: { label: '进行中', className: 'status-badge status-working' },
  completed: { label: '已完成', className: 'status-badge status-completed' },
  error: { label: '失败', className: 'status-badge status-error' },
  rejected: { label: '已驳回', className: 'status-badge bg-[rgba(185,28,28,0.13)] text-[#b91c1c]' },
}

export default function TaskPanel({ tasks }: TaskPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [tasks])

  return (
    <div className="flex-1 overflow-hidden flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[var(--ink)]">执行进度</h2>
        {tasks.length > 0 && (
          <span className="text-xs text-[var(--ink-soft)]">{tasks.length} 个任务</span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="scroll-area flex-1 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[rgba(15,23,42,0.56)] p-4"
      >
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ink-muted)]">
            <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">暂无任务</p>
          </div>
        ) : (
          tasks.map((task) => {
            const statusInfo = statusConfig[task.status] || { label: task.status, className: 'status-badge status-idle' }
            return (
              <div
                key={task.id}
                className="mb-4 pb-4 border-b border-[var(--line)] last:mb-0 last:pb-0 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-[var(--ink)] leading-snug flex-1">
                    {task.description}
                  </p>
                  <span className={statusInfo.className}>{statusInfo.label}</span>
                </div>
                {task.logs.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {task.logs.slice(-3).map((log, i) => (
                      <div
                        key={i}
                        className="text-xs text-[var(--ink-soft)] leading-relaxed bg-[rgba(15,23,42,0.68)] px-2 py-1 rounded-lg border border-[var(--line)]"
                      >
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
