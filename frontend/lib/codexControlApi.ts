import { apiUrl } from '@/src/constants/agent'

interface RequestOptions extends RequestInit {
  parseAsText?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`

    try {
      const payload = await response.json()
      if (typeof payload?.error === 'string') {
        message = payload.error
      }
    } catch {
      // Keep default message.
    }

    throw new Error(message)
  }

  if (options.parseAsText) {
    return (await response.text()) as T
  }

  return (await response.json()) as T
}

export interface CodexAgentView {
  sessionId: string
  agentId: string
  state: string
  threadId: string | null
  activeTurnId: string | null
  activeTaskId: string | null
  taskCount: number
  pendingApprovalCount: number
}

export interface CodexDispatchResponse {
  taskId: string
  turnId: string | null
  threadId: string
  status: string
}

export async function listCodexAgents(sessionId: string): Promise<CodexAgentView[]> {
  const response = await request<{ agents: CodexAgentView[] }>(`/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents`)
  return response.agents
}

export async function activateCodexAgent(sessionId: string, agentId: string, harness?: Record<string, unknown>) {
  return request<CodexAgentView>(`/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents`, {
    method: 'POST',
    body: JSON.stringify({ agentId, harness: harness || {} }),
  })
}

export async function dispatchCodexTask(sessionId: string, agentId: string, payload: { title?: string; prompt: string }) {
  return request<CodexDispatchResponse>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/tasks`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
}

export async function interruptCodexAgent(sessionId: string, agentId: string) {
  return request<{ ok: boolean }>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/interrupt`,
    {
      method: 'POST',
    }
  )
}

export async function resumeCodexAgent(sessionId: string, agentId: string, prompt?: string) {
  return request<{ ok: boolean; turnId?: string }>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/resume`,
    {
      method: 'POST',
      body: JSON.stringify(prompt ? { prompt } : {}),
    }
  )
}

export async function retryCodexTask(sessionId: string, agentId: string, taskId: string) {
  return request<{ ok: boolean; turnId?: string; attempt?: number }>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/retry`,
    {
      method: 'POST',
    }
  )
}

export async function finishCodexTask(sessionId: string, taskId: string) {
  return request<{ ok: boolean; taskId: string; status: string }>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}/finish`,
    {
      method: 'POST',
    }
  )
}

export async function closeCodexAgent(sessionId: string, agentId: string) {
  return request<{ ok: boolean }>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/close`,
    {
      method: 'POST',
    }
  )
}

export async function respondCodexApproval(
  sessionId: string,
  agentId: string,
  requestId: string | number,
  decision: string
) {
  return request<{ ok: boolean }>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/approvals/${encodeURIComponent(String(requestId))}`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }
  )
}

export async function fetchSessionBlackboardMarkdown(sessionId: string) {
  return request<string>(`/api/codex-control/sessions/${encodeURIComponent(sessionId)}/blackboard/markdown`, {
    parseAsText: true,
  })
}

export async function fetchAgentBlackboardMarkdown(sessionId: string, agentId: string) {
  return request<string>(
    `/api/codex-control/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/blackboard/markdown`,
    {
      parseAsText: true,
    }
  )
}
