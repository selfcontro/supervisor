'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AgentCard from '@/components/AgentCard'
import AgentDetailPanel from '@/components/AgentDetailPanel'
import FlowChart from '@/components/FlowChart'
import LogViewer from '@/components/LogViewer'
import SessionSidebar from '@/components/SessionSidebar'
import TaskInput from '@/components/TaskInput'
import TaskList from '@/components/TaskList'
import { classifySessionSnapshotFailure } from '@/lib/runtimeConfig'
import {
  activateCodexAgent,
  closeCodexAgent,
  dispatchCodexTask,
  fetchAgentBlackboardMarkdown,
  fetchSessionBlackboardMarkdown,
  interruptCodexAgent,
  listCodexAgents,
  respondCodexApproval,
  resumeCodexAgent,
  retryCodexTask,
} from '@/lib/codexControlApi'
import {
  SessionApiError,
  assignTaskToAgent,
  createTaskForSession,
  fetchSessionList,
  fetchSessionSnapshot,
  getWorkspaceSocketUrl,
  subscribeToSession,
} from '@/lib/sessionApi'
import type { Agent } from '@/src/types/agent'
import type {
  ConnectionState,
  SessionDetails,
  SessionLogEntry,
  SessionSocketEvent,
  SessionSummary,
  SessionTask,
} from '@/src/types/session'

interface AgentTeamWorkspaceProps {
  sessionId: string
}

interface Notice {
  tone: 'info' | 'success' | 'error'
  message: string
}

interface PendingApproval {
  requestId: string
  agentId: string
  command: string
  cwd: string
  availableDecisions: string[]
  timestamp: string
}

interface AgentTaskHistoryEntry {
  task: string
  assignedAt: string
  completedAt?: string
  result?: string | null
}

type WorkspaceAgent = Omit<Agent, 'currentTask'> & {
  currentTask?: string | null
  role?: string
  taskHistory?: AgentTaskHistoryEntry[]
}

const ACTIVE_TASK_STATUSES = new Set(['pending', 'planning', 'executing', 'reviewing', 'working'])

function createFallbackSessionSummary(
  session: SessionDetails,
  tasks: SessionTask[],
  agents: WorkspaceAgent[],
  logs: SessionLogEntry[]
): SessionSummary {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    taskCount: tasks.length,
    activeTaskCount: tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length,
    agentCount: agents.length,
    latestLogAt: logs.length > 0 ? logs[logs.length - 1].timestamp : null,
  }
}

