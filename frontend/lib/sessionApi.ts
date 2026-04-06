import { apiUrl, wsUrl } from '@/src/constants/agent'
import type { SessionSnapshot, SessionSummary, SessionTask } from '@/src/types/session'

export class SessionApiError extends Error {
  status: number
  body: string | null

  constructor(message: string, status: number, body: string | null = null) {
    super(message)
    this.name = 'SessionApiError'
    this.status = status
    this.body = body
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  const rawBody = await response.text()

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`

    try {
      const payload = JSON.parse(rawBody)
      if (typeof payload?.error === 'string') {
        message = payload.error
      }
    } catch {
      const routeMismatch = rawBody.match(/Cannot [A-Z]+ [^<\n]+/)
      if (routeMismatch?.[0]) {
        message = routeMismatch[0]
      }
    }

    throw new SessionApiError(message, response.status, rawBody || null)
  }

  try {
    return JSON.parse(rawBody) as T
  } catch {
    throw new SessionApiError('Invalid JSON response from backend', response.status, rawBody || null)
  }
}

export async function fetchSessionList(): Promise<SessionSummary[]> {
  const response = await requestJson<{ sessions: SessionSummary[] }>('/api/sessions')
  return response.sessions
}

export async function fetchSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  return requestJson<SessionSnapshot>(`/api/sessions/${encodeURIComponent(sessionId)}`)
}

export async function createTaskForSession(sessionId: string, description: string): Promise<SessionTask> {
  return requestJson<SessionTask>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ description, sessionId }),
  })
}

export async function assignTaskToAgent(sessionId: string, agentId: string, task: string) {
  return requestJson(`/api/agents/${encodeURIComponent(agentId)}/task`, {
    method: 'POST',
    body: JSON.stringify({ task, sessionId }),
  })
}

export function getWorkspaceSocketUrl(): string {
  return `${wsUrl}/ws`
}

export function subscribeToSession(socket: WebSocket, sessionId: string) {
  socket.send(
    JSON.stringify({
      type: 'subscribe',
      payload: {
        sessionId,
        events: [
          'agent_status',
          'task_update',
          'task:new',
          'log_entry',
          'command_execution',
          'command_output_delta',
          'approval_required',
          'approval_resolved',
        ],
      },
    })
  )
}
