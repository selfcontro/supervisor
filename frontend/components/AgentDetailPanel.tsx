'use client'

import { useEffect } from 'react'
import type { Agent } from '@/src/types/agent'
import { statusLabels } from '@/src/constants/agent'

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'error' | 'success' | 'debug' | 'warning'
  message: string
}

interface TaskHistoryItem {
  description: string
  assignedAt: string
  completedAt?: string
  result?: string
}

interface AgentDetailPanelProps {
  agent: Agent | null
  onClose: () => void
  logs?: LogEntry[]
  taskHistory?: TaskHistoryItem[]
}

const statusConfig: Record<string, { color: string; bgColor: string }> = {
  idle: { color: '#cbd5e1', bgColor: 'rgba(148,163,184,0.18)' },
  working: { color: '#7dd3fc', bgColor: 'rgba(14,165,233,0.2)' },
  completed: { color: '#86efac', bgColor: 'rgba(34,197,94,0.2)' },
  error: { color: '#fca5a5', bgColor: 'rgba(239,68,68,0.2)' },
  done: { color: '#86efac', bgColor: 'rgba(34,197,94,0.2)' },
}

export default function AgentDetailPanel({ agent, onClose, logs = [], taskHistory = [] }: AgentDetailPanelProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!agent) return null

  const statusInfo = statusConfig[agent.status] || { color: '#cbd5e1', bgColor: 'rgba(148,163,184,0.18)' }
  const roleMap: Record<string, string> = { planner: '任务规划分解', executor: '任务执行', reviewer: '结果审查' }
  const lastLogs = logs.slice(-5).reverse()
  const recentHistory = taskHistory.slice(-3).reverse()

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-[rgba(2,6,23,0.66)] backdrop-blur-[1.5px]" onClick={onClose} aria-label="关闭详情面板" />
      <div className="frame-surface absolute inset-y-0 right-0 flex w-full max-w-xl animate-[panelSlideIn_0.28s_ease-out] flex-col border-l border-[var(--line)] bg-[rgba(10,16,25,0.95)] shadow-2xl backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between border-b border-[var(--line)] px-6">
          <button onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-[rgba(148,163,184,0.15)]">
            <svg className="h-5 w-5 text-[var(--ink-soft)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className="edge-label">Agent Detail</p>
          <button onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-[rgba(148,163,184,0.15)]">
            <svg className="h-5 w-5 text-[var(--ink-soft)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="scroll-area flex-1 space-y-6 overflow-y-auto p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line)] bg-[rgba(15,23,42,0.82)]">
              <span className="text-xl font-semibold text-[var(--ink)]">{agent.name.charAt(0)}</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--ink)]">{agent.name}</h3>
              <p className="text-sm text-[var(--ink-soft)]">{roleMap[agent.id] || 'Agent'}</p>
            </div>
          </div>

          <div className="panel frame-surface frame-muted p-5">
            <h4 className="edge-label mb-2">状态</h4>
            <span
              className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold"
              style={{ backgroundColor: statusInfo.bgColor, color: statusInfo.color }}
            >
              {statusLabels[agent.status] || agent.status}
            </span>
          </div>

          <div className="panel frame-surface frame-muted p-5">
            <h4 className="edge-label mb-2">当前任务</h4>
            {agent.currentTask ? (
              <p className="rounded-xl border border-[var(--line)] bg-[rgba(15,23,42,0.66)] p-4 text-sm leading-relaxed text-[var(--ink-soft)]">{agent.currentTask}</p>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">暂无</p>
            )}
          </div>

          <div className="panel frame-surface frame-muted p-5">
            <h4 className="edge-label mb-3">最近日志</h4>
            {lastLogs.length > 0 ? (
              <div className="space-y-2">
                {lastLogs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-[var(--line)] bg-[rgba(15,23,42,0.66)] p-3 text-sm">
                    <span className="mr-2 text-xs text-[var(--ink-muted)]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className={log.level === 'error' ? 'text-[var(--danger)]' : 'text-[var(--ink-soft)]'}>{log.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">暂无日志</p>
            )}
          </div>

          <div className="panel frame-surface frame-muted p-5">
            <h4 className="edge-label mb-3">任务历史</h4>
            {recentHistory.length > 0 ? (
              <div className="space-y-2">
                {recentHistory.map((item, idx) => (
                  <div key={idx} className="rounded-xl border border-[var(--line)] bg-[rgba(15,23,42,0.66)] p-3">
                    <p className="text-sm font-medium text-[var(--ink)]">{item.description}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{new Date(item.assignedAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">暂无历史</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