function upsertSessionSummary(
  sessions: SessionSummary[],
  session: SessionDetails,
  tasks: SessionTask[],
  agents: WorkspaceAgent[],
  logs: SessionLogEntry[]
): SessionSummary[] {
  const nextSummary = createFallbackSessionSummary(session, tasks, agents, logs)
  const nextSessions = sessions.some((item) => item.id === session.id)
    ? sessions.map((item) => (item.id === session.id ? { ...item, ...nextSummary } : item))
    : [nextSummary, ...sessions]

  return nextSessions.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

function buildTaskHistory(agent: WorkspaceAgent | null, tasks: SessionTask[]) {
  const explicitHistory = Array.isArray(agent?.taskHistory)
    ? agent.taskHistory.map((entry) => ({
        description: entry.task,
        assignedAt: entry.assignedAt,
        completedAt: entry.completedAt,
        result: entry.result || undefined,
      }))
    : []

  if (explicitHistory.length > 0) {
    return explicitHistory
  }

  return tasks
    .filter((task) => task.agentId === agent?.id)
    .map((task) => ({
      description: task.description,
      assignedAt: task.createdAt,
      completedAt: task.updatedAt,
      result: task.result || undefined,
    }))
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

const connectionCopy: Record<ConnectionState, string> = {
  connected: 'Connected',
  disconnected: 'Offline',
  reconnecting: 'Reconnecting',
}

function createClientLogId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export default function AgentTeamWorkspace({ sessionId }: AgentTeamWorkspaceProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionMeta, setSessionMeta] = useState<SessionDetails | null>(null)
  const [agents, setAgents] = useState<WorkspaceAgent[]>([])
  const [tasks, setTasks] = useState<SessionTask[]>([])
  const [logs, setLogs] = useState<SessionLogEntry[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [codexAgentId, setCodexAgentId] = useState('agent-main')
  const [codexPrompt, setCodexPrompt] = useState('')
  const [codexBusy, setCodexBusy] = useState(false)
  const [blackboardPreview, setBlackboardPreview] = useState<string>('')
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const reconnectAttemptsRef = useRef(0)
  const currentSessionIdRef = useRef(sessionId)

  useEffect(() => {
    currentSessionIdRef.current = sessionId
  }, [sessionId])

  const selectedAgent = useMemo(() => {
    return agents.find((agent) => agent.id === selectedAgentId) || null
  }, [agents, selectedAgentId])

  const selectedAgentLogs = useMemo(() => {
    if (!selectedAgentId) {
      return []
    }

    return logs.filter((log) => log.agentId === selectedAgentId)
  }, [logs, selectedAgentId])

  const selectedAgentHistory = useMemo(() => {
    return buildTaskHistory(selectedAgent, tasks)
  }, [selectedAgent, tasks])

  const activeTasksCount = useMemo(() => {
    return tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length
  }, [tasks])

  const completedTasksCount = useMemo(() => {
    return tasks.filter((task) => task.status === 'completed').length
  }, [tasks])

  useEffect(() => {
    if (!notice) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  useEffect(() => {
    if (!sessionMeta || loading || notFound) {
      return
    }

    setSessions((current) => upsertSessionSummary(current, sessionMeta, tasks, agents, logs))
  }, [agents, loading, logs, notFound, sessionMeta, tasks])

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

    function appendLog(entry: SessionLogEntry) {
      setLogs((current) => [...current, entry].slice(-500))
    }

    function hydrateSnapshot(snapshot: Awaited<ReturnType<typeof fetchSessionSnapshot>>) {
      const normalizedLogs = snapshot.logs.map((log) => ({ ...log, source: log.source || 'backend' as const }))
      setSessionMeta(snapshot.session)
      setAgents(snapshot.agents as WorkspaceAgent[])
      setTasks(snapshot.tasks)
      setLogs(normalizedLogs)
      setSessions((current) => upsertSessionSummary(current, snapshot.session, snapshot.tasks, snapshot.agents as WorkspaceAgent[], normalizedLogs))
    }

    async function refreshSessionSnapshot(activeSessionId: string) {
      try {
        const snapshot = await fetchSessionSnapshot(activeSessionId)

        if (disposed || currentSessionIdRef.current !== activeSessionId) {
          return
        }

        hydrateSnapshot(snapshot)
      } catch (snapshotError) {
        if (!disposed && currentSessionIdRef.current === activeSessionId) {
          setNotice({ tone: 'error', message: getErrorMessage(snapshotError) })
        }
      }
    }

    function handleSocketEvent(message: SessionSocketEvent) {
      if ('sessionId' in message && message.sessionId && message.sessionId !== sessionId) {
        return
      }

      switch (message.type) {
        case 'subscribed':
          setConnectionState('connected')
          void refreshSessionSnapshot(sessionId)
          return
        case 'agent_status': {
          const agentId = message.payload?.agentId
          const data = message.payload?.data
          if (!agentId || !data) {
            return
          }

          setAgents((current) => {
            const existingAgent = current.find((agent) => agent.id === agentId)
            if (!existingAgent) {
              return [
                ...current,
                {
                  id: agentId,
                  name: agentId,
                  status: data.status || 'idle',
                  currentTask: data.currentTask || null,
                },
              ]
            }

            return current.map((agent) => (agent.id === agentId ? { ...agent, ...data } : agent))
          })

          if (data.log) {
            appendLog({
              id: createClientLogId('log'),
              timestamp: message.timestamp || new Date().toISOString(),
              level: 'info',
              source: 'backend',
              message: `[${agentId}] ${data.log}`,
              agentId,
              sessionId,
            })
          }
          return
        }
        case 'task_update': {
          const taskId = message.payload?.taskId
          const data = message.payload?.data
          if (!taskId || !data) {
            return
          }

          setTasks((current) => {
            const existing = current.find((task) => task.id === taskId)
            if (existing) {
              return current.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      ...data,
                      updatedAt: data.updatedAt || message.timestamp || task.updatedAt,
                    }
                  : task
              )
            }

            return [
              {
                id: taskId,
                description: (data as SessionTask).description || `Codex task ${taskId}`,
                status: (data as SessionTask).status || 'executing',
                createdAt: message.timestamp || new Date().toISOString(),
                updatedAt: (data as SessionTask).updatedAt || message.timestamp || new Date().toISOString(),
                agentId: (data as SessionTask).agentId || null,
                result: (data as SessionTask).result || null,
                error: (data as SessionTask).error || null,
                sessionId,
              },
              ...current,
            ]
          })
          return
        }
        case 'task:new': {
          if (!message.task) {
            return
          }

          setTasks((current) => {
            if (current.some((task) => task.id === message.task?.id)) {
              return current
            }
            return [message.task as SessionTask, ...current]
          })
          return
        }
        case 'log_entry': {
          const data = message.payload?.data
          if (!data?.message) {
            return
          }

          appendLog({
            id: message.payload?.logId || createClientLogId('log'),
            timestamp: message.timestamp || new Date().toISOString(),
            level: data.level || 'info',
            source: 'backend',
            message: data.message,
            taskId: data.taskId || null,
            agentId: data.agentId || null,
            sessionId,
            metadata: data,
          })
          return
        }
        case 'command_execution': {
          const payload = message.payload
          if (!payload?.command) {
            return
          }

          appendLog({
            id: createClientLogId('cmd'),
            timestamp: message.timestamp || new Date().toISOString(),
            level: payload.exitCode === 0 ? 'info' : 'error',
            source: 'backend',
            message: `[cmd] ${payload.command} (exit=${String(payload.exitCode ?? 'n/a')})`,
            taskId: payload.taskId || null,
            agentId: payload.agentId || null,
            sessionId,
            metadata: payload,
          })
          return
        }
        case 'approval_required': {
          const payload = message.payload
          const payloadData = payload || {}
          const requestIdRaw = payload?.requestId
          const approvalAgentId = typeof payload?.agentId === 'string' ? payload.agentId : ''

          if (requestIdRaw !== undefined && approvalAgentId) {
            setPendingApprovals((current) => {
              const requestId = String(requestIdRaw)
              const existing = current.find((item) => item.requestId === requestId)
              const next: PendingApproval = {
                requestId,
                agentId: approvalAgentId,
                command: payloadData.command || '',
                cwd: payloadData.cwd || '',
                availableDecisions: Array.isArray(payloadData.availableDecisions) ? payloadData.availableDecisions : [],
                timestamp: message.timestamp || new Date().toISOString(),
              }

              if (existing) {
                return current.map((item) => (item.requestId === requestId ? next : item))
              }

              return [next, ...current]
            })
          }
          appendLog({
            id: createClientLogId('approval'),
            timestamp: message.timestamp || new Date().toISOString(),
            level: 'warning',
            source: 'backend',
            message: `Approval required for ${payload?.agentId || 'agent'}: ${payload?.command || 'command execution'}`,
            agentId: payload?.agentId || null,
            sessionId,
            metadata: payload,
          })
          return
        }
        case 'approval_resolved': {
          const payload = message.payload
          if (payload?.requestId !== undefined) {
            const requestId = String(payload.requestId)
            setPendingApprovals((current) => current.filter((item) => item.requestId !== requestId))
          }
          appendLog({
            id: createClientLogId('approval'),
            timestamp: message.timestamp || new Date().toISOString(),
            level: 'info',
            source: 'backend',
            message: `Approval resolved (${payload?.decision || 'unknown'}) for ${payload?.agentId || 'agent'}.`,
            agentId: payload?.agentId || null,
            sessionId,
            metadata: payload,
          })
          return
        }
        case 'error': {
          const messageText = typeof message.payload?.message === 'string' ? message.payload.message : 'WebSocket error'
          setNotice({ tone: 'error', message: messageText })
          return
        }
        default:
          return
      }
    }

    function connectSocket() {
      if (disposed) {
        return
      }

      setConnectionState(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'disconnected')
      socket = new WebSocket(getWorkspaceSocketUrl())

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0
        setConnectionState('connected')
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
          setNotice({ tone: 'error', message: 'Received an unreadable realtime payload.' })
        }
      }

      socket.onerror = () => {
        if (!disposed) {
          setConnectionState('reconnecting')
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
        setConnectionState('reconnecting')
        reconnectTimeoutId = setTimeout(connectSocket, Math.min(5000, 1000 * reconnectAttemptsRef.current))
      }
    }

    async function loadWorkspace() {
      setLoading(true)
      setSessionMeta(null)
      setAgents([])
      setTasks([])
      setLogs([])
      setError(null)
      setNotice(null)
      setNotFound(false)
      setBlackboardPreview('')
      setPendingApprovals([])
      setConnectionState('disconnected')
      setSelectedAgentId(null)
      reconnectAttemptsRef.current = 0

      const [sessionListResult, snapshotResult, codexAgentsResult] = await Promise.allSettled([
        fetchSessionList(),
        fetchSessionSnapshot(sessionId),
        listCodexAgents(sessionId),
      ])

      if (disposed) {
        return
      }

      if (sessionListResult.status === 'fulfilled') {
        setSessions(sessionListResult.value)
      } else {
        setNotice({ tone: 'error', message: 'Unable to refresh the session list.' })
      }

      if (snapshotResult.status === 'rejected') {
        if (snapshotResult.reason instanceof SessionApiError && snapshotResult.reason.status === 404) {
          const failureKind = classifySessionSnapshotFailure(snapshotResult.reason)
          if (failureKind === 'not_found') {
            setNotFound(true)
          } else {
            setError(
              'Workspace session API is unavailable. Restart the backend with the current server code and confirm the frontend API URL points to it.'
            )
          }
        } else {
          setError(getErrorMessage(snapshotResult.reason))
        }

        setLoading(false)
        return
      }

      const snapshot = snapshotResult.value
      hydrateSnapshot(snapshot)
      if (codexAgentsResult.status === 'fulfilled' && codexAgentsResult.value.length > 0) {
        setCodexAgentId((current) => (current === 'agent-main' ? codexAgentsResult.value[0].agentId : current))
        setAgents((current) => {
          const existingIds = new Set(current.map((agent) => agent.id))
          const merged = [...current]

          for (const codexAgent of codexAgentsResult.value) {
            if (existingIds.has(codexAgent.agentId)) {
              continue
            }
            merged.push({
              id: codexAgent.agentId,
              name: codexAgent.agentId,
              status: codexAgent.state === 'working' ? 'working' : codexAgent.state === 'error' ? 'error' : 'idle',
              currentTask: null,
              role: 'Codex controlled agent',
            })
          }

          return merged
        })
      }

      if (sessionListResult.status === 'fulfilled') {
        setSessions((current) => upsertSessionSummary(sessionListResult.value, snapshot.session, snapshot.tasks, snapshot.agents as WorkspaceAgent[], snapshot.logs))
      }

      setLoading(false)
      connectSocket()
    }

    loadWorkspace().catch((loadError) => {
      if (disposed) {
        return
      }
      setLoading(false)
      setError(getErrorMessage(loadError))
    })

    return () => {
      disposed = true
      stopRealtime()
    }
  }, [refreshKey, sessionId])

  const handleRetry = useCallback(() => {
    setRefreshKey((current) => current + 1)
  }, [])

  const handleSendTask = useCallback(async (description: string, targetSessionId: string) => {
    try {
      const preferredAgentId = codexAgentId.trim()
      let task: SessionTask

      if (preferredAgentId) {
        await activateCodexAgent(targetSessionId, preferredAgentId)
        const dispatched = await dispatchCodexTask(targetSessionId, preferredAgentId, {
          title: description.slice(0, 80),
          prompt: description,
        })

        task = {
          id: dispatched.taskId,
          description: description.slice(0, 120),
          status: 'executing',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          agentId: preferredAgentId,
          sessionId: targetSessionId,
        }
        setSelectedAgentId(preferredAgentId)
      } else {
        task = await createTaskForSession(targetSessionId, description)
      }

      if (currentSessionIdRef.current !== targetSessionId) {
        return
      }

      setTasks((current) => (current.some((item) => item.id === task.id) ? current : [task, ...current]))
      setNotice({
        tone: 'success',
        message: preferredAgentId
          ? `Task submitted to Codex agent ${preferredAgentId}.`
          : 'Task submitted to the active session.',
      })
    } catch (taskError) {
      const message = getErrorMessage(taskError)
      if (currentSessionIdRef.current === targetSessionId) {
        setNotice({ tone: 'error', message })
      }
      throw taskError
    }
  }, [codexAgentId])

  const handleAssignTask = useCallback(
    async (agentId: string, description: string) => {
      try {
        try {
          await activateCodexAgent(sessionId, agentId)
          const dispatched = await dispatchCodexTask(sessionId, agentId, {
            title: description.slice(0, 80),
            prompt: description,
          })

          setTasks((current) => [
            {
              id: dispatched.taskId,
              description: description.slice(0, 120),
              status: 'executing',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              agentId,
              sessionId,
            },
            ...current.filter((task) => task.id !== dispatched.taskId),
          ])
          setNotice({ tone: 'success', message: `Dispatched task to Codex agent ${agentId}.` })
          return
        } catch {
          await assignTaskToAgent(sessionId, agentId, description)
          setNotice({ tone: 'info', message: `Fallback assignment sent to ${agentId}.` })
        }
      } catch (assignError) {
        const message = getErrorMessage(assignError)
        setNotice({ tone: 'error', message })
        throw assignError
      }
    },
    [sessionId]
  )

  const handleTaskClick = useCallback((task: SessionTask) => {
    if (task.agentId) {
      setSelectedAgentId(task.agentId)
    }
  }, [])

  useEffect(() => {
    if (selectedAgentId) {
      setCodexAgentId(selectedAgentId)
    }
  }, [selectedAgentId])

  const latestCodexTaskId = useMemo(() => {
    const targetAgentId = codexAgentId.trim()
    if (!targetAgentId) {
      return null
    }

    const candidate = tasks.find((task) => task.agentId === targetAgentId)
    return candidate?.id || null
  }, [codexAgentId, tasks])

  const visibleApprovals = useMemo(() => {
    const targetAgentId = codexAgentId.trim()
    if (!targetAgentId) {
      return pendingApprovals
    }

    return pendingApprovals.filter((approval) => approval.agentId === targetAgentId)
  }, [codexAgentId, pendingApprovals])

  const runCodexAction = useCallback(
    async (action: () => Promise<void>) => {
      setCodexBusy(true)
      try {
        await action()
      } catch (actionError) {
        setNotice({ tone: 'error', message: getErrorMessage(actionError) })
      } finally {
        setCodexBusy(false)
      }
    },
    []
  )

  const handleActivateCodex = useCallback(async () => {
    const agentId = codexAgentId.trim()
    if (!agentId) {
      setNotice({ tone: 'error', message: 'Set an agent id first.' })
      return
    }

    await runCodexAction(async () => {
      await activateCodexAgent(sessionId, agentId)
      setSelectedAgentId(agentId)
      setNotice({ tone: 'success', message: `Codex agent ${agentId} is ready.` })
    })
  }, [codexAgentId, runCodexAction, sessionId])

  const handleDispatchCodex = useCallback(async () => {
    const agentId = codexAgentId.trim()
    const prompt = codexPrompt.trim()

    if (!agentId || !prompt) {
      setNotice({ tone: 'error', message: 'Agent id and prompt are required.' })
      return
    }

    await runCodexAction(async () => {
      await activateCodexAgent(sessionId, agentId)
      const dispatched = await dispatchCodexTask(sessionId, agentId, {
        title: prompt.slice(0, 80),
        prompt,
      })

      setTasks((current) => [
        {
          id: dispatched.taskId,
          description: prompt.slice(0, 120),
          status: 'executing',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          agentId,
          sessionId,
        },
        ...current.filter((task) => task.id !== dispatched.taskId),
      ])
      setCodexPrompt('')
      setSelectedAgentId(agentId)
      setNotice({ tone: 'success', message: `Task sent to ${agentId}.` })
    })
  }, [codexAgentId, codexPrompt, runCodexAction, sessionId])

  const handleInterruptCodex = useCallback(async () => {
    const agentId = codexAgentId.trim()
    if (!agentId) {
      return
    }

    await runCodexAction(async () => {
      await interruptCodexAgent(sessionId, agentId)
      setNotice({ tone: 'info', message: `Interrupt requested for ${agentId}.` })
    })
  }, [codexAgentId, runCodexAction, sessionId])

  const handleResumeCodex = useCallback(async () => {
    const agentId = codexAgentId.trim()
    if (!agentId) {
      return
    }

    await runCodexAction(async () => {
      await resumeCodexAgent(sessionId, agentId)
      setNotice({ tone: 'info', message: `Resume requested for ${agentId}.` })
    })
  }, [codexAgentId, runCodexAction, sessionId])

  const handleRetryCodex = useCallback(async () => {
    const agentId = codexAgentId.trim()
    if (!agentId || !latestCodexTaskId) {
      setNotice({ tone: 'error', message: 'No codex task available to retry.' })
      return
    }

    await runCodexAction(async () => {
      await retryCodexTask(sessionId, agentId, latestCodexTaskId)
      setNotice({ tone: 'info', message: `Retry requested for ${latestCodexTaskId}.` })
    })
  }, [codexAgentId, latestCodexTaskId, runCodexAction, sessionId])

  const handleCloseCodex = useCallback(async () => {
    const agentId = codexAgentId.trim()
    if (!agentId) {
      return
    }

    await runCodexAction(async () => {
      await closeCodexAgent(sessionId, agentId)
      setNotice({ tone: 'info', message: `${agentId} closed.` })
    })
  }, [codexAgentId, runCodexAction, sessionId])

  const handleLoadBlackboard = useCallback(async () => {
    const agentId = codexAgentId.trim()

    await runCodexAction(async () => {
      const markdown = agentId
        ? await fetchAgentBlackboardMarkdown(sessionId, agentId)
        : await fetchSessionBlackboardMarkdown(sessionId)

      setBlackboardPreview(markdown)
      setNotice({ tone: 'success', message: 'Blackboard snapshot refreshed.' })
    })
  }, [codexAgentId, runCodexAction, sessionId])

  const handleRespondApproval = useCallback(
    async (approval: PendingApproval, decision: string) => {
      await runCodexAction(async () => {
        await respondCodexApproval(sessionId, approval.agentId, approval.requestId, decision)
        setPendingApprovals((current) => current.filter((item) => item.requestId !== approval.requestId))
        setNotice({ tone: 'success', message: `Approval ${approval.requestId} resolved with ${decision}.` })
      })
    },
    [runCodexAction, sessionId]
  )

  if (notFound) {
    return (
      <div className="landing-shell control-canvas min-h-screen px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
          <div className="panel-strong frame-surface w-full max-w-2xl rounded-[2.5rem] p-8 text-center sm:p-12">
            <p className="edge-label">404</p>
            <h1 className="editorial-display mt-4 text-4xl text-[var(--ink)] sm:text-5xl">Session not found</h1>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-[var(--ink-soft)]">
              The workspace <span className="font-semibold text-[var(--ink)]">{sessionId}</span> does not exist in the current backend runtime.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/" className="lavender-button">
                Back Home
              </Link>
              <button onClick={handleRetry} className="btn-secondary">
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="landing-shell control-canvas min-h-screen px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-5">
        <header className="panel frame-surface fade-up rounded-[2.4rem] px-5 py-5 sm:px-6 lg:px-8">
          <div className="pointer-events-none absolute right-8 top-4 h-px w-32 bg-gradient-to-r from-transparent via-[#67e8f9] to-transparent opacity-70" />
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="edge-label">Agent Team Control</p>
              <h1 className="editorial-display mt-3 text-4xl text-[var(--ink)] sm:text-5xl lg:text-6xl">
                Operate one session at a time, with the whole team in view.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
                Snapshot first, then live updates. The workspace hydrates from the session API and stays current through
                realtime events for agent status, tasks, and logs.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="soft-pill">Session {sessionId}</span>
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
                {connectionCopy[connectionState]}
              </span>
              <span className="signal-dot bg-[#7dd3fc]" />
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <article className="metric-card">
              <p className="metric-value">{agents.length}</p>
              <p className="metric-label">Agents</p>
            </article>
            <article className="metric-card">
              <p className="metric-value">{activeTasksCount}</p>
              <p className="metric-label">Active Tasks</p>
            </article>
            <article className="metric-card">
              <p className="metric-value">{completedTasksCount}</p>
              <p className="metric-label">Completed</p>
            </article>
          </div>
        </header>

        {notice ? (
          <div
            className={`fade-up frame-surface rounded-[1.6rem] border px-4 py-3 text-sm font-medium ${
              notice.tone === 'success'
                ? 'border-[rgba(34,197,94,0.34)] bg-[rgba(34,197,94,0.16)] text-[#86efac]'
                : notice.tone === 'error'
                  ? 'border-[rgba(239,68,68,0.34)] bg-[rgba(239,68,68,0.16)] text-[#fca5a5]'
                  : 'border-[rgba(14,165,233,0.34)] bg-[rgba(14,165,233,0.16)] text-[#7dd3fc]'
            }`}
          >
            {notice.message}
          </div>
        ) : null}

        <div className="workspace-grid gap-5">
          <SessionSidebar
            sessions={sessions}
            activeSessionId={sessionId}
            connectionState={connectionState}
            loading={loading}
          />

          <section className="dark-stage frame-surface fade-up flex min-h-[640px] flex-col overflow-hidden rounded-[2.4rem] p-4 sm:p-5 lg:p-6">
            {loading ? (
              <div className="grid flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                <div className="rounded-[2rem] bg-[rgba(148,163,184,0.1)] xl:row-span-2" />
                <div className="rounded-[2rem] bg-[rgba(148,163,184,0.1)] min-h-[420px]" />
                <div className="rounded-[2rem] bg-[rgba(148,163,184,0.1)] min-h-[260px] xl:col-start-2" />
              </div>
            ) : error ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="frame-surface max-w-xl rounded-[2rem] border border-[var(--line)] bg-[rgba(15,23,42,0.6)] p-8 text-center text-[var(--ink)]">
                  <p className="edge-label">Workspace Error</p>
                  <h2 className="mt-3 text-3xl font-semibold">Unable to load this session</h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">{error}</p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button onClick={handleRetry} className="lavender-button">
                      Retry
                    </button>
                    <Link href="/" className="btn-secondary">
                      Back Home
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                <aside className="frame-surface frame-muted rounded-[2rem] border border-[var(--line)] bg-[rgba(15,23,42,0.48)] p-4 backdrop-blur-sm sm:p-5 xl:row-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="section-title">Agents</h2>
                    <span className="soft-pill">{agents.length} online</span>
                  </div>
                  <div className="scroll-area space-y-2.5 xl:max-h-[calc(100vh-320px)] xl:overflow-y-auto xl:pr-1">
                    {agents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={{ ...agent, currentTask: agent.currentTask || undefined }}
                        selected={selectedAgentId === agent.id}
                        onClick={() => setSelectedAgentId(agent.id)}
                        onAssign={(description) => handleAssignTask(agent.id, description)}
                      />
                    ))}
                  </div>
                </aside>

                <main className="flex min-h-[560px] flex-col gap-4">
                  <section className="frame-surface frame-muted rounded-[2rem] border border-[var(--line)] bg-[rgba(15,23,42,0.48)] p-3 backdrop-blur-sm sm:p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="section-title">Flow Graph</h2>
                      <span className="soft-pill">Live pipeline</span>
                    </div>
                    <div className="h-[400px] sm:h-[500px] xl:h-[560px]">
                      <FlowChart agents={agents.map((agent) => ({ ...agent, currentTask: agent.currentTask || undefined }))} />
                    </div>
                  </section>

                  <section className="frame-surface frame-muted overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[rgba(15,23,42,0.48)] backdrop-blur-sm">
                    <LogViewer logs={logs} maxHeight="100%" showSource />
                  </section>
                </main>

                <aside className="frame-surface frame-muted flex min-h-[300px] flex-col rounded-[2rem] border border-[var(--line)] bg-[rgba(15,23,42,0.48)] p-4 backdrop-blur-sm sm:p-5 xl:col-start-2">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="section-title">Task Center</h2>
                    <span className="soft-pill">{tasks.length} tasks</span>
                  </div>
                  <section className="mb-4 rounded-2xl border border-[var(--line)] bg-[rgba(2,6,23,0.45)] p-3">
                    <p className="edge-label">Codex Agent Control</p>
                    <div className="mt-2 space-y-2">
                      <input
                        value={codexAgentId}
                        onChange={(event) => setCodexAgentId(event.target.value)}
                        placeholder="agent-main"
                        className="input w-full text-sm"
                        disabled={codexBusy}
                      />
                      <textarea
                        value={codexPrompt}
                        onChange={(event) => setCodexPrompt(event.target.value)}
                        placeholder="Describe task for Codex agent"
                        className="input min-h-[88px] w-full resize-y text-sm"
                        disabled={codexBusy}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button onClick={() => void handleActivateCodex()} className="btn-secondary text-xs" disabled={codexBusy}>
                        Activate
                      </button>
                      <button onClick={() => void handleDispatchCodex()} className="btn-primary text-xs" disabled={codexBusy || !codexPrompt.trim()}>
                        Dispatch
                      </button>
                      <button onClick={() => void handleInterruptCodex()} className="btn-secondary text-xs" disabled={codexBusy}>
                        Interrupt
                      </button>
                      <button onClick={() => void handleResumeCodex()} className="btn-secondary text-xs" disabled={codexBusy}>
                        Resume
                      </button>
                      <button onClick={() => void handleRetryCodex()} className="btn-secondary text-xs" disabled={codexBusy || !latestCodexTaskId}>
                        Retry
                      </button>
                      <button onClick={() => void handleCloseCodex()} className="btn-secondary text-xs" disabled={codexBusy}>
                        Close
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-[var(--ink-muted)]">Latest task: {latestCodexTaskId || 'none'}</span>
                      <button onClick={() => void handleLoadBlackboard()} className="text-xs text-[#7dd3fc] hover:underline" disabled={codexBusy}>
                        Refresh blackboard
                      </button>
                    </div>
                    <div className="mt-2 rounded-xl border border-[var(--line)] bg-[rgba(15,23,42,0.45)] p-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                        Pending approvals: {visibleApprovals.length}
                      </p>
                      {visibleApprovals.length === 0 ? (
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">No approval requests.</p>
                      ) : (
                        <div className="mt-2 max-h-32 space-y-2 overflow-auto pr-1">
                          {visibleApprovals.map((approval) => (
                            <div key={approval.requestId} className="rounded-lg border border-[var(--line)] bg-[rgba(2,6,23,0.65)] p-2">
                              <p className="text-xs text-[var(--ink-soft)]">{approval.command || 'Command execution approval'}</p>
                              <p className="mt-1 text-[11px] text-[var(--ink-muted)]">{approval.agentId} · {approval.cwd || 'cwd n/a'}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {(approval.availableDecisions.length > 0 ? approval.availableDecisions : ['approve', 'deny']).map((decision) => (
                                  <button
                                    key={`${approval.requestId}_${decision}`}
                                    onClick={() => void handleRespondApproval(approval, decision)}
                                    className="btn-secondary text-[11px]"
                                    disabled={codexBusy}
                                  >
                                    {decision}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {blackboardPreview ? (
                      <pre className="mt-2 max-h-28 overflow-auto rounded-xl bg-[rgba(15,23,42,0.72)] p-2 text-[11px] leading-5 text-[var(--ink-soft)]">
                        {blackboardPreview}
                      </pre>
                    ) : null}
                  </section>
                  <div className="mb-4 flex-1 overflow-hidden">
                    <TaskList tasks={tasks} onTaskClick={handleTaskClick} />
                  </div>
                  <TaskInput sessionId={sessionId} onSend={handleSendTask} />
                </aside>
              </div>
            )}
          </section>
        </div>
      </div>

      <AgentDetailPanel
        agent={selectedAgent ? { ...selectedAgent, currentTask: selectedAgent.currentTask || undefined } : null}
        onClose={() => setSelectedAgentId(null)}
        logs={selectedAgentLogs}
        taskHistory={selectedAgentHistory}
      />
    </div>
  )
}
