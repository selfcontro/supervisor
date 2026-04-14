'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import FlowChart from '@/components/FlowChart'
import { classifySessionSnapshotFailure } from '@/lib/runtimeConfig'
import {
  SessionApiError,
  fetchSessionSnapshot,
  getWorkspaceSocketUrl,
  subscribeToSession,
} from '@/lib/sessionApi'
import type { Agent } from '@/src/types/agent'
import type { SessionSocketEvent, SessionTask } from '@/src/types/session'

interface AgentTeamWorkspaceProps {
  sessionId: string
}

type WorkspaceAgent = Omit<Agent, 'currentTask'> & {
  currentTask?: string | null
  role?: string
  ephemeral?: boolean
  workflowParentTaskId?: string | null
  stageId?: string | null
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

export default function AgentTeamWorkspace({ sessionId }: AgentTeamWorkspaceProps) {
  const [agents, setAgents] = useState<WorkspaceAgent[]>([])
  const [tasks, setTasks] = useState<SessionTask[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const reconnectAttemptsRef = useRef(0)
  const currentSessionIdRef = useRef(sessionId)

  useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let heartbeatId: ReturnType<typeof setInterval> | null = null
    let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null

    function stopRealtime() {
      if (heartbeatId) {
        clearInterval(heartbeatId)
        heartbeatId = null
      }
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId)
        reconnectTimeoutId = null
      }
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close()
      }
      socket = null
    }

    function hydrateSnapshot(snapshot: Awaited<ReturnType<typeof fetchSessionSnapshot>>) {
      setAgents([...(snapshot.agents as WorkspaceAgent[]), ...(snapshot.workflowAgents as WorkspaceAgent[])])
      setTasks(snapshot.tasks)
    }

    async function refreshSessionSnapshot(activeSessionId: string) {
      const snapshot = await fetchSessionSnapshot(activeSessionId)

      if (disposed || currentSessionIdRef.current !== activeSessionId) {
        return
      }

      hydrateSnapshot(snapshot)
    }

    function handleSocketEvent(message: SessionSocketEvent) {
      if ('sessionId' in message && message.sessionId && message.sessionId !== sessionId) {
        return
      }

      switch (message.type) {
        case 'subscribed':
          void refreshSessionSnapshot(sessionId)
          return
        case 'agent_status': {
          const agentId = message.payload?.agentId
          const data = message.payload?.data

          if (!agentId || !data) {
            return
          }

          setAgents((current) => {
            if (data.lifecycle === 'closed' && data.ephemeral) {
              return current.filter((agent) => agent.id !== agentId)
            }

            const existingAgent = current.find((agent) => agent.id === agentId)
            if (!existingAgent) {
              return [
                ...current,
                {
                  id: agentId,
                  name: data.name || agentId,
                  status: data.status || 'idle',
                  currentTask: data.currentTask || null,
                  role: data.role,
                  ephemeral: Boolean(data.ephemeral),
                  workflowParentTaskId: typeof data.workflowParentTaskId === 'string' ? data.workflowParentTaskId : null,
                  stageId: typeof data.stageId === 'string' ? data.stageId : null,
                },
              ]
            }

            return current.map((agent) => (agent.id === agentId ? { ...agent, ...data } : agent))
          })
          return
        }
        case 'task_update':
        {
          const taskId = message.payload?.taskId
          const data = message.payload?.data

          if (!taskId || !data) {
            return
          }

          setTasks((current) => {
            const existing = current.find((task) => task.id === taskId)

            if (!existing) {
              return [
                {
                  id: taskId,
                  description: data.description || taskId,
                  status: data.status || 'executing',
                  createdAt: message.timestamp || new Date().toISOString(),
                  updatedAt: data.updatedAt || message.timestamp || new Date().toISOString(),
                  agentId: data.agentId || null,
                  parentTaskId: data.parentTaskId || null,
                  subTasks: Array.isArray(data.subTasks) ? data.subTasks : [],
                  result: data.result || null,
                  error: data.error || null,
                  sessionId,
                },
                ...current,
              ]
            }

            return current.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    ...data,
                    updatedAt: data.updatedAt || message.timestamp || task.updatedAt,
                  }
                : task
            )
          })
          return
        }
        case 'task:new':
          if (!message.task) {
            return
          }

          setTasks((current) => {
            if (current.some((task) => task.id === message.task?.id)) {
              return current
            }

            return [message.task, ...current]
          })
          return
        case 'log_entry':
        case 'command_execution':
        case 'approval_required':
        case 'approval_resolved':
          return
        case 'error':
          setError(typeof message.payload?.message === 'string' ? message.payload.message : 'WebSocket error')
          return
        default:
          return
      }
    }

    function connectSocket() {
      if (disposed) {
        return
      }

      socket = new WebSocket(getWorkspaceSocketUrl())

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0
        subscribeToSession(socket as WebSocket, sessionId)
        heartbeatId = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, 30000)
      }

      socket.onmessage = (event) => {
        try {
          handleSocketEvent(JSON.parse(event.data) as SessionSocketEvent)
        } catch {
          setError('Received an unreadable realtime payload.')
        }
      }

      socket.onclose = () => {
        if (heartbeatId) {
          clearInterval(heartbeatId)
          heartbeatId = null
        }

        if (disposed) {
          return
        }

        reconnectAttemptsRef.current += 1
        reconnectTimeoutId = setTimeout(connectSocket, Math.min(5000, 1000 * reconnectAttemptsRef.current))
      }
    }

    async function loadWorkspace() {
      setLoading(true)
      setAgents([])
      setTasks([])
      setError(null)
      setNotFound(false)
      setSelectedAgentId(null)
      reconnectAttemptsRef.current = 0

      try {
        const snapshot = await fetchSessionSnapshot(sessionId)

        if (disposed) {
          return
        }

        hydrateSnapshot(snapshot)
        setLoading(false)
        connectSocket()
      } catch (loadError) {
        if (disposed) {
          return
        }

        if (loadError instanceof SessionApiError && loadError.status === 404) {
          const failureKind = classifySessionSnapshotFailure(loadError)
          if (failureKind === 'not_found') {
            setNotFound(true)
          } else {
            setError(
              'Workspace session API is unavailable. Restart the backend with the current server code and confirm the frontend API URL points to it.'
            )
          }
        } else {
          setError(getErrorMessage(loadError))
        }

        setLoading(false)
      }
    }

    void loadWorkspace()

    return () => {
      disposed = true
      stopRealtime()
    }
  }, [refreshKey, sessionId])

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070d] px-6 text-center">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[rgba(148,163,184,0.72)]">404</p>
          <h1 className="mt-4 text-4xl font-semibold text-[#e2e8f0]">Session not found</h1>
          <p className="mt-4 text-sm text-[rgba(148,163,184,0.78)]">
            The workspace <span className="text-[#f8fafc]">{sessionId}</span> does not exist in the current backend runtime.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-[rgba(125,211,252,0.26)] px-4 py-2 text-sm text-[#cbd5e1] transition hover:border-[rgba(125,211,252,0.48)] hover:text-white"
            >
              Back home
            </Link>
            <button
              onClick={() => setRefreshKey((current) => current + 1)}
              className="rounded-full bg-[#0f172a] px-4 py-2 text-sm text-[#cbd5e1] transition hover:bg-[#162033] hover:text-white"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070d]">
        <div className="h-10 w-10 rounded-full border border-[rgba(125,211,252,0.22)] border-t-[rgba(125,211,252,0.88)] animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070d] px-6 text-center">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[rgba(248,113,113,0.72)]">Workspace error</p>
          <h1 className="mt-4 text-4xl font-semibold text-[#e2e8f0]">Unable to load this session</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[rgba(148,163,184,0.82)]">{error}</p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              onClick={() => setRefreshKey((current) => current + 1)}
              className="rounded-full bg-[#0f172a] px-4 py-2 text-sm text-[#cbd5e1] transition hover:bg-[#162033] hover:text-white"
            >
              Retry
            </button>
            <Link
              href="/"
              className="rounded-full border border-[rgba(125,211,252,0.26)] px-4 py-2 text-sm text-[#cbd5e1] transition hover:border-[rgba(125,211,252,0.48)] hover:text-white"
            >
              Back home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const recentTasks = tasks
    .slice()
    .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime())
    .slice(0, 8)

  const statusTone: Record<string, string> = {
    completed: 'bg-emerald-400',
    executing: 'bg-cyan-400',
    planning: 'bg-sky-400',
    reviewing: 'bg-violet-400',
    pending: 'bg-amber-300',
    failed: 'bg-rose-400',
    error: 'bg-rose-400',
    interrupted: 'bg-orange-400',
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#04070d]">
      <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#050811_0%,#04070d_48%,#050811_100%)]">
        <FlowChart
          agents={agents.map((agent) => ({ ...agent, currentTask: agent.currentTask || undefined }))}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
      </div>
      <div className="fixed right-4 top-20 z-20 flex flex-col items-end gap-3">
        <button
          type="button"
          onClick={() => setTaskPanelOpen((current) => !current)}
          className="rounded-full border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.8)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(226,232,240,0.78)] backdrop-blur transition hover:border-[rgba(125,211,252,0.32)] hover:text-white"
        >
          Tasks {recentTasks.length > 0 ? `· ${recentTasks.length}` : ''}
        </button>

        {taskPanelOpen ? (
          <aside className="w-[320px] max-w-[calc(100vw-2rem)] rounded-[1.4rem] border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.84)] p-3 text-left shadow-[0_24px_80px_-40px_rgba(2,6,23,0.92)] backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(148,163,184,0.72)]">
                Recent tasks
              </p>
              <button
                type="button"
                onClick={() => setTaskPanelOpen(false)}
                className="text-xs text-[rgba(148,163,184,0.74)] transition hover:text-white"
              >
                Close
              </button>
            </div>

            {recentTasks.length === 0 ? (
              <p className="text-sm text-[rgba(148,163,184,0.74)]">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => task.agentId && setSelectedAgentId(task.agentId)}
                    className="flex w-full items-start gap-3 rounded-2xl border border-[rgba(148,163,184,0.12)] bg-[rgba(15,23,42,0.52)] px-3 py-3 text-left transition hover:border-[rgba(125,211,252,0.28)] hover:bg-[rgba(15,23,42,0.74)]"
                  >
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${statusTone[task.status] || 'bg-slate-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[rgba(241,245,249,0.92)]">
                        {task.description}
                      </span>
                      <span className="mt-1 block text-[11px] uppercase tracking-[0.12em] text-[rgba(148,163,184,0.7)]">
                        {task.status}
                        {task.agentId ? ` · ${task.agentId}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </main>
  )
}
