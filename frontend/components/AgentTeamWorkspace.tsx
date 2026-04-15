'use client'

import Link from 'next/link'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import FlowChart from '@/components/FlowChart'
import { dispatchCodexTask, finishCodexTask } from '@/lib/codexControlApi'
import { classifySessionSnapshotFailure } from '@/lib/runtimeConfig'
import {
  SessionApiError,
  fetchSessionSnapshot,
  getWorkspaceSocketUrl,
  subscribeToSession,
} from '@/lib/sessionApi'
import type { Agent } from '@/src/types/agent'
import type { SessionLogEntry, SessionSocketEvent, SessionTask } from '@/src/types/session'

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
  const [logs, setLogs] = useState<SessionLogEntry[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [isSendingPrompt, setIsSendingPrompt] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [finishingTaskId, setFinishingTaskId] = useState<string | null>(null)
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
      setLogs(snapshot.logs)
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
          {
            const nextTask = message.task

            setTasks((current) => {
              if (current.some((task) => task.id === nextTask.id)) {
                return current
              }

              return [nextTask, ...current]
            })
          }
          return
        case 'log_entry':
        {
          const logId = message.payload?.logId
          const payloadData = message.payload?.data
          const logMessage = payloadData?.message

          if (!logId || !logMessage) {
            return
          }

          setLogs((current) => {
            if (current.some((entry) => entry.id === logId)) {
              return current
            }

            return [
              ...current,
              {
                id: logId,
                timestamp: message.timestamp || new Date().toISOString(),
                level: payloadData?.level || 'info',
                message: logMessage,
                taskId: payloadData?.taskId || null,
                agentId: payloadData?.agentId || null,
                sessionId,
                source: 'backend',
              },
            ]
          })
          return
        }
        case 'command_execution':
        {
          const commandPayload = message.payload

          if (!commandPayload?.command) {
            return
          }

          setLogs((current) => [
            ...current,
            {
              id: `cmd_${message.timestamp || Date.now()}_${commandPayload.agentId || 'agent'}`,
              timestamp: message.timestamp || new Date().toISOString(),
              level: commandPayload.status === 'failed' ? 'error' : 'info',
              message: `[${commandPayload.agentId || 'agent'}] ${commandPayload.command} (exit=${String(commandPayload.exitCode)})`,
              taskId: commandPayload.taskId || null,
              agentId: commandPayload.agentId || null,
              sessionId,
              source: 'backend',
            },
          ])
          return
        }
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
      setLogs([])
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
  const tasksById = new Map(tasks.map((task) => [task.id, task] as const))
  const rootTasks = recentTasks.filter((task) => !task.parentTaskId)

  const statusTone: Record<string, string> = {
    completed: 'bg-emerald-400',
    awaiting_finish: 'bg-amber-300',
    executing: 'bg-cyan-400',
    planning: 'bg-sky-400',
    reviewing: 'bg-violet-400',
    waiting: 'bg-slate-300',
    pending: 'bg-amber-300',
    failed: 'bg-rose-400',
    error: 'bg-rose-400',
    interrupted: 'bg-orange-400',
  }

  async function handleSubmitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextPrompt = prompt.trim()
    if (!nextPrompt || isSendingPrompt) {
      return
    }

    setIsSendingPrompt(true)
    setPromptError(null)
    try {
      await dispatchCodexTask(sessionId, 'agent-main', {
        title: nextPrompt.slice(0, 80),
        prompt: nextPrompt,
      })
      setPrompt('')
      setTaskPanelOpen(true)
    } catch (submitError) {
      setPromptError(getErrorMessage(submitError))
    } finally {
      setIsSendingPrompt(false)
    }
  }

  async function handleFinishTask(taskId: string) {
    if (finishingTaskId) {
      return
    }
    setFinishingTaskId(taskId)
    setPromptError(null)
    try {
      await finishCodexTask(sessionId, taskId)
    } catch (finishError) {
      setPromptError(getErrorMessage(finishError))
    } finally {
      setFinishingTaskId(null)
    }
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#04070d]">
      <div className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(14,116,144,0.12),transparent_28%),linear-gradient(180deg,#050811_0%,#04070d_48%,#050811_100%)]">
        <FlowChart
          agents={agents.map((agent) => ({ ...agent, currentTask: agent.currentTask || undefined }))}
          tasks={tasks}
          logs={logs}
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

            {rootTasks.length === 0 ? (
              <p className="text-sm text-[rgba(148,163,184,0.74)]">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {rootTasks.map((task) => {
                  const stageTasks = (task.subTasks || [])
                    .map((taskId) => tasksById.get(taskId))
                    .filter((item): item is SessionTask => Boolean(item))
                    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())

                  return (
                    <div
                      key={task.id}
                      className="rounded-2xl border border-[rgba(148,163,184,0.12)] bg-[rgba(15,23,42,0.52)] px-3 py-3 text-left transition hover:border-[rgba(125,211,252,0.28)] hover:bg-[rgba(15,23,42,0.74)]"
                    >
                      <button
                        type="button"
                        onClick={() => task.agentId && setSelectedAgentId(task.agentId)}
                        className="flex w-full items-start gap-3 text-left"
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

                      {stageTasks.length > 0 ? (
                        <div className="mt-3 space-y-1.5 border-l border-[rgba(148,163,184,0.2)] pl-3">
                          {stageTasks.map((stageTask) => (
                            <button
                              key={stageTask.id}
                              type="button"
                              onClick={() => stageTask.agentId && setSelectedAgentId(stageTask.agentId)}
                              className="flex w-full items-center gap-2 text-left"
                            >
                              <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone[stageTask.status] || 'bg-slate-500'}`} />
                              <span className="truncate text-[12px] text-[rgba(191,219,254,0.84)]">
                                {stageTask.description}
                              </span>
                              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-[0.1em] text-[rgba(148,163,184,0.66)]">
                                {stageTask.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {task.status === 'awaiting_finish' ? (
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            disabled={finishingTaskId === task.id}
                            onClick={() => handleFinishTask(task.id)}
                            className="rounded-full border border-[rgba(125,211,252,0.28)] bg-[rgba(15,23,42,0.66)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(226,232,240,0.86)] transition hover:border-[rgba(125,211,252,0.5)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {finishingTaskId === task.id ? 'Finishing…' : 'Finish task'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </aside>
        ) : null}
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-20 flex justify-center px-4">
        <form
          onSubmit={handleSubmitPrompt}
          className="pointer-events-auto w-full max-w-2xl rounded-[1.4rem] border border-[rgba(148,163,184,0.24)] bg-[rgba(2,6,23,0.9)] px-4 pb-2.5 pt-2 shadow-[0_30px_100px_-44px_rgba(2,6,23,0.92)] backdrop-blur-xl"
        >
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Message agent-main…"
            rows={1}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!isSendingPrompt && prompt.trim()) {
                  event.currentTarget.form?.requestSubmit()
                }
              }
            }}
            className="max-h-40 min-h-[36px] w-full resize-y bg-transparent px-2 py-1.5 text-sm text-[rgba(241,245,249,0.94)] outline-none placeholder:text-[rgba(148,163,184,0.62)]"
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[rgba(148,163,184,0.62)]">
              Enter to send · Shift+Enter for newline
            </p>
            <button
              type="submit"
              disabled={isSendingPrompt || !prompt.trim()}
              className="rounded-full border border-[rgba(125,211,252,0.24)] bg-[rgba(8,47,73,0.5)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(191,219,254,0.92)] transition hover:border-[rgba(125,211,252,0.46)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSendingPrompt ? 'Sending…' : 'Send'}
            </button>
          </div>
          {promptError ? (
            <p className="mt-2 text-xs text-[rgba(248,113,113,0.86)]">{promptError}</p>
          ) : null}
        </form>
      </div>
    </main>
  )
}
