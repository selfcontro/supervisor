'use client'

import { useEffect, useRef, useState } from 'react'

export interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warning' | 'error'
  source?: 'frontend' | 'backend'
  message: string
  metadata?: Record<string, unknown>
}

interface LogViewerProps {
  logs: LogEntry[]
  autoScroll?: boolean
  maxHeight?: string
  showTimestamp?: boolean
  showSource?: boolean
}

const levelColors: Record<LogEntry['level'], string> = {
  debug: '#94a3b8',
  info: '#7dd3fc',
  warning: '#fbbf24',
  error: '#fca5a5',
}

const levelLabels: Record<LogEntry['level'], string> = {
  debug: 'Debug',
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
}

export default function LogViewer({
  logs,
  autoScroll = true,
  maxHeight = '400px',
  showTimestamp = true,
  showSource = false,
}: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  useEffect(() => {
    if (autoScroll && isAtBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll, isAtBottom])

  const handleScroll = () => {
    if (!containerRef.current) {
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setIsAtBottom(scrollHeight - scrollTop - clientHeight < 50)
  }

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <span className="edge-label">Runtime Logs</span>
        <span className="soft-pill">{logs.length} entries</span>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ maxHeight }}
        className="scroll-area flex-1 overflow-y-auto p-4"
      >
        {logs.length > 0 ? (
          logs.map((log) => (
            <div
              key={log.id}
              className="frame-surface frame-muted mb-2 flex items-start gap-3 rounded-xl border border-transparent bg-[rgba(15,23,42,0.52)] px-3 py-2.5 transition-all duration-200 hover:border-[var(--line)] hover:bg-[rgba(15,23,42,0.76)]"
            >
              {showTimestamp ? (
                <span className="shrink-0 pt-0.5 text-xs text-[var(--ink-muted)]">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              ) : null}
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]"
                style={{ backgroundColor: `${levelColors[log.level]}15`, color: levelColors[log.level] }}
              >
                {levelLabels[log.level]}
              </span>
              {showSource && log.source ? <span className="shrink-0 text-xs text-[var(--ink-muted)]">{log.source}</span> : null}
              <span className="flex-1 text-sm text-[var(--ink-soft)]">{log.message}</span>
            </div>
          ))
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-[var(--ink-muted)]">
            <p className="text-sm">No logs yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
