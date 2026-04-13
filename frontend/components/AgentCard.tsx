'use client'

import { useState } from 'react'
import type { Agent } from '@/src/types/agent'
import { statusLabels } from '@/src/constants/agent'

interface AgentCardProps {
  agent: Agent
  selected: boolean
  onClick: () => void
  onAssign: (task: string) => void
}

const statusColors: Record<string, string> = {
  idle: 'bg-[rgba(71,85,105,0.68)]',
  working: 'bg-[var(--accent-2)]',
  completed: 'bg-[var(--success)]',
  error: 'bg-[var(--danger)]',
  done: 'bg-[var(--success)]',
}

export default function AgentCard({ agent, selected, onClick, onAssign }: AgentCardProps) {
  const [showInput, setShowInput] = useState(false)
  const [taskInput, setTaskInput] = useState('')

  const handleSubmit = () => {
    if (taskInput.trim()) {
      onAssign(taskInput)
      setTaskInput('')
      setShowInput(false)
    }
  }

  return (
    <div
      className={`frame-surface frame-muted rounded-2xl border p-4 cursor-pointer transition-all duration-200 ${
        selected
          ? 'border-[rgba(56,189,248,0.75)] bg-[linear-gradient(180deg,rgba(14,165,233,0.18),rgba(15,23,42,0.78))] shadow-[0_0_0_1px_rgba(125,211,252,0.42),0_0_0_6px_rgba(14,165,233,0.10),0_22px_36px_-24px_rgba(14,165,233,0.72)]'
          : 'border-[var(--line)] bg-[rgba(15,23,42,0.52)] hover:border-[var(--line-strong)] hover:bg-[rgba(15,23,42,0.75)]'
      }`}
      onClick={onClick}
    >
      <div className={`mb-3 h-0.5 rounded-full transition-all ${selected ? 'bg-[linear-gradient(90deg,rgba(56,189,248,0.95),rgba(34,211,238,0.35))] opacity-100' : 'bg-transparent opacity-0'}`} />
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${statusColors[agent.status] || 'bg-[rgba(71,85,105,0.68)]'} ${agent.status === 'working' ? 'animate-pulse' : ''}`} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--ink)]">{agent.name}</span>
            {selected && (
              <span className="rounded-full border border-[rgba(56,189,248,0.4)] bg-[rgba(8,47,73,0.42)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgba(125,211,252,0.94)]">
                Selected
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{statusLabels[agent.status] || agent.status}</p>
        </div>
        <span className="status-badge status-idle">{agent.id}</span>
      </div>

      {agent.currentTask && (
        <p className="mt-2 truncate pl-5 text-xs text-[var(--ink-soft)]">{agent.currentTask}</p>
      )}

      {selected && (
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          {showInput ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                className="input flex-1 py-2 text-sm"
                placeholder="Assign a task..."
                autoFocus
              />
              <button onClick={handleSubmit} className="btn-primary px-4 py-2 text-sm">Assign</button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setShowInput(true); }}
              className="text-sm font-medium text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
            >
              + Assign Task
            </button>
          )}
        </div>
      )}
    </div>
  )
}
