'use client'

import type { SessionLogEntry } from '@/src/types/session'

type TimelineEvent = {
  id: string
  kind: string
  timestamp: string
  title: string
  message: string
  status?: string
  level?: string
  taskId?: string | null
  agentId?: string | null
}

interface SessionTimelinePanelProps {
  timeline: TimelineEvent[]
  logs: SessionLogEntry[]
  selectedAgentName?: string | null
  onClose: () => void
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function toneForEvent(event: TimelineEvent) {
  if (event.level === 'error' || event.status === 'failed' || event.status === 'error') {
    return 'bg-rose-400'
  }
  if (event.status === 'completed') {
    return 'bg-emerald-400'
  }
  if (event.kind === 'task') {
    return 'bg-cyan-400'
  }

  return 'bg-slate-300'
}

export default function SessionTimelinePanel({
  timeline,
  logs,
  selectedAgentName,
  onClose,
}: SessionTimelinePanelProps) {
  return (
    <aside className="max-h-[min(76vh,820px)] w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[1.4rem] border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.88)] text-left shadow-[0_24px_80px_-40px_rgba(2,6,23,0.92)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[rgba(148,163,184,0.12)] px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(148,163,184,0.72)]">
            Session replay
          </p>
          <p className="mt-1 text-xs text-[rgba(203,213,225,0.74)]">
            {selectedAgentName ? `Logs filtered to ${selectedAgentName}` : 'Full session timeline'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[rgba(148,163,184,0.74)] transition hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="max-h-[calc(min(76vh,820px)-74px)] overflow-y-auto">
        <section className="px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(226,232,240,0.82)]">
              Timeline
            </h2>
            <span className="text-[10px] uppercase tracking-[0.12em] text-[rgba(148,163,184,0.62)]">
              {timeline.length} events
            </span>
          </div>
          {timeline.length === 0 ? (
            <p className="text-sm text-[rgba(148,163,184,0.74)]">No task or log events have been recorded yet.</p>
          ) : (
            <ol className="space-y-3 border-l border-[rgba(148,163,184,0.16)] pl-4">
              {timeline.map((event) => (
                <li key={event.id} className="relative">
                  <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${toneForEvent(event)}`} />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium leading-5 text-[rgba(241,245,249,0.9)]">
                        {event.title}
                      </p>
                      <p className="mt-1 break-words text-xs leading-5 text-[rgba(203,213,225,0.74)]">
                        {event.message}
                      </p>
                      <p className="mt-1 break-all text-[10px] uppercase tracking-[0.1em] text-[rgba(148,163,184,0.58)]">
                        {event.agentId || 'session'}
                        {event.taskId ? ` · ${event.taskId}` : ''}
                      </p>
                    </div>
                    <time className="shrink-0 text-[10px] tabular-nums text-[rgba(148,163,184,0.64)]">
                      {formatTime(event.timestamp)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="border-t border-[rgba(148,163,184,0.12)] px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgba(226,232,240,0.82)]">
              Agent logs
            </h2>
            <span className="text-[10px] uppercase tracking-[0.12em] text-[rgba(148,163,184,0.62)]">
              {logs.length} entries
            </span>
          </div>
          {logs.length === 0 ? (
            <p className="text-sm text-[rgba(148,163,184,0.74)]">No matching logs yet.</p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-2xl border border-[rgba(148,163,184,0.1)] bg-[rgba(15,23,42,0.42)] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[rgba(148,163,184,0.66)]">
                      {log.level}
                    </span>
                    <time className="shrink-0 text-[10px] tabular-nums text-[rgba(148,163,184,0.58)]">
                      {formatTime(log.timestamp)}
                    </time>
                  </div>
                  <p className="mt-1 break-words text-xs leading-5 text-[rgba(226,232,240,0.84)]">{log.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
