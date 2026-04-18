import { resolveBrowserApiUrl } from '@/lib/runtimeConfig'

export interface Agent {
  id: string
  name: string
  status: 'idle' | 'working' | 'completed' | 'error'
  currentTask?: string
}

export interface Task {
  id: string
  description: string
  status: string
  logs: string[]
}

export async function getAgents(): Promise<Agent[]> {
  const res = await fetch(`${resolveBrowserApiUrl()}/api/agents`)
  return res.json()
}

export async function createTask(description: string): Promise<Task> {
  const res = await fetch(`${resolveBrowserApiUrl()}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  return res.json()
}

export async function assignTask(agentId: string, task: string): Promise<void> {
  await fetch(`${resolveBrowserApiUrl()}/api/agents/${agentId}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  })
}

export async function codexChat(messages: any[]): Promise<string> {
  const res = await fetch(`${resolveBrowserApiUrl()}/api/codex/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  const data = await res.json()
  return data.reply
}
