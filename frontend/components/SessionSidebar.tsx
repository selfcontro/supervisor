'use client'

import Link from 'next/link'
import type { ConnectionState, SessionSummary } from '@/src/types/session'

interface SessionSidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string
  connectionState: ConnectionState
  loading?: boolean
}

const connectionLabels: Record<ConnectionState, string> = {
  connected: 'Connected',
  disconnected: 'Offline',
  reconnecting: 'Reconnecting',
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return 'No activity yet'
  }

  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  connectionState,
  loading = false,
}: SessionSidebarProps) {
  const hasSessions = sessions.length > 0

  return (
    <aside className="workspace-sidebar panel-strong frame-surface frame-muted fade-up flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="edge-label">Sessions</p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--ink)]">Workspace Index</h2>
        </div>
        <span
          className={`soft-pill ${
            connectionState === 'connected'
              ? 'text-[var(--success)]'
              : connectionState === 'reconnecting'
                ? 'text-[var(--warning)]'
                : 'text-[var(--danger)]'
          }`}
        >
          <span
            className={`mr-2 h-2.5 w-2.5 rounded-full ${
              connectionState === 'connected'
                ? 'bg-[var(--success)]'
                : connectionState === 'reconnecting'
                  ? 'bg-[var(--warning)]'
                  : 'bg-[var(--danger)]'
            }`}
          />
          {connectionLabels[connectionState]}
        </span>
      </div>

      <div className="rounded-[2rem] bg-[var(--surface-muted)] p-4">
        <p className="text-sm leading-6 text-[var(--ink-soft)]">
          Each session routes the same agent-team UI to a different backend snapshot. Switch sessions without leaving the
          operational surface.
        </p>
      </div>

      <div className="session-list scroll-area flex gap-3 overflow-x-auto pb-1 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
        {loading && !hasSessions ? (
          <div className="flex min-h-28 items-center justify-center rounded-[1.6rem] border border-dashed border-[var(--line-strong)] bg-[rgba(15,23,42,0.54)] px-4 text-sm text-[var(--ink-muted)]">
            Loading sessions...
          </div>
        ) : hasSessions ? (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId
            return (
              <Link
                key={session.id}
                href={`/workspace/${encodeURIComponent(session.id)}`}
                className={`min-w-[240px] rounded-[1.6rem] border p-4 text-left transition-all duration-200 lg:min-w-0 ${
                  isActive
                    ? 'border-[rgba(14,165,233,0.4)] bg-[rgba(14,165,233,0.14)] shadow-[0_20px_35px_-28px_rgba(14,165,233,0.5)]'
                    : 'border-[var(--line)] bg-[rgba(15,23,42,0.56)] hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:bg-[rgba(15,23,42,0.78)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--ink)]">{session.id}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                      {session.agentCount} agents
                    </p>
                  </div>
                  {isActive ? (
                    <span className="status-badge bg-[rgba(14,165,233,0.18)] text-[#7dd3fc]">Live</span>
                  ) : null}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-[var(--ink-soft)]">
                  <div className="rounded-2xl bg-[var(--surface-muted)] px-3 py-2">
                    <span className="block text-[11px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">Tasks</span>
                    <span className="mt-1 block font-medium text-[var(--ink)]">{session.taskCount}</span>
                  </div>
                  <div className="rounded-2xl bg-[var(--surface-muted)] px-3 py-2">
                    <span className="block text-[11px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">Active</span>
                    <span className="mt-1 block font-medium text-[var(--ink)]">{session.activeTaskCount}</span>
                  </div>
                </div>

                <p className="mt-4 text-xs text-[var(--ink-muted)]">Updated {formatTimestamp(session.latestLogAt || session.updatedAt)}</p>
              </Link>
            )
          })
        ) : (
          <div className="flex min-h-28 items-center justify-center rounded-[1.6rem] border border-dashed border-[var(--line-strong)] bg-[rgba(15,23,42,0.54)] px-4 text-sm text-[var(--ink-muted)]">
            No sessions available yet.
          </div>
        )}
      </div>

      <div className="frame-surface frame-muted rounded-[1.6rem] border border-[var(--line)] bg-[rgba(15,23,42,0.6)] p-4 text-sm text-[var(--ink-soft)]">
        <p className="font-medium text-[var(--ink)]">Quick path</p>
        <p className="mt-1">The landing page sends users directly into the default workspace.</p>
      </div>
    </aside>
  )
}
