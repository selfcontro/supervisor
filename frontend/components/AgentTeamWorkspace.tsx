'use client'

import Link from 'next/link'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import AgentDetailPanel from '@/components/AgentDetailPanel'
import BlackboardPanel from '@/components/BlackboardPanel'
import DotField from '@/components/DotField'
import FlowChart from '@/components/FlowChart'
import { useTaskMonitor } from '@/hooks/useTaskMonitor'
import { dispatchCodexTask, finishCodexTask, interruptCodexAgent, respondCodexApproval, retryCodexTask } from '@/lib/codexControlApi'
import { classifySessionSnapshotFailure, classifyWorkspaceLoadFailure, resolveBrowserApiUrl } from '@/lib/runtimeConfig'
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

type RuntimeHealth = {
  status: 'checking' | 'ready' | 'starting' | 'error'
  detail: string
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
  const [activityPanelOpen, setActivityPanelOpen] = useState(false)
  const [subagentCalls, setSubagentCalls] = useState<Record<string, { status: string; title: string; agentId?: string | null }>>({})
  const [blackboardPanelOpen, setBlackboardPanelOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [isSendingPrompt, setIsSendingPrompt] = useState(false)
  const [interruptingAgentId, setInterruptingAgentId] = useState<string | null>(null)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [finishingTaskId, setFinishingTaskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [showLocalCodexGuide, setShowLocalCodexGuide] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingApprovals, setPendingApprovals] = useState<Array<{
    requestId: string
    agentId: string
    command: string | null
    cwd: string | null
    availableDecisions: string[]
    timestamp: string
  }>>([])
  const [respondingApprovalId, setRespondingApprovalId] = useState<string | null>(null)
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null)
  const [streamsByAgent, setStreamsByAgent] = useState<Record<string, {
    threadId: string | null
    turnId: string | null
    text: string
    updatedAt: string
  }>>({})
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth>({
    status: 'checking',
    detail: 'Checking Codex app-server…',
  })
  const autoFinishingRootTaskRef = useRef<string | null>(null)
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
                metadata: payloadData?.metadata as Record<string, unknown> | undefined,
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

          const exitCode = commandPayload.exitCode
          const durationMs = typeof commandPayload.durationMs === 'number' ? commandPayload.durationMs : null
          const outputPreview = typeof commandPayload.outputPreview === 'string' ? commandPayload.outputPreview.slice(0, 600) : ''
          const detailParts = [`exit=${String(exitCode)}`]
          if (durationMs !== null) {
            detailParts.push(`${durationMs}ms`)
          }
          if (commandPayload.status) {
            detailParts.push(String(commandPayload.status))
          }
          const cwdSuffix = commandPayload.cwd ? ` @ ${commandPayload.cwd}` : ''
          const outputSuffix = outputPreview ? `\n${outputPreview}` : ''

          setStreamsByAgent((current) => {
            if (!commandPayload.agentId || !current[commandPayload.agentId]) {
              return current
            }
            const next = { ...current }
            delete next[commandPayload.agentId]
            return next
          })

          setLogs((current) => [
            ...current,
            {
              id: `cmd_${message.timestamp || Date.now()}_${commandPayload.agentId || 'agent'}_${commandPayload.threadId || ''}`,
              timestamp: message.timestamp || new Date().toISOString(),
              level: commandPayload.status === 'failed' ? 'error' : 'info',
              message: `[${commandPayload.agentId || 'agent'}] ${commandPayload.command}${cwdSuffix} (${detailParts.join(' · ')})${outputSuffix}`,
              taskId: commandPayload.taskId || null,
              agentId: commandPayload.agentId || null,
              sessionId,
              source: 'backend',
              metadata: {
                command: commandPayload.command,
                cwd: commandPayload.cwd || null,
                exitCode,
                durationMs,
                status: commandPayload.status || null,
                outputPreview,
                threadId: commandPayload.threadId || null,
                turnId: commandPayload.turnId || null,
              },
            },
          ])
          return
        }
        case 'command_output_delta':
        {
          const deltaPayload = message.payload || {}
          const delta = typeof deltaPayload.delta === 'string' ? deltaPayload.delta : ''
          const agentId = typeof deltaPayload.agentId === 'string' ? deltaPayload.agentId : null

          if (!delta || !agentId) {
            return
          }

          const threadId = typeof deltaPayload.threadId === 'string' ? deltaPayload.threadId : null
          const turnId = typeof deltaPayload.turnId === 'string' ? deltaPayload.turnId : null

          setStreamsByAgent((current) => {
            const existing = current[agentId]
            const base = existing && (existing.threadId === threadId || !threadId) ? existing.text : ''
            const text = `${base}${delta}`.slice(-4000)
            return {
              ...current,
              [agentId]: {
                threadId,
                turnId,
                text,
                updatedAt: message.timestamp || new Date().toISOString(),
              },
            }
          })
          return
        }
        case 'approval_required':
        {
          const approvalPayload = message.payload
          const requestId = approvalPayload?.requestId

          if (requestId === undefined || requestId === null || !approvalPayload?.agentId) {
            return
          }

          const requestKey = String(requestId)
          setPendingApprovals((current) => {
            if (current.some((item) => item.requestId === requestKey)) {
              return current
            }
            return [
              ...current,
              {
                requestId: requestKey,
                agentId: String(approvalPayload.agentId),
                command: typeof approvalPayload.command === 'string' ? approvalPayload.command : null,
                cwd: typeof approvalPayload.cwd === 'string' ? approvalPayload.cwd : null,
                availableDecisions: Array.isArray(approvalPayload.availableDecisions)
                  ? approvalPayload.availableDecisions.filter((d): d is string => typeof d === 'string')
                  : [],
                timestamp: message.timestamp || new Date().toISOString(),
              },
            ]
          })
          return
        }
        case 'approval_resolved':
        {
          const resolvedId = message.payload?.requestId
          if (resolvedId === undefined || resolvedId === null) {
            return
          }
          const requestKey = String(resolvedId)
          setPendingApprovals((current) => current.filter((item) => item.requestId !== requestKey))
          return
        }
        case 'subagent_call': {
          const call = message.payload
          if (!call?.callId) return
          const callId = call.callId
          setSubagentCalls((current) => ({
            ...current,
            [callId]: {
              status: call.status || 'unknown',
              title: call.title || call.agentId || 'subagent call',
              agentId: call.agentId,
            },
          }))
          return
        }
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
      setPendingApprovals([])
      setStreamsByAgent({})
      setSubagentCalls({})
      setError(null)
      setNotFound(false)
      setShowLocalCodexGuide(false)
      setSelectedAgentId(null)
      reconnectAttemptsRef.current = 0

      try {
        const [snapshot, healthResponse] = await Promise.all([
          fetchSessionSnapshot(sessionId),
          fetch(`${resolveBrowserApiUrl()}/health`, { cache: 'no-store' }),
        ])

        if (disposed) {
          return
        }

        hydrateSnapshot(snapshot)
        if (healthResponse.ok) {
          const health = await healthResponse.json()
          const runtime = health?.bridge?.runtime || {}
          const ready = health?.codexControl === 'ready' || runtime.codexControl === 'ready' || runtime.appServer === 'ready'
          setRuntimeHealth({
            status: ready ? 'ready' : 'starting',
            detail: ready ? 'Codex app-server connected' : 'Bridge connected; app-server is starting',
          })
        } else {
          setRuntimeHealth({ status: 'error', detail: `Health check returned ${healthResponse.status}` })
        }
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
          if (classifyWorkspaceLoadFailure(loadError) === 'local_backend_unreachable') {
            setShowLocalCodexGuide(true)
            setError(
              'This public frontend is still pointed at a local backend. Start your local Codex bridge/backend, then reconnect the workspace to continue.'
            )
            setLoading(false)
            return
          }
          setError(getErrorMessage(loadError))
        }

        setRuntimeHealth({ status: 'error', detail: 'Codex app-server unavailable' })

        setLoading(false)
      }
    }

    void loadWorkspace()

    return () => {
      disposed = true
      stopRealtime()
    }
  }, [refreshKey, sessionId])

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || null
  const selectedAgentLogs = useMemo(
    () => (selectedAgentId ? logs.filter((entry) => entry.agentId === selectedAgentId) : []),
    [logs, selectedAgentId]
  )
  const selectedTaskHistory = useMemo(
    () =>
      (selectedAgentId
        ? tasks
            .filter((task) => task.agentId === selectedAgentId)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : []
      ).map((task) => ({
        description: task.description,
        assignedAt: task.createdAt,
        completedAt: task.updatedAt,
        result: task.result || undefined,
      })),
    [tasks, selectedAgentId]
  )
  const selectedToolHistory = useMemo(
    () =>
      selectedAgentLogs
        .filter((entry) => {
          const metadata = entry.metadata as Record<string, unknown> | undefined
          return typeof metadata?.command === 'string'
        })
        .map((entry) => {
          const metadata = entry.metadata as Record<string, unknown>
          return {
            id: entry.id,
            timestamp: entry.timestamp,
            command: String(metadata.command),
            exitCode: typeof metadata.exitCode === 'number' ? metadata.exitCode : null,
            durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : null,
            status: typeof metadata.status === 'string' ? metadata.status : null,
            outputPreview: typeof metadata.outputPreview === 'string' ? metadata.outputPreview : null,
            turnId: typeof metadata.turnId === 'string' ? metadata.turnId : null,
          }
        }),
    [selectedAgentLogs]
  )
  const canInterruptSelectedAgent = Boolean(
    selectedAgent && ['working', 'waiting'].includes(selectedAgent.status)
  )
  const {
    rootTasks,
    recentTasks,
    tasksById,
    activeRootTask,
    awaitingFinishRootTask,
  } = useTaskMonitor(tasks)

  useEffect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      if (!selectedAgentId || !canInterruptSelectedAgent || interruptingAgentId) {
        return
      }

      event.preventDefault()
      void handleInterruptSelectedAgent()
    }

    window.addEventListener('keydown', handleGlobalKeydown)
    return () => window.removeEventListener('keydown', handleGlobalKeydown)
  }, [canInterruptSelectedAgent, interruptingAgentId, selectedAgentId, sessionId, agents])

  useEffect(() => {
    if (!awaitingFinishRootTask) {
      autoFinishingRootTaskRef.current = null
      return
    }

    if (autoFinishingRootTaskRef.current === awaitingFinishRootTask.id || finishingTaskId) {
      return
    }

    autoFinishingRootTaskRef.current = awaitingFinishRootTask.id
    setFinishingTaskId(awaitingFinishRootTask.id)
    setPromptError(null)

    void finishCodexTask(sessionId, awaitingFinishRootTask.id)
      .catch((finishError) => {
        setPromptError(getErrorMessage(finishError))
      })
      .finally(() => {
        setFinishingTaskId(null)
      })
  }, [awaitingFinishRootTask, finishingTaskId, sessionId])

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
          <h1 className="mt-4 text-4xl font-semibold text-[#e2e8f0]">
            {showLocalCodexGuide ? 'Connect Local Codex' : 'Unable to load this session'}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[rgba(148,163,184,0.82)]">{error}</p>
          {showLocalCodexGuide ? (
            <div className="mx-auto mt-6 max-w-2xl rounded-[28px] border border-[rgba(125,211,252,0.16)] bg-[rgba(8,15,28,0.9)] p-6 text-left shadow-[0_28px_120px_rgba(2,8,23,0.45)]">
              <p className="text-xs uppercase tracking-[0.24em] text-[rgba(103,232,249,0.7)]">Public Frontend Mode</p>
              <ol className="mt-4 space-y-3 text-sm leading-7 text-[rgba(226,232,240,0.84)]">
                <li>1. Run your local Codex backend or bridge on <span className="text-white">port 3101</span>.</li>
                <li>2. Make sure it exposes the session API and websocket endpoints used by this workspace.</li>
                <li>3. If you are using your own local Codex bridge, point this frontend to that URL instead of <span className="text-white">localhost</span>.</li>
                <li>4. Reload this page after the local runtime reports healthy.</li>
              </ol>
              <div className="mt-5 rounded-2xl border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.66)] px-4 py-3 font-mono text-xs leading-6 text-[rgba(148,163,184,0.9)]">
                NEXT_PUBLIC_API_URL=http://127.0.0.1:3101
                <br />
                NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3101
              </div>
              <div className="mt-5 flex items-center justify-center">
                <Link
                  href="/connect-local-codex"
                  className="rounded-full bg-[rgba(103,232,249,0.14)] px-4 py-2 text-sm text-cyan-100 transition hover:bg-[rgba(103,232,249,0.24)]"
                >
                  Open Connection Guide
                </Link>
              </div>
            </div>
          ) : null}
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
    if (!nextPrompt || isSendingPrompt || activeRootTask) {
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

  async function handleRetryTask(agentId: string, taskId: string) {
    if (retryingTaskId) {
      return
    }
    setRetryingTaskId(taskId)
    setPromptError(null)
    try {
      await retryCodexTask(sessionId, agentId, taskId)
    } catch (retryError) {
      setPromptError(getErrorMessage(retryError))
    } finally {
      setRetryingTaskId(null)
    }
  }

  async function handleInterruptSelectedAgent() {
    if (!selectedAgentId || !canInterruptSelectedAgent || interruptingAgentId) {
      return
    }

    setInterruptingAgentId(selectedAgentId)
    setPromptError(null)
    try {
      await interruptCodexAgent(sessionId, selectedAgentId)
    } catch (interruptError) {
      setPromptError(getErrorMessage(interruptError))
    } finally {
      setInterruptingAgentId(null)
    }
  }

  async function handleRespondApproval(agentId: string, requestId: string, decision: string) {    if (respondingApprovalId) {
      return
    }
    setRespondingApprovalId(requestId)
    setPromptError(null)
    try {
      await respondCodexApproval(sessionId, agentId, requestId, decision)
      setPendingApprovals((current) => current.filter((item) => item.requestId !== requestId))
    } catch (respondError) {
      const message = getErrorMessage(respondError)
      // The backend drops pending approvals on restart; a 404 means this
      // card can never resolve, so remove it instead of leaving it stuck.
      if (/not found/i.test(message)) {
        setPendingApprovals((current) => current.filter((item) => item.requestId !== requestId))
      }
      setPromptError(message)
    } finally {
      setRespondingApprovalId(null)
    }
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#04070d]">
      <div className="relative h-full w-full bg-[radial-gradient(circle_at_top,rgba(14,116,144,0.08),transparent_30%),linear-gradient(180deg,#050811_0%,#04070d_50%,#050811_100%)]">
        <div className="pointer-events-none absolute inset-0 z-0 opacity-80">
          <DotField
            dotRadius={1.4}
            dotSpacing={13}
            bulgeStrength={56}
            glowRadius={145}
            sparkle={false}
            waveAmplitude={0}
            gradientFrom="rgba(56, 189, 248, 0.22)"
            gradientTo="rgba(59, 130, 246, 0.16)"
            glowColor="rgba(10, 22, 38, 0.9)"
          />
        </div>
        <div className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_50%_12%,rgba(56,189,248,0.09),transparent_34%)]" />
        <div className="relative z-10 h-full w-full">
        <div className="pointer-events-none fixed left-4 top-4 z-30 flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.78)] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[rgba(226,232,240,0.82)] backdrop-blur-xl">
          <span className={`h-2 w-2 rounded-full ${runtimeHealth.status === 'ready' ? 'bg-emerald-400' : runtimeHealth.status === 'starting' ? 'bg-amber-300' : runtimeHealth.status === 'error' ? 'bg-rose-400' : 'bg-sky-300 animate-pulse'}`} />
          <span>{runtimeHealth.detail}</span>
        </div>
        <FlowChart
          agents={agents.map((agent) => ({ ...agent, currentTask: agent.currentTask || undefined }))}
          tasks={tasks}
          logs={logs}
          streams={streamsByAgent}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
        />
        </div>
      </div>
      <div className="fixed right-4 top-20 z-20 flex flex-col items-end gap-3">
        <button
          type="button"
          onClick={() => setBlackboardPanelOpen((current) => !current)}
          className="rounded-full border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.8)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(226,232,240,0.78)] backdrop-blur transition hover:border-[rgba(125,211,252,0.32)] hover:text-white"
        >
          Blackboard
          {selectedAgent ? ` · ${selectedAgent.name}` : ''}
        </button>
        <button
          type="button"
          onClick={() => setTaskPanelOpen((current) => !current)}
          className="rounded-full border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.8)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(226,232,240,0.78)] backdrop-blur transition hover:border-[rgba(125,211,252,0.32)] hover:text-white"
        >
          Tasks {recentTasks.length > 0 ? `· ${recentTasks.length}` : ''}
        </button>
        <button
          type="button"
          onClick={() => setActivityPanelOpen((current) => !current)}
          className="rounded-full border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.8)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(226,232,240,0.78)] backdrop-blur transition hover:border-[rgba(125,211,252,0.32)] hover:text-white"
        >
          Activity {logs.length > 0 ? `· ${logs.length}` : ''} {Object.keys(subagentCalls).length > 0 ? `· subagents ${Object.keys(subagentCalls).length}` : ''}
        </button>

        {pendingApprovals.length > 0 ? (
          <aside className="w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[1.4rem] border border-[rgba(251,191,36,0.3)] bg-[rgba(30,20,4,0.9)] p-3 text-left shadow-[0_24px_80px_-40px_rgba(2,6,23,0.92)] backdrop-blur-xl">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(251,191,36,0.85)]">
              Approval needed · {pendingApprovals.length}
            </p>
            <div className="space-y-2">
              {pendingApprovals.map((approval) => {
                const decisions = approval.availableDecisions.length > 0
                  ? approval.availableDecisions
                  : ['approve', 'deny']
                return (
                  <div
                    key={approval.requestId}
                    className="rounded-2xl border border-[rgba(251,191,36,0.2)] bg-[rgba(15,23,42,0.52)] px-3 py-3"
                  >
                    <p className="break-words font-mono text-[12px] leading-5 text-[rgba(241,245,249,0.92)]">
                      {approval.command || '(no command payload)'}
                    </p>
                    <p className="mt-1 text-[11px] text-[rgba(148,163,184,0.75)]">
                      {approval.agentId}
                      {approval.cwd ? ` · ${approval.cwd}` : ''}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {decisions.map((decision) => (
                        <button
                          key={decision}
                          type="button"
                          disabled={respondingApprovalId === approval.requestId}
                          onClick={() => void handleRespondApproval(approval.agentId, approval.requestId, decision)}
                          className="rounded-full border border-[rgba(125,211,252,0.28)] bg-[rgba(15,23,42,0.66)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(226,232,240,0.86)] transition hover:border-[rgba(125,211,252,0.5)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {respondingApprovalId === approval.requestId ? 'Sending…' : decision}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
        ) : null}

        {taskPanelOpen ? (
          <aside className="max-h-[min(70vh,720px)] w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[1.4rem] border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.84)] p-3 text-left shadow-[0_24px_80px_-40px_rgba(2,6,23,0.92)] backdrop-blur-xl">
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
                        className="flex w-full items-start gap-3 overflow-hidden text-left"
                      >
                        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${statusTone[task.status] || 'bg-slate-500'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-medium leading-5 text-[rgba(241,245,249,0.92)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                            {task.description}
                          </span>
                          <span className="mt-1 block break-all text-[11px] uppercase tracking-[0.12em] text-[rgba(148,163,184,0.7)]">
                            {task.status}
                            {task.agentId ? ` · ${task.agentId}` : ''}
                          </span>
                          {task.error ? (
                            <span className="mt-1 block break-words text-[12px] leading-5 text-[rgba(248,113,113,0.9)]" title={task.error}>
                              {task.error.slice(0, 220)}
                            </span>
                          ) : null}
                        </span>
                      </button>

                      {stageTasks.length > 0 ? (
                        <div className="mt-3 space-y-1.5 border-l border-[rgba(148,163,184,0.2)] pl-3">
                          {stageTasks.map((stageTask) => (
                            <div key={stageTask.id}>
                              <button
                                type="button"
                                onClick={() => stageTask.agentId && setSelectedAgentId(stageTask.agentId)}
                                className="flex w-full items-start gap-2 overflow-hidden text-left"
                              >
                                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusTone[stageTask.status] || 'bg-slate-500'}`} />
                                <span className="min-w-0 flex-1 break-words text-[12px] leading-5 text-[rgba(191,219,254,0.84)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                                  {stageTask.description}
                                </span>
                                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-[0.1em] text-[rgba(148,163,184,0.66)]">
                                  {stageTask.status}
                                </span>
                              </button>
                              {stageTask.error ? (
                                <p className="mt-1 break-words text-[11px] leading-5 text-[rgba(248,113,113,0.88)]" title={stageTask.error}>
                                  {stageTask.error.slice(0, 220)}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {(task.status === 'failed' || task.status === 'error') && task.agentId ? (
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            disabled={retryingTaskId === task.id}
                            onClick={() => void handleRetryTask(task.agentId as string, task.id)}
                            className="rounded-full border border-[rgba(248,113,113,0.28)] bg-[rgba(69,10,10,0.52)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(254,202,202,0.92)] transition hover:border-[rgba(248,113,113,0.44)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {retryingTaskId === task.id ? 'Retrying…' : 'Retry task'}
                          </button>
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

        {activityPanelOpen ? (
          <aside className="max-h-[min(70vh,720px)] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[1.4rem] border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.9)] p-3 text-left shadow-[0_24px_80px_-40px_rgba(2,6,23,0.92)] backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(148,163,184,0.72)]">Live activity</p>
              <button type="button" onClick={() => setActivityPanelOpen(false)} className="text-xs text-[rgba(148,163,184,0.74)] hover:text-white">Close</button>
            </div>
            {logs.length === 0 ? <p className="text-sm text-[rgba(148,163,184,0.74)]">No logs yet.</p> : (
              <div className="space-y-2">
                {logs.slice(-40).reverse().map((entry) => {
                  const metadata = entry.metadata as Record<string, unknown> | undefined
                  const kind = metadata?.kind === 'tool_call' || typeof metadata?.command === 'string' ? 'TOOL' : 'LOG'
                  return (
                    <div key={entry.id} className="rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(15,23,42,0.52)] px-3 py-2">
                      <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em] text-[rgba(125,211,252,0.78)]">
                        <span>{kind} · {entry.level}</span>
                        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[rgba(226,232,240,0.84)]">{entry.message}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </aside>
        ) : null}

        {blackboardPanelOpen ? (
          <BlackboardPanel
            open={blackboardPanelOpen}
            sessionId={sessionId}
            selectedAgentId={selectedAgentId}
            selectedAgentName={selectedAgent?.name || null}
            tasks={tasks}
            logs={logs}
            onClose={() => setBlackboardPanelOpen(false)}
          />
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
              Enter to send · Shift+Enter for newline · Esc to interrupt selected agent
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleInterruptSelectedAgent()}
                disabled={!canInterruptSelectedAgent || Boolean(interruptingAgentId)}
                className="rounded-full border border-[rgba(248,113,113,0.24)] bg-[rgba(69,10,10,0.52)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(254,202,202,0.92)] transition hover:border-[rgba(248,113,113,0.44)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {interruptingAgentId === selectedAgentId ? 'Interrupting…' : 'Interrupt'}
              </button>
              <button
                type="submit"
                disabled={isSendingPrompt || !prompt.trim() || Boolean(activeRootTask)}
                className="rounded-full border border-[rgba(125,211,252,0.24)] bg-[rgba(8,47,73,0.5)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(191,219,254,0.92)] transition hover:border-[rgba(125,211,252,0.46)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSendingPrompt ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        {selectedAgent ? (
          <p className="mt-2 text-xs text-[rgba(148,163,184,0.78)]">
            Selected agent: <span className="text-[rgba(241,245,249,0.92)]">{selectedAgent.name}</span>
            <span className="text-[rgba(148,163,184,0.62)]"> · {selectedAgent.status}</span>
          </p>
        ) : null}
        {activeRootTask ? (
          <p className="mt-2 text-xs text-[rgba(148,163,184,0.78)]">
            Current team task in progress: <span className="text-[rgba(241,245,249,0.92)]">{activeRootTask.description}</span>
          </p>
        ) : null}
        {promptError ? (
          <p className="mt-2 text-xs text-[rgba(248,113,113,0.86)]">{promptError}</p>
        ) : null}
        </form>
      </div>
      {selectedAgent ? (
        <AgentDetailPanel
          agent={{
            id: selectedAgent.id,
            name: selectedAgent.name,
            status: (['idle', 'working', 'waiting', 'completed', 'error'] as const).includes(selectedAgent.status as never)
              ? (selectedAgent.status as 'idle' | 'working' | 'waiting' | 'completed' | 'error')
              : 'idle',
            currentTask: selectedAgent.currentTask || undefined,
          }}
          onClose={() => setSelectedAgentId(null)}
          logs={selectedAgentLogs.map((entry) => ({
            id: entry.id,
            timestamp: entry.timestamp,
            level: entry.level === 'warning' || entry.level === 'error' || entry.level === 'debug' ? entry.level : 'info',
            message: entry.message,
          }))}
          taskHistory={selectedTaskHistory}
          toolHistory={selectedToolHistory}
        />
      ) : null}
    </main>
  )
}
