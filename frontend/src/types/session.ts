import type { Agent } from '@/src/types/agent'

export type TaskStatus =
  | 'assigned'
  | 'pending'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'completed'
  | 'rejected'
  | 'interrupted'
  | 'failed'
  | 'working'
  | 'error'
  | 'idle'

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface SessionTask {
  id: string
  sessionId?: string
  description: string
  status: TaskStatus
  createdAt: string
  updatedAt?: string
  agentId?: string | null
  result?: string | null
  error?: string | null
}

export interface SessionLogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source?: 'frontend' | 'backend'
  message: string
  metadata?: Record<string, unknown>
  taskId?: string | null
  agentId?: string | null
  sessionId?: string
}

export interface SessionSummary {
  id: string
  createdAt: string
  updatedAt: string
  taskCount: number
  activeTaskCount: number
  agentCount: number
  latestLogAt: string | null
}

export interface SessionDetails {
  id: string
  createdAt: string
  updatedAt: string
}

export type SessionAgent = Omit<Agent, 'currentTask'> & {
  currentTask?: string | null
  role?: string
  taskHistory?: Array<{
    task: string
    assignedAt: string
    completedAt?: string
    result?: string | null
  }>
}

export interface SessionSnapshot {
  session: SessionDetails
  agents: SessionAgent[]
  tasks: SessionTask[]
  logs: SessionLogEntry[]
}

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting'

export interface AgentStatusEvent {
  type: 'agent_status'
  sessionId: string
  timestamp?: string
  payload?: {
    agentId?: string
    data?: Partial<SessionAgent> & { log?: string }
  }
}

export interface TaskUpdateEvent {
  type: 'task_update'
  sessionId: string
  timestamp?: string
  payload?: {
    taskId?: string
    data?: Partial<SessionTask>
  }
}

export interface TaskNewEvent {
  type: 'task:new'
  sessionId: string
  timestamp?: string
  task?: SessionTask
}

export interface LogEntryEvent {
  type: 'log_entry'
  sessionId: string
  timestamp?: string
  payload?: {
    logId?: string
    data?: {
      level?: LogLevel
      message?: string
      taskId?: string | null
      agentId?: string | null
      [key: string]: unknown
    }
  }
}

export interface ControlEvent {
  type: 'subscribed' | 'unsubscribed' | 'pong' | 'error'
  sessionId?: string
  timestamp?: string
  payload?: Record<string, unknown>
}

export interface CommandExecutionEvent {
  type: 'command_execution'
  sessionId: string
  timestamp?: string
  payload?: {
    agentId?: string
    taskId?: string | null
    command?: string
    cwd?: string | null
    status?: string
    exitCode?: number | null
    durationMs?: number | null
    outputPreview?: string
    threadId?: string
    turnId?: string
  }
}

export interface CommandOutputDeltaEvent {
  type: 'command_output_delta'
  sessionId: string
  timestamp?: string
  payload?: {
    agentId?: string
    itemId?: string
    threadId?: string
    turnId?: string
    delta?: string
  }
}

export interface ApprovalRequiredEvent {
  type: 'approval_required'
  sessionId: string
  timestamp?: string
  payload?: {
    requestId?: string | number
    agentId?: string
    availableDecisions?: string[]
    command?: string | null
    cwd?: string | null
  }
}

export interface ApprovalResolvedEvent {
  type: 'approval_resolved'
  sessionId: string
  timestamp?: string
  payload?: {
    requestId?: string | number
    agentId?: string
    decision?: string
  }
}

export type SessionSocketEvent =
  | AgentStatusEvent
  | TaskUpdateEvent
  | TaskNewEvent
  | LogEntryEvent
  | CommandExecutionEvent
  | CommandOutputDeltaEvent
  | ApprovalRequiredEvent
  | ApprovalResolvedEvent
  | ControlEvent
